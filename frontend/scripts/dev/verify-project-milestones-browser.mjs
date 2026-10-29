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
  console.log('=== STARTING PROJECT MILESTONES BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.ms.${ts}@example.com`;
  let ownerAuth = await registerAndVerify(ownerEmail, defaultPass, 'Owner Milestones');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `Milestones Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Milestones' }
  });
  const orgId = orgRes.json?.organizationId;
  ownerAuth = await loginUser(ownerEmail, defaultPass);

  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client MS ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `prj-${ts}` },
    body: { client_id: clientId, name: `Project Milestones ${ts}`, description: 'Testing Milestones Page', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Initial milestone 1
  const ms1Res = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ms1-${ts}` },
    body: { title: 'Script Lock', due_at: '2026-11-01T23:59:59.000Z', position: 0, status: 'OPEN' }
  });
  const ms1Id = ms1Res.json?.id;

  // Initial milestone 2
  const ms2Res = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ms2-${ts}` },
    body: { title: 'Rough Cut Delivery', due_at: '2026-11-15T23:59:59.000Z', position: 1, status: 'OPEN' }
  });
  const ms2Id = ms2Res.json?.id;

  // 2. Setup Contributor
  const contribEmail = `contrib.ms.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Tariq');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie, 'idempotency-key': `acc-c-${ts}` },
    body: { token: contribInviteToken }
  });
  const contribAuth = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribAuth.cookie } })).json?.items || [];
  const contribPrincipalId = contribPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-c-${ts}` },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });

  // 3. Setup Viewer
  const viewerEmail = `viewer.ms.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-v-${ts}` },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerInviteToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer Laila');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': viewerReg.token, 'Cookie': viewerReg.cookie, 'idempotency-key': `acc-v-${ts}` },
    body: { token: viewerInviteToken }
  });
  const viewerAuth = await loginUser(viewerEmail, defaultPass);
  const viewerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': viewerAuth.cookie } })).json?.items || [];
  const viewerPrincipalId = viewerPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-v-${ts}` },
    body: { membership_id: viewerPrincipalId, role: 'VIEWER', status: 'ACTIVE' }
  });

  // 4. Setup Non-Member Admin
  const nonMemberEmail = `admin.ms.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-nm-${ts}` },
    body: { email: nonMemberEmail, role: 'ADMIN' }
  });
  const nonMemberInviteToken = await getInviteToken(nonMemberEmail);
  const nonMemberReg = await registerAndVerify(nonMemberEmail, defaultPass, 'Admin NonMember');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': nonMemberReg.token, 'Cookie': nonMemberReg.cookie, 'idempotency-key': `acc-nm-${ts}` },
    body: { token: nonMemberInviteToken }
  });
  const nonMemberAuth = await loginUser(nonMemberEmail, defaultPass);

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

  await testPage.goto(`${BASE_URL}/project/project-milestones`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-milestones?id=invalid-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) creates, reorders, renames, completes, reopens
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-milestones?id=${projectId}`);
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Milestones ${ts}`, { timeout: 10000 });

  // 1. Create New Milestone
  console.log('   Creating new milestone...');
  const nmVis = await mgrPage.isVisible('#nm');
  if (!nmVis) throw new Error('New milestone button must be visible for Manager');

  await mgrPage.click('#nm');
  await mgrPage.waitForSelector('#dg[open]', { timeout: 5000 });
  await mgrPage.fill('#mt', 'Final Sound Mix');
  await mgrPage.fill('#md', '2026-11-28');
  await mgrPage.click('#dgf button[type="submit"]');

  await mgrPage.waitForFunction(() => {
    return Array.from(document.querySelectorAll('#ls li b')).some(b => b.textContent.includes('Final Sound Mix'));
  }, { timeout: 8000 });
  console.log('   [PASS] Milestone created and rendered in list');

  // 2. Reorder Milestones (move Final Sound Mix up)
  console.log('   Testing reorder milestones...');
  const itemsBefore = await mgrPage.$$eval('#ls li b', els => els.map(e => e.textContent.trim()));
  console.log('   Order before reorder:', itemsBefore);
  // Final Sound Mix is at index 2 (last), click its move up button
  await mgrPage.click('#ls li:nth-child(3) button[data-u]');
  await mgrPage.waitForTimeout(1000);
  const itemsAfter = await mgrPage.$$eval('#ls li b', els => els.map(e => e.textContent.trim()));
  console.log('   Order after move up:', itemsAfter);
  if (itemsAfter[1] !== 'Final Sound Mix') throw new Error('Expected Final Sound Mix moved to position 1');
  console.log('   [PASS] Milestone reordered via position swap');

  // 3. Rename Milestone
  console.log('   Testing rename milestone...');
  // Click rename on first milestone (Script Lock)
  await mgrPage.click('#ls li:nth-child(1) button[data-r]');
  await mgrPage.waitForSelector('dialog[open] input', { timeout: 5000 });
  await mgrPage.fill('dialog[open] input', 'Approved Script Lock');
  await mgrPage.click('dialog[open] button[type="submit"]');

  await mgrPage.waitForFunction(() => {
    return document.querySelector('#ls li:nth-child(1) b')?.textContent?.includes('Approved Script Lock');
  }, { timeout: 8000 });
  console.log('   [PASS] Milestone renamed in DOM');

  // 4. Mark Complete & Reopen
  console.log('   Testing complete and reopen...');
  // Complete the first milestone
  await mgrPage.click('#ls li:nth-child(1) button[data-c]');
  await mgrPage.waitForFunction(() => {
    const li = document.querySelector('#ls li:nth-child(1)');
    return li && li.classList.contains('done') && li.querySelector('button[data-c]')?.textContent?.trim() === 'Reopen';
  }, { timeout: 8000 });
  console.log('   [PASS] Milestone marked Complete');

  // Reopen
  await mgrPage.click('#ls li:nth-child(1) button[data-c]');
  await mgrPage.waitForFunction(() => {
    const li = document.querySelector('#ls li:nth-child(1)');
    return li && !li.classList.contains('done') && li.querySelector('button[data-c]')?.textContent?.trim() === 'Mark complete';
  }, { timeout: 8000 });
  const reNotice = await mgrPage.textContent('#re');
  console.log('   Reopen notice:', reNotice?.trim());
  if (!reNotice?.includes('was reopened')) throw new Error('Expected reopen notice in #re');
  console.log('   [PASS] Milestone reopened and #re banner displayed');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR & VIEWER permissions
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR and VIEWER...');
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-milestones?id=${projectId}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Milestones ${ts}`, { timeout: 10000 });
  await contribPage.waitForSelector('#ls li', { timeout: 10000 });

  const cNmVis = await contribPage.isVisible('#nm');
  const cButtonsCount = await contribPage.$$eval('#ls button', els => els.length);
  console.log('   Contributor #nm visible:', cNmVis, 'action buttons count:', cButtonsCount);
  if (cNmVis || cButtonsCount > 0) throw new Error('Mutation buttons must be hidden for Contributor');

  // Server error test on forbidden mutation
  const contribPost = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': contribAuth.token, 'Cookie': contribAuth.cookie, 'x-organization-principal': contribPrincipalId },
    body: { title: 'Forbidden Milestone', due_at: null, position: 10, status: 'OPEN' }
  });
  console.log('   Contributor POST milestone status & code:', contribPost.status, contribPost.json?.code);
  if (contribPost.status !== 403 || contribPost.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Contributor POST, got ${contribPost.status}`);
  }
  console.log('   [PASS] Contributor mutation controls hidden and server returns 403 FORBIDDEN');
  await contribCtx.close();

  // Viewer checks
  const viewerCtx = await browser.newContext();
  const viewerPage = await viewerCtx.newPage();
  await viewerPage.goto(`${BASE_URL}/login`);
  await viewerPage.fill('#e', viewerEmail);
  await viewerPage.fill('#p', defaultPass);
  await viewerPage.click('button[type="submit"]');
  await viewerPage.waitForURL('**/workspace/dashboard**');

  await viewerPage.goto(`${BASE_URL}/project/project-milestones?id=${projectId}`);
  await viewerPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Milestones ${ts}`, { timeout: 10000 });
  await viewerPage.waitForSelector('#ls li', { timeout: 10000 });

  const vNmVis = await viewerPage.isVisible('#nm');
  const vButtonsCount = await viewerPage.$$eval('#ls button', els => els.length);
  if (vNmVis || vButtonsCount > 0) throw new Error('Mutation buttons must be hidden for Viewer');

  const viewerPatch = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones/${ms1Id}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId, 'If-Match': '"1"' },
    body: { title: 'Forbidden Patch', due_at: null, position: 0, status: 'OPEN' }
  });
  console.log('   Viewer PATCH milestone status & code:', viewerPatch.status, viewerPatch.json?.code);
  if (viewerPatch.status !== 403 || viewerPatch.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer PATCH, got ${viewerPatch.status}`);
  }
  console.log('   [PASS] Viewer mutation controls hidden and server returns 403 FORBIDDEN');
  await viewerCtx.close();

  // ---------------------------------------------------------------------------
  // TEST D: Org ADMIN who is not in project_membership
  // ---------------------------------------------------------------------------
  console.log('\n[D] Testing Org ADMIN who is not in project_membership...');
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE_URL}/login`);
  await adminPage.fill('#e', nonMemberEmail);
  await adminPage.fill('#p', defaultPass);
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL('**/workspace/dashboard**');

  await adminPage.goto(`${BASE_URL}/project/project-milestones?id=${projectId}`);
  await adminPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Milestones ${ts}`, { timeout: 10000 });
  await adminPage.waitForSelector('#ls li', { timeout: 10000 });

  const aNmVis = await adminPage.isVisible('#nm');
  const aButtonsCount = await adminPage.$$eval('#ls button', els => els.length);
  console.log('   Non-member Admin #nm visible:', aNmVis, 'buttons count:', aButtonsCount);
  if (!aNmVis || aButtonsCount === 0) throw new Error('Org ADMIN must inherit Manager privileges (controls visible)');
  console.log('   [PASS] Org ADMIN inherits Manager privileges on milestones');
  await adminCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT MILESTONES BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project milestones verification:', err);
  process.exit(1);
});
