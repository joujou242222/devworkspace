/**
 * Group 1 End-to-End Browser Verification Test
 * Runs in headless Chromium via Playwright:
 * 1. Register -> Mailpit email confirmation link -> Email verified banner
 * 2. Login -> Empty principals -> Redirect to /onboarding
 * 3. Onboarding -> Create organization -> Redirect to /workspace/dashboard
 * 4. Logout -> Redirect to /login
 * 5. Route Guard: Accessing /workspace/projects unauthenticated -> redirects to /login?returnTo=...
 * 6. Forgot Password -> Mailpit reset email -> Reset password with new password -> Login with new password
 */

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

const BASE_URL = 'http://localhost:5199';
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

// Enforce execution against localhost targets only
for (const target of [BASE_URL, MAILPIT_API]) {
  const host = new URL(target).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Safety check failed: refusing to run against non-localhost target "${target}"`);
  }
}

async function main() {
  console.log('=== STARTING GROUP 1 BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const timestamp = Date.now();
  const testEmail = `browser.verify.${timestamp}@example.com`;
  const initialPassword = 'InitialPassword123!';
  const updatedPassword = 'UpdatedPassword456!';
  const userName = `Browser Test ${timestamp.toString().slice(-4)}`;

  try {
    // -------------------------------------------------------------------------
    // 1. REGISTER
    // -------------------------------------------------------------------------
    console.log('\n[1/6] Testing Registration at /register...');
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('#f');

    await page.fill('#n', userName);
    await page.fill('#e', testEmail);
    await page.fill('#p', initialPassword);
    await page.fill('#c', initialPassword);
    await page.click('button[type="submit"]');

    await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
    const doneText = await page.textContent('#done');
    console.log('   Registration submitted, done banner visible.');

    // -------------------------------------------------------------------------
    // 2. EMAIL VERIFICATION VIA MAILPIT
    // -------------------------------------------------------------------------
    console.log('\n[2/6] Checking Mailpit for verification email...');
    let verifyLink = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(500);
      const res = await fetch(`${MAILPIT_API}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msg = (data.messages || []).find((m) =>
          m.To && m.To.some((to) => to.Address.toLowerCase() === testEmail.toLowerCase())
        );
        if (msg) {
          const detailRes = await fetch(`${MAILPIT_API}/message/${msg.ID}`);
          const detail = await detailRes.json();
          const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
          if (match) {
            const url = new URL(match[0]);
            verifyLink = `${BASE_URL}/register${url.search}`;
            break;
          }
        }
      }
    }

    if (!verifyLink) throw new Error('Verification email not found in Mailpit');
    console.log('   Navigating to verification link in browser:', verifyLink);
    await page.goto(verifyLink);

    await page.waitForSelector('#verified-banner', { timeout: 10000 });
    console.log('   [PASS] Email verified banner successfully displayed in browser.');

    // -------------------------------------------------------------------------
    // 3. LOGIN & ONBOARDING REDIRECT
    // -------------------------------------------------------------------------
    console.log('\n[3/6] Testing Login for new user with 0 principals...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForSelector('#e');

    await page.fill('#e', testEmail);
    await page.fill('#p', initialPassword);
    await page.click('button[type="submit"]');

    // Should redirect to /onboarding because user has 0 principals
    await page.waitForURL('**/onboarding**', { timeout: 10000 });
    console.log('   [PASS] Redirected to /onboarding as expected (0 principals).');

    // -------------------------------------------------------------------------
    // 4. ONBOARDING & DASHBOARD
    // -------------------------------------------------------------------------
    console.log('\n[4/6] Completing Organization Onboarding...');
    await page.waitForSelector('#n');
    await page.fill('#n', `Browser Org ${timestamp.toString().slice(-4)}`);
    await page.fill('#d', 'Created during automated browser verification');
    await page.click('#b');

    // Onboarding redirects to /login?notice=org_created with prefilled email
    await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
    console.log('   [PASS] Redirected to /login with notice=org_created.');

    // Check notice message and prefilled email
    const noticeText = await page.textContent('.msg[role="status"]');
    console.log('   Notice banner text:', noticeText?.trim());
    if (!noticeText?.includes('Your organization is ready')) {
      throw new Error('Expected friendly notice banner on login after org creation');
    }

    const prefilledEmailVal = await page.inputValue('#e');
    console.log('   Prefilled email:', prefilledEmailVal);
    if (prefilledEmailVal !== testEmail) {
      throw new Error(`Expected prefilled email ${testEmail}, got ${prefilledEmailVal}`);
    }

    // Sign in with organization
    await page.fill('#p', initialPassword);
    await page.click('button[type="submit"]');

    // Should redirect to /workspace/dashboard
    await page.waitForURL('**/workspace/dashboard**', { timeout: 10000 });
    console.log('   [PASS] Landed on /workspace/dashboard after post-onboarding sign in!');

    // Verify globals exposed before scripts
    const globalsCheck = await page.evaluate(() => ({
      hasApi: typeof window.__API__ !== 'undefined',
      hasAuth: typeof window.__AUTH__ !== 'undefined',
      hasEsc: typeof window.esc === 'function',
      activePrincipalId: window.__AUTH__.getActivePrincipalId()
    }));
    console.log('   Globals check in page context:', globalsCheck);
    if (!globalsCheck.hasApi || !globalsCheck.hasAuth || !globalsCheck.hasEsc || !globalsCheck.activePrincipalId) {
      throw new Error('Globals (__API__, __AUTH__, esc) or activePrincipalId missing on dashboard');
    }

    // -------------------------------------------------------------------------
    // 5. LOGOUT & ROUTE GUARD
    // -------------------------------------------------------------------------
    console.log('\n[5/6] Testing Logout & Route Guard...');
    await page.evaluate(() => window.__AUTH__.logout());
    await page.waitForURL('**/login**', { timeout: 10000 });
    console.log('   [PASS] Logout succeeded, redirected to /login.');

    // Test Route Guard: attempt to visit /workspace/projects unauthenticated
    console.log('   Testing Route Guard: accessing protected /workspace/projects unauthenticated...');
    await page.goto(`${BASE_URL}/workspace/projects`);
    await page.waitForURL((url) => url.pathname.includes('/login') && url.search.includes('returnTo'), { timeout: 10000 });
    console.log('   [PASS] Route Guard intercepted request and redirected to:', page.url());

    // -------------------------------------------------------------------------
    // 6. FORGOT PASSWORD & RESET PASSWORD
    // -------------------------------------------------------------------------
    console.log('\n[6/6] Testing Forgot Password & Reset flow...');
    await page.goto(`${BASE_URL}/forgot-password`);
    await page.waitForSelector('#e');
    await page.fill('#e', testEmail);
    await page.click('#b');

    await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
    console.log('   Forgot password submitted, done message visible.');

    // Check Mailpit for password reset email
    console.log('   Checking Mailpit for reset password email...');
    let resetLink = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(500);
      const res = await fetch(`${MAILPIT_API}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msg = (data.messages || []).find((m) =>
          m.Subject.includes('Reset') && m.To.some((to) => to.Address.toLowerCase() === testEmail.toLowerCase())
        );
        if (msg) {
          const detailRes = await fetch(`${MAILPIT_API}/message/${msg.ID}`);
          const detail = await detailRes.json();
          const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
          if (match) {
            const url = new URL(match[0]);
            resetLink = `${BASE_URL}/reset-password${url.search}`;
            break;
          }
        }
      }
    }

    if (!resetLink) throw new Error('Reset email not found in Mailpit');
    console.log('   Navigating to reset password link:', resetLink);
    await page.goto(resetLink);

    await page.waitForSelector('#p');
    await page.fill('#p', updatedPassword);
    await page.fill('#c', updatedPassword);
    await page.click('#b');

    await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
    console.log('   [PASS] Password successfully reset.');

    // Verify login with updated password
    console.log('   Verifying login with new password...');
    await page.goto(`${BASE_URL}/login`);
    await page.fill('#e', testEmail);
    await page.fill('#p', updatedPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/workspace/dashboard**', { timeout: 10000 });
    console.log('   [PASS] Logged in successfully with updated password, reached dashboard!');

    // -------------------------------------------------------------------------
    // 7. INVITATION FLOW (CREATE -> REGISTER INVITEE -> INSPECT & ACCEPT)
    // -------------------------------------------------------------------------
    console.log('\n[7/7] Testing Invitation Flow...');
    const inviteeEmail = `invitee.${timestamp.toString().slice(-4)}@example.com`;
    const inviteePassword = 'InviteePassword123!';
    const orgId = await page.evaluate(() => window.__AUTH__.getActiveOrgId());
    const principalId = await page.evaluate(() => window.__AUTH__.getActivePrincipalId());

    // Send invitation from active owner
    console.log(`   Sending invitation to ${inviteeEmail}...`);
    const inviteRes = await page.evaluate(async ({ orgId, inviteeEmail, principalId }) => {
      return window.__API__.post(`/organizations/${orgId}/invitations`, {
        email: inviteeEmail,
        role: 'MEMBER'
      }, {
        headers: { 'X-Organization-Principal': principalId }
      });
    }, { orgId, inviteeEmail, principalId });
    console.log('   Invitation sent:', inviteRes);

    // Fetch invitation from Mailpit
    console.log('   Checking Mailpit for invitation email...');
    let inviteToken = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(500);
      const res = await fetch(`${MAILPIT_API}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msg = (data.messages || []).find((m) =>
          m.Subject.includes('invitation') && m.To.some((to) => to.Address.toLowerCase() === inviteeEmail.toLowerCase())
        );
        if (msg) {
          const detailRes = await fetch(`${MAILPIT_API}/message/${msg.ID}`);
          const detail = await detailRes.json();
          const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
          if (match) {
            const url = new URL(match[0]);
            inviteToken = url.searchParams.get('token');
            break;
          }
        }
      }
    }

    if (!inviteToken) throw new Error('Invitation email not found in Mailpit');
    console.log('   Found invitation token:', inviteToken.slice(0, 16) + '...');

    // Log out the owner so the invitee can authenticate
    console.log('   Logging out owner...');
    await page.evaluate(() => window.__AUTH__.logout());
    await page.waitForURL('**/login**', { timeout: 10000 });

    // Register and verify the invitee account
    console.log('   Registering invitee account in browser...');
    await page.goto(`${BASE_URL}/register`);
    await page.fill('#n', 'Invitee Member');
    await page.fill('#e', inviteeEmail);
    await page.fill('#p', inviteePassword);
    await page.fill('#c', inviteePassword);
    await page.click('button[type="submit"]');
    await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });

    // Fetch verification token for invitee
    let inviteeVerifyLink = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(500);
      const res = await fetch(`${MAILPIT_API}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msg = (data.messages || []).find((m) =>
          m.Subject.includes('Verify') && m.To.some((to) => to.Address.toLowerCase() === inviteeEmail.toLowerCase())
        );
        if (msg) {
          const detailRes = await fetch(`${MAILPIT_API}/message/${msg.ID}`);
          const detail = await detailRes.json();
          const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
          if (match) {
            const url = new URL(match[0]);
            inviteeVerifyLink = `${BASE_URL}/register${url.search}`;
            break;
          }
        }
      }
    }
    await page.goto(inviteeVerifyLink);
    await page.waitForSelector('#verified-banner', { timeout: 10000 });

    // Sign in as invitee
    console.log('   Signing in as invitee...');
    await page.goto(`${BASE_URL}/login`);
    await page.fill('#e', inviteeEmail);
    await page.fill('#p', inviteePassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/onboarding**', { timeout: 10000 });

    // Now open /invitation?token=... as authenticated matching invitee!
    console.log('   Navigating to /invitation as authenticated invitee...');
    await page.goto(`${BASE_URL}/invitation?token=${inviteToken}`);
    await page.waitForSelector('.inv', { timeout: 10000 });
    console.log('   Invitation details rendered on /invitation.');

    // Click Accept invitation
    await page.waitForSelector('#acc:not([disabled])', { timeout: 10000 });
    await page.click('#acc');

    await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
    console.log('   [PASS] Invitation accepted in browser, confirmation visible!');

    console.log('\n=== ALL GROUP 1 BROWSER VERIFICATIONS PASSED! ===');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nBrowser verification failed:', err);
  process.exit(1);
});
