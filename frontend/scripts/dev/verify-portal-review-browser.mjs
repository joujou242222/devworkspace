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

async function setupPortalReviewFixture() {
  const ts = Date.now();
  const ownerEmail = `portal.owner.${ts}@example.com`;
  const clientEmail = `portal.client.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // 1. Register & verify owner
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Agency Producer' }
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

  // 2. Login owner & create org
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

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { ...authHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Studio Horizon', timezone: 'Africa/Cairo', description: 'Portal Review Agency' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login owner
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

  // 3. Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Zenith Labs', description: 'Biotech Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // 4. Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Brand Identity Video',
      description: 'Review cut for identity reveal',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const projectId = projRes.json.id;

  // 5. Register and verify Client User
  const cc0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': cc0.json.token, Cookie: parseCookies(cc0.setCookie) },
    body: { email: clientEmail, password: pass, name: 'Karim Approver' }
  });

  let cmsg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    cmsg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === clientEmail.toLowerCase()));
    if (cmsg) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const cdetail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${cmsg.ID}`)).json();
  const ctoken = new URL(cdetail.Text.trim()).searchParams.get('token');
  const cc1 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': cc1.json.token, Cookie: parseCookies(cc1.setCookie) },
    body: { token: ctoken }
  });

  // 6. Create Contact
  const contactRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Karim Approver', email: clientEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json.id;

  // 7. Invite Contact & Accept
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: projectId, role: 'APPROVER' }
  });

  let inv = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    inv = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === clientEmail.toLowerCase() && m.Subject.includes('invitation')));
    if (inv) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const invDetail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${inv.ID}`)).json();
  const invToken = new URL(invDetail.Text.trim()).searchParams.get('token');

  const cc2 = await req('/api/v1/identity/csrf');
  const clRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': cc2.json.token, Cookie: parseCookies(cc2.setCookie) },
    body: { email: clientEmail, password: pass }
  });
  const clientCookie = parseCookies(clRes.setCookie);
  const clientCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: clientCookie } });

  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: {
      'x-csrf-token': clientCsrf.json.token,
      Cookie: clientCookie + '; ' + parseCookies(clientCsrf.setCookie),
      'idempotency-key': randomUUID()
    },
    body: { token: invToken }
  });

  // 8. Upload asset & create Deliverable & Review
  const digest = createHash('sha256').update(VALID_PNG).digest('hex');
  const upIntent = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      name: 'identity_cut_v1.png',
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

  for (let i = 0; i < 30; i++) {
    const poll = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${upIntent.json.id}`, {
      headers: fullHeaders
    });
    if (poll.json?.status === 'READY') break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const delRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Identity Video Cut',
      description: '45-second identity cut',
      task_id: null,
      status: 'ACTIVE'
    }
  });
  const delId = delRes.json.id;

  const ver1 = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${delId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: upIntent.json.id }
  });
  const version1Id = ver1.json.id;

  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/versions/${version1Id}/share`, {
    method: 'PATCH',
    headers: { ...fullHeaders, 'If-Match': '"1"' },
    body: { status: 'ACTIVE' }
  });

  const dueAt = new Date(Date.now() + 86400000 * 3).toISOString();
  const revRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/reviews`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      version_id: version1Id,
      digest,
      approver_ids: [contactId],
      due_at: dueAt
    }
  });
  const reviewId = revRes.json.id;

  return {
    clientEmail,
    pass,
    orgId,
    projectId,
    reviewId,
    version1Id
  };
}

async function run() {
  console.log('=== STARTING PORTAL REVIEW BROWSER VERIFICATION ===');
  const fixture = await setupPortalReviewFixture();
  console.log('Fixture created. ProjectId:', fixture.projectId, 'ReviewId:', fixture.reviewId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  page.on('response', async res => {
    if (res.status() >= 400) {
      console.log('HTTP ERROR:', res.status(), res.url(), await res.text().catch(() => ''));
    }
  });

  // 1. Sign in as Client User through UI
  console.log('\n[1] Signing in as Client User through UI...');
  await page.goto('http://localhost:5199/login');
  await page.fill('#e', fixture.clientEmail);
  await page.fill('#p', fixture.pass);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/portal/portal-projects**', { timeout: 15000 });
  console.log('Signed in. Navigating to /portal/portal-review...');

  await page.goto(`http://localhost:5199/portal/portal-review?id=${fixture.projectId}&review=${fixture.reviewId}`);
  await page.waitForTimeout(1000);

  // 2. Review heading and preview media
  console.log('\n[2] Verifying review heading and preview image...');
  await page.waitForSelector('.pm h1', { timeout: 10000 });
  const h1 = await page.locator('.pm h1').textContent();
  console.log(`Heading: "${h1}"`);
  if (!h1.includes('Identity Video Cut')) throw new Error('H1 does not contain deliverable title');

  const sub = await page.locator('.pm p.sub').textContent();
  console.log(`Sub: "${sub}"`);
  if (!sub.includes('Version 1')) throw new Error('Expected Version 1 in sub-header');

  const pvImg = page.locator('#pvImg');
  const imgVisible = await pvImg.isVisible();
  console.log(`Preview image visible: ${imgVisible}`);
  if (!imgVisible) throw new Error('Expected preview image visible');

  // 3. Post a comment with pin annotation
  console.log('\n[3] Placing a pin and submitting a feedback comment...');
  await page.click('#previewContainer', { position: { x: 50, y: 50 } });
  await page.waitForTimeout(300);

  await page.fill('#nc', 'Please make the logo 15% larger');
  await page.click('#ac');
  await page.waitForTimeout(1000);

  const commentText = await page.locator('.cmt').first().textContent();
  console.log(`Submitted comment text: "${commentText}"`);
  if (!commentText.includes('Please make the logo 15% larger')) {
    throw new Error('Expected submitted comment in comments list');
  }

  const pinVisible = await page.locator('.pin').first().isVisible();
  console.log(`Pin button visible on preview: ${pinVisible}`);
  if (!pinVisible) throw new Error('Expected pin button visible on preview');

  // 4. Submit formal decision: Request Changes
  console.log('\n[4] Submitting formal decision: Request changes...');
  const decBox = page.locator('#decisionBox');
  const hasDecBox = await decBox.isVisible();
  console.log(`Decision box visible: ${hasDecBox}`);
  if (!hasDecBox) throw new Error('Expected decision box visible for eligible Approver');

  await page.click('#rq');
  await page.waitForSelector('#rv:not([hidden])', { timeout: 5000 });
  await page.fill('#rt', 'Revise typography and adjust pacing');
  await page.click('#sr');

  // Confirm dialog
  await page.waitForSelector('#dg[open]', { timeout: 5000 });
  await page.click('#confirmBtn');
  await page.waitForTimeout(1000);

  const statusMsg = await page.locator('#ok').textContent();
  console.log(`Status message: "${statusMsg}"`);
  if (!statusMsg.includes('Changes requested on version 1')) {
    throw new Error('Expected "Changes requested on version 1" in status banner');
  }
  console.log('PASS: Decision successfully recorded and acknowledged in UI');

  console.log('\n=== ALL PORTAL REVIEW BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
