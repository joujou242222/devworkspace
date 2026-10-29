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
const BASE_URL = 'http://localhost:5199';

function req(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'https://localhost:8443');
    const headers = {
      Origin: 'https://localhost:8443',
      ...(options.headers || {})
    };
    const reqObj = https.request(url, {
      method: options.method || 'GET',
      headers,
      ca,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: bodyText,
          json: bodyJson,
          setCookie: res.headers['set-cookie']
        });
      });
    });
    reqObj.on('error', reject);
    if (options.body) {
      if (typeof options.body === 'object') {
        reqObj.setHeader('Content-Type', 'application/json');
        reqObj.write(JSON.stringify(options.body));
      } else {
        reqObj.write(options.body);
      }
    }
    reqObj.end();
  });
}

function parseCookies(cookies) {
  if (!cookies) return '';
  return cookies.map(c => c.split(';')[0]).join('; ');
}

async function verifyEmail(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.includes('Verify')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Verification email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const token = new URL(detail.Text.trim()).searchParams.get('token');
  const csrfRes = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfRes.json?.token, 'Cookie': parseCookies(csrfRes.setCookie) },
    body: { token }
  });
}

async function getInviteToken(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.toLowerCase().includes('invitation')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Invite email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const match = detail.Text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invite token not found in email body for: ' + email);
  return match[1];
}

async function loginUser(email, password) {
  const cRes = await req('/api/v1/identity/csrf');
  const token = cRes.json?.token;
  const cookie0 = parseCookies(cRes.setCookie);

  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token, 'Cookie': cookie0 },
    body: { email, password }
  });
  if (lRes.status !== 200) throw new Error('Login failed for ' + email + ': ' + lRes.status + ' ' + lRes.text);

  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { 'Cookie': cookie1 } });
  const finalToken = postCsrf.json?.token;
  const finalCookie = cookie1 + '; ' + parseCookies(postCsrf.setCookie);

  return { email, token: finalToken, cookie: finalCookie };
}

async function registerAndVerify(email, password, name) {
  const csrf = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf.json?.token, 'Cookie': parseCookies(csrf.setCookie) },
    body: { email, password, name }
  });
  await verifyEmail(email);
  return await loginUser(email, password);
}

