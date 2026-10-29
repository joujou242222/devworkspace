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
const BASE_URL = 'http://localhost:5199';

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

async function setupTestEnvironment() {
  const ts = Date.now();
  const ownerEmail = `reports.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // Register & verify
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Reports Owner' }
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

  // Login
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
    body: { name: 'Analytics Studio', timezone: 'Africa/Cairo', description: 'Testing Reports' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login to get membership
  const lRes2 = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': postCsrf.json.token, Cookie: authHeaders.Cookie },
    body: { email: ownerEmail, password: pass }
  });
  const cookie2 = parseCookies(lRes2.setCookie);
  const finalCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie2 } });

  const principalsRes = await req('/api/v1/me/principals', {
    headers: { Cookie: cookie2 }
  });
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
    body: { name: 'Analytics Client', description: 'Client for reports', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project Alpha
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Project Alpha',
      description: 'Alpha report project',
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

  // Create tasks on Project Alpha (one DONE, one open)
  const t1Res = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Task Alpha 1',
      description: 'Done task',
      priority: 'HIGH',
      due_at: null,
      status: 'DONE',
      position: 1,
      assignee_id: null,
      milestone_id: null
    }
  });

  const t2Res = await req(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      title: 'Task Alpha 2',
      description: 'Open task',
      priority: 'NORMAL',
      due_at: null,
      status: 'TODO',
      position: 2,
      assignee_id: null,
      milestone_id: null
    }
  });
  console.log('Task creation statuses:', t1Res.status, t2Res.status, t2Res.text);

  return { ownerEmail, pass, orgId, projectId, fullHeaders };
}

async function run() {
  console.log('=== VERIFYING /workspace/reports (Reports Page) ===');
  const env = await setupTestEnvironment();
  console.log(`Environment ready. Org: ${env.orgId}, Project: ${env.projectId}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  try {
    // 1. Sign in via UI
    console.log('\n1. Signing in via UI...');
    await page.goto(`${BASE_URL}/login`);
    await page.fill('#e', env.ownerEmail);
    await page.fill('#p', env.pass);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workspace/dashboard**', { timeout: 15000 });
    console.log('Signed in successfully');

    // 2. Navigate to /workspace/reports
    console.log('\n2. Navigating to /workspace/reports...');
    await page.goto(`${BASE_URL}/workspace/reports`);
    await page.waitForSelector('#app');
    await page.waitForSelector('#out .stats', { timeout: 10000 });
    console.log('Reports page rendered');

    // Verify dynamic header
    const headerUser = await page.textContent('.util a.ib');
    console.log(`Header user: "${headerUser.trim()}"`);
    if (headerUser.includes('Sara')) throw new Error('Header still contains hardcoded Sara');

    // Verify initial stats cards and table
    const statsText = await page.locator('#out .stats').innerText();
    console.log('Stats cards output:\n', statsText);
    if (!statsText.toLowerCase().includes('progress') || !statsText.toLowerCase().includes('tasks closed / open')) {
      throw new Error('Stats cards missing expected metrics');
    }

    const tableHtml = await page.locator('#out table.tbl').innerHTML();
    console.log('Table contains Project Alpha:', tableHtml.includes('Project Alpha'));
    if (!tableHtml.includes('Project Alpha')) {
      throw new Error('Table did not render Project Alpha');
    }
    console.log('✓ Initial whole-company report verified');

    // 3. Test Invalid Date Window (start date > end date)
    console.log('\n3. Testing invalid date range (start > end)...');
    await page.fill('#fa', '2026-11-01');
    await page.fill('#fb', '2026-10-01');
    // Trigger onchange
    await page.locator('#fb').dispatchEvent('change');

    await page.waitForFunction(() => !document.getElementById('ce')?.hidden, { timeout: 5000 });
    const ceVisible = await page.locator('#ce').isVisible();
    const outHtml = await page.locator('#out').innerHTML();
    console.log(`Error banner #ce visible: ${ceVisible}, #out content cleared: ${outHtml === ''}`);

    if (!ceVisible || outHtml !== '') {
      throw new Error('Invalid date window did not show #ce or did not clear #out');
    }
    console.log('✓ Start date > end date correctly renders #ce error banner');

    // 4. Restore valid date range
    console.log('\n4. Restoring valid date range...');
    await page.fill('#fa', '2026-08-01');
    await page.fill('#fb', '2026-12-31');
    await page.locator('#fb').dispatchEvent('change');

    await page.waitForSelector('#out .stats', { timeout: 10000 });
    const ceRestoredHidden = await page.locator('#ce').isHidden();
    console.log(`Error banner #ce hidden: ${ceRestoredHidden}`);
    if (!ceRestoredHidden) throw new Error('#ce remained visible after restoring valid dates');
    console.log('✓ Valid date range restored report view');

    // 5. Test Scope Filtering (Specific project selection)
    console.log('\n5. Testing scope filtering by project...');
    const selectOptions = await page.locator('#fp option').allInnerTexts();
    console.log('Scope selector options:', selectOptions);
    if (!selectOptions.includes('Project Alpha')) {
      throw new Error('Scope dropdown does not list Project Alpha');
    }

    await page.selectOption('#fp', env.projectId);
    await page.locator('#fp').dispatchEvent('change');
    await page.waitForSelector('#out table.tbl tbody tr', { timeout: 10000 });

    const filteredRows = await page.locator('#out table.tbl tbody tr').count();
    const filteredRowText = await page.locator('#out table.tbl tbody tr').first().innerText();
    console.log(`Filtered row count: ${filteredRows}, content: "${filteredRowText}"`);

    if (filteredRows !== 1 || !filteredRowText.includes('Project Alpha')) {
      throw new Error('Filtered scope did not isolate Project Alpha');
    }
    console.log('✓ Project scope filtering verified');

    console.log('\nALL REPORTS PAGE TESTS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('REPORTS VERIFICATION FAILED:', err);
  process.exit(1);
});
