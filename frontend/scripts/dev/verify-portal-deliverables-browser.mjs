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

async function setupPortalDeliverablesFixture() {
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
    body: { name: 'Studio Lumiere', timezone: 'Africa/Cairo', description: 'Portal Deliverables Agency' }
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
    body: { name: 'Apex Media', description: 'Apex Brand', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // 4. Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Autumn Campaign',
      description: 'Brand commercials and assets',
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
    body: { email: clientEmail, password: pass, name: 'Sara Client' }
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
    body: { name: 'Sara Client', email: clientEmail, status: 'ACTIVE' }
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

  // Helper to upload a PNG asset
  async function uploadFile(filename) {
    const digest = createHash('sha256').update(VALID_PNG).digest('hex');
    const upIntent = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
      body: {
        name: filename,
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
    return { uploadId: upIntent.json.id, digest };
  }

  // 8. Create Deliverable
  const delRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Hero Teaser Cut',
      description: '30-second cinema spot',
      task_id: null,
      status: 'ACTIVE'
    }
  });
  const delId = delRes.json.id;

  // Version 1: Shared, Under Review
  const up1 = await uploadFile('hero_cut_v1.png');
  const ver1 = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${delId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: up1.uploadId }
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
      digest: up1.digest,
      approver_ids: [contactId],
      due_at: dueAt
    }
  });
  const reviewId = revRes.json.id;

  // Version 2: Shared, Not Under Review
  const up2 = await uploadFile('hero_cut_v2.png');
  const ver2 = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${delId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: up2.uploadId }
  });
  const version2Id = ver2.json.id;

  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/versions/${version2Id}/share`, {
    method: 'PATCH',
    headers: { ...fullHeaders, 'If-Match': '"1"' },
    body: { status: 'ACTIVE' }
  });

  return {
    clientEmail,
    pass,
    orgId,
    projectId,
    reviewId,
    version1Id,
    version2Id
  };
}

async function run() {
  console.log('=== STARTING PORTAL DELIVERABLES BROWSER VERIFICATION ===');
  const fixture = await setupPortalDeliverablesFixture();
  console.log('Fixture created. ProjectId:', fixture.projectId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));

  // 1. Sign in as Client User through UI
  console.log('\n[1] Signing in as Client User through UI...');
  await page.goto('http://localhost:5199/login');
  await page.fill('#e', fixture.clientEmail);
  await page.fill('#p', fixture.pass);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/portal/portal-projects**', { timeout: 15000 });
  console.log('Signed in. Navigating to /portal/portal-deliverables...');

  await page.goto(`http://localhost:5199/portal/portal-deliverables?id=${fixture.projectId}`);
  await page.waitForTimeout(1000);

  // 2. Deliverables page heading and subtitle
  console.log('\n[2] Verifying deliverables heading and breadcrumb...');
  await page.waitForSelector('.pm h1', { timeout: 10000 });
  const h1 = await page.locator('.pm h1').textContent();
  console.log(`Heading: "${h1}"`);
  if (!h1.includes('Deliverables')) throw new Error('H1 does not contain "Deliverables"');

  const lnk = await page.locator('.pm a.lnk').textContent();
  console.log(`Breadcrumb link: "${lnk}"`);
  if (!lnk.includes('Autumn Campaign')) throw new Error('Breadcrumb does not contain project name');

  // 3. Versions list verification
  console.log('\n[3] Verifying versions list...');
  await page.waitForSelector('.pm .vr', { timeout: 5000 });
  const vrCards = await page.locator('.pm .vr').all();
  console.log(`Found ${vrCards.length} version card(s) (expected 2)`);
  if (vrCards.length !== 2) throw new Error(`Expected 2 shared versions, found ${vrCards.length}`);

  // Identify cards by version text
  const cardObjects = await Promise.all(vrCards.map(async c => ({ locator: c, text: await c.textContent() })));
  const card1Obj = cardObjects.find(x => x.text.includes('Version 1'));
  const card2Obj = cardObjects.find(x => x.text.includes('Version 2'));

  if (!card1Obj) throw new Error('Could not find card for Version 1');
  if (!card2Obj) throw new Error('Could not find card for Version 2');

  // Card 1: Version 1 (Under Review)
  const card1 = card1Obj.locator;
  const card1Text = card1Obj.text;
  console.log(`Version 1 card: "${card1Text}"`);
  if (!card1Text.includes('Version 1') || !card1Text.includes('Hero Teaser Cut')) {
    throw new Error('Version 1 title or deliverable missing');
  }
  if (!card1Text.includes('Under review')) {
    throw new Error('Expected "Under review" badge on Version 1');
  }
  const openRevBtn = card1.locator('a.btn.lime');
  const hasOpenRev = await openRevBtn.isVisible();
  console.log(`Version 1 has "Open review" button: ${hasOpenRev}`);
  if (!hasOpenRev) throw new Error('Expected "Open review" button on Version 1');

  // Card 2: Version 2 (Not Under Review)
  const card2 = card2Obj.locator;
  const card2Text = card2Obj.text;
  console.log(`Version 2 card: "${card2Text}"`);
  if (!card2Text.includes('Version 2')) {
    throw new Error('Expected Version 2 in card 2');
  }
  if (!card2Text.includes('Not under review')) {
    throw new Error('Expected "Not under review" badge on Version 2');
  }
  const previewBtn = card2.locator('a.btn:has-text("Preview")');
  const hasPreview = await previewBtn.isVisible();
  console.log(`Version 2 has Preview button: ${hasPreview}`);
  if (!hasPreview) throw new Error('Expected Preview button on Version 2');

  const downloadBtn = card2.locator('a.btn:has-text("Download")');
  const hasDownload = await downloadBtn.isVisible();
  console.log(`Version 2 has Download button: ${hasDownload}`);
  if (!hasDownload) throw new Error('Expected Download button on Version 2');

  // 4. Click "Open review" on Version 1 and verify navigation
  console.log('\n[4] Clicking "Open review" button...');
  await openRevBtn.click();
  await page.waitForURL(`**/portal/portal-review?id=${fixture.projectId}&review=${fixture.reviewId}**`, { timeout: 10000 });
  console.log('PASS: Successfully transitioned to /portal/portal-review');

  console.log('\n=== ALL PORTAL DELIVERABLES BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
