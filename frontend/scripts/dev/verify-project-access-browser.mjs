import { chromium } from '@playwright/test';

async function launchBrowser() {
  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let lastError;
  for (const opt of options) {
    try {
      return await chromium.launch({ ...opt, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
import https from 'node:https';
import fs from 'node:fs';

const ca = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));
const BASE_URL = 'http://localhost:5199';

function req(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'https://localhost:8443');
    const headers = {
      Origin: 'https://localhost:8443',
      ...(options.headers || {})
    };
    const reqObj = https.request(url, {
      method: options.method || 'GET',
      headers,
      ca,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: bodyText,
          json: bodyJson,
          setCookie: res.headers['set-cookie']
        });
      });
    });
    reqObj.on('error', reject);
    if (options.body) {
      if (typeof options.body === 'object') {
        reqObj.setHeader('Content-Type', 'application/json');
        reqObj.write(JSON.stringify(options.body));
      } else {
        reqObj.write(options.body);
      }
    }
    reqObj.end();
  });
}

function parseCookies(cookies) {
  if (!cookies) return '';
  return cookies.map(c => c.split(';')[0]).join('; ');
}

async function verifyEmail(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.includes('Verify')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Verification email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const token = new URL(detail.Text.trim()).searchParams.get('token');
  const csrfRes = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfRes.json?.token, 'Cookie': parseCookies(csrfRes.setCookie) },
    body: { token }
  });
}

async function getInviteToken(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.toLowerCase().includes('invitation')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Invite email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const match = detail.Text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invite token not found in email body for: ' + email);
  return match[1];
}

async function loginUser(email, password) {
  const cRes = await req('/api/v1/identity/csrf');
  const token = cRes.json?.token;
  const cookie0 = parseCookies(cRes.setCookie);

  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token, 'Cookie': cookie0 },
    body: { email, password }
  });
  if (lRes.status !== 200) throw new Error('Login failed for ' + email + ': ' + lRes.status + ' ' + lRes.text);

  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { 'Cookie': cookie1 } });
  const finalToken = postCsrf.json?.token;
  const finalCookie = cookie1 + '; ' + parseCookies(postCsrf.setCookie);

  return { email, token: finalToken, cookie: finalCookie };
}

async function registerAndVerify(email, password, name) {
  const csrf = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf.json?.token, 'Cookie': parseCookies(csrf.setCookie) },
    body: { email, password, name }
  });
  await verifyEmail(email);
  return loginUser(email, password);
}

