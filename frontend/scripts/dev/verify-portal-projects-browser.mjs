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

async function setupPortalProjectsFixture() {
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
    body: { name: 'Studio Nour', timezone: 'Africa/Cairo', description: 'Testing Client Portal' }
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
    body: { name: 'Nile Foods', description: 'FMCG Brand', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project 1 (with review)
  const proj1Res = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Spring TVC',
      description: 'Television Commercial',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const project1Id = proj1Res.json.id;

  // Create Project 2
  const proj2Res = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Packaging Redesign',
      description: 'Packaging assets',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const project2Id = proj2Res.json.id;

  // Register and verify Client User (Mona Fathy)
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

  // Grant access to Project 1
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: project1Id, role: 'APPROVER' }
  });

  let inv1 = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    inv1 = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === clientEmail.toLowerCase() && m.Subject.includes('invitation')));
    if (inv1) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const inv1Detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${inv1.ID}`)).json();
  const inv1Token = new URL(inv1Detail.Text.trim()).searchParams.get('token');

  // Login Client to accept invite 1
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
    body: { token: inv1Token }
  });

  // Grant access to Project 2
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: project2Id, role: 'REVIEWER' }
  });

  let inv2 = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    inv2 = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === clientEmail.toLowerCase() && m.ID !== inv1.ID && m.Subject.includes('invitation')));
    if (inv2) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const inv2Detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${inv2.ID}`)).json();
  const inv2Token = new URL(inv2Detail.Text.trim()).searchParams.get('token');

  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: {
      'x-csrf-token': clientCsrf.json.token,
      Cookie: clientCookie + '; ' + parseCookies(clientCsrf.setCookie),
      'idempotency-key': randomUUID()
    },
    body: { token: inv2Token }
  });

  // Deliverable & Open Review on Project 1
  const delRes = await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/deliverables`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'TV Spot 30s',
      description: '30 second spot',
      task_id: null,
      status: 'ACTIVE'
    }
  });
  const deliverableId = delRes.json.id;

  const digest = createHash('sha256').update(VALID_PNG).digest('hex');
  const upIntent = await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/uploads`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      name: 'tvc_v1.png',
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

  await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/uploads/${upIntent.json.id}/finalize`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {}
  });

  for (let i = 0; i < 30; i++) {
    const poll = await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/uploads/${upIntent.json.id}`, {
      headers: fullHeaders
    });
    if (poll.json?.status === 'READY') break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const verRes = await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/deliverables/${deliverableId}/versions`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { asset_id: upIntent.json.id }
  });
  const versionId = verRes.json.id;

  await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/versions/${versionId}/share`, {
    method: 'PATCH',
    headers: { ...fullHeaders, 'If-Match': '"1"' },
    body: { status: 'ACTIVE' }
  });

  const dueAt = new Date(Date.now() + 86400000 * 3).toISOString();
  await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/reviews`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      version_id: versionId,
      digest,
      approver_ids: [contactId],
      due_at: dueAt
    }
  });

  return {
    clientEmail,
    pass,
    orgId,
    project1Id,
    project2Id
  };
}

async function run() {
  console.log('=== STARTING PORTAL PROJECTS BROWSER VERIFICATION ===');
  const fixture = await setupPortalProjectsFixture();
  console.log('Fixture created. Client email:', fixture.clientEmail);

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
  console.log('Signed in. Navigated to /portal/portal-projects...');

  // 2. Header and workspace verification
  console.log('\n[2] Verifying portal header, branding, and workspace...');
  await page.waitForSelector('header.ph', { timeout: 10000 });
  const brandTag = await page.locator('.tagc').textContent();
  console.log(`Brand badge: "${brandTag}"`);
  if (!brandTag.includes('Client space')) throw new Error('Expected "Client space" badge in header');

  const wsVal = await page.locator('#ws').inputValue();
  console.log(`Workspace selector value: ${wsVal}`);
  if (!wsVal) throw new Error('Expected #ws selector to have active client principal selected');

  const uname = await page.locator('#uname').textContent();
  console.log(`User name: "${uname}"`);
  if (!uname.includes('Mona')) throw new Error('Expected user name Mona in header');
  console.log('PASS: Portal header and identity verified');

  // 3. Project list verification
  console.log('\n[3] Verifying project list and status tags...');
  await page.waitForSelector('.pm .post', { timeout: 10000 });
  const cards = await page.locator('.pm .post').all();
  console.log(`Number of project cards rendered: ${cards.length} (expected 2)`);
  if (cards.length !== 2) throw new Error(`Expected 2 project cards, got ${cards.length}`);

  const springCard = page.locator(`.pm .post[data-p="${fixture.project1Id}"]`);
  const springText = await springCard.textContent();
  console.log(`Spring TVC Card: "${springText}"`);
  if (!springText.includes('Spring TVC') || !springText.includes('Waiting for your decision')) {
    throw new Error('Expected Spring TVC card to show "Waiting for your decision"');
  }

  const packCard = page.locator(`.pm .post[data-p="${fixture.project2Id}"]`);
  const packText = await packCard.textContent();
  console.log(`Packaging Card: "${packText}"`);
  if (!packText.includes('Packaging Redesign') || !packText.includes('Nothing needed from you')) {
    throw new Error('Expected Packaging Redesign card to show "Nothing needed from you"');
  }
  console.log('PASS: Projects and decision status tags verified');

  // 4. Navigation to project detail
  console.log('\n[4] Clicking project card...');
  await page.click(`.pm .post[data-p="${fixture.project1Id}"]`);
  await page.waitForURL(`**/portal/portal-project?id=${fixture.project1Id}**`, { timeout: 10000 });
  console.log('PASS: Navigated cleanly to /portal/portal-project');

  console.log('\n=== ALL PORTAL PROJECTS BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
