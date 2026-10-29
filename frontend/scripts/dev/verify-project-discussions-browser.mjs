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
  console.log('=== STARTING PROJECT DISCUSSIONS BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.disc.${ts}@example.com`;
  let ownerAuth = await registerAndVerify(ownerEmail, defaultPass, 'Owner Discussions');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `Discussions Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Discussions' }
  });
  const orgId = orgRes.json?.organizationId;
  ownerAuth = await loginUser(ownerEmail, defaultPass);

  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client Disc ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `prj-${ts}` },
    body: { client_id: clientId, name: `Project Discussions ${ts}`, description: 'Testing Discussions Page', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Initial Manager
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-mgr-${ts}` },
    body: { membership_id: ownerPrincipalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // 2. Setup Contributor
  const contribEmail = `contrib.disc.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Tamer');
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

  // 3. Setup Viewer
  const viewerEmail = `viewer.disc.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-v-${ts}` },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer Salma');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': viewerReg.token, 'Cookie': viewerReg.cookie, 'idempotency-key': `acc-v-${ts}` },
    body: { token: viewerToken }
  });
  const viewerAuth = await loginUser(viewerEmail, defaultPass);
  const viewerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': viewerAuth.cookie } })).json?.items || [];
  const viewerPrincipalId = viewerPrincipals[0]?.id;
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-v-${ts}` },
    body: { membership_id: viewerPrincipalId, role: 'VIEWER', status: 'ACTIVE' }
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

  await testPage.goto(`${BASE_URL}/project/project-discussions`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-discussions?id=invalid-uuid-1234`);
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
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-discussions?id=${projectId}`);
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Discussions ${ts}`, { timeout: 10000 });

  // 1. Create New Topic
  console.log('   Testing new topic creation...');
  const ntVis = await mgrPage.isVisible('#nt');
  if (!ntVis) throw new Error('New topic button must be visible for Manager');

  await mgrPage.click('#nt');
  await mgrPage.waitForSelector('#dg[open]', { timeout: 5000 });
  await mgrPage.fill('#nt2', 'Opening Scene Style');
  await mgrPage.fill('#nm', 'Should we shoot in studio or outdoors?');
  await mgrPage.click('#dgf button[type="submit"]');

  await mgrPage.waitForFunction(() => {
    return Array.from(document.querySelectorAll('#tb tr td a')).some(a => a.textContent.includes('Opening Scene Style'));
  }, { timeout: 8000 });
  console.log('   [PASS] Discussion topic created and rendered in list');

  // 2. View Thread and Post Reply
  console.log('   Testing view thread and post reply...');
  await mgrPage.click('#tb tr:nth-child(1) td a');
  await mgrPage.waitForSelector('#tv:not([hidden])', { timeout: 5000 });
  const ttText = await mgrPage.textContent('#tt');
  console.log('   Thread title:', ttText?.trim());
  if (ttText?.trim() !== 'Opening Scene Style') throw new Error('Expected thread title in #tt');

  await mgrPage.fill('#rt', 'Outdoors at dawn gives the best natural lighting.');
  await mgrPage.click('#rb');

  await mgrPage.waitForFunction(() => {
    return Array.from(document.querySelectorAll('#rs .cm')).some(cm => cm.textContent.includes('Outdoors at dawn'));
  }, { timeout: 8000 });
  console.log('   [PASS] Reply posted and displayed in thread view');

  // 3. Archive Topic (Terminal Action)
  console.log('   Testing archive topic (terminal action)...');
  await mgrPage.click('#ab');
  await mgrPage.waitForSelector('dialog[open]', { timeout: 5000 });
  await mgrPage.click('dialog[open] button[type="submit"]');

  await mgrPage.waitForSelector('#ar:not([hidden])', { timeout: 8000 });
  const arText = await mgrPage.textContent('#ar');
  console.log('   Archive notice:', arText?.trim());
  if (!arText?.includes('archived')) throw new Error('Expected archived banner in #ar');

  const rfHidden = await mgrPage.isHidden('#rf');
  const abHidden = await mgrPage.isHidden('#ab');
  console.log('   Reply box hidden:', rfHidden, 'archive button hidden:', abHidden);
  if (!rfHidden || !abHidden) throw new Error('Reply box and archive button must be hidden on archived topic');
  console.log('   [PASS] Topic archived and locked as read-only');

  // Back to list
  await mgrPage.click('#bk');
  await mgrPage.waitForSelector('#lv:not([hidden])', { timeout: 5000 });
  const rowArchivedTag = await mgrPage.textContent('#tb tr:nth-child(1)');
  console.log('   List row after archive:', rowArchivedTag?.trim());
  if (!rowArchivedTag?.includes('Archived')) throw new Error('Expected Archived tag in list view');
  console.log('   [PASS] Archived status badge rendered in list view');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR permissions
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR...');
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  contribPage.on('console', msg => console.log('   [CONTRIB BROWSER LOG]', msg.text()));
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-discussions?id=${projectId}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Discussions ${ts}`, { timeout: 10000 });
  await contribPage.waitForSelector('#tb tr td a', { timeout: 10000 });

  const cNtVis = await contribPage.isVisible('#nt');
  const cRoVis = await contribPage.isVisible('#ro');
  console.log('   Contributor #nt visible:', cNtVis, '#ro visible:', cRoVis);
  if (!cNtVis || cRoVis) throw new Error('Contributor can create topics (nt visible, ro hidden)');

  // Contributor views thread: #ab must be hidden (only managers can archive)
  await contribPage.click('#tb tr:nth-child(1) td a');
  await contribPage.waitForSelector('#tv:not([hidden])', { timeout: 5000 });
  const cAbHidden = await contribPage.isHidden('#ab');
  console.log('   Contributor #ab hidden:', cAbHidden);
  if (!cAbHidden) throw new Error('Archive button must be hidden for Contributor');
  console.log('   [PASS] Contributor has write access but cannot archive topics');
  await contribCtx.close();

  // ---------------------------------------------------------------------------
  // TEST D: VIEWER permissions (read-only)
  // ---------------------------------------------------------------------------
  console.log('\n[D] Testing as VIEWER (read-only)...');
  const viewerCtx = await browser.newContext();
  const viewerPage = await viewerCtx.newPage();
  await viewerPage.goto(`${BASE_URL}/login`);
  await viewerPage.fill('#e', viewerEmail);
  await viewerPage.fill('#p', defaultPass);
  await viewerPage.click('button[type="submit"]');
  await viewerPage.waitForURL('**/workspace/dashboard**');

  await viewerPage.goto(`${BASE_URL}/project/project-discussions?id=${projectId}`);
  await viewerPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Project Discussions ${ts}`, { timeout: 10000 });
  await viewerPage.waitForSelector('#ro:not([hidden])', { timeout: 10000 });

  const vRoVis = await viewerPage.isVisible('#ro');
  const vNtVis = await viewerPage.isVisible('#nt');
  console.log('   Viewer #ro visible:', vRoVis, '#nt visible:', vNtVis);
  if (!vRoVis || vNtVis) throw new Error('Viewer must see read-only banner #ro and have #nt hidden');

  // Server rejection test
  const viewerPost = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/discussions`, {
    method: 'POST',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId },
    body: { title: 'Forbidden Topic', body: 'Forbidden' }
  });
  console.log('   Viewer POST discussion status & code:', viewerPost.status, viewerPost.json?.code);
  if (viewerPost.status !== 403 || viewerPost.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer POST, got ${viewerPost.status}`);
  }
  console.log('   [PASS] Viewer has read-only access and server rejects mutations with 403 FORBIDDEN');
  await viewerCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT DISCUSSIONS BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project discussions verification:', err);
  process.exit(1);
});
