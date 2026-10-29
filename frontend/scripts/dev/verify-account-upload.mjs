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
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json, setCookie: res.headers['set-cookie'] });
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

// 1x1 valid PNG buffer
const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function createAuthenticatedUser() {
  const ts = Date.now();
  const email = `account.tester.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';
  const name = 'Photo User';

  const c0 = await req('/api/v1/identity/csrf');
  const cookie0 = parseCookies(c0.setCookie);
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: cookie0 },
    body: { email, password: pass, name }
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

  // Login via API to create an org so user has active principal
  const c2 = await req('/api/v1/identity/csrf');
  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': c2.json.token, Cookie: parseCookies(c2.setCookie) },
    body: { email, password: pass }
  });
  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie1 } });
  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: {
      'x-csrf-token': postCsrf.json.token,
      'Cookie': cookie1 + '; ' + parseCookies(postCsrf.setCookie),
      'idempotency-key': `org-${ts}`
    },
    body: { name: 'Photo Test Studio', timezone: 'Africa/Cairo', description: 'Testing Photo' }
  });
  console.log('Org creation status:', orgRes.status);

  return { email, pass, name };
}

async function run() {
  console.log('=== STARTING ACCOUNT PHOTO UPLOAD VERIFICATION ===');
  const user = await createAuthenticatedUser();
  console.log('Created user and org:', user.email);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // Sign in through UI with returnTo=/workspace/account
  await page.goto('http://localhost:5199/login?returnTo=/workspace/account');
  await page.fill('#e', user.email);
  await page.fill('#p', user.pass);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/account**', { timeout: 15000 });
  console.log('Signed in through UI, on /workspace/account');
  await page.waitForTimeout(1000);
  console.log('Current URL:', page.url());
  const bodyText = await page.locator('body').innerHTML();
  console.log('Body length:', bodyText.length);

  await page.goto('http://localhost:5199/workspace/account');
  await page.waitForSelector('#av', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Check initial state: shows initials 'PU'
  const initialAvText = await page.locator('#av').textContent();
  const initialHeaderAvText = await page.locator('.util .av').textContent();
  console.log(`Initial initials: #av="${initialAvText}", header="${initialHeaderAvText}"`);
  if (!initialAvText.includes('PU') || !initialHeaderAvText.includes('PU')) {
    throw new Error('Initial avatar initials do not match "PU"');
  }
  console.log('PASS: Initial initials match display name');

  // 1. TEST WRONG FILE TYPE
  console.log('\n[1] Testing wrong file type (.txt)...');
  await page.setInputFiles('#up', {
    name: 'document.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Hello world text file')
  });
  await page.waitForTimeout(300);
  const wrongTypeVisible = await page.locator('#ie').isVisible();
  const wrongTypeText = await page.locator('#ie').textContent();
  console.log(`Wrong type error visible=${wrongTypeVisible}: "${wrongTypeText}"`);
  if (!wrongTypeVisible || !wrongTypeText.includes('Use a JPG or PNG under 2 MB')) {
    throw new Error('Wrong file type did not trigger expected error banner');
  }
  console.log('PASS: Wrong file type rejected');

  // 2. TEST OVER 2 MB
  console.log('\n[2] Testing over 2 MB file...');
  const largeBuf = Buffer.alloc(2.5 * 1024 * 1024);
  await page.setInputFiles('#up', {
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: largeBuf
  });
  await page.waitForTimeout(300);
  const largeVisible = await page.locator('#ie').isVisible();
  const largeText = await page.locator('#ie').textContent();
  console.log(`Over 2MB error visible=${largeVisible}: "${largeText}"`);
  if (!largeVisible || !largeText.includes('Use a JPG or PNG under 2 MB')) {
    throw new Error('Over 2MB file did not trigger expected error banner');
  }
  console.log('PASS: Over 2MB file rejected');

  // 3. TEST REAL SUCCESSFUL UPLOAD
  console.log('\n[3] Testing real successful photo upload (PNG -> scanner -> READY -> attach)...');
  await page.setInputFiles('#up', {
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  // Wait for processing to complete and image to be rendered (up to 35 seconds)
  await page.waitForFunction(() => {
    const av = document.getElementById('av');
    return av && av.style.backgroundImage && av.style.backgroundImage.includes('/api/v1/me/image/content');
  }, { timeout: 45000 });

  const avBg = await page.locator('#av').evaluate(el => el.style.backgroundImage);
  const headerBg = await page.locator('.util .av').evaluate(el => el.style.backgroundImage);
  console.log(`Uploaded avatar background: ${avBg}`);
  console.log(`Header avatar background: ${headerBg}`);
  if (!avBg.includes('/api/v1/me/image/content') || !headerBg.includes('/api/v1/me/image/content')) {
    throw new Error('Avatar or header avatar background does not reference image content');
  }
  console.log('PASS: Real photo upload succeeded, avatar and header avatar updated');

  // 4. TEST REMOVE PHOTO
  console.log('\n[4] Testing remove photo (#rm)...');
  await page.click('#rm');
  await page.waitForFunction(() => {
    const av = document.getElementById('av');
    return av && av.textContent && av.textContent.includes('PU') && !av.style.backgroundImage;
  }, { timeout: 10000 });

  const afterRemoveAvText = await page.locator('#av').textContent();
  const afterRemoveHeaderAvText = await page.locator('.util .av').textContent();
  const afterRemoveAvBg = await page.locator('#av').evaluate(el => el.style.backgroundImage);
  console.log(`After remove: #av="${afterRemoveAvText}" (bg="${afterRemoveAvBg}"), header="${afterRemoveHeaderAvText}"`);
  if (!afterRemoveAvText.includes('PU') || afterRemoveAvBg) {
    throw new Error('Photo removal did not restore initials and clear background image');
  }
  console.log('PASS: Photo removal succeeded, initials restored');

  // 5. TEST STALE REVISION HANDLING (412 STALE_REVISION)
  console.log('\n[5] Testing stale revision (412 STALE_REVISION)...');
  await page.route('**/api/v1/me/image', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'STALE_REVISION', message: 'Image changed in another session.' })
      });
    } else {
      await route.continue();
    }
  });

  // Upload an image which will hit 412 STALE_REVISION on the PATCH /me/image step
  await page.setInputFiles('#up', {
    name: 'stale-test.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  await page.waitForFunction(() => {
    const ie = document.getElementById('ie');
    return ie && !ie.hidden && ie.textContent.includes('another session');
  }, { timeout: 35000 });

  const staleVisible = await page.locator('#ie').isVisible();
  const staleText = await page.locator('#ie').textContent();
  console.log(`Stale revision error visible=${staleVisible}: "${staleText}"`);
  if (!staleVisible || !staleText.includes('another session')) {
    throw new Error('412 STALE_REVISION did not show expected refresh error banner');
  }
  await page.unroute('**/api/v1/me/image');
  console.log('PASS: Stale revision handled correctly');

  // 6. TEST SCANNER FAILURE / SCANNER_UNAVAILABLE
  console.log('\n[6] Testing SCANNER_UNAVAILABLE message...');
  await page.route('**/api/v1/me/image/uploads/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock-upload-id',
          status: 'FAILED',
          error_code: 'SCANNER_UNAVAILABLE'
        })
      });
    } else {
      await route.continue();
    }
  });

  await page.setInputFiles('#up', {
    name: 'scan-fail.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  await page.waitForFunction(() => {
    const ie = document.getElementById('ie');
    return ie && !ie.hidden && ie.textContent.includes('Try again later');
  }, { timeout: 10000 });

  const scannerFailText = await page.locator('#ie').textContent();
  console.log(`Scanner unavailable message: "${scannerFailText}"`);
  if (!scannerFailText.includes("We couldn't process this file right now. Try again later.")) {
    throw new Error('SCANNER_UNAVAILABLE did not show exact server problem message');
  }
  await page.unroute('**/api/v1/me/image/uploads/**');
  console.log('PASS: SCANNER_UNAVAILABLE shows exact server problem message');

  await browser.close();
  console.log('\n=== ALL ACCOUNT PHOTO UPLOAD CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error during account upload verification:', err);
  process.exit(1);
});
