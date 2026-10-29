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
  console.log('=== STARTING PROJECT TASK DETAIL BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const ts = Date.now();
  const defaultPass = 'Disposable-phase2-password-123!';

  // 1. Setup Owner & Org & Project
  const ownerEmail = `owner.taskdetail.${ts}@example.com`;
  let ownerAuth = await registerAndVerify(ownerEmail, defaultPass, 'Owner TaskDetail');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'idempotency-key': `org-${ts}` },
    body: { name: `TaskDetail Org ${ts}`, timezone: 'Africa/Cairo', description: 'Testing Task Detail' }
  });
  const orgId = orgRes.json?.organizationId;
  ownerAuth = await loginUser(ownerEmail, defaultPass);

  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerAuth.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `cli-${ts}` },
    body: { name: `Client TD ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `prj-${ts}` },
    body: { client_id: clientId, name: `Film TD ${ts}`, description: 'Film Task Detail Project', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projRes.json?.id;

  // Create Milestone
  const msRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ms-${ts}` },
    body: { title: 'Sound Design Lock', due_at: null, position: 0, status: 'OPEN' }
  });
  const milestoneId = msRes.json?.id;

  // 2. Setup Contributor
  const contribEmail = `contrib.td.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-c-${ts}` },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor Maya');
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
  const viewerEmail = `viewer.td.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-v-${ts}` },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerInviteToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer Mark');
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

  // Create Task assigned to Contributor
  const taskRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `tsk-${ts}` },
    body: {
      title: 'Compose Original Score',
      description: 'Create 90s ambient string arrangement for main theme.',
      milestone_id: milestoneId,
      assignee_id: contribProjectMemberId,
      priority: 'HIGH',
      status: 'TODO',
      due_at: '2026-11-20T23:59:59.000Z',
      position: 0
    }
  });
  const taskId = taskRes.json?.id;

  // Create Checklist items for this task
  const cl1Res = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/checklist`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ck1-${ts}` },
    body: { label: 'Piano sketch demo', position: 0, completed: false }
  });
  const cl1Id = cl1Res.json?.id;

  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/checklist`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `ck2-${ts}` },
    body: { label: 'String quartet recording', position: 1, completed: false }
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

  await testPage.goto(`${BASE_URL}/project/project-task`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const missingText = await testPage.textContent('.empty b');
  console.log('   Missing id header:', missingText?.trim());
  if (!missingText?.includes('Not available')) throw new Error('Expected Not available on missing id');

  await testPage.goto(`${BASE_URL}/project/project-task?id=invalid-uuid-1234`);
  await testPage.waitForSelector('.empty b', { timeout: 8000 });
  const invalidText = await testPage.textContent('.empty b');
  console.log('   Invalid id header:', invalidText?.trim());
  if (!invalidText?.includes('Not available')) throw new Error('Expected Not available on invalid id');

  console.log('   [PASS] Missing and invalid project ID render neutral not-available state');
  await testCtx.close();

  // ---------------------------------------------------------------------------
  // TEST B: MANAGER (Owner) task actions: status, checklist, comments
  // ---------------------------------------------------------------------------
  console.log('\n[B] Testing as MANAGER (Owner)...');
  const mgrCtx = await browser.newContext();
  const mgrPage = await mgrCtx.newPage();
  mgrPage.on('console', msg => console.log('MGR LOG:', msg.text()));
  mgrPage.on('pageerror', err => console.log('MGR ERR:', err));
  await mgrPage.goto(`${BASE_URL}/login`);
  await mgrPage.fill('#e', ownerEmail);
  await mgrPage.fill('#p', defaultPass);
  await mgrPage.click('button[type="submit"]');
  await mgrPage.waitForURL('**/workspace/dashboard**');

  await mgrPage.goto(`${BASE_URL}/project/project-task?id=${projectId}&taskId=${taskId}`);
  await mgrPage.waitForTimeout(2000);
  const curH2 = await mgrPage.textContent('main.page > h2').catch(() => null);
  const curEmpty = await mgrPage.textContent('.empty b').catch(() => null);
  console.log('   mgrPage debug:', { curH2, curEmpty, url: mgrPage.url() });
  await mgrPage.waitForFunction((expected) => {
    return document.querySelector('main.page > h2')?.textContent?.includes(expected);
  }, 'Compose Original Score', { timeout: 10000 });

  const h2Text = await mgrPage.textContent('main.page > h2');
  console.log('   Task title & status:', h2Text?.replace(/\s+/g, ' ').trim());
  if (!h2Text?.includes('Compose Original Score') || !h2Text?.includes('To do')) {
    throw new Error('Expected task title and initial status To do');
  }

  // Verify KV fields
  const assigneeText = await mgrPage.textContent('#as');
  console.log('   Assignee name:', assigneeText?.trim());
  if (!assigneeText?.includes('Contributor Maya')) throw new Error('Expected Contributor Maya as assignee');

  // Checklist verification
  await mgrPage.waitForSelector('#ckl label', { timeout: 5000 });
  const ccText = await mgrPage.textContent('#cc');
  console.log('   Checklist count:', ccText?.trim());
  if (ccText?.trim() !== '0 of 2') throw new Error('Expected 0 of 2 checklist items');

  // Toggle checklist item via click
  console.log('   Toggling checklist item...');
  await mgrPage.click(`#ckl input[data-cid="${cl1Id}"]`);
  await mgrPage.waitForFunction(() => {
    return document.querySelector('#cc')?.textContent?.trim() === '1 of 2';
  }, { timeout: 8000 });
  console.log('   [PASS] Checklist item toggled to completed (1 of 2)');

  // Test Block button
  console.log('   Testing Block button...');
  await mgrPage.click('#bl');
  await mgrPage.waitForFunction(() => {
    return document.querySelector('#stt')?.textContent?.trim() === 'Blocked';
  }, { timeout: 8000 });
  const blText = await mgrPage.textContent('#bl');
  if (blText?.trim() !== 'Unblock') throw new Error('Expected button text Unblock');
  console.log('   [PASS] Task marked Blocked and button changed to Unblock');

  // Test Unblock
  await mgrPage.click('#bl');
  await mgrPage.waitForFunction(() => {
    return document.querySelector('#stt')?.textContent?.trim() === 'In progress';
  }, { timeout: 8000 });
  console.log('   [PASS] Task unblocked to In progress');

  // Test Mark done button
  console.log('   Testing Mark done button...');
  await mgrPage.click('#dn');
  await mgrPage.waitForFunction(() => {
    return document.querySelector('#stt')?.textContent?.trim() === 'Done';
  }, { timeout: 8000 });
  const dnText = await mgrPage.textContent('#dn');
  if (dnText?.trim() !== 'Reopen') throw new Error('Expected button text Reopen');
  console.log('   [PASS] Task marked Done (backend allows completion regardless of checklist) and button changed to Reopen');

  // Test Post comment
  console.log('   Testing comment posting...');
  await mgrPage.fill('#nc', 'Director approved the draft outline.');
  await mgrPage.click('#pc');
  await mgrPage.waitForFunction(() => {
    return document.querySelector('#cms')?.textContent?.includes('Director approved the draft outline.');
  }, { timeout: 8000 });
  console.log('   [PASS] Comment posted and displayed in comments list');
  await mgrCtx.close();

  // ---------------------------------------------------------------------------
  // TEST C: CONTRIBUTOR permissions
  // ---------------------------------------------------------------------------
  console.log('\n[C] Testing as CONTRIBUTOR (assigned to task)...');
  const contribCtx = await browser.newContext();
  const contribPage = await contribCtx.newPage();
  await contribPage.goto(`${BASE_URL}/login`);
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', defaultPass);
  await contribPage.click('button[type="submit"]');
  await contribPage.waitForURL('**/workspace/dashboard**');

  await contribPage.goto(`${BASE_URL}/project/project-task?id=${projectId}&taskId=${taskId}`);
  await contribPage.waitForFunction((expected) => {
    return document.querySelector('main.page > h2')?.textContent?.includes(expected);
  }, 'Compose Original Score', { timeout: 10000 });

  // Contributor assigned to task has enabled controls
  const cDnDisabled = await contribPage.$eval('#dn', el => el.disabled);
  console.log('   Contributor #dn disabled:', cDnDisabled);
  if (cDnDisabled) throw new Error('Assigned contributor must have enabled status button');

  // Contributor re-opens task
  console.log('   Contributor reopening task...');
  await contribPage.click('#dn');
  await contribPage.waitForFunction(() => {
    return document.querySelector('#stt')?.textContent?.trim() === 'In progress';
  }, { timeout: 8000 });
  console.log('   [PASS] Assigned contributor reopened task to In progress');

  // Contributor posts comment
  await contribPage.fill('#nc', 'Quartet booked for Thursday session.');
  await contribPage.click('#pc');
  await contribPage.waitForFunction(() => {
    return document.querySelector('#cms')?.textContent?.includes('Quartet booked for Thursday session.');
  }, { timeout: 8000 });
  console.log('   [PASS] Contributor posted comment');
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

  await viewerPage.goto(`${BASE_URL}/project/project-task?id=${projectId}&taskId=${taskId}`);
  await viewerPage.waitForFunction((expected) => {
    return document.querySelector('main.page > h2')?.textContent?.includes(expected);
  }, 'Compose Original Score', { timeout: 10000 });

  const vDnDisabled = await viewerPage.$eval('#dn', el => el.disabled);
  const vBlDisabled = await viewerPage.$eval('#bl', el => el.disabled);
  const vNcDisabled = await viewerPage.$eval('#nc', el => el.disabled);
  const vPcDisabled = await viewerPage.$eval('#pc', el => el.disabled);
  const vCkDisabled = await viewerPage.$eval('#ckl input', el => el.disabled);

  console.log('   Viewer controls disabled:', { dn: vDnDisabled, bl: vBlDisabled, nc: vNcDisabled, pc: vPcDisabled, ck: vCkDisabled });
  if (!vDnDisabled || !vBlDisabled || !vNcDisabled || !vPcDisabled || !vCkDisabled) {
    throw new Error('All mutation controls must be disabled for Viewer');
  }

  // Verify server rejects Viewer checklist toggle
  const viewerPatch = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/checklist/${cl1Id}`, {
    method: 'PATCH',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId },
    body: { completed: false }
  });
  console.log('   Viewer checklist PATCH status & code:', viewerPatch.status, viewerPatch.json?.code);
  if (viewerPatch.status !== 403 || viewerPatch.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer checklist toggle, got ${viewerPatch.status}`);
  }

  // Verify server rejects Viewer comment
  const viewerComment = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'x-csrf-token': viewerAuth.token, 'Cookie': viewerAuth.cookie, 'x-organization-principal': viewerPrincipalId },
    body: { body: 'Unauthorized comment', thread_id: null }
  });
  console.log('   Viewer comment POST status & code:', viewerComment.status, viewerComment.json?.code);
  if (viewerComment.status !== 403 || viewerComment.json?.code !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN for Viewer comment, got ${viewerComment.status}`);
  }
  console.log('   [PASS] Viewer has read-only access and mutations return 403 FORBIDDEN');
  await viewerCtx.close();

  await browser.close();
  console.log('=== ALL PROJECT TASK DETAIL BROWSER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in project task detail verification:', err);
  process.exit(1);
});
