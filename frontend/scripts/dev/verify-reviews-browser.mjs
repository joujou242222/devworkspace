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

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function setupReviewFixture() {
  const ts = Date.now();
  const ownerEmail = `rev.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // 1. Register Owner
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Review Owner' }
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
    body: { name: 'Acme Studios', timezone: 'Africa/Cairo', description: 'Testing Review Center' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login Owner to get Org principal
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

  // 2. Create Client
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { name: 'Starlight Corp', description: 'Global client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // 3. Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Super Bowl Commercial',
      description: 'Commercial production',
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

  // 4. Create Approver user & contact
  const approverEmail = `approver.${ts}@example.com`;
  const caReg = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': caReg.json.token, Cookie: parseCookies(caReg.setCookie) },
    body: { email: approverEmail, password: pass, name: 'Review Approver' }
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
    body: { name: 'Review Approver', email: approverEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json.id;

  // Invite Contact to Project as APPROVER
  await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { project_id: projectId, role: 'APPROVER' }
  });

  // Get invitation link
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

  // Approver logs in and accepts invitation
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

  // 5. Helper to create deliverable, upload asset, create & share version
  const digest = createHash('sha256').update(VALID_PNG).digest('hex');

  async function createDeliverableAndVersion(delTitle) {
    const delRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, {
      method: 'POST',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
      body: { title: delTitle, description: 'High quality cut', task_id: null, status: 'ACTIVE' }
    });
    const delId = delRes.json.id;

    const uploadIntent = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
      body: {
        name: `${delTitle}.png`,
        purpose: 'DELIVERABLE',
        folder_id: null,
        size: VALID_PNG.length,
        digest,
        mime: 'image/png'
      }
    });
    const uploadId = uploadIntent.json.id;
    const capUrl = uploadIntent.json.capability.url;

    // PUT binary with content-length
    await req(new URL(capUrl).pathname + new URL(capUrl).search, {
      method: 'PUT',
      headers: {
        'content-length': String(VALID_PNG.length),
        'content-type': 'image/png',
        ...uploadIntent.json.capability.headers
      },
      body: VALID_PNG
    });

    // Finalize
    await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${uploadId}/finalize`, {
      method: 'POST',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
      body: {}
    });

    // Poll until READY
    for (let i = 0; i < 60; i++) {
      const poll = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/uploads/${uploadId}`, { headers: fullHeaders });
      if (poll.json?.status === 'READY') break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // Create version
    const verRes = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/deliverables/${delId}/versions`, {
      method: 'POST',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
      body: { asset_id: uploadId }
    });
    const verId = verRes.json.id;

    // Share version
    await req(`/api/v1/organizations/${orgId}/projects/${projectId}/versions/${verId}/share`, {
      method: 'PATCH',
      headers: { ...fullHeaders, 'idempotency-key': randomUUID(), 'if-match': '"1"' },
      body: { status: 'ACTIVE' }
    });

    return { delId, verId };
  }

  // Deliverable 1: Open review (future due date)
  console.log('Creating Deliverable 1 & Version 1...');
  const item1 = await createDeliverableAndVersion('Rough Cut Edit');
  const futureDue = new Date(Date.now() + 86400000 * 3).toISOString(); // 3 days in future
  const rev1 = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/reviews`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      version_id: item1.verId,
      digest,
      approver_ids: [contactId],
      due_at: futureDue
    }
  });

  // Deliverable 2: Overdue review (past due date)
  console.log('Creating Deliverable 2 & Version 1...');
  const item2 = await createDeliverableAndVersion('Color Grading Reel');
  const pastDue = new Date(Date.now() - 86400000 * 2).toISOString(); // 2 days in past
  const rev2 = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/reviews`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      version_id: item2.verId,
      digest,
      approver_ids: [contactId],
      due_at: pastDue
    }
  });

  return {
    ownerEmail,
    pass,
    orgId,
    projectId,
    rev1Id: rev1.json.id,
    rev2Id: rev2.json.id
  };
}

