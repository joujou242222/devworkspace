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

async function setupDeliverablesFixture() {
  const ts = Date.now();
  const ownerEmail = `del.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // 1. Register & verify owner
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Deliv Owner' }
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
    body: { name: 'Kino Post', timezone: 'Africa/Cairo', description: 'Testing Deliverables' }
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
    body: { name: 'Vanguard Media', description: 'Media Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Cinema Spot 2026',
      description: 'Theatrical Spot',
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

  // Create Task
  const taskRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Finish Color Grade',
      description: 'Resolve grade for cinema',
      milestone_id: null,
      assignee_id: null,
      priority: 'HIGH',
      status: 'TODO',
      due_at: null,
      position: 1
    }
  });
  console.log('Fixture taskRes status:', taskRes.status, taskRes.text);
  const taskId = taskRes.json?.id;

  // Create Approver User & Contact
  const approverEmail = `del.app.${ts}@example.com`;
  const caReg = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': caReg.json.token, Cookie: parseCookies(caReg.setCookie) },
    body: { email: approverEmail, password: pass, name: 'Approver Nadine' }
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
    body: { name: 'Approver Nadine', email: approverEmail, status: 'ACTIVE' }
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

  return {
    ownerEmail,
    pass,
    orgId,
    projectId,
    taskId
  };
}

async function run() {
  console.log('=== STARTING PROJECT DELIVERABLES BROWSER VERIFICATION ===');
  const fixture = await setupDeliverablesFixture();
  console.log('Fixture created:', fixture.ownerEmail, 'ProjectId:', fixture.projectId);

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
  console.log('Signed in. Navigating to project-deliverables...');

  await page.goto(`http://localhost:5199/project/project-deliverables?id=${fixture.projectId}`);
  await page.waitForTimeout(1000);

  // 2. Initial empty state
  console.log('\n[2] Checking initial empty state...');
  await page.waitForSelector('.top h1', { timeout: 10000 });
  const h1 = await page.locator('.top h1').textContent();
  console.log(`Page title: "${h1}"`);
  if (!h1.includes('Cinema Spot 2026')) throw new Error('H1 does not contain project name');

  const emptyVisible = await page.locator('#em').isVisible();
  console.log(`Initial empty state visible: ${emptyVisible}`);
  if (!emptyVisible) throw new Error('Expected #em empty state visible initially');
  console.log('PASS: Initial empty state verified');

  // 3. Create New Deliverable
  console.log('\n[3] Creating new deliverable "Broadcast Cut"...');
  await page.click('#nd');
  await page.waitForSelector('#dn[open]', { timeout: 5000 });
  await page.fill('#nn', 'Broadcast Cut');
  await page.click('#dnf button[type="submit"]');

  await page.waitForFunction(() => {
    const sec = document.querySelector('section.sec h2');
    return sec && sec.textContent.includes('Broadcast Cut');
  }, { timeout: 8000 });
  console.log('PASS: Deliverable "Broadcast Cut" created and rendered');

  // 4. Link Task
  console.log('\n[4] Linking task "Finish Color Grade"...');
  await page.click('button[data-lt="0"]');
  await page.waitForSelector('#dk[open]', { timeout: 5000 });
  await page.selectOption('#lt', { label: 'Finish Color Grade' });
  await page.click('#dkf button[type="submit"]');

  await page.waitForFunction(() => {
    const sec = document.querySelector('section.sec');
    return sec && sec.textContent.includes('Linked task: Finish Color Grade') && sec.textContent.includes('Unlink task');
  }, { timeout: 5000 });
  console.log('PASS: Task linked to deliverable');

  // 5. Prepare Version 1
  console.log('\n[5] Preparing Version 1...');
  await page.click('button[data-pv="0"]');
  await page.waitForSelector('#dp[open]', { timeout: 5000 });
  await page.fill('#pf', 'spot_v1.png');
  await page.click('#dpf button[type="submit"]');

  console.log('Waiting for scanner to mark Version 1 Ready...');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#out tr[data-id]');
    return Array.from(rows).some(r => r.textContent.includes('v1') && r.textContent.includes('Ready'));
  }, { timeout: 60000 });
  console.log('PASS: Version 1 prepared and ready');

  // 6. Share Version 1
  console.log('\n[6] Sharing Version 1 with client...');
  await page.click('button[data-sh="0,0"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('#out tr[data-id]');
    return row && row.textContent.includes('Shared') && row.querySelector('button[data-sh]').textContent.includes('Unshare');
  }, { timeout: 8000 });
  console.log('PASS: Version 1 shared with client');

  // 7. Open Review Cycle on Version 1
  console.log('\n[7] Opening Review Cycle on Version 1...');
  await page.click('button[data-rv="0,0"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('#out tr[data-id]');
    return row && row.textContent.includes('Review open') && row.querySelector('button[data-rv]').textContent.includes('Cancel review');
  }, { timeout: 8000 });
  console.log('PASS: Review cycle opened on Version 1');

  // 8. Prepare Version 2
  console.log('\n[8] Preparing Version 2...');
  await page.click('button[data-pv="0"]');
  await page.waitForSelector('#dp[open]', { timeout: 5000 });
  await page.fill('#pf', 'spot_v2.png');
  await page.click('#dpf button[type="submit"]');

  console.log('Waiting for scanner to mark Version 2 Ready...');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#out tr[data-id]');
    return Array.from(rows).some(r => r.textContent.includes('v2') && r.textContent.includes('Ready'));
  }, { timeout: 60000 });
  console.log('PASS: Version 2 prepared and ready');

  // Check that v1 now displays the stale warning
  const staleNoticeCount = await page.locator('#out .tag.no:has-text("A newer version is ready")').count();
  console.log(`Stale notice count: ${staleNoticeCount} (expected 1)`);
  if (staleNoticeCount !== 1) throw new Error('Expected stale notice on v1 when v2 is ready');
  console.log('PASS: Stale review notice rendered cleanly on v1');

  // 9. Replace Review on v1 with v2
  console.log('\n[9] Replacing Review on v1 with v2 via dialog...');
  await page.click('button[data-rp="0,1"]'); // v1 row index is 1 (sorted newest first)
  await page.waitForSelector('#dq[open]', { timeout: 5000 });

  // Click Next
  await page.click('#rn');
  await page.waitForFunction(() => {
    const s2 = document.getElementById('s2');
    return s2 && !s2.hidden;
  }, { timeout: 5000 });
  const confMsg = await page.locator('#rc').textContent();
  console.log(`Confirmation text: "${confMsg}"`);
  if (!confMsg.includes('v1') || !confMsg.includes('v2')) {
    throw new Error('Confirmation text does not mention v1 and v2');
  }

  // Click Replace review
  await page.click('#rg');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#out tr[data-id]');
    const v2Row = Array.from(rows).find(r => r.textContent.includes('v2'));
    const v1Row = Array.from(rows).find(r => r.textContent.includes('v1'));
    return v2Row && v2Row.textContent.includes('Review open') && v1Row && !v1Row.textContent.includes('Review open');
  }, { timeout: 10000 });
  console.log('PASS: Review cycle atomically replaced from v1 to v2');

  // 10. Cancel Review on v2
  console.log('\n[10] Cancelling review on v2...');
  await page.click('#out tr:has-text("v2") button[data-rv]');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#out tr[data-id]');
    return Array.from(rows).every(r => !r.textContent.includes('Review open'));
  }, { timeout: 10000 });
  console.log('PASS: Review cycle cancelled cleanly');

  console.log('\n=== ALL PROJECT DELIVERABLES BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
