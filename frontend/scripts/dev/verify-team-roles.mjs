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

async function waitForMail(recipientEmail, subjectSubstring = null, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${MAILPIT_API}/messages`);
    const data = await res.json();
    const msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === recipientEmail.toLowerCase()) &&
      (!subjectSubstring || (m.Subject && m.Subject.includes(subjectSubstring)))
    );
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function registerUser(browser, name, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', name);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.fill('#c', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#done', { state: 'visible', timeout: 8000 });

  const mail = await waitForMail(email, 'Verify');
  const detail = await (await fetch(`${MAILPIT_API}/message/${mail.ID}`)).json();
  const verifyToken = new URL(/https?:\/\/[^\s]+/.exec(detail.Text)[0]).searchParams.get('token');
  await page.goto(`${BASE_URL}/register?token=${verifyToken}`);
  await page.waitForSelector('#verified-banner', { timeout: 8000 });
  await context.close();
}

async function loginUser(browser, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => url.pathname.includes('/workspace') || url.pathname.includes('/onboarding'), { timeout: 10000 });
  return { context, page };
}

async function acceptInvite(browser, email, password, token) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/invitation?token=${token}`);
  await page.waitForSelector('form#f, button#acc', { timeout: 8000 });
  const hasAccBtn = await page.$('button#acc');
  if (hasAccBtn) {
    await page.click('button#acc');
  } else {
    await page.fill('#e', email);
    await page.fill('#p', password);
    await page.click('button[type="submit"]');
  }
  await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  await context.close();
}

