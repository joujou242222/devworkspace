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
  console.log('=== STARTING PROJECT TASKS BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.tasks.${ts}@example.com`;
  const ownerReg = await registerAndVerify(ownerEmail, defaultPass, 'Owner Tasks');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerReg.token, 'Cookie': ownerReg.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `Tasks Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Tasks' }
  });
  const orgId = orgRes.json?.organizationId;
  const ownerAuth = await loginUser(ownerEmail, defaultPass);
  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `prj-${ts}` },
    body: { client_id: clientId, name: `Tasks Feature Film ${ts}`, description: 'Feature Film Project', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Create Milestone
  const msRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ms-${ts}` },
    body: { title: 'Pre-Production', due_at: null, position: 0, status: 'OPEN' }
  });
  const milestoneId = msRes.json?.id;
  console.log('Setup Milestone:', { msStatus: msRes.status, milestoneId });

  // 2. Setup Contributor
  const contribEmail = `contrib.tasks.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Yara');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie, 'idempotency-key': `acc-c-${ts}` },
    body: { token: contribInviteToken }
  });
  const contribAuth = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribAuth.cookie } })).json?.items || [];
  const contribPrincipalId = contribPrincipals[0]?.id;
  const contribMemberRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `pm-c-${ts}` },
    body: { membership_id: contribPrincipalId, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });
  const contribProjectMemberId = contribMemberRes.json?.id;

  // 3. Setup Viewer
  const viewerEmail = `viewer.tasks.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-v-${ts}` },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerInviteToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer Sam');
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
  const nonMemberEmail = `admin.tasks.${ts}@example.com`;
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

  await testPage.goto(`${BASE_URL}/project/project-tasks`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-tasks?id=invalid-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) creates task, views board & list, moves status
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  mgrPage.on('console', msg => console.log('MGR PAGE LOG:', msg.text()));
  mgrPage.on('pageerror', err => console.log('MGR PAGE ERROR:', err));
  mgrPage.on('response', res => {
    if (res.status() >= 400) console.log('MGR HTTP ERR:', res.status(), res.url());
  });
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-tasks?id=${projectId}`);
  await mgrPage.waitForTimeout(2000);
  const currentH1 = await mgrPage.textContent('h1').catch(() => null);
  const emptyB = await mgrPage.textContent('.empty b').catch(() => null);
  console.log('   mgrPage debug:', { currentH1, emptyB, url: mgrPage.url() });
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Tasks Feature Film ${ts}`, { timeout: 10000 });

  const ntVis = await mgrPage.isVisible('#nt');
  console.log('   New task button visible for Manager:', ntVis);
  if (!ntVis) throw new Error('Expected New task button visible for Manager');

  // Open modal and create task assigned to Contributor with checklist
  console.log('   Creating task with checklist...');
  await mgrPage.click('#nt');
  await mgrPage.waitForSelector('#dg[open]', { timeout: 5000 });
  await mgrPage.fill('#tt', 'Produce Storyboards');
  await mgrPage.fill('#td', 'Initial sketches for scene 1 and 2.');
  await mgrPage.selectOption('#tm', milestoneId);
  await mgrPage.selectOption('#ta', contribProjectMemberId);
  await mgrPage.selectOption('#tp', 'High');
  await mgrPage.fill('#tu', '2026-11-15');
  await mgrPage.fill('#tk', 'Scene 1 roughs\nScene 2 roughs\nDirector review');
  await mgrPage.click('#dgf button[type="submit"]');
  await mgrPage.waitForTimeout(1000);
  const derrVis = await mgrPage.isVisible('#derr');
  const derrText = await mgrPage.textContent('#derr');
  console.log('   Submit result derr:', { derrVis, derrText });

  // Wait for task card to appear on board in "To do" column
  await mgrPage.waitForFunction(() => {
    return document.querySelector('.tc b')?.textContent?.includes('Produce Storyboards');
  }, { timeout: 8000 });

  const cardText = await mgrPage.textContent('.tc');
  console.log('   Rendered task card:', cardText?.replace(/\s+/g, ' ').trim());
  if (!cardText?.includes('High priority') || !cardText?.includes('Contributor Yara') || !cardText?.includes('0 of 3')) {
    throw new Error('Task card missing expected metadata (priority, assignee, checklist count)');
  }
  console.log('   [PASS] Task created with checklist and displayed on board');

  // Test List view
  console.log('   Testing List view...');
  await mgrPage.selectOption('#vw', 'List');
  await mgrPage.waitForSelector('.tblw table tbody tr', { timeout: 5000 });
  const rowText = await mgrPage.textContent('.tblw table tbody tr');
  console.log('   List view row:', rowText?.replace(/\s+/g, ' ').trim());
  if (!rowText?.includes('Produce Storyboards') || !rowText?.includes('Contributor Yara')) {
    throw new Error('List view row missing task data');
  }
  // Switch back to Board
  await mgrPage.selectOption('#vw', 'Board');
  await mgrPage.waitForSelector('.board .col', { timeout: 5000 });

  // Test search filter
  console.log('   Testing search filter...');
  await mgrPage.fill('#q', 'Nonexistent Task');
  await mgrPage.waitForSelector('#em:not([hidden])', { timeout: 5000 });
  await mgrPage.fill('#q', 'Storyboards');
  await mgrPage.waitForSelector('.tc', { timeout: 5000 });
  await mgrPage.fill('#q', '');

  // Test move task from To do -> In progress
  console.log('   Testing move task to In progress...');
  await mgrPage.selectOption('.tc select[data-task-id]', 'In progress');
  await mgrPage.waitForFunction(() => {
    const col = Array.from(document.querySelectorAll('.board .col')).find(c => c.querySelector('h3')?.textContent?.includes('In progress'));
    return col && col.querySelector('.tc b')?.textContent?.includes('Produce Storyboards');
  }, { timeout: 8000 });
  console.log('   [PASS] Manager moved task to In progress column');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR permissions & status transition
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR...');
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  contribPage.on('console', msg => console.log('CONTRIB PAGE LOG:', msg.text()));
  contribPage.on('pageerror', err => console.log('CONTRIB PAGE ERROR:', err));
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-tasks?id=${projectId}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Tasks Feature Film ${ts}`, { timeout: 10000 });
  await contribPage.waitForSelector('.tc', { timeout: 10000 });

  // New task button must be hidden for Contributor
  const cNtVis = await contribPage.isVisible('#nt');
  console.log('   New task button visible for Contributor:', cNtVis);
  if (cNtVis) throw new Error('New task button must be hidden for Contributor');

  // Contributor can move their assigned task
  const moveSel = await contribPage.$('.tc select[data-task-id]');
  const isMoveDisabled = await moveSel.isDisabled();
  console.log('   Move select disabled for assigned task:', isMoveDisabled);
  if (isMoveDisabled) throw new Error('Move select must be enabled for assigned task');

  console.log('   Contributor moving task to Done...');
  await contribPage.selectOption('.tc select[data-task-id]', 'Done');
  await contribPage.waitForFunction(() => {
    const col = Array.from(document.querySelectorAll('.board .col')).find(c => c.querySelector('h3')?.textContent?.includes('Done'));
    return col && col.querySelector('.tc b')?.textContent?.includes('Produce Storyboards');
  }, { timeout: 8000 });
  console.log('   [PASS] Contributor moved assigned task to Done');

  // Verify server rejects Contributor POST (create task)
  const contribPost = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'x-csrf-token': contribAuth.token, 'Cookie': contribAuth.cookie, 'x-organization-principal': contribPrincipalId },
    body: { title: 'Forbidden Task', description: '', milestone_id: null, assignee_id: null, priority: 'NORMAL', status: 'TODO', due_at: null, position: 0 }
  });
  console.log('   Contributor POST task status & error:', contribPost.status, contribPost.json?.code);
  if (contribPost.status !== 403 || contribPost.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Contributor POST task, got ${contribPost.status}`);
  }
  console.log('   [PASS] Contributor cannot create tasks (403 FORBIDDEN)');
  await contribCtx.close();

  // ---------------------------------------------------------------------------
  // TEST D: VIEWER permissions (read-only)
  // ---------------------------------------------------------------------------
  console.log('\n[D] Testing as VIEWER...');
  const viewerCtx = await browser.newContext();
  const viewerPage = await viewerCtx.newPage();
  await viewerPage.goto(`${BASE_URL}/login`);
  await viewerPage.fill('#e', viewerEmail);
  await viewerPage.fill('#p', defaultPass);
  await viewerPage.click('button[type="submit"]');
  await viewerPage.waitForURL('**/workspace/dashboard**');

  await viewerPage.goto(`${BASE_URL}/project/project-tasks?id=${projectId}`);
  await viewerPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Tasks Feature Film ${ts}`, { timeout: 10000 });
  await viewerPage.waitForSelector('.tc', { timeout: 10000 });

  const vNtVis = await viewerPage.isVisible('#nt');
  if (vNtVis) throw new Error('New task button must be hidden for Viewer');

  const vMoveSel = await viewerPage.$('.tc select[data-task-id]');
  const vDisabled = await vMoveSel.isDisabled();
  console.log('   Move select disabled for Viewer:', vDisabled);
  if (!vDisabled) throw new Error('Move select must be disabled for Viewer');

  // Verify server rejects Viewer PATCH task
  const taskIdRes = (await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks?limit=1`, {
    headers: { 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId }
  })).json?.items?.[0];
  const viewerPatch = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks/${taskIdRes.id}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId, 'If-Match': `"${taskIdRes.revision}"` },
    body: { status: 'IN_PROGRESS' }
  });
  console.log('   Viewer PATCH task status & error:', viewerPatch.status, viewerPatch.json?.code);
  if (viewerPatch.status !== 403 || viewerPatch.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer PATCH task, got ${viewerPatch.status}`);
  }
  console.log('   [PASS] Viewer has read-only access and mutation returns 403 FORBIDDEN');
  await viewerCtx.close();

  // ---------------------------------------------------------------------------
  // TEST E: Non-member Org ADMIN inherits Manager privileges
  // ---------------------------------------------------------------------------
  console.log('\n[E] Testing Org ADMIN who is not in project_membership...');
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE_URL}/login`);
  await adminPage.fill('#e', nonMemberEmail);
  await adminPage.fill('#p', defaultPass);
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL('**/workspace/dashboard**');

  await adminPage.goto(`${BASE_URL}/project/project-tasks?id=${projectId}`);
  await adminPage.waitForFunction((expected) => {
    return document.querySelector('.top h1')?.textContent?.includes(expected);
  }, `Tasks Feature Film ${ts}`, { timeout: 10000 });
  await adminPage.waitForSelector('.tc', { timeout: 10000 });

  const aNtVis = await adminPage.isVisible('#nt');
  console.log('   Non-member Admin New task visible:', aNtVis);
  if (!aNtVis) throw new Error('Org ADMIN must inherit Manager privileges (New task visible)');

  const aMoveSel = await adminPage.$('.tc select[data-task-id]');
  const aDisabled = await aMoveSel.isDisabled();
  console.log('   Non-member Admin Move select disabled:', aDisabled);
  if (aDisabled) throw new Error('Org ADMIN must inherit Manager privileges (Move select enabled)');

  console.log('   [PASS] Org ADMIN inherits Manager privileges on project tasks');
  await adminCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT TASKS BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project tasks verification:', err);
  process.exit(1);
});
