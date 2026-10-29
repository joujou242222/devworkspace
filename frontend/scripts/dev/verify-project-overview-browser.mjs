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
  return await loginUser(email, password);
}

async function run() {
  console.log('=== STARTING PROJECT OVERVIEW BROWSER VERIFICATION ===');
  const browser = await launchBrowser();

  const defaultPass = 'Disposable-phase2-password-123!';
  const ts = Date.now();

  // 1. Setup Org, Client & Project
  const ownerEmail = `owner.proj.${ts}@example.com`;
  const ownerReg = await registerAndVerify(ownerEmail, defaultPass, 'Project Owner');
  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerReg.token, 'Cookie': ownerReg.cookie, 'idempotency-key': `org-create-${ts}` },
    body: { name: `Project Test Org ${ts}`, description: 'Testing Project Overview', timezone: 'UTC' }
  });
  const orgId = orgRes.json?.organizationId;
  const ownerAuth = await loginUser(ownerEmail, defaultPass);
  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { name: `Apex Dynamics ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  const projectRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { client_id: clientId, name: `Brand Film ${ts}`, description: 'Flagship video production', due_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(), portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projectRes.json?.id;
  console.log('Created Project:', projectId);

  // 2. Setup Contributor (Org Member with CONTRIBUTOR project role)
  const contribEmail = `contrib.proj.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-contrib-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie, 'idempotency-key': `acc-contrib-${ts}` },
    body: { token: contribInviteToken }
  });
  const contribAuth = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribAuth.cookie } })).json?.items || [];
  const contribPrincipalId = contribPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });

  // 3. Setup Viewer (Org Member with VIEWER project role)
  const viewerEmail = `viewer.proj.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-viewer-${ts}` },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerInviteToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': viewerReg.token, 'Cookie': viewerReg.cookie, 'idempotency-key': `acc-viewer-${ts}` },
    body: { token: viewerInviteToken }
  });
  const viewerAuth = await loginUser(viewerEmail, defaultPass);
  const viewerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': viewerAuth.cookie } })).json?.items || [];
  const viewerPrincipalId = viewerPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { membership_id: viewerPrincipalId, role: 'VIEWER', status: 'ACTIVE' }
  });

  // 4. Setup Non-Member Admin (Org Admin, NOT in project_membership)
  const nonMemberEmail = `admin.nonmember.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-nonmember-${ts}` },
    body: { email: nonMemberEmail, role: 'ADMIN' }
  });
  const nonMemberInviteToken = await getInviteToken(nonMemberEmail);
  const nonMemberReg = await registerAndVerify(nonMemberEmail, defaultPass, 'Admin NonMember');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': nonMemberReg.token, 'Cookie': nonMemberReg.cookie, 'idempotency-key': `acc-nonmember-${ts}` },
    body: { token: nonMemberInviteToken }
  });

  // ---------------------------------------------------------------------------
  // TEST A: Missing or invalid project ID renders neutral not-available state
  // ---------------------------------------------------------------------------
  console.log('\n[A] Testing missing or invalid ?id parameter...');
  const testCtx = await browser.newContext();
  const testPage = await testCtx.newPage();
  await testPage.goto(`${BASE_URL}/login`);
  await testPage.fill('#e', ownerEmail);
  await testPage.fill('#p', defaultPass);
  await testPage.click('button[type="submit"]');
  await testPage.waitForURL('**/workspace/dashboard**', { timeout: 10000 });

  // Missing id
  await testPage.goto(`${BASE_URL}/project/project`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  // Invalid UUID
  await testPage.goto(`${BASE_URL}/project/project?id=not-a-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) sees all controls and performs actions
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project?id=${projectId}`);
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Brand Film ${ts}`, { timeout: 10000 });

  const h1Text = await mgrPage.textContent('.top h1');
  console.log('   Project title rendered:', h1Text?.trim());
  if (!h1Text?.includes(`Brand Film ${ts}`)) throw new Error('Expected project title');

  // Check sub-navigation links automatically carried ?id=<uuid>
  const tasksLink = await mgrPage.getAttribute('nav.ptabs a[href*="project-tasks"]', 'href');
  console.log('   Tasks sub-nav link:', tasksLink);
  if (!tasksLink?.includes(`id=${projectId}`)) throw new Error('Expected sub-nav to preserve ?id=<uuid>');

  // Verify Manager controls are visible
  const edVis = await mgrPage.isVisible('#ed');
  const puVis = await mgrPage.isVisible('#pu');
  const coVis = await mgrPage.isVisible('#co');
  console.log('   Manager controls visible:', { ed: edVis, pu: puVis, co: coVis });
  if (!edVis || !puVis || !coVis) throw new Error('Expected Manager controls visible');

  // 1. Edit Project Modal test
  console.log('   Testing Edit Project modal...');
  await mgrPage.click('#ed');
  await mgrPage.waitForSelector('#dg[open]', { timeout: 5000 });
  await mgrPage.fill('#en', `Brand Film Updated ${ts}`);
  await mgrPage.click('#dgf button[type="submit"]');
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Brand Film Updated ${ts}`);
  console.log('   [PASS] Project edited and title updated in DOM');

  // 2. Post Client Update test
  console.log('   Testing Post Client Update...');
  await mgrPage.click('#pu');
  await mgrPage.waitForSelector('#du[open]', { timeout: 5000 });
  await mgrPage.fill('#ut', 'Script Approved');
  await mgrPage.fill('#ub', 'Client approved script version 2. Production scheduled.');
  await mgrPage.click('#duf button[type="submit"]');
  await mgrPage.waitForSelector('#up:not([hidden])', { timeout: 8000 });
  console.log('   [PASS] Client update posted and banner displayed');

  // 3. Complete Project test
  console.log('   Testing Complete Project...');
  await mgrPage.click('#co');
  // Confirm dialog
  await mgrPage.waitForSelector('dialog[open]', { timeout: 5000 });
  await mgrPage.click('dialog[open] button[type="submit"]');
  await mgrPage.waitForSelector('#cl:not([hidden])', { timeout: 8000 });
  const completedStatus = await mgrPage.textContent('#stt');
  console.log('   Status after completion:', completedStatus?.trim());
  if (completedStatus?.trim() !== 'Completed') throw new Error('Expected Completed status');

  const edAfter = await mgrPage.isVisible('#ed');
  const puAfter = await mgrPage.isVisible('#pu');
  const coAfter = await mgrPage.isVisible('#co');
  if (edAfter || puAfter || coAfter) throw new Error('Expected controls hidden on completed project');
  console.log('   [PASS] Project completed and controls hidden');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR & VIEWER role permissions
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR and VIEWER...');
  // Create a second active project for Contributor & Viewer testing
  const proj2Res = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { client_id: clientId, name: `Promo 2 ${ts}`, description: 'Second Project', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const proj2Id = proj2Res.json?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${proj2Id}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });
  await req(`/api/v1/organizations/${orgId}/projects/${proj2Id}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId },
    body: { membership_id: viewerPrincipalId, role: 'VIEWER', status: 'ACTIVE' }
  });

  // Contributor checks
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');
  await contribPage.goto(`${BASE_URL}/project/project?id=${proj2Id}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Promo 2 ${ts}`, { timeout: 10000 });

  const cEdVis = await contribPage.isVisible('#ed');
  const cPuVis = await contribPage.isVisible('#pu');
  const cCoVis = await contribPage.isVisible('#co');
  console.log('   Contributor controls visible:', { ed: cEdVis, pu: cPuVis, co: cCoVis });
  if (cEdVis || cPuVis || cCoVis) throw new Error('Manager controls must be hidden for Contributor');

  // Verify server error for forbidden mutation by Contributor
  const contribPatch = await req(`/api/v1/organizations/${orgId}/projects/${proj2Id}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': contribAuth.token, 'Cookie': contribAuth.cookie, 'x-organization-principal': contribPrincipalId, 'If-Match': '"1"' },
    body: { name: 'Forbidden Edit', client_id: clientId, description: '', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  console.log('   Contributor PATCH server status & error:', contribPatch.status, contribPatch.json?.code);
  if (contribPatch.status !== 403 || contribPatch.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Contributor PATCH, got ${contribPatch.status}`);
  }
  console.log('   [PASS] Contributor controls hidden and forbidden mutation returns 403 FORBIDDEN');
  await contribCtx.close();

  // Viewer checks
  const viewerCtx = await browser.newContext();
  const viewerPage = await viewerCtx.newPage();
  await viewerPage.goto(`${BASE_URL}/login`);
  await viewerPage.fill('#e', viewerEmail);
  await viewerPage.fill('#p', defaultPass);
  await viewerPage.click('button[type="submit"]');
  await viewerPage.waitForURL('**/workspace/dashboard**');
  await viewerPage.goto(`${BASE_URL}/project/project?id=${proj2Id}`);
  await viewerPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Promo 2 ${ts}`, { timeout: 10000 });

  const vEdVis = await viewerPage.isVisible('#ed');
  const vPuVis = await viewerPage.isVisible('#pu');
  const vCoVis = await viewerPage.isVisible('#co');
  console.log('   Viewer controls visible:', { ed: vEdVis, pu: vPuVis, co: vCoVis });
  if (vEdVis || vPuVis || vCoVis) throw new Error('Manager controls must be hidden for Viewer');

  const viewerPatch = await req(`/api/v1/organizations/${orgId}/projects/${proj2Id}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId, 'If-Match': '"1"' },
    body: { name: 'Forbidden Edit', client_id: clientId, description: '', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  console.log('   Viewer PATCH server status & error:', viewerPatch.status, viewerPatch.json?.code);
  if (viewerPatch.status !== 403 || viewerPatch.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer PATCH, got ${viewerPatch.status}`);
  }
  console.log('   [PASS] Viewer controls hidden and forbidden mutation returns 403 FORBIDDEN');
  await viewerCtx.close();

  // ---------------------------------------------------------------------------
  // TEST D: Org ADMIN who is not a project member
  // ---------------------------------------------------------------------------
  console.log('\n[D] Testing Org ADMIN who is not in project_membership...');
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE_URL}/login`);
  await adminPage.fill('#e', nonMemberEmail);
  await adminPage.fill('#p', defaultPass);
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL('**/workspace/dashboard**');
  await adminPage.goto(`${BASE_URL}/project/project?id=${proj2Id}`);
  await adminPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Promo 2 ${ts}`, { timeout: 10000 });

  const aEdVis = await adminPage.isVisible('#ed');
  const aPuVis = await adminPage.isVisible('#pu');
  const aCoVis = await adminPage.isVisible('#co');
  console.log('   Non-member Admin controls visible:', { ed: aEdVis, pu: aPuVis, co: aCoVis });
  if (!aEdVis || !aPuVis || !aCoVis) throw new Error('Org Admin inherits implicit Manager access on all projects');
  console.log('   [PASS] Org ADMIN inherits implicit Manager controls without explicit project membership');
  await adminCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT OVERVIEW BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project overview verification:', err);
  process.exit(1);
});
