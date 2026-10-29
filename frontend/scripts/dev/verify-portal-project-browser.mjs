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

async function setupPortalProjectFixture() {
  const ts = Date.now();
  const ownerEmail = `pproj.owner.${ts}@example.com`;
  const clientEmail = `pproj.client.${ts}@example.com`;
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
    body: { name: 'Kino Space', timezone: 'Africa/Cairo', description: 'Testing Portal Project' }
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
    body: { name: 'Apex Foods', description: 'Food Brand', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Cinema Spot 2026',
      description: 'Cinema television commercial',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const projectId = projRes.json.id;

  // Create Milestones
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { title: 'Script lock', status: 'COMPLETED', due_at: null, position: 0 }
  });
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { title: 'Rough cut', status: 'OPEN', due_at: '2026-11-20T12:00:00Z', position: 1 }
  });

  // Register and verify Client User
  const cc0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': cc0.json.token, Cookie: parseCookies(cc0.setCookie) },
    body: { email: clientEmail, password: pass, name: 'Mona Fathy' }
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

  // Create Contact
  const contactRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Mona Fathy', email: clientEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json.id;

  // Grant access
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

  // Accept invitation
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

  // Deliverable & Open Review
  const delRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Brand film cut',
      description: 'Main master cut',
      task_id: null,
      status: 'ACTIVE'
    }
  });
  const deliverableId = delRes.json.id;

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

  for (let i = 0; i < 30; i++) {
    const poll = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${upIntent.json.id}`, {
      headers: fullHeaders
    });
    if (poll.json?.status === 'READY') break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const verRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${deliverableId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: upIntent.json.id }
  });
  const versionId = verRes.json.id;

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
  const reviewId = revRes.json.id;

  return {
    clientEmail,
    pass,
    orgId,
    projectId,
    reviewId
  };
}

async function run() {
  console.log('=== STARTING PORTAL PROJECT OVERVIEW BROWSER VERIFICATION ===');
  const fixture = await setupPortalProjectFixture();
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
  console.log('Signed in. Navigating to /portal/portal-project...');

  await page.goto(`http://localhost:5199/portal/portal-project?id=${fixture.projectId}`);
  await page.waitForTimeout(1000);

  // 2. Project title, status badge, and "Needs your decision" banner
  console.log('\n[2] Verifying project title and review ask banner...');
  await page.waitForSelector('.pm h1', { timeout: 10000 });
  const h1 = await page.locator('.pm h1').textContent();
  console.log(`Page heading: "${h1}"`);
  if (!h1.includes('Cinema Spot 2026')) throw new Error('H1 does not contain project name');

  const sub = await page.locator('.pm p.sub').textContent();
  console.log(`Sub-header: "${sub}"`);
  if (!sub.includes('Waiting for you')) throw new Error('Expected "Waiting for you" tag in subheader');

  const askBox = page.locator('.ask');
  const askVisible = await askBox.isVisible();
  console.log(`"Needs your decision" banner visible: ${askVisible}`);
  if (!askVisible) throw new Error('Expected .ask banner visible');

  const askText = await askBox.textContent();
  console.log(`Ask banner text: "${askText}"`);
  if (!askText.includes('Brand film cut') || !askText.includes('version 1')) {
    throw new Error('Ask banner does not mention deliverable and version');
  }
  console.log('PASS: Project header and decision banner verified');

  // 3. Milestones verification
  console.log('\n[3] Verifying milestones section...');
  await page.waitForSelector('.ms div', { timeout: 5000 });
  const msItems = await page.locator('.ms div').all();
  console.log(`Milestones count: ${msItems.length} (expected 2)`);
  if (msItems.length !== 2) throw new Error(`Expected 2 milestones, got ${msItems.length}`);

  const ms1 = await msItems[0].textContent();
  console.log(`Milestone 1: "${ms1}"`);
  if (!ms1.includes('Script lock') || !ms1.includes('Done')) {
    throw new Error('Milestone 1 expected Script lock Done');
  }

  const ms2 = await msItems[1].textContent();
  console.log(`Milestone 2: "${ms2}"`);
  if (!ms2.includes('Rough cut')) {
    throw new Error('Milestone 2 expected Rough cut');
  }
  console.log('PASS: Milestones rendered cleanly');

  // 4. Shared files verification
  console.log('\n[4] Verifying shared files...');
  const filesList = await page.locator('.grid div:first-child ul.act li').textContent();
  console.log(`Shared files item: "${filesList}"`);
  if (!filesList.includes('Brand film cut') || !filesList.includes('version 1')) {
    throw new Error('Expected shared files to display Brand film cut · version 1');
  }
  console.log('PASS: Shared files displayed cleanly');

  // 5. Click review button and transition to review workspace
  console.log('\n[5] Clicking "Review version 1" button...');
  await page.click('.ask a.btn');
  await page.waitForURL(`**/portal/portal-review?id=${fixture.projectId}&review=${fixture.reviewId}**`, { timeout: 10000 });
  console.log('PASS: Successfully transitioned to /portal/portal-review');

  console.log('\n=== ALL PORTAL PROJECT OVERVIEW BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