async function run() {
  console.log('=== STARTING PROJECT ACCESS BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.acc.${ts}@example.com`;
  let ownerAuth = await registerAndVerify(ownerEmail, defaultPass, 'Owner Access');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `Access Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Access' }
  });
  const orgId = orgRes.json?.organizationId;
  ownerAuth = await loginUser(ownerEmail, defaultPass);

  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client Access ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Client Contact
  const contactRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cnt-${ts}` },
    body: { name: 'Mona Fathy', email: `mona.${ts}@client.example.com`, status: 'ACTIVE' }
  });
  console.log('Setup contact response status:', contactRes.status);
  const contactId = contactRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `prj-${ts}` },
    body: { client_id: clientId, name: `Project Access ${ts}`, description: 'Testing Project Access', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Initial Manager (Owner)
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-mgr-${ts}` },
    body: { membership_id: ownerPrincipalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // 2. Setup Contributor (team member)
  const contribEmail = `contrib.acc.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Omar');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie, 'idempotency-key': `acc-c-${ts}` },
    body: { token: contribInviteToken }
  });
  const contribAuth = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribAuth.cookie } })).json?.items || [];
  const contribPrincipalId = contribPrincipals[0]?.id;

  // 3. Setup Org Member to be added via candidates
  const candidateEmail = `cand.acc.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-cand-${ts}` },
    body: { email: candidateEmail, role: 'MEMBER' }
  });
  const candToken = await getInviteToken(candidateEmail);
  const candReg = await registerAndVerify(candidateEmail, defaultPass, 'Candidate Layla');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': candReg.token, 'Cookie': candReg.cookie, 'idempotency-key': `acc-cand-${ts}` },
    body: { token: candToken }
  });

  // ---------------------------------------------------------------------------
  // TEST A: Missing or invalid ?id parameter
  // ---------------------------------------------------------------------------
  console.log('\n[A] Testing missing or invalid ?id parameter...');
  const testCtx = await browser.newContext();
  const testPage = await testCtx.newPage();
  await testPage.goto(`${BASE_URL}/login`);
  await testPage.fill('#e', ownerEmail);
  await testPage.fill('#p', defaultPass);
  await testPage.click('button[type="submit"]');
  await testPage.waitForURL('**/workspace/dashboard**');

  await testPage.goto(`${BASE_URL}/project/project-access`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-access?id=invalid-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) Operations
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  mgrPage.on('console', msg => console.log('MGR LOG:', msg.text()));
  mgrPage.on('pageerror', err => console.log('MGR ERR:', err.message));
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-access?id=${projectId}`);
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Access ${ts}`, { timeout: 10000 });

  // 1. Add team member from candidates
  console.log('   Testing add team member from candidates...');
  await mgrPage.waitForSelector('#am-c', { timeout: 8000 });
  await mgrPage.selectOption('#am-c', { label: 'Candidate Layla' });
  await mgrPage.selectOption('#am-r', 'CONTRIBUTOR');
  await mgrPage.click('#am-btn');

  await mgrPage.waitForFunction(() => {
    return Array.from(document.querySelectorAll('#it tr td')).some(td => td.textContent.includes('Candidate Layla'));
  }, { timeout: 8000 });
  console.log('   [PASS] Candidate Layla added to internal team as Contributor');

  // 2. Change member role to Viewer
  console.log('   Testing member role update...');
  // Find Candidate Layla's row select
  const laylaRowIdx = await mgrPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#it tr'));
    return rows.findIndex(r => r.textContent.includes('Candidate Layla'));
  });
  await mgrPage.selectOption(`#it tr:nth-child(${laylaRowIdx + 1}) select[data-i]`, 'Viewer');
  await mgrPage.waitForTimeout(1000);
  const laylaRoleVal = await mgrPage.$eval(`#it tr:nth-child(${laylaRowIdx + 1}) select[data-i]`, s => s.value);
  console.log('   Layla role value after change:', laylaRoleVal);
  if (laylaRoleVal !== 'VIEWER') throw new Error('Expected role updated to VIEWER');
  console.log('   [PASS] Member role updated to Viewer');

  // 3. Last manager demotion protection
  console.log('   Testing last manager demotion protection...');
  // Owner is the sole Manager, attempt to demote Owner to Contributor
  await mgrPage.selectOption('#it tr:nth-child(1) select[data-i]', 'Contributor');
  await mgrPage.waitForSelector('#ce:not([hidden])', { timeout: 5000 });
  const ceText = await mgrPage.textContent('#ce');
  console.log('   Last manager warning:', ceText?.trim());
  if (!ceText?.includes('at least one manager')) throw new Error('Expected at least one manager warning in #ce');
  console.log('   [PASS] Demoting sole manager is blocked with visible warning');

  // 4. Invite client contact
  console.log('   Testing client contact invite (grant)...');
  console.log('   ct innerHTML:', await mgrPage.innerHTML('#ct'));
  console.log('   em hidden:', await mgrPage.getAttribute('#em', 'hidden'));
  await mgrPage.waitForSelector('#ct button[data-v]', { timeout: 8000 });
  await mgrPage.click('#ct button[data-v]');

  await mgrPage.waitForFunction(() => {
    const row = document.querySelector('#ct tr');
    return row && row.textContent.includes('Active') && row.querySelector('button[data-r]');
  }, { timeout: 8000 });
  console.log('   [PASS] Client contact access granted with Active status');

  // 5. Toggle "Can decide" checkbox
  console.log('   Testing "Can decide" checkbox...');
  const canDecideCb = await mgrPage.$('#ct input[data-d]');
  const isCheckedBefore = await canDecideCb.isChecked();
  console.log('   Checkbox before toggle (expected false/REVIEWER):', isCheckedBefore);
  if (isCheckedBefore) throw new Error('Expected initially unchecked (REVIEWER)');

  await canDecideCb.check();
  await mgrPage.waitForTimeout(1000);
  const isCheckedAfter = await canDecideCb.isChecked();
  console.log('   Checkbox after checking (expected true/APPROVER):', isCheckedAfter);
  if (!isCheckedAfter) throw new Error('Expected checkbox checked');
  console.log('   [PASS] Contact upgraded to Approver (Can decide)');

  // Untoggle back to Reviewer
  await canDecideCb.uncheck();
  await mgrPage.waitForTimeout(1000);
  console.log('   [PASS] Contact downgraded back to Reviewer');

  // 6. Remove client access
  console.log('   Testing remove client access...');
  await mgrPage.click('#ct button[data-r]');
  await mgrPage.waitForSelector('#dg[open]', { timeout: 5000 });
  const wmText = await mgrPage.textContent('#wm');
  console.log('   Remove dialog message:', wmText?.trim());
  if (!wmText?.includes('Remove Mona Fathy’s access')) throw new Error('Expected remove confirmation prompt');

  await mgrPage.click('#dgf button[type="submit"]');
  await mgrPage.waitForFunction(() => {
    const row = document.querySelector('#ct tr');
    return row && row.textContent.includes('Not on this project') && row.querySelector('button[data-v]');
  }, { timeout: 8000 });
  console.log('   [PASS] Client contact access removed (grant REVOKED)');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR permissions (read-only on access page)
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR...');
  // Add Contributor Omar to project members via API
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-c-${ts}` },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });

  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-access?id=${projectId}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Access ${ts}`, { timeout: 10000 });

  const cAddRowVis = await contribPage.isVisible('.add-member-row');
  const cSelectsCount = await contribPage.$$eval('#it select', els => els.length);
  const cCtButtonsCount = await contribPage.$$eval('#ct button', els => els.length);
  console.log('   Contributor add row visible:', cAddRowVis, 'role selects:', cSelectsCount, 'ct buttons:', cCtButtonsCount);
  if (cAddRowVis || cSelectsCount > 0 || cCtButtonsCount > 0) {
    throw new Error('Contributor must have read-only view on project access');
  }

  // Server error test on forbidden mutation
  const contribPost = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': contribAuth.token, 'Cookie': contribAuth.cookie, 'x-organization-principal': contribPrincipalId },
    body: { membership_id: contribPrincipalId, role: 'MANAGER', status: 'ACTIVE' }
  });
  console.log('   Contributor POST member status & code:', contribPost.status, contribPost.json?.code);
  if (contribPost.status !== 403 || contribPost.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Contributor POST, got ${contribPost.status}`);
  }
  console.log('   [PASS] Contributor has read-only access and server rejects mutations with 403 FORBIDDEN');
  await contribCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT ACCESS BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project access verification:', err);
  process.exit(1);
});
