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

async function setupTestEnvironment() {
  const ts = Date.now();
  const email = `doc.editor.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // Register & verify
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email, password: pass, name: 'Doc Editor Test' }
  });

  let msg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    msg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()));
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
    body: { email, password: pass }
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
    body: { name: 'Editor Studio', timezone: 'Africa/Cairo', description: 'Testing Document Editor' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login to get membership
  const lRes2 = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': postCsrf.json.token, Cookie: authHeaders.Cookie },
    body: { email, password: pass }
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
    body: { name: 'Editor Client', description: 'Client for editor tests', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Creative Project',
      description: 'Project for document editing',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  const projectId = projRes.json.id;

  // Add Member as MANAGER
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: { membership_id: principalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // Create Document
  const docKey = randomUUID();
  const docRes = await req(`/api/v1/organizations/${orgId}/documents`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': docKey },
    body: {
      project_id: projectId,
      title: 'Initial Script',
      content: {
        version: 1,
        blocks: [
          { type: 'heading', level: 2, spans: [{ text: 'Scene 1' }] },
          { type: 'paragraph', spans: [{ text: 'The sun rises over the horizon.' }] }
        ]
      }
    }
  });

  return { email, pass, orgId, projectId, docId: docRes.json.id, fullHeaders };
}

async function run() {
  console.log('=== VERIFYING /workspace/document (Document Editor) ===');
  const env = await setupTestEnvironment();
  console.log(`Test environment set up. Org: ${env.orgId}, Project: ${env.projectId}, Doc: ${env.docId}`);

  // 1. Direct API probe: test javascript: URL rejected with 400
  console.log('\n--- 1. Direct API Probe (javascript: link rejected) ---');
  const badLinkRes = await req(`/api/v1/organizations/${env.orgId}/projects/${env.projectId}/documents/${env.docId}`, {
    method: 'PATCH',
    headers: { ...env.fullHeaders, 'if-match': '"1"' },
    body: {
      title: 'XSS Attempt',
      content: {
        version: 1,
        blocks: [
          { type: 'paragraph', spans: [{ text: 'Malicious link', href: 'javascript:alert(1)' }] }
        ]
      }
    }
  });
  console.log(`Direct API probe status: ${badLinkRes.status}, code: ${badLinkRes.json?.code}`);
  if (badLinkRes.status !== 400 || badLinkRes.json?.code !== 'INVALID_INPUT') {
    throw new Error(`Expected 400 INVALID_INPUT for javascript: URL, got ${badLinkRes.status} ${badLinkRes.text}`);
  }
  console.log('✓ Direct API probe passed: javascript: rejected with 400 INVALID_INPUT');

  // Launch Playwright Edge
  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  try {
    // Sign in via UI
    console.log('\nSigning in via UI...');
    await page.goto('http://localhost:5199/login');
    await page.fill('#e', env.email);
    await page.fill('#p', env.pass);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workspace/dashboard**', { timeout: 15000 });
    console.log('Signed in successfully');

    // 2. Round-trip test
    console.log('\n--- 2. Round-Trip Edit & Autosave ---');
    await page.goto(`http://localhost:5199/workspace/document?id=${env.docId}&project=${env.projectId}`);
    await page.waitForSelector('#ti');
    await page.waitForFunction(() => document.getElementById('ti')?.value === 'Initial Script', { timeout: 10000 });

    const titleVal = await page.locator('#ti').inputValue();
    console.log(`Loaded title: "${titleVal}" (expected "Initial Script")`);
    if (titleVal !== 'Initial Script') throw new Error(`Expected title "Initial Script", got "${titleVal}"`);

    const breadcrumb = await page.locator('#bp').innerText();
    console.log(`Breadcrumb project name: "${breadcrumb}" (expected "Creative Project")`);
    if (breadcrumb !== 'Creative Project') throw new Error(`Expected breadcrumb "Creative Project", got "${breadcrumb}"`);

    // Edit title and add text
    await page.locator('#ti').fill('Updated Script v2');
    await page.locator('#ed').click();
    await page.keyboard.type('\nNew paragraph with bold details.');

    // Wait for autosave debounced save
    await page.waitForFunction(() => document.getElementById('ss')?.textContent === 'Saving…', { timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('ss')?.textContent === 'Saved', { timeout: 10000 });
    console.log('Autosave status transitioned to "Saved"');

    // Reload page and verify content persisted
    await page.reload();
    await page.waitForSelector('#ti');
    await page.waitForFunction(() => document.getElementById('ti')?.value === 'Updated Script v2', { timeout: 10000 });

    const reloadedTitle = await page.locator('#ti').inputValue();
    const edText = await page.locator('#ed').innerText();
    console.log(`Reloaded title: "${reloadedTitle}"`);
    console.log(`Reloaded text includes new content: ${edText.includes('New paragraph with bold details.')}`);
    if (reloadedTitle !== 'Updated Script v2' || !edText.includes('New paragraph with bold details.')) {
      throw new Error('Round-trip content did not persist properly across reload');
    }
    console.log('✓ Round-trip edit, autosave, and reload verified');

    // 3. Paste test
    console.log('\n--- 3. Plain Text Paste Sanitization ---');
    await page.evaluate(() => {
      const ed = document.getElementById('ed');
      ed.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', '<b style="color:red"><script>alert(1)</script><a href="javascript:foo">Click</a> Injected</b>');
      dt.setData('text/plain', 'Pasted plain text snippet');
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      ed.dispatchEvent(pasteEvent);
    });

    const edHtmlAfterPaste = await page.locator('#ed').innerHTML();
    console.log('HTML after paste does not contain script or style:', !edHtmlAfterPaste.includes('<script>') && !edHtmlAfterPaste.includes('color:red'));
    if (edHtmlAfterPaste.includes('<script>') || edHtmlAfterPaste.includes('color:red')) {
      throw new Error('Paste event did not sanitize HTML to plain text');
    }
    console.log('✓ Paste sanitization verified');

    // 4. Concurrency & 412 STALE_REVISION Conflict Handling
    console.log('\n--- 4. Concurrency & 412 STALE_REVISION ---');
    // Fetch document record to get current revision
    const currentDoc = await req(`/api/v1/organizations/${env.orgId}/projects/${env.projectId}/documents/${env.docId}`, {
      headers: env.fullHeaders
    });
    const rev = currentDoc.json.revision;

    // Simulate concurrent update on server from another session
    const concurrentSave = await req(`/api/v1/organizations/${env.orgId}/projects/${env.projectId}/documents/${env.docId}`, {
      method: 'PATCH',
      headers: { ...env.fullHeaders, 'if-match': `"${rev}"` },
      body: {
        title: 'Concurrent Server Title',
        content: {
          version: 1,
          blocks: [
            { type: 'paragraph', spans: [{ text: 'Goal: a 60-second launch film saved concurrently by teammate.' }] }
          ]
        }
      }
    });
    console.log(`Concurrent server save status: ${concurrentSave.status}, new revision: ${concurrentSave.json.revision}`);

    // Now trigger an edit on the page which will send outdated revision
    await page.locator('#ti').fill('Conflicting local edit');
    await page.waitForFunction(() => document.getElementById('ss')?.textContent === 'Conflict', { timeout: 10000 });

    const cfVisible = await page.locator('#cf').isVisible();
    const dr2Text = await page.locator('#dr2').innerText();
    const isEdEditable = await page.locator('#ed').getAttribute('contenteditable');
    const isTiReadonly = await page.locator('#ti').getAttribute('readonly');
    const isArHidden = await page.locator('#ar').isHidden();

    console.log(`Conflict banner #cf visible: ${cfVisible}`);
    console.log(`Local draft in #dr2: "${dr2Text.slice(0, 40)}..."`);
    console.log(`Editor contenteditable: ${isEdEditable} (expected "false")`);
    console.log(`Title readonly: ${isTiReadonly !== null} (expected true)`);
    console.log(`Archive button hidden: ${isArHidden} (expected true)`);

    if (!cfVisible || isEdEditable !== 'false' || isTiReadonly === null || !isArHidden) {
      throw new Error('412 STALE_REVISION handling did not disable editor or show #cf banner');
    }
    console.log('✓ 412 STALE_REVISION conflict display & locking verified');

    // 5. Read-only / Archived State Test
    console.log('\n--- 5. Read-Only / Archived State ---');
    // Archive the document on the server
    const currentDoc2 = await req(`/api/v1/organizations/${env.orgId}/projects/${env.projectId}/documents/${env.docId}`, {
      headers: env.fullHeaders
    });
    const archiveRes = await req(`/api/v1/organizations/${env.orgId}/projects/${env.projectId}/documents/${env.docId}/archive`, {
      method: 'POST',
      headers: { ...env.fullHeaders, 'if-match': `"${currentDoc2.json.revision}"` },
      body: {}
    });
    console.log(`Archive status: ${archiveRes.status}, status: ${archiveRes.json?.status}`);

    // Reload page on archived document
    await page.reload();
    await page.waitForSelector('#ro');
    const roVisible = await page.locator('#ro').isVisible();
    const edEditableArchived = await page.locator('#ed').getAttribute('contenteditable');
    const tbarHidden = await page.locator('.tbar').isHidden();
    console.log(`Read-only banner #ro visible: ${roVisible}`);
    console.log(`Editor disabled: ${edEditableArchived === 'false'}`);
    console.log(`Toolbar hidden: ${tbarHidden}`);

    if (!roVisible || edEditableArchived !== 'false' || !tbarHidden) {
      throw new Error('Archived document did not render in read-only mode');
    }
    console.log('✓ Read-only / archived state verified');

    console.log('\nALL 5 TESTS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
