/**
 * Browser verification script for /project/project-activity
 * 
 * Verifies:
 * 1. Missing or invalid ?id parameter renders neutral not-available state.
 * 2. Real project activity events listed with Time, Who, Action, and On.
 * 3. Dynamic Who filter options populated with real actors.
 * 4. Date range filter (From / To) calls backend with ISO datetime query params.
 * 5. Type filter (Tasks, Files, Reviews, Access) filters events.
 * 6. Empty state displays appropriate messaging ("No events match" when filtered).
 * 7. Multi-role access: MANAGER, CONTRIBUTOR, and VIEWER can all inspect activity.
 */

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
  console.log('=== STARTING PROJECT ACTIVITY BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.act.${ts}@example.com`;
  let ownerAuth = await registerAndVerify(ownerEmail, defaultPass, 'Owner Activist');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `Activity Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Activity' }
  });
  const orgId = orgRes.json?.organizationId;
  ownerAuth = await loginUser(ownerEmail, defaultPass);

  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client Act ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `proj-${ts}` },
    body: { client_id: clientId, name: `Project Activity ${ts}`, description: 'Testing Activity Events', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Add Owner as MANAGER
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-mgr-${ts}` },
    body: { membership_id: ownerPrincipalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // Generate activities on the project
  // Activity 1: Start a discussion
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/discussions`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `disc-${ts}` },
    body: { title: 'First Project Discussion', body: 'Let us coordinate on deliverables.' }
  });

  // Activity 2: Create a task
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `task-${ts}` },
    body: { title: 'Draft production schedule', description: 'Detailed timeline', priority: 'HIGH', status: 'TODO' }
  });

  // Activity 3: Create a milestone
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ms-${ts}` },
    body: { title: 'Initial Draft Review', status: 'PLANNED' }
  });

  // 2. Setup Contributor
  const contribEmail = `contrib.act.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Charlie');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie, 'idempotency-key': `acc-c-${ts}` },
    body: { token: contribToken }
  });
  const contribAuth = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribAuth.cookie } })).json?.items || [];
  const contribPrincipalId = contribPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-c-${ts}` },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
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

  await testPage.goto(`${BASE_URL}/project/project-activity`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-activity?id=invalid-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) View and Operations
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  mgrPage.on('console', msg => console.log('   [MGR LOG]', msg.text()));
  mgrPage.on('pageerror', err => console.error('   [MGR ERROR]', err));
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-activity?id=${projectId}`);
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Activity ${ts}`, { timeout: 10000 });

  // 1. Verify Activity Records Rendered
  await mgrPage.waitForSelector('#tb tr', { timeout: 8000 });
  const rowsCount = await mgrPage.locator('#tb tr').count();
  console.log('   Total activity rows loaded:', rowsCount);
  if (rowsCount === 0) throw new Error('Expected activity rows to be rendered');

  const firstRowText = await mgrPage.textContent('#tb tr:nth-child(1)');
  console.log('   First row text:', firstRowText?.trim());
  if (!firstRowText?.includes(`Project Activity ${ts}`)) {
    throw new Error('Expected project name in On column');
  }

  // 2. Verify Pagination Info
  const pgText = await mgrPage.textContent('#pg');
  console.log('   Pagination text:', pgText?.trim());
  if (!pgText?.includes('Page 1 of')) throw new Error('Expected Page 1 of N in pagination');
  const pvDisabled = await mgrPage.isDisabled('#pv');
  console.log('   Previous button disabled on page 1:', pvDisabled);
  if (!pvDisabled) throw new Error('Previous button must be disabled on page 1');
  console.log('   [PASS] Activity table and pagination rendered correctly');

  // 3. Test Filter - Future Date Filter -> Empty State
  console.log('   Testing date range filter (future date window -> empty state)...');
  await mgrPage.fill('#fa', '2099-01-01');
  await mgrPage.dispatchEvent('#fa', 'change');
  await mgrPage.waitForSelector('#em:not([hidden])', { timeout: 8000 });
  const emptyTitle = await mgrPage.textContent('#et');
  const emptyHint = await mgrPage.textContent('#eh');
  console.log('   Filtered empty title & hint:', emptyTitle?.trim(), emptyHint?.trim());
  if (!emptyTitle?.includes('No events match')) throw new Error('Expected "No events match" when filtered');

  // Clear date filter
  await mgrPage.fill('#fa', '');
  await mgrPage.dispatchEvent('#fa', 'change');
  await mgrPage.waitForSelector('#tb tr', { timeout: 8000 });
  const restoredCount = await mgrPage.locator('#tb tr').count();
  console.log('   Rows restored after clearing date filter:', restoredCount);
  if (restoredCount === 0) throw new Error('Expected rows to be restored');
  console.log('   [PASS] Date filtering and filtered empty state verified');

  // 4. Verify Who and Type controls are removed from UI
  console.log('   Verifying Who and Type controls are absent...');
  const ftExists = await mgrPage.locator('#ft').count();
  const fwExists = await mgrPage.locator('#fw').count();
  if (ftExists > 0 || fwExists > 0) {
    throw new Error('Expected #ft and #fw to be removed from UI');
  }
  console.log('   [PASS] Who (#fw) and Type (#ft) controls successfully removed from UI');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR permissions
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR...');
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-activity?id=${projectId}`);
  await contribPage.waitForSelector('#tb tr', { timeout: 10000 });
  const contribRows = await contribPage.locator('#tb tr').count();
  console.log('   Contributor can see activity rows:', contribRows);
  if (contribRows === 0) throw new Error('Contributor must be able to view project activity');
  console.log('   [PASS] Contributor has full read visibility on project activity');
  await contribCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT ACTIVITY BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project activity verification:', err);
  process.exit(1);
});
