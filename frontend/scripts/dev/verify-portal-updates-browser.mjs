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
import { randomUUID } from 'node:crypto';

const ca = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function setupPortalUpdatesFixture() {
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
    body: { name: 'Studio Updates', timezone: 'Africa/Cairo', description: 'Portal Updates Agency' }
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
    body: { name: 'Acme Global', description: 'Global Retailer', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // 4. Create Project 1 (Alpha Brand) and Project 2 (Beta Campaign)
  const p1Res = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Alpha Brand',
      description: 'Alpha campaign assets',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const project1Id = p1Res.json.id;

  const p2Res = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Beta Campaign',
      description: 'Beta product launch',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const project2Id = p2Res.json.id;

  // 5. Register and verify Client User
  const cc0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': cc0.json.token, Cookie: parseCookies(cc0.setCookie) },
    body: { email: clientEmail, password: pass, name: 'Hoda Client' }
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
    body: { name: 'Hoda Client', email: clientEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json.id;

  // 7. Invite Contact to Project 1 & Accept
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: project1Id, role: 'APPROVER' }
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

  // Also grant Project 2 directly
  await req(`/api/v1/organizations/${orgId}/projects/${project2Id}/grants`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { contact_id: contactId, role: 'APPROVER', status: 'ACTIVE' }
  });

  // 8. Publish client updates on Project 1 and Project 2
  await req(`/api/v1/organizations/${orgId}/projects/${project1Id}/updates`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { body: 'The rough cut is ready for your review. Take a look when you can.' }
  });

  await req(`/api/v1/organizations/${orgId}/projects/${project2Id}/updates`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { body: 'Storyboards signed off by creative directors.' }
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
  console.log('=== STARTING PORTAL UPDATES BROWSER VERIFICATION ===');
  const fixture = await setupPortalUpdatesFixture();
  console.log('Fixture created. Project1:', fixture.project1Id, 'Project2:', fixture.project2Id);

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
  console.log('Signed in. Navigating to /portal/portal-updates...');

  await page.goto('http://localhost:5199/portal/portal-updates');
  await page.waitForTimeout(1000);

  // 2. Heading and Subtitle
  console.log('\n[2] Verifying updates heading and project filter...');
  await page.waitForSelector('.pm h1', { timeout: 10000 });
  const h1 = await page.locator('.pm h1').textContent();
  console.log(`Heading: "${h1}"`);
  if (!h1.includes('Latest updates')) throw new Error('H1 does not contain "Latest updates"');

  // Verify Project filter dropdown
  const fp = page.locator('#fp');
  const fpVisible = await fp.isVisible();
  console.log(`Project filter dropdown visible: ${fpVisible}`);
  if (!fpVisible) throw new Error('Expected project filter dropdown #fp');

  const fpText = await fp.textContent();
  console.log(`Filter options: "${fpText}"`);
  if (!fpText.includes('All projects') || !fpText.includes('Alpha Brand') || !fpText.includes('Beta Campaign')) {
    throw new Error('Project filter missing project options');
  }

  // 3. Aggregate Feed (All projects)
  console.log('\n[3] Verifying all projects updates feed...');
  await page.waitForSelector('.pm article.post', { timeout: 5000 });
  const posts = await page.locator('.pm article.post').all();
  console.log(`Found ${posts.length} update article(s) (expected 2)`);
  if (posts.length !== 2) throw new Error(`Expected 2 update posts, got ${posts.length}`);

  const postTexts = await Promise.all(posts.map(p => p.textContent()));
  console.log('Posts:', postTexts);
  const hasUpdate1 = postTexts.some(t => t.includes('The rough cut is ready for your review'));
  const hasUpdate2 = postTexts.some(t => t.includes('Storyboards signed off by creative directors'));
  if (!hasUpdate1 || !hasUpdate2) {
    throw new Error('Expected both updates from Project 1 and Project 2 in aggregate feed');
  }
  console.log('PASS: Aggregate feed contains all accessible project updates');

  // 4. Filter to Project 1 (Alpha Brand)
  console.log('\n[4] Filtering to Project 1 (Alpha Brand)...');
  await page.selectOption('#fp', fixture.project1Id);
  await page.waitForTimeout(1000);

  const filteredPosts = await page.locator('.pm article.post').all();
  console.log(`Found ${filteredPosts.length} filtered post(s) (expected 1)`);
  if (filteredPosts.length !== 1) throw new Error(`Expected 1 post after filter, got ${filteredPosts.length}`);

  const singleText = await filteredPosts[0].textContent();
  console.log(`Filtered post: "${singleText}"`);
  if (!singleText.includes('The rough cut is ready for your review')) {
    throw new Error('Expected Project 1 update in filtered view');
  }
  if (singleText.includes('Storyboards signed off by creative directors')) {
    throw new Error('Project 2 update should NOT appear in filtered view');
  }

  const curUrl = page.url();
  console.log(`Current URL with filter: "${curUrl}"`);
  if (!curUrl.includes(fixture.project1Id)) {
    throw new Error('URL does not include filtered projectId');
  }
  console.log('PASS: Filter works cleanly and updates view');

  console.log('\n=== ALL PORTAL UPDATES BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