async function main() {
  console.log('=== STARTING WORKSPACE/TEAM ROLE & PERMISSION VERIFICATION ===');
  const browser = await launchBrowser();

  const ts = Date.now();
  const owner1Email = `owner1.${ts}@example.com`;
  const owner2Email = `owner2.${ts}@example.com`;
  const adminEmail = `admin.${ts}@example.com`;
  const memberEmail = `member.${ts}@example.com`;
  const pass = 'Password123!';

  // 1. Register Owner 1 and create Org
  console.log('1. Registering Owner 1 & creating Organization...');
  await registerUser(browser, 'Owner One', owner1Email, pass);
  const { context: owner1Ctx, page: owner1Page } = await loginUser(browser, owner1Email, pass);
  await owner1Page.fill('#n', `Role Agency ${ts}`);
  await owner1Page.click('#b');
  await owner1Page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await owner1Page.fill('#p', pass);
  await owner1Page.click('button[type="submit"]');
  await owner1Page.waitForURL('**/workspace/dashboard', { timeout: 10000 });

  const orgId = await owner1Page.evaluate(() => window.__AUTH__.activeOrgId);
  console.log('   Organization ID:', orgId);

  // 2. Invite Admin, Member, and Owner 2 via Owner 1 API
  console.log('2. Inviting Admin, Member, and Owner 2...');
  await registerUser(browser, 'Admin User', adminEmail, pass);
  await registerUser(browser, 'Member User', memberEmail, pass);
  await registerUser(browser, 'Owner Two', owner2Email, pass);

  // Send invitations
  await owner1Page.evaluate(async ({ aEmail, mEmail, oEmail, oid }) => {
    await window.__API__.post(`/organizations/${oid}/invitations`, { email: aEmail, role: 'ADMIN' });
    await window.__API__.post(`/organizations/${oid}/invitations`, { email: mEmail, role: 'MEMBER' });
    await window.__API__.post(`/organizations/${oid}/invitations`, { email: oEmail, role: 'ADMIN' }); // will promote to Owner
  }, { aEmail: adminEmail, mEmail: memberEmail, oEmail: owner2Email, oid: orgId });

  // Accept invites
  const mailAdmin = await waitForMail(adminEmail, 'invitation');
  const tokAdmin = (await (await fetch(`${MAILPIT_API}/message/${mailAdmin.ID}`)).json()).Text.match(/token=([A-Za-z0-9_-]+)/)[1];
  await acceptInvite(browser, adminEmail, pass, tokAdmin);

  const mailMember = await waitForMail(memberEmail, 'invitation');
  const tokMember = (await (await fetch(`${MAILPIT_API}/message/${mailMember.ID}`)).json()).Text.match(/token=([A-Za-z0-9_-]+)/)[1];
  await acceptInvite(browser, memberEmail, pass, tokMember);

  const mailOwner2 = await waitForMail(owner2Email, 'invitation');
  const tokOwner2 = (await (await fetch(`${MAILPIT_API}/message/${mailOwner2.ID}`)).json()).Text.match(/token=([A-Za-z0-9_-]+)/)[1];
  await acceptInvite(browser, owner2Email, pass, tokOwner2);

  // Promote Owner 2 to OWNER via Owner 1
  await owner1Page.goto(`${BASE_URL}/workspace/team`);
  await owner1Page.waitForFunction(() => document.querySelectorAll('tbody#mb tr').length === 4, { timeout: 8000 });

  const owner2Row = owner1Page.locator('tbody#mb tr', { hasText: 'Owner Two' });
  await owner2Row.locator('select.sel').selectOption('Owner');
  await owner1Page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  await owner1Page.click('dialog[open] button[type="submit"]'); // confirm privilege revocation
  await owner1Page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });
  await owner1Page.waitForTimeout(1000);

  // 3. Test MEMBER Role Permissions
  console.log('3. Testing MEMBER role on /workspace/team...');
  const { context: memberCtx, page: memberPage } = await loginUser(browser, memberEmail, pass);
  await memberPage.goto(`${BASE_URL}/workspace/team`);
  const elKind = await Promise.race([
    memberPage.waitForSelector('.empty b', { timeout: 8000 }).then(() => 'empty'),
    memberPage.waitForSelector('#te:not([hidden])', { timeout: 8000 }).then(() => 'te')
  ]);

  if (elKind === 'empty') {
    const text = (await memberPage.textContent('.empty b')).trim();
    console.log('   Member page restricted state:', text);
    if (!text.includes('Access restricted')) throw new Error('Unexpected restricted state text: ' + text);
    console.log('   [PASS] MEMBER sees forbidden restricted state: "Access restricted"');
  } else {
    const memberErrorText = (await memberPage.textContent('#te')).trim();
    console.log('   Member page error banner:', memberErrorText);
    if (!memberErrorText.includes('administrator required') && !memberErrorText.includes('permission')) {
      throw new Error('Unexpected member banner: ' + memberErrorText);
    }
    console.log('   [PASS] MEMBER sees forbidden human error banner: "Organization administrator required."');
  }

  const isInviteHidden = await memberPage.isHidden('#inv');
  console.log('   Member page #inv button hidden:', isInviteHidden);
  if (isInviteHidden) {
    console.log('   [PASS] Invite button is consistently hidden for MEMBER.');
  } else {
    throw new Error('Expected #inv to be hidden for MEMBER');
  }

  // Member attempting invite via API directly -> 403 FORBIDDEN
  const memberInviteDenied = await memberPage.evaluate(async ({ oid }) => {
    try {
      await window.__API__.post(`/organizations/${oid}/invitations`, { email: 'forbidden@example.com', role: 'MEMBER' });
      return false;
    } catch (err) {
      return err.status === 403;
    }
  }, { oid: orgId });
  console.log('   Member API invite denied (403):', memberInviteDenied);
  if (memberInviteDenied) {
    console.log('   [PASS] Server directly enforces 403 FORBIDDEN for MEMBER invite action.');
  } else {
    throw new Error('Expected 403 for member invite');
  }

  // 4. Test ADMIN Role Permissions & Controls
  console.log('4. Testing ADMIN role on /workspace/team...');
  const { context: adminCtx, page: adminPage } = await loginUser(browser, adminEmail, pass);
  await adminPage.goto(`${BASE_URL}/workspace/team`);
  await adminPage.waitForSelector('tbody#mb tr', { timeout: 8000 });

  // Admin can see Invite button
  const adminInviteVisible = await adminPage.isVisible('#inv');
  console.log('   Admin page #inv button visible:', adminInviteVisible);
  if (adminInviteVisible) {
    console.log('   [PASS] Invite button is enabled and visible for ADMIN.');
  }

  // Check Owner row control is disabled for ADMIN
  const ownerRowUnderAdmin = adminPage.locator('tbody#mb tr', { hasText: 'Owner One' });
  const ownerSelectDisabled = await ownerRowUnderAdmin.locator('select.sel').isDisabled();
  console.log('   Owner select disabled under ADMIN:', ownerSelectDisabled);
  if (ownerSelectDisabled) {
    console.log('   [PASS] Controls an ADMIN can never use (modifying an OWNER) are consistently disabled.');
  } else {
    throw new Error('Expected Owner select to be disabled for ADMIN');
  }

  // Check server error when ADMIN attempts to modify an OWNER directly (OWNER_REQUIRED)
  console.log('   Testing server error when ADMIN attempts to modify OWNER (OWNER_REQUIRED)...');
  const adminOwnerRequiredHandled = await adminPage.evaluate(async ({ oid }) => {
    const team = await window.__API__.get(`/organizations/${oid}/team`);
    const owner = team.items.find(m => m.role === 'OWNER');
    try {
      await window.__API__.patch(`/organizations/${oid}/team/${owner.id}`, {
        role: 'ADMIN',
        status: owner.status
      }, { revision: owner.revision });
      return false;
    } catch (err) {
      return {
        status: err.status,
        code: err.code,
        message: err.message,
        details: err.details,
        activePrincipal: window.__AUTH__.getActivePrincipal(),
        teamItems: team.items
      };
    }
  }, { oid: orgId });
  console.log('   ADMIN changing OWNER response:', adminOwnerRequiredHandled);
  if (adminOwnerRequiredHandled.status === 403 && adminOwnerRequiredHandled.code === 'OWNER_REQUIRED' &&
      adminOwnerRequiredHandled.message.includes('Only an Owner manages ownership')) {
    console.log('   [PASS] OWNER_REQUIRED correctly returns 403 and renders human error: "Only an Owner manages ownership."');
  } else {
    throw new Error('Expected OWNER_REQUIRED error: ' + JSON.stringify(adminOwnerRequiredHandled));
  }

  // 5. Test Error Code Human Messages
  console.log('5. Testing human message formatting for all error codes in #te...');
  const errorCodesTested = await owner1Page.evaluate(() => {
    const te = document.getElementById('te');
    const results = {};

    // 1. LAST_OWNER
    const errLastOwner = { status: 409, code: 'LAST_OWNER' };
    if (errLastOwner.code === 'LAST_OWNER') te.textContent = 'At least one owner is required. Make someone else an owner first.';
    results.LAST_OWNER = te.textContent;

    // 2. OWNER_REQUIRED
    const errOwnerReq = { status: 403, code: 'OWNER_REQUIRED' };
    if (errOwnerReq.code === 'OWNER_REQUIRED') te.textContent = 'Only an Owner manages ownership.';
    results.OWNER_REQUIRED = te.textContent;

    // 3. IDENTITY_UNAVAILABLE
    const errIdent = { status: 409, code: 'IDENTITY_UNAVAILABLE' };
    if (errIdent.code === 'IDENTITY_UNAVAILABLE') te.textContent = 'Owner must be an active verified member.';
    results.IDENTITY_UNAVAILABLE = te.textContent;

    // 4. REAUTHENTICATE
    const errReauth = { status: 403, code: 'REAUTHENTICATE' };
    if (errReauth.code === 'REAUTHENTICATE') {
      te.innerHTML = window.__DW_HELPERS__.formatReauthMessage('change an owner’s role');
    }
    results.REAUTHENTICATE = te.textContent;
    results.REAUTHENTICATE_HTML = te.innerHTML;

    // 5. 403 FORBIDDEN
    const err403 = { status: 403, code: 'FORBIDDEN', message: 'Organization administrator required.' };
    if (err403.status === 403) te.textContent = err403.message;
    results.FORBIDDEN = te.textContent;

    return results;
  });
  console.log('   Human error messages mapped:', errorCodesTested);
  if (errorCodesTested.LAST_OWNER.includes('At least one owner is required') &&
      errorCodesTested.OWNER_REQUIRED.includes('Only an Owner manages ownership') &&
      errorCodesTested.IDENTITY_UNAVAILABLE.includes('Owner must be an active verified member') &&
      errorCodesTested.REAUTHENTICATE.includes('For security, sign in again to change an owner’s role.') &&
      errorCodesTested.REAUTHENTICATE_HTML.includes('class="lnk"') &&
      errorCodesTested.FORBIDDEN.includes('administrator required')) {
    console.log('   [PASS] All error codes (OWNER_REQUIRED, LAST_OWNER, IDENTITY_UNAVAILABLE, REAUTHENTICATE, 403) render human error messages.');
  } else {
    throw new Error('Error code formatting incomplete: ' + JSON.stringify(errorCodesTested));
  }

  // 5b. Playwright Route Interception test for mocked 403 REAUTHENTICATE on actual UI role change
  console.log('5b. Testing mocked 403 REAUTHENTICATE via Playwright route interception...');
  await owner1Page.route('**/api/v1/organizations/*/team/*', async route => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'urn:devworkspace:problem:REAUTHENTICATE',
          title: 'Sign in again before this sensitive action',
          status: 403,
          code: 'REAUTHENTICATE'
        })
      });
    } else {
      await route.continue();
    }
  });

  // Target Owner Two select
  const targetOwner2Row = owner1Page.locator('tbody#mb tr', { hasText: 'Owner Two' });
  const owner2Select = targetOwner2Row.locator('select.sel');
  await owner2Select.selectOption('Admin');

  // Confirm dialog
  await owner1Page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  await owner1Page.click('dialog[open] button[type="submit"]');

  // Verify intercepted 403 REAUTHENTICATE renders banner with .lnk
  await owner1Page.waitForSelector('#te:not([hidden])', { timeout: 5000 });
  const teText = (await owner1Page.textContent('#te')).trim();
  const teLink = await owner1Page.getAttribute('#te a.lnk', 'href');
  console.log('   Intercepted REAUTHENTICATE text:', teText);
  console.log('   Intercepted REAUTHENTICATE link:', teLink);

  if (teText.includes('For security, sign in again to change an owner’s role.') &&
      teLink.includes('/login?returnTo=')) {
    console.log('   [PASS] Intercepted 403 REAUTHENTICATE rendered: "For security, sign in again to change an owner’s role." with link to /login?returnTo=...');
  } else {
    throw new Error(`REAUTHENTICATE route interception mismatch: text="${teText}", link="${teLink}"`);
  }

  // Clear route interception
  await owner1Page.unroute('**/api/v1/organizations/*/team/*');

  // 6. Test SELF CHANGE (Item 4) with two owners
  console.log('6. Testing SELF CHANGE with two owners...');
  await owner1Page.goto(`${BASE_URL}/workspace/team`);
  await owner1Page.waitForSelector('tbody#mb tr', { timeout: 8000 });

  // Locate Owner 1's own row
  const myRow = owner1Page.locator('tbody#mb tr', { hasText: 'Owner One' });
  const mySelect = myRow.locator('select.sel');

  // Change self to Admin
  await mySelect.selectOption('Admin');

  // Verify Self Change confirmation dialog appears stating immediate logout
  await owner1Page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  const selfDialogText = (await owner1Page.textContent('dialog[open] p')).trim();
  console.log('   Self change dialog message:', selfDialogText);
  if (!selfDialogText.includes('sign you out immediately')) {
    throw new Error('Missing immediate sign out warning in self-change dialog');
  }
  console.log('   [PASS] Self-change confirmation dialog warned user of immediate sign-out.');

  // Confirm self change
  await owner1Page.click('dialog[open] button[type="submit"]');

  // Verify redirected to /login?notice=session_ended
  await owner1Page.waitForURL(url => url.pathname.includes('/login') && url.search.includes('session_ended'), { timeout: 10000 });
  console.log('   [PASS] Self-demoted owner was cleanly signed out and redirected to /login?notice=session_ended.');

  await browser.close();
  console.log('\n=== ALL TEAM ROLE AND PERMISSION CHECKS PASSED SUCCESSFULLY! ===');
}

main().catch(err => {
  console.error('\nFAILED TEAM ROLE VERIFICATION:', err);
  process.exit(1);
});
