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

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function setupProjectFixture() {
  const ts = Date.now();
  const ownerEmail = `files.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // 1. Register & verify owner
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email: ownerEmail, password: pass, name: 'Files Owner' }
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
    body: { name: 'Media Craft', timezone: 'Africa/Cairo', description: 'Testing Files' }
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
    body: { name: 'Delta Retail', description: 'Major Retailer', status: 'ACTIVE' }
  });
  const clientId = clientRes.json.id;

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { ...fullHeaders, 'idempotency-key': randomUUID() },
    body: {
      client_id: clientId,
      name: 'Autumn Lookbook',
      description: 'Fashion shoot and lookbook',
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

  return {
    ownerEmail,
    pass,
    orgId,
    projectId
  };
}

async function run() {
  console.log('=== STARTING PROJECT FILES BROWSER VERIFICATION ===');
  const fixture = await setupProjectFixture();
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
  console.log('Signed in, on dashboard. Now navigating to project-files...');

  await page.goto(`http://localhost:5199/project/project-files?id=${fixture.projectId}`);
  console.log('After goto, URL is:', page.url());
  await page.waitForTimeout(1000);
  console.log('Page content length:', (await page.content()).length);
  console.log('Page title:', await page.title());
  console.log('Page body text snippet:', (await page.locator('body').innerText()).slice(0, 300));

  // 2. Verify Header & Empty State
  console.log('\n[2] Verifying initial project header and empty state...');
  await page.waitForSelector('.top h1', { timeout: 10000 });
  const h1 = await page.locator('.top h1').textContent();
  console.log(`Page title: "${h1}"`);
  if (!h1.includes('Autumn Lookbook')) throw new Error('H1 does not contain project name');

  const emptyVisible = await page.locator('#em').isVisible();
  console.log(`Initial empty state visible: ${emptyVisible}`);
  if (!emptyVisible) throw new Error('Empty state #em should be visible initially');
  console.log('PASS: Initial project header and empty state verified');

  // 3. Create New Folder ("Designs")
  console.log('\n[3] Creating new folder "Designs"...');
  await page.click('#nf');
  await page.waitForSelector('#dg[open]', { timeout: 5000 });
  await page.fill('#fn', 'Designs');
  await page.click('#dgf button[type="submit"]');

  await page.waitForFunction(() => {
    const tags = document.querySelectorAll('#fo .tag');
    return Array.from(tags).some(t => t.textContent.includes('Designs'));
  }, { timeout: 5000 });
  console.log('PASS: Folder "Designs" created and rendered in #fo');

  // 4. Create Second Folder ("Specs")
  console.log('\n[4] Creating second folder "Specs"...');
  await page.click('#nf');
  await page.waitForSelector('#dg[open]', { timeout: 5000 });
  await page.fill('#fn', 'Specs');
  await page.click('#dgf button[type="submit"]');

  await page.waitForFunction(() => {
    const tags = document.querySelectorAll('#fo .tag');
    return Array.from(tags).some(t => t.textContent.includes('Specs'));
  }, { timeout: 5000 });
  console.log('PASS: Folder "Specs" created and rendered in #fo');

  // 5. Enter Folder "Designs"
  console.log('\n[5] Navigating inside folder "Designs"...');
  await page.click('#fo a:has-text("Designs")');
  await page.waitForFunction(() => {
    const pa = document.getElementById('pa');
    return pa && pa.textContent.includes('Designs');
  }, { timeout: 5000 });
  console.log('Path updated: inside Designs');

  // 6. Upload Real File into "Designs"
  console.log('\n[6] Uploading real PNG into "Designs"...');
  await page.setInputFiles('#fu', {
    name: 'cover_mockup.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  // Verify it appears in table with Ready state
  console.log('Waiting for scanner to mark file Ready...');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#tb tr');
    return Array.from(rows).some(r => r.textContent.includes('cover_mockup.png') && r.textContent.includes('Ready'));
  }, { timeout: 60000 });
  console.log('PASS: File uploaded and scanner reached Ready status');

  // 7. Test Rename File
  console.log('\n[7] Testing Rename file...');
  // Handle prompt dialog
  page.on('dialog', async dialog => {
    await dialog.accept('cover_v2.png');
  });
  // Since our page uses custom HTML dialog askText:
  await page.click('#tb button[data-rn]');
  await page.waitForSelector('dialog[open] input', { timeout: 5000 });
  await page.fill('dialog[open] input', 'cover_v2.png');
  await page.click('dialog[open] button[type="submit"]');

  await page.waitForFunction(() => {
    const row = document.querySelector('#tb tr');
    return row && row.textContent.includes('cover_v2.png');
  }, { timeout: 5000 });
  console.log('PASS: File renamed to cover_v2.png');

  // 8. Navigate back to Root
  console.log('\n[8] Navigating back to root...');
  await page.click('#up');
  await page.waitForFunction(() => {
    const fo = document.getElementById('fo');
    return fo && fo.textContent.includes('Designs') && fo.textContent.includes('Specs');
  }, { timeout: 5000 });
  console.log('PASS: Returned to root, folders visible');

  // 9. Go back into Designs and Move file to "Specs"
  console.log('\n[9] Moving file from "Designs" to "Specs"...');
  await page.click('#fo a:has-text("Designs")');
  await page.waitForSelector('#tb select[data-mv]', { timeout: 5000 });

  // Select "Specs" in Move dropdown
  await page.selectOption('#tb select[data-mv]', { label: 'Specs' });
  await page.waitForTimeout(500);

  // File moved out of Designs, Designs should now be empty
  const inDesigns = await page.locator('#tb tr').count();
  console.log(`Files remaining in Designs: ${inDesigns} (expected 0)`);
  if (inDesigns !== 0) throw new Error('File was not moved out of Designs');

  // Go to root then into Specs
  await page.click('#up');
  await page.click('#fo a:has-text("Specs")');
  await page.waitForSelector('#tb tr', { timeout: 5000 });
  const inSpecs = await page.locator('#tb tr').count();
  console.log(`Files inside Specs: ${inSpecs} (expected 1)`);
  if (inSpecs !== 1) throw new Error('File was not found in Specs');
  console.log('PASS: File move between folders verified');

  // 10. Attempt to Delete nonempty folder "Specs"
  console.log('\n[10] Attempting to delete nonempty folder "Specs"...');
  await page.click('#up');
  await page.waitForSelector('#fo', { timeout: 5000 });

  // Click delete button on Specs
  const specsTag = page.locator('#fo .tag:has-text("Specs")');
  await specsTag.locator('button[data-x2]').click();
  await page.waitForSelector('#ce:not([hidden])', { timeout: 5000 });
  const ceText = await page.locator('#ce').textContent();
  console.log(`Conflict error banner: "${ceText}"`);
  if (!ceText.includes('has files in it')) {
    throw new Error(`Expected conflict message about nonempty folder, got: "${ceText}"`);
  }
  console.log('PASS: Deleting nonempty folder prevented with clear error banner');

  // 11. Delete empty folder "Designs" (since its file was moved to Specs)
  console.log('\n[11] Deleting empty folder "Designs"...');
  const designsTag = page.locator('#fo .tag:has-text("Designs")');
  await designsTag.locator('button[data-x2]').click();

  await page.waitForFunction(() => {
    const fo = document.getElementById('fo');
    return fo && !fo.textContent.includes('Designs');
  }, { timeout: 5000 });
  console.log('PASS: Empty folder "Designs" deleted successfully');

  // 12. Move file from Specs back to Root, then delete Specs
  console.log('\n[12] Moving file from Specs to root and deleting Specs...');
  await page.click('#fo a:has-text("Specs")');
  await page.waitForSelector('#tb select[data-mv]', { timeout: 5000 });
  await page.selectOption('#tb select[data-mv]', { label: 'Files' });
  await page.waitForTimeout(500);

  // Return to root
  await page.click('#up');
  await page.waitForSelector('#fo', { timeout: 5000 });

  // Delete now empty Specs folder
  const specsTagAfter = page.locator('#fo .tag:has-text("Specs")');
  await specsTagAfter.locator('button[data-x2]').click();

  await page.waitForFunction(() => {
    const fo = document.getElementById('fo');
    return fo && !fo.textContent.includes('Specs');
  }, { timeout: 5000 });
  console.log('PASS: Empty folder "Specs" deleted successfully');

  // 13. Verify file is at root and test Archive file at root
  console.log('\n[13] Verifying file at root and archiving it...');
  await page.waitForSelector('#tb tr', { timeout: 5000 });
  const rootCount = await page.locator('#tb tr').count();
  console.log(`Root files count: ${rootCount} (expected 1)`);
  if (rootCount !== 1) throw new Error('File not found at root');

  await page.click('#tb button[data-ar]');
  await page.waitForSelector('dialog[open] button[type="submit"]', { timeout: 5000 });
  await page.click('dialog[open] button[type="submit"]');

  await page.waitForFunction(() => {
    const em = document.getElementById('em');
    return em && !em.hidden;
  }, { timeout: 5000 });
  console.log('PASS: File archived; root is empty');

  console.log('\n=== ALL PROJECT FILES BROWSER VERIFICATIONS PASSED ===');
  await browser.close();
}

run().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