async function run() {
  console.log('=== STARTING WORKSPACE REVIEWS BROWSER VERIFICATION ===');
  const fixture = await setupReviewFixture();
  console.log('Fixture created successfully:', fixture.ownerEmail, 'Org:', fixture.orgId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // 1. Sign in through UI
  console.log('\n[1] Signing in through UI...');
  await page.goto('http://localhost:5199/login?returnTo=/workspace/reviews');
  await page.fill('#e', fixture.ownerEmail);
  await page.fill('#p', fixture.pass);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/workspace/reviews**', { timeout: 15000 });
  console.log('Navigated to /workspace/reviews');

  // 2. Wait for table rows to render
  console.log('\n[2] Waiting for reviews data to load...');
  await page.waitForSelector('#tb tr[data-id]', { timeout: 10000 });
  const rows = await page.locator('#tb tr').count();
  console.log(`Found ${rows} rendered review rows (expected 2)`);
  if (rows !== 2) throw new Error(`Expected 2 review rows, got ${rows}`);

  // 3. Verify Stats Cards
  console.log('\n[3] Verifying stats cards (#s1 Open, #s2 Overdue, #s3 Waiting)...');
  const s1Text = await page.locator('#s1').textContent();
  const s2Text = await page.locator('#s2').textContent();
  const s3Text = await page.locator('#s3').textContent();
  console.log(`Stats cards: Open=#s1="${s1Text}", Overdue=#s2="${s2Text}", Waiting=#s3="${s3Text}"`);
  if (s1Text !== '2') throw new Error(`Expected #s1=2 (Open), got "${s1Text}"`);
  if (s2Text !== '1') throw new Error(`Expected #s2=1 (Overdue), got "${s2Text}"`);
  if (s3Text !== '2') throw new Error(`Expected #s3=2 (Waiting), got "${s3Text}"`);
  console.log('PASS: Stats cards accurately reflect open and overdue review cycles');

  // 4. Verify Table Row Content
  console.log('\n[4] Verifying table row contents...');
  const rowHtml = await page.locator('#tb').innerHTML();
  if (!rowHtml.includes('Rough Cut Edit') || !rowHtml.includes('Color Grading Reel')) {
    throw new Error('Deliverable titles missing from table rows');
  }
  if (!rowHtml.includes('Super Bowl Commercial')) {
    throw new Error('Project name missing from table rows');
  }
  if (!rowHtml.includes('Starlight Corp')) {
    throw new Error('Client name missing from table rows');
  }
  if (!rowHtml.includes('v1')) {
    throw new Error('Version v1 missing from table rows');
  }
  // Check for the overdue / late badge
  const lateBadgeCount = await page.locator('#tb .late').count();
  console.log(`Late indicator count: ${lateBadgeCount} (expected 1)`);
  if (lateBadgeCount !== 1) throw new Error(`Expected 1 late indicator, got ${lateBadgeCount}`);
  console.log('PASS: Table rows render deliverable, project, client, version, and late indicator');

  // 5. Test Filters
  console.log('\n[5] Testing status filter (#fs)...');
  await page.selectOption('#fs', 'APPROVED');
  await page.waitForTimeout(300);
  const filteredRows = await page.locator('#tb tr').count();
  const emptyVisible = await page.locator('#em').isVisible();
  console.log(`Filtered by APPROVED: rows=${filteredRows}, #em visible=${emptyVisible}`);
  if (filteredRows !== 0 || !emptyVisible) {
    throw new Error('Filtering by APPROVED should show 0 rows and reveal #em empty state');
  }

  // Restore status to All
  await page.selectOption('#fs', '');
  await page.waitForTimeout(300);
  const restoredRows = await page.locator('#tb tr').count();
  const emptyHidden = await page.locator('#em').isHidden();
  console.log(`Restored filter to All: rows=${restoredRows}, #em hidden=${emptyHidden}`);
  if (restoredRows !== 2 || !emptyHidden) {
    throw new Error('Restoring filter should show 2 rows and hide #em');
  }

  // Filter by project (#fp)
  console.log('\n[6] Testing project filter (#fp)...');
  const projectOptions = await page.locator('#fp option').count();
  console.log(`Project filter options count: ${projectOptions}`);
  if (projectOptions < 2) throw new Error('Expected project filter to contain project options');
  await page.selectOption('#fp', fixture.projectId);
  await page.waitForTimeout(300);
  const projRows = await page.locator('#tb tr').count();
  if (projRows !== 2) throw new Error(`Expected 2 rows when filtered by current project, got ${projRows}`);

  // 6. Test Open Action Navigation
  console.log('\n[7] Testing review action button navigation...');
  const firstOpenBtn = page.locator('#tb button[data-open]').first();
  await firstOpenBtn.click();
  await page.waitForURL('**/project/project-review**', { timeout: 10000 });
  const currentUrl = page.url();
  console.log(`Navigated to: ${currentUrl}`);
  if (!currentUrl.includes('/project/project-review') || !currentUrl.includes(`project=${fixture.projectId}`)) {
    throw new Error(`Navigation URL does not match project-review path: ${currentUrl}`);
  }
  console.log('PASS: Open button cleanly navigated to /project/project-review with query parameters');

  console.log('\n=== ALL WORKSPACE REVIEWS BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
