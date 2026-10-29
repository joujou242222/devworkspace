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
import { randomUUID, createHash } from 'node:crypto';

const ca = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

function req(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'https://localhost:8443');
    const headers = { Origin: 'https://localhost:8443', ...(options.headers || {}) };
    const reqObj = https.request(url, { method: options.method || 'GET', headers, ca, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json, setCookie: res.headers['set-cookie'] });
      });
    });
    reqObj.on('error', reject);
    if (options.body) {
      if (Buffer.isBuffer(options.body)) reqObj.write(options.body);
      else if (typeof options.body === 'object') {
        reqObj.setHeader('Content-Type', 'application/json');
        reqObj.write(JSON.stringify(options.body));
      } else reqObj.write(options.body);
    }
    reqObj.end();
  });
}

function parseCookies(cookies) {
  if (!cookies) return '';
  return (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

async function setupReviewFixture() {
  const ts = Date.now();
  const ownerEmail = `rev.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // 1. Register & verify owner
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Proofly Manager' }
  });

  let msg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    msg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === ownerEmail.toLowerCase()));
    if (msg) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const token = new URL(detail.Text.trim()).searchParams.get('token');
  const c1 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': c1.json.token, Cookie: parseCookies(c1.setCookie) },
    body: { token }
  });

  // Login Owner
  const c2 = await req('/api/v1/identity/csrf');
  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': c2.json.token, Cookie: parseCookies(c2.setCookie) },
    body: { email: ownerEmail, password: pass }
  });
  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie1 } });
  const authHeaders = {
    'x-csrf-token': postCsrf.json.token,
    Cookie: cookie1 + '; ' + parseCookies(postCsrf.setCookie)
  };

  // Create Org
  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { ...authHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Kino Proofly', timezone: 'Africa/Cairo', description: 'Testing Review Page' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login Owner
  const lRes2 = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': postCsrf.json.token, Cookie: authHeaders.Cookie },
    body: { email: ownerEmail, password: pass }
  });
  const cookie2 = parseCookies(lRes2.setCookie);
  const finalCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie2 } });
  const principalsRes = await req('/api/v1/me/principals', { headers: { Cookie: cookie2 } });
  const principalId = principalsRes.json.items[0].id;

  const fullHeaders = {
    'Content-Type': 'application/json',
    'x-csrf-token': finalCsrf.json.token,
    'x-organization-principal': principalId,
    Cookie: cookie2 + '; ' + parseCookies(finalCsrf.setCookie)
  };

  // Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Lotus Foods', description: 'Packaged Goods Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Lotus Commercial 2026',
      description: 'Television Commercial',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const projectId = projRes.json.id;

  // Add Manager
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { membership_id: principalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // Create Approver User & Contact
  const approverEmail = `rev.app.${ts}@example.com`;
  const caReg = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': caReg.json.token, Cookie: parseCookies(caReg.setCookie) },
    body: { email: approverEmail, password: pass, name: 'Mona Fathy' }
  });
  let aMsg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    aMsg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === approverEmail.toLowerCase()));
    if (aMsg) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const aDetail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${aMsg.ID}`)).json();
  const aToken = new URL(aDetail.Text.trim()).searchParams.get('token');
  const caV = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': caV.json.token, Cookie: parseCookies(caV.setCookie) },
    body: { token: aToken }
  });

  // Create Contact
  const contactRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Mona Fathy', email: approverEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json.id;

  // Invite Contact to Project as APPROVER
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: projectId, role: 'APPROVER' }
  });

  let invMsg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    invMsg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === approverEmail.toLowerCase() && m.Subject.includes('invitation')));
    if (invMsg) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const invDetail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${invMsg.ID}`)).json();
  const invToken = new URL(invDetail.Text.trim()).searchParams.get('token');

  // Accept invitation
  const caCsrf = await req('/api/v1/identity/csrf');
  const caL = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': caCsrf.json.token, Cookie: parseCookies(caCsrf.setCookie) },
    body: { email: approverEmail, password: pass }
  });
  const appCookie = parseCookies(caL.setCookie);
  const appCsrfRes = await req('/api/v1/identity/csrf', { headers: { Cookie: appCookie } });
  const appCsrf = appCsrfRes.json.token;

  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': appCsrf, Cookie: appCookie + '; ' + parseCookies(appCsrfRes.setCookie), 'idempotency-key': randomUUID() },
    body: { token: invToken }
  });

  // Create Deliverable
  const delRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Brand Film Master',
      description: 'Master commercial cut',
      task_id: null,
      status: 'ACTIVE'
    }
  });
  console.log('delRes status:', delRes.status, delRes.text);
  const deliverableId = delRes.json?.id;

  // Upload & scan asset for Version 1
  const digest = createHash('sha256').update(VALID_PNG).digest('hex');
  const upIntent = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      name: 'brand_cut_v1.png',
      purpose: 'DELIVERABLE',
      folder_id: null,
      size: VALID_PNG.length,
      digest,
      mime: 'image/png'
    }
  });

  const capUrl = new URL(upIntent.json.capability.url);
  const stagingPath = capUrl.pathname + capUrl.search;
  const putHeaders = {
    'content-length': String(VALID_PNG.length),
    'content-type': 'image/png',
    ...(upIntent.json.capability.headers || {})
  };
  delete putHeaders['host'];
  delete putHeaders['Host'];

  await req(stagingPath, {
    method: 'PUT',
    headers: putHeaders,
    body: VALID_PNG
  });

  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${upIntent.json.id}/finalize`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {}
  });

  // Poll until READY
  for (let i = 0; i < 30; i++) {
    const poll = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${upIntent.json.id}`, {
      headers: fullHeaders
    });
    if (poll.json?.status === 'READY') break;
    await new Promise(r => setTimeout(r, 1000));
  }

  // Create Version 1
  const verRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${deliverableId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: upIntent.json.id }
  });
  const versionId = verRes.json.id;

  // Share Version 1
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/versions/${versionId}/share`, {
    method: 'PATCH',
    headers: { ...fullHeaders, 'If-Match': '"1"' },
    body: { status: 'ACTIVE' }
  });

  const dueAt = new Date(Date.now() + 86400000 * 3).toISOString();
  const revRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/reviews`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      version_id: versionId,
      digest,
      approver_ids: [contactId],
      due_at: dueAt
    }
  });
  console.log('revRes status:', revRes.status, revRes.text);
  const reviewId = revRes.json?.id;

  return {
    ownerEmail,
    pass,
    orgId,
    projectId,
    deliverableId,
    versionId,
    reviewId,
    contactId
  };
}

async function run() {
  console.log('=== STARTING PROJECT REVIEW BROWSER VERIFICATION ===');
  const fixture = await setupReviewFixture();
  console.log('Fixture created. ReviewId:', fixture.reviewId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));

  // 1. Sign in through UI
  console.log('\n[1] Signing in through UI...');
  await page.goto('http://localhost:5199/login');
  await page.fill('#e', fixture.ownerEmail);
  await page.fill('#p', fixture.pass);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/workspace/dashboard**', { timeout: 15000 });
  console.log('Signed in. Navigating to project-review...');

  await page.goto(`http://localhost:5199/project/project-review?id=${fixture.projectId}&review=${fixture.reviewId}`);
  await page.waitForTimeout(1000);

  // 2. Initial state verification
  console.log('\n[2] Verifying review header, key-values, and preview...');
  await page.waitForSelector('.top h1', { timeout: 10000 });
  const h1 = await page.locator('.top h1').textContent();
  console.log(`Page title: "${h1}"`);
  if (!h1.includes('Lotus Commercial 2026')) throw new Error('H1 does not contain project name');

  const kdText = await page.locator('#kd').textContent();
  console.log(`Deliverable: "${kdText}"`);
  if (!kdText.includes('Brand Film Master')) throw new Error('Deliverable title not displayed');

  const csText = await page.locator('#cs').textContent();
  console.log(`Cycle status: "${csText}"`);
  if (csText.trim() !== 'Open') throw new Error('Expected cycle status Open');

  const cdText = await page.locator('#cd').textContent();
  console.log(`Who can decide: "${cdText}"`);
  if (!cdText.includes('Mona Fathy')) throw new Error('Approver Mona Fathy not listed in who can decide');

  const approveBtnDisabled = await page.locator('#ap').isDisabled();
  const approveBtnTitle = await page.locator('#ap').getAttribute('title');
  console.log(`Approve button disabled: ${approveBtnDisabled}, title: "${approveBtnTitle}"`);
  if (!approveBtnDisabled) throw new Error('Expected internal approve button to be disabled');

  const pvwVisible = await page.locator('#pvw').isVisible();
  console.log(`Preview player visible: ${pvwVisible}`);
  if (!pvwVisible) throw new Error('Expected preview player to be visible');
  console.log('PASS: Initial review workspace verified');

  // 3. Add a general note
  console.log('\n[3] Adding general comment note...');
  await page.fill('#nn', 'Overall pace feels very dynamic and engaging.');
  await page.click('#an');

  await page.waitForFunction(() => {
    const cm = document.getElementById('cm');
    return cm && cm.textContent.includes('Overall pace feels very dynamic and engaging.');
  }, { timeout: 8000 });
  console.log('PASS: Comment note created and rendered in thread');

  // 4. Place a pinpoint annotation
  console.log('\n[4] Placing pin annotation on preview...');
  const pvprev = page.locator('#pvprev');
  await pvprev.click({ position: { x: 120, y: 80 } });

  const placeholder = await page.locator('#nn').getAttribute('placeholder');
  console.log(`Textarea placeholder with pin coords: "${placeholder}"`);
  if (!placeholder || !placeholder.includes('Add note at pin')) {
    throw new Error('Expected pin annotation placeholder');
  }

  await page.fill('#nn', 'Adjust logo contrast at upper corner.');
  await page.click('#an');

  await page.waitForFunction(() => {
    const cm = document.getElementById('cm');
    const pins = document.getElementById('pins');
    const hasComment = cm && cm.textContent.includes('Adjust logo contrast at upper corner.');
    const hasPin = pins && pins.querySelectorAll('.pin').length >= 1;
    return hasComment && hasPin;
  }, { timeout: 8000 });
  console.log('PASS: Pin annotation placed and rendered on preview canvas and list');

  // 5. Resolve and Reopen comment
  console.log('\n[5] Resolving and reopening comment 1...');
  await page.click('button[data-r="0"]');
  await page.waitForFunction(() => {
    const card = document.querySelector('.cmt[data-c="0"]');
    return card && card.textContent.includes('Resolved') && card.querySelector('button[data-r]').textContent.includes('Reopen');
  }, { timeout: 8000 });
  console.log('PASS: Comment 1 marked Resolved');

  await page.click('button[data-r="0"]');
  await page.waitForFunction(() => {
    const card = document.querySelector('.cmt[data-c="0"]');
    return card && !card.textContent.includes('Resolved') && card.querySelector('button[data-r]').textContent.includes('Resolve');
  }, { timeout: 8000 });
  console.log('PASS: Comment 1 reopened cleanly');

  // 6. Turn feedback into internal task
  console.log('\n[6] Turning comment 2 into internal task...');
  await page.click('button[data-t="1"]');
  await page.waitForFunction(() => {
    const ok = document.getElementById('ok');
    const card = document.querySelector('.cmt[data-c="1"]');
    const okMsg = ok && !ok.hidden && ok.textContent.includes('Internal task created');
    const taskBadge = card && card.textContent.includes('Task created');
    return okMsg && taskBadge;
  }, { timeout: 8000 });
  console.log('PASS: Feedback turned into internal task and badge displayed');

  // 7. Cancel review
  console.log('\n[7] Cancelling review via dialog...');
  await page.click('#rp');
  await page.waitForSelector('#dg[open]', { timeout: 5000 });
  await page.selectOption('#ac', 'cancel');
  await page.click('#dgf button[type="submit"]');

  await page.waitForFunction(() => {
    const cl = document.getElementById('cl');
    const cs = document.getElementById('cs');
    const an = document.getElementById('an');
    const isClosed = cl && !cl.hidden && cl.textContent.includes('This review was canceled');
    const statusCanceled = cs && cs.textContent.includes('Canceled');
    const disabledInputs = an && an.disabled;
    return isClosed && statusCanceled && disabledInputs;
  }, { timeout: 8000 });
  console.log('PASS: Review cancelled cleanly and locked read-only');

  console.log('\n=== ALL PROJECT REVIEW BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
