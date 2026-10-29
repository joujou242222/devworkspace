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

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function createAuthenticatedOwner() {
  const ts = Date.now();
  const email = `settings.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';
  const name = 'Studio Nour';

  const c0 = await req('/api/v1/identity/csrf');
  const cookie0 = parseCookies(c0.setCookie);
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: cookie0 },
    body: { email, password: pass, name: 'Nour Owner' }
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
    body: { name: 'Studio Nour', timezone: 'Africa/Cairo', description: 'Testing Settings' }
  });

  return { email, pass, name: 'Studio Nour', orgId: orgRes.json?.organizationId };
}

async function run() {
  console.log('=== STARTING SETTINGS LOGO UPLOAD VERIFICATION ===');
  const owner = await createAuthenticatedOwner();
  console.log('Created owner and org:', owner.email, owner.orgId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Sign in through UI with returnTo=/workspace/settings
  await page.goto('http://localhost:5199/login?returnTo=/workspace/settings');
  await page.fill('#e', owner.email);
  await page.fill('#p', owner.pass);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/settings**', { timeout: 15000 });
  console.log('Signed in through UI, on /workspace/settings');

  await page.waitForSelector('#lg', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Check initial state: shows initials 'SN'
  const initialLgText = await page.locator('#lg').textContent();
  console.log(`Initial initials: #lg="${initialLgText}"`);
  if (!initialLgText.includes('SN')) {
    throw new Error('Initial org initials do not match "SN"');
  }
  console.log('PASS: Initial org initials match organization name');

  // 1. TEST WRONG FILE TYPE
  console.log('\n[1] Testing wrong file type (.txt)...');
  await page.setInputFiles('#lu', {
    name: 'document.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Text not image')
  });
  await page.waitForTimeout(300);
  const wrongTypeVisible = await page.locator('#le').isVisible();
  const wrongTypeText = await page.locator('#le').textContent();
  console.log(`Wrong type error visible=${wrongTypeVisible}: "${wrongTypeText}"`);
  if (!wrongTypeVisible || !wrongTypeText.includes('Use a JPG or PNG under 2 MB')) {
    throw new Error('Wrong file type did not trigger expected error banner');
  }
  console.log('PASS: Wrong file type rejected');

  // 2. TEST OVER 2 MB
  console.log('\n[2] Testing over 2 MB file...');
  const largeBuf = Buffer.alloc(2.5 * 1024 * 1024);
  await page.setInputFiles('#lu', {
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: largeBuf
  });
  await page.waitForTimeout(300);
  const largeVisible = await page.locator('#le').isVisible();
  const largeText = await page.locator('#le').textContent();
  console.log(`Over 2MB error visible=${largeVisible}: "${largeText}"`);
  if (!largeVisible || !largeText.includes('Use a JPG or PNG under 2 MB')) {
    throw new Error('Over 2MB file did not trigger expected error banner');
  }
  console.log('PASS: Over 2MB file rejected');

  // 3. TEST REAL SUCCESSFUL LOGO UPLOAD
  console.log('\n[3] Testing real successful logo upload (PNG -> scanner -> READY -> attach)...');
  await page.setInputFiles('#lu', {
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  await page.waitForFunction(() => {
    const lg = document.getElementById('lg');
    return lg && lg.style.backgroundImage && lg.style.backgroundImage.includes('/logo/content');
  }, { timeout: 60000 });

  const lgBg = await page.locator('#lg').evaluate(el => el.style.backgroundImage);
  console.log(`Uploaded logo background: ${lgBg}`);
  if (!lgBg.includes('/logo/content')) {
    throw new Error('Logo background does not reference logo content');
  }
  console.log('PASS: Real logo upload succeeded, #lg background updated');

  // 4. TEST REMOVE LOGO
  console.log('\n[4] Testing remove logo (#lr)...');
  await page.click('#lr');
  await page.waitForFunction(() => {
    const lg = document.getElementById('lg');
    return lg && lg.textContent && lg.textContent.includes('SN') && !lg.style.backgroundImage;
  }, { timeout: 10000 });

  const afterRemoveLgText = await page.locator('#lg').textContent();
  const afterRemoveLgBg = await page.locator('#lg').evaluate(el => el.style.backgroundImage);
  console.log(`After remove: #lg="${afterRemoveLgText}" (bg="${afterRemoveLgBg}")`);
  if (!afterRemoveLgText.includes('SN') || afterRemoveLgBg) {
    throw new Error('Logo removal did not restore initials and clear background image');
  }
  console.log('PASS: Logo removal succeeded, initials restored');

  // 5. TEST STALE REVISION HANDLING (412 STALE_REVISION)
  console.log('\n[5] Testing stale revision (412 STALE_REVISION)...');
  await page.route('**/api/v1/organizations/*/logo', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'STALE_REVISION', message: 'Logo changed in another session.' })
      });
    } else {
      await route.continue();
    }
  });

  await page.setInputFiles('#lu', {
    name: 'stale-logo.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  await page.waitForFunction(() => {
    const le = document.getElementById('le');
    return le && !le.hidden && le.textContent.includes('another session');
  }, { timeout: 35000 });

  const staleVisible = await page.locator('#le').isVisible();
  const staleText = await page.locator('#le').textContent();
  console.log(`Stale revision error visible=${staleVisible}: "${staleText}"`);
  if (!staleVisible || !staleText.includes('another session')) {
    throw new Error('412 STALE_REVISION did not show expected refresh error banner');
  }
  await page.unroute('**/api/v1/organizations/*/logo');
  console.log('PASS: Stale revision handled correctly');

  // 6. TEST SCANNER FAILURE / SCANNER_UNAVAILABLE
  console.log('\n[6] Testing SCANNER_UNAVAILABLE message...');
  await page.route('**/api/v1/organizations/*/logo/uploads/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock-logo-upload-id',
          status: 'FAILED',
          error_code: 'SCANNER_UNAVAILABLE'
        })
      });
    } else {
      await route.continue();
    }
  });

  await page.setInputFiles('#lu', {
    name: 'scan-fail.png',
    mimeType: 'image/png',
    buffer: VALID_PNG
  });

  await page.waitForFunction(() => {
    const le = document.getElementById('le');
    return le && !le.hidden && le.textContent.includes('Try again later');
  }, { timeout: 10000 });

  const scannerFailText = await page.locator('#le').textContent();
  console.log(`Scanner unavailable message: "${scannerFailText}"`);
  if (!scannerFailText.includes("We couldn't process this file right now. Try again later.")) {
    throw new Error('SCANNER_UNAVAILABLE did not show exact server problem message');
  }
  await page.unroute('**/api/v1/organizations/*/logo/uploads/**');
  console.log('PASS: SCANNER_UNAVAILABLE shows exact server problem message');

  await browser.close();
  console.log('\n=== ALL SETTINGS LOGO UPLOAD CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error during settings logo upload verification:', err);
  process.exit(1);
});
