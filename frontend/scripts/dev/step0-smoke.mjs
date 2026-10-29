import { chromium } from '@playwright/test';

const email = 'p2-7c1bf40a-8623-4726-9c52-f5db8e088ebd@example.test';
const password = 'Disposable-phase2-password-123!';
const VITE_URL = 'http://localhost:5199';

// Enforce execution against localhost targets only
if (!['localhost', '127.0.0.1'].includes(new URL(VITE_URL).hostname)) {
  throw new Error(`Safety check failed: refusing to run against non-localhost target "${VITE_URL}"`);
}

console.log('=== STEP 0: SMOKE TEST THROUGH VITE PROXY ===');
console.log('Target: ' + VITE_URL);

// PART A: Direct fetch through Vite proxy
console.log('\n--- Part A: Fetch through Vite proxy ---');

// 0. Fetch CSRF token first
const initCsrfRes = await fetch(`${VITE_URL}/api/v1/identity/csrf`);
const initCsrfData = await initCsrfRes.json();
const initCsrfCookies = initCsrfRes.headers.getSetCookie();
const initCsrfCookieHeader = initCsrfCookies.map((c) => c.split(';')[0]).join('; ');

// 1. Login
console.log('1. Attempting login for:', email);
const loginRes = await fetch(`${VITE_URL}/api/v1/identity/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    cookie: initCsrfCookieHeader,
    'x-csrf-token': initCsrfData.token,
  },
  body: JSON.stringify({ email, password }),
});

console.log('Login status:', loginRes.status);
const loginSetCookies = loginRes.headers.getSetCookie();
const sessionCookie = loginSetCookies.find((c) => c.includes('__Host-devworkspace.session_token'));
console.log('Has __Host-devworkspace.session_token:', !!sessionCookie);

if (!loginRes.ok) {
  const errBody = await loginRes.text();
  console.error('Login failed:', errBody);
  process.exit(1);
}

const sessionCookieHeader = loginSetCookies.map((c) => c.split(';')[0]).join('; ');
const authedCookies = `${initCsrfCookieHeader}; ${sessionCookieHeader}`;

// 2. GET /api/v1/me
console.log('\n2. Testing GET /api/v1/me with session cookie');
const meRes = await fetch(`${VITE_URL}/api/v1/me`, {
  headers: { cookie: authedCookies },
});
console.log('/me status:', meRes.status);
const meData = await meRes.json();
console.log('/me response:', meData);

// 3. GET /api/v1/me/principals
console.log('\n3. Testing GET /api/v1/me/principals with session cookie');
const princRes = await fetch(`${VITE_URL}/api/v1/me/principals`, {
  headers: { cookie: authedCookies },
});
console.log('/me/principals status:', princRes.status);
const princData = await princRes.json();
console.log('/me/principals response:', princData);

// 4. Mutation with CSRF & If-Match
console.log('\n4. Testing Mutation with CSRF and If-Match (PATCH /api/v1/me)');
const postLoginCsrfRes = await fetch(`${VITE_URL}/api/v1/identity/csrf`, {
  headers: { cookie: authedCookies },
});
const postLoginCsrfData = await postLoginCsrfRes.json();
const postLoginCsrfCookies = postLoginCsrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const patchCookies = `${sessionCookieHeader}; ${postLoginCsrfCookies}`;

const newName = 'Smoke Test Name ' + Date.now().toString().slice(-4);
const patchRes = await fetch(`${VITE_URL}/api/v1/me`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    cookie: patchCookies,
    'x-csrf-token': postLoginCsrfData.token,
    'if-match': `"${meData.revision}"`,
  },
  body: JSON.stringify({ name: newName }),
});

console.log('PATCH /api/v1/me status:', patchRes.status);
const patchData = await patchRes.json();
console.log('PATCH /api/v1/me response:', patchData);

// PART B: Browser test in Chromium on http://localhost:5199
console.log('\n--- Part B: Browser test in Chromium on http://localhost:5199 ---');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${VITE_URL}/login`);
console.log('Loaded /login page title:', await page.title());

const browserEvalResult = await page.evaluate(
  async ({ email, password }) => {
    // 0. Initial CSRF
    const c0Res = await fetch('/api/v1/identity/csrf');
    const c0 = await c0Res.json();

    // 1. Login
    const res = await fetch('/api/v1/identity/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': c0.token,
      },
      body: JSON.stringify({ email, password }),
    });
    const loginStatus = res.status;

    // 2. GET /me
    const meRes = await fetch('/api/v1/me');
    const meStatus = meRes.status;
    const meJson = await meRes.json();

    // 3. GET /me/principals
    const princRes = await fetch('/api/v1/me/principals');
    const princStatus = princRes.status;
    const princJson = await princRes.json();

    // 4. CSRF & Mutation with If-Match
    const csrfRes = await fetch('/api/v1/identity/csrf');
    const csrfJson = await csrfRes.json();

    const patchRes = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfJson.token,
        'if-match': `"${meJson.revision}"`,
      },
      body: JSON.stringify({ name: 'Browser Verified Name' }),
    });
    const patchStatus = patchRes.status;
    const patchJson = await patchRes.json();

    return {
      loginStatus,
      meStatus,
      meJson,
      princStatus,
      princJson,
      patchStatus,
      patchJson,
    };
  },
  { email, password },
);

console.log('Browser Evaluation Result:');
console.log(JSON.stringify(browserEvalResult, null, 2));

const cookies = await context.cookies();
console.log(
  '\nChromium stored cookies:',
  cookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
  })),
);

const hasPersistedHostCookie = cookies.some((c) => c.name === '__Host-devworkspace.session_token');
console.log('\n>>> RESULT: __Host-devworkspace.session_token persisted in browser context:', hasPersistedHostCookie);

await browser.close();