async function run() {
  console.log('=== VERIFYING ACCESS LAYER & ROLE VISIBILITY ===');
  const browser = await launchBrowser();

  const defaultPass = 'Disposable-phase2-password-123!';
  const ts = Date.now();

  // 1. Setup Owner & Org
  const ownerEmail = `owner.access.${ts}@example.com`;
  const ownerReg = await registerAndVerify(ownerEmail, defaultPass, 'Access Owner');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerReg.token, 'Cookie': ownerReg.cookie, 'idempotency-key': `org-create-${ts}` },
    body: { name: `Access Org ${ts}`, description: 'Access Test', timezone: 'UTC' }
  });
  const orgId = orgRes.json?.organizationId;
  if (!orgId) throw new Error('Failed to create org: ' + JSON.stringify(orgRes));

  // Re-login owner to bind active principal
  const ownerLoggedIn = await loginUser(ownerEmail, defaultPass);
  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerLoggedIn.cookie } })).json?.items || [];
  const ownerPrincipalId = ownerPrincipals[0]?.id;
  const ownerFinal = { ...ownerLoggedIn, principalId: ownerPrincipalId };

  // 2. Setup Admin
  const adminEmail = `admin.access.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerFinal.token, 'Cookie': ownerFinal.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-admin-${ts}` },
    body: { email: adminEmail, role: 'ADMIN' }
  });
  const adminInviteToken = await getInviteToken(adminEmail);
  const adminReg = await registerAndVerify(adminEmail, defaultPass, 'Access Admin');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': adminReg.token, 'Cookie': adminReg.cookie, 'idempotency-key': `acc-admin-${ts}` },
    body: { token: adminInviteToken }
  });

  // 3. Setup Member
  const memberEmail = `member.access.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerFinal.token, 'Cookie': ownerFinal.cookie, 'x-organization-principal': ownerPrincipalId, 'idempotency-key': `inv-member-${ts}` },
    body: { email: memberEmail, role: 'MEMBER' }
  });
  const memberInviteToken = await getInviteToken(memberEmail);
  const memberReg = await registerAndVerify(memberEmail, defaultPass, 'Access Member');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': memberReg.token, 'Cookie': memberReg.cookie, 'idempotency-key': `acc-member-${ts}` },
    body: { token: memberInviteToken }
  });

  // TEST 1: Navigation links for Team and Audit are visible for ADMIN
  console.log('1. Testing Navigation links as ADMIN...');
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE_URL}/login`);
  await adminPage.fill('#e', adminEmail);
  await adminPage.fill('#p', defaultPass);
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL('**/workspace/dashboard**', { timeout: 10000 });
  await adminPage.waitForSelector('nav a[href="/workspace/dashboard"]', { timeout: 10000 });

  const adminNavTeam = await adminPage.$('nav a[href="/workspace/team"]');
  const adminNavAudit = await adminPage.$('nav a[href="/workspace/audit"]');
  const adminTeamVisible = adminNavTeam && (await adminNavTeam.isVisible());
  const adminAuditVisible = adminNavAudit && (await adminNavAudit.isVisible());

  if (adminTeamVisible && adminAuditVisible) {
    console.log('   [PASS] Nav links for Team and Audit are visible for ADMIN');
  } else {
    throw new Error(`Expected Team and Audit visible for Admin, got Team:${adminTeamVisible}, Audit:${adminAuditVisible}`);
  }
  await adminCtx.close();

  // TEST 2: Navigation links for Team and Audit are hidden for MEMBER
  console.log('2. Testing Navigation links as MEMBER...');
  const memberCtx = await browser.newContext();
  const memberPage = await memberCtx.newPage();
  await memberPage.goto(`${BASE_URL}/login`);
  await memberPage.fill('#e', memberEmail);
  await memberPage.fill('#p', defaultPass);
  await memberPage.click('button[type="submit"]');
  await memberPage.waitForURL('**/workspace/dashboard**', { timeout: 10000 });
  await memberPage.waitForSelector('nav a[href="/workspace/dashboard"]', { timeout: 10000 });

  const memberNavTeam = await memberPage.$('nav a[href="/workspace/team"]');
  const memberNavAudit = await memberPage.$('nav a[href="/workspace/audit"]');
  const memberTeamVisible = memberNavTeam && (await memberNavTeam.isVisible());
  const memberAuditVisible = memberNavAudit && (await memberNavAudit.isVisible());

  if (!memberTeamVisible && !memberAuditVisible) {
    console.log('   [PASS] Nav links for Team and Audit are hidden for MEMBER');
  } else {
    throw new Error(`Expected Team and Audit hidden for Member, got Team:${memberTeamVisible}, Audit:${memberAuditVisible}`);
  }

  // TEST 3: MEMBER opens /workspace/team directly -> restricted state, no raw error banner
  console.log('3. Testing MEMBER opens /workspace/team directly...');
  await memberPage.goto(`${BASE_URL}/workspace/team`);
  await memberPage.waitForSelector('.empty b', { timeout: 10000 });

  const restrictedHeader = await memberPage.textContent('.empty b');
  console.log('   Rendered empty header:', restrictedHeader?.trim());
  const hasRestrictedText = restrictedHeader?.includes('Access restricted');

  const rawBanner = await memberPage.$('#te');
  let rawBannerHidden = true;
  if (rawBanner) {
    const isHiddenAttr = await rawBanner.getAttribute('hidden');
    const isVisible = await rawBanner.isVisible();
    rawBannerHidden = isHiddenAttr !== null || !isVisible;
  }

  if (hasRestrictedText && rawBannerHidden) {
    console.log('   [PASS] MEMBER opens /workspace/team directly -> restricted state, no raw error banner');
  } else {
    throw new Error(`Failed restricted state verification: text=${restrictedHeader}, rawBannerHidden=${rawBannerHidden}`);
  }

  // TEST 4: 404 on primary load -> neutral "not available" state
  console.log('4. Testing 404 on primary load -> neutral "not available" state...');
  // Route intercept primary API call on /workspace/team to return 404
  await memberPage.route('**/api/v1/organizations/*/team*', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:devworkspace:problem:NOT_FOUND',
        title: 'The requested resource was not found.',
        status: 404,
        code: 'NOT_FOUND'
      })
    });
  });

  await memberPage.goto(`${BASE_URL}/workspace/team`);
  await memberPage.waitForSelector('.empty b', { timeout: 10000 });

  const notFoundHeader = await memberPage.textContent('.empty b');
  console.log('   Rendered empty header on 404:', notFoundHeader?.trim());
  const hasNotAvailableText = notFoundHeader?.includes('Not available');

  if (hasNotAvailableText) {
    console.log('   [PASS] a 404 on a primary load -> neutral "not available" state');
  } else {
    throw new Error(`Failed 404 not-available state verification: text=${notFoundHeader}`);
  }

  await memberCtx.close();
  await browser.close();
  console.log('=== ALL ACCESS LAYER CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error in access layer verification:', err);
  process.exit(1);
});
