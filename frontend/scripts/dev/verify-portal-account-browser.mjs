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

async function setupPortalAccountFixture() {
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
    body: { name: 'Studio Account', timezone: 'Africa/Cairo', description: 'Portal Account Agency' }
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
    body: { name: 'Alpha Retail', description: 'Retail Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // 4. Create Project
  const pRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Retail Portal',
      description: 'Retail Portal Assets',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const projectId = pRes.json.id;

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

  return {
    clientEmail,
    pass,
    orgId,
    projectId
  };
}

async function run() {
  console.log('=== STARTING PORTAL ACCOUNT BROWSER VERIFICATION ===');
  const fixture = await setupPortalAccountFixture();
  console.log('Fixture created. OrgId:', fixture.orgId);

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
  console.log('Signed in. Navigating to /portal/portal-account...');

  await page.goto('http://localhost:5199/portal/portal-account');
  await page.waitForTimeout(1000);

  // 2. Heading and Profile form
  console.log('\n[2] Verifying account heading and initial display name...');
  await page.waitForSelector('.pm h1', { timeout: 10000 });
  const h1 = await page.locator('.pm h1').textContent();
  console.log(`Heading: "${h1}"`);
  if (!h1.includes('Account')) throw new Error('H1 does not contain "Account"');

  const dnVal = await page.inputValue('#dn');
  console.log(`Current display name: "${dnVal}"`);
  if (!dnVal.includes('Hoda Client')) throw new Error('Display name input does not match initial name');

  // 3. Update Display Name
  console.log('\n[3] Updating display name...');
  await page.fill('#dn', 'Hoda Updated Name');
  await page.click('#sv');
  await page.waitForSelector('#ps:not([hidden])', { timeout: 5000 });
  const psText = await page.locator('#ps').textContent();
  console.log(`Profile status: "${psText}"`);
  if (!psText.includes('Profile saved')) throw new Error('Expected "Profile saved."');

  // 4. Verify Sessions Table
  console.log('\n[4] Verifying active sessions table...');
  await page.waitForSelector('#ss tr', { timeout: 5000 });
  const rows = await page.locator('#ss tr').all();
  console.log(`Active session rows count: ${rows.length}`);
  if (rows.length < 1) throw new Error('Expected at least 1 session row');

  const firstRowText = await rows[0].textContent();
  console.log(`First session row: "${firstRowText}"`);
  if (!firstRowText.includes('This device')) {
    throw new Error('Expected "This device" tag on current session');
  }

  // 5. Verify Notification Preferences Toggles
  console.log('\n[5] Verifying notification preferences checkboxes...');
  const a1 = page.locator('#a1');
  const a2 = page.locator('#a2');
  const a3 = page.locator('#a3');
  const a4 = page.locator('#a4');

  const a1Visible = await a1.isVisible();
  const a2Visible = await a2.isVisible();
  const a3Visible = await a3.isVisible();
  const a4Visible = await a4.isVisible();

  console.log(`Notification checkboxes visible: a1=${a1Visible}, a2=${a2Visible}, a3=${a3Visible}, a4=${a4Visible}`);
  if (!a1Visible || !a2Visible || !a3Visible || !a4Visible) {
    throw new Error('All 4 notification category checkboxes must be visible');
  }

  // Toggle checkbox a4 (Client updates)
  const initialA4 = await a4.isChecked();
  await a4.click();
  await page.waitForTimeout(500);
  const toggledA4 = await a4.isChecked();
  console.log(`Checkbox a4 toggled from ${initialA4} to ${toggledA4}`);
  if (initialA4 === toggledA4) throw new Error('Checkbox a4 state did not toggle');

  console.log('PASS: All account profile, sessions, and preferences verified');

  console.log('\n=== ALL PORTAL ACCOUNT BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
