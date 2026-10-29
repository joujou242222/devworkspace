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

const VITE_PORT = 5199;
const BASE_URL = `http://localhost:${VITE_PORT}`;

async function waitForMail(recipientEmail, subjectSubstring = null, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch('http://localhost:8025/api/v1/messages');
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

async function main() {
  console.log('=== STARTING WORKSPACE/TEAM BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools') && !text.includes('Failed to load resource')) {
      console.log('BROWSER LOG:', text);
    }
  });

  page.on('pageerror', err => {
    console.error('BROWSER ERROR:', err.message);
  });

  const ts = Date.now();
  const ownerEmail = `team.owner.${ts}@example.com`;
  const ownerPass = 'Password123!';
  const orgName = `Team Testing Agency ${ts}`;

  // 1. Register & Verify
  console.log('1. Registering test user:', ownerEmail);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Tariq Owner');
  await page.fill('#e', ownerEmail);
  await page.fill('#p', ownerPass);
  await page.fill('#c', ownerPass);
  await page.click('button[type="submit"]');

  await page.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  await new Promise(r => setTimeout(r, 1000));
  const userMsg = await waitForMail(ownerEmail, 'Verify');
  const msgDetail = await (await fetch(`http://localhost:8025/api/v1/message/${userMsg.ID}`)).json();
  const verifyToken = new URL(/https?:\/\/[^\s]+/.exec(msgDetail.Text)[0]).searchParams.get('token');

  await page.goto(`${BASE_URL}/register?token=${verifyToken}`);
  await page.waitForSelector('#verified-banner', { timeout: 8000 });

  // 2. Login & Onboarding
  console.log('2. Logging in and completing onboarding...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', ownerEmail);
  await page.fill('#p', ownerPass);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/onboarding', { timeout: 8000 });

  await page.fill('#n', orgName);
  await page.fill('#d', 'Testing Team UI');
  await page.click('#b');
  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await page.fill('#p', ownerPass);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });

  // 3. Navigate to /workspace/team
  console.log('3. Navigating to /workspace/team...');
  await page.goto(`${BASE_URL}/workspace/team`);
  await page.waitForSelector('table.tbl tbody#mb tr', { timeout: 8000 });

  // Assert logged in user is displayed in Members table
  const membersRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody#mb tr'));
    return rows.map(r => ({
      who: r.querySelector('.who')?.textContent?.trim(),
      role: r.querySelector('select.sel')?.value,
      status: r.querySelector('.tag')?.textContent?.trim()
    }));
  });
  console.log('   Rendered members:', membersRows);

  if (membersRows.length === 1 && membersRows[0].role === 'Owner' && membersRows[0].status === 'Active') {
    console.log('   [PASS] Owner member rendered correctly with Owner role and Active tag.');
  } else {
    throw new Error('Unexpected initial members: ' + JSON.stringify(membersRows));
  }

  // Assert pending invitations empty state
  const isIeVisible = await page.evaluate(() => {
    const ie = document.getElementById('ie');
    return ie && !ie.hidden;
  });
  console.log('   Invitations empty state visible:', isIeVisible);
  if (isIeVisible) {
    console.log('   [PASS] Clean empty state displayed when 0 pending invitations exist.');
  } else {
    throw new Error('Expected empty state for pending invitations');
  }

  // 4. Test Last Owner Guard (trying to demote single owner)
  console.log('4. Testing Last Owner Guard (demoting lone owner)...');
  const roleSelect = page.locator('tbody#mb tr:first-child select.sel');
  await roleSelect.selectOption('Member');

  await page.waitForSelector('#te:not([hidden])', { timeout: 5000 });
  const teBannerText = (await page.textContent('#te')).trim();
  console.log('   Last owner guard banner text:', teBannerText);
  if (teBannerText.includes('At least one owner is required')) {
    console.log('   [PASS] Last owner demotion prevented with message: "At least one owner is required. Make someone else an owner first."');
  } else {
    throw new Error('Unexpected banner text: ' + teBannerText);
  }

  const roleAfterGuard = await roleSelect.inputValue();
  if (roleAfterGuard === 'Owner') {
    console.log('   [PASS] Role select successfully reverted to Owner.');
  } else {
    throw new Error('Role select did not revert to Owner: ' + roleAfterGuard);
  }

  // 5. Test Invite Modal Validation
  console.log('5. Testing Invite Modal validation...');
  await page.click('#inv');
  await page.waitForSelector('dialog#dg[open]', { state: 'visible', timeout: 5000 });

  // Empty submit
  await page.click('#df button[type="submit"]');
  await page.waitForSelector('#derr:not([hidden])', { timeout: 3000 });
  console.log('   Empty email error:', (await page.textContent('#derr')).trim());

  // Invalid email
  await page.fill('#ie2', 'invalid-email');
  await page.click('#df button[type="submit"]');
  console.log('   Invalid email error:', (await page.textContent('#derr')).trim());

  // Existing member email
  await page.fill('#ie2', ownerEmail);
  await page.click('#df button[type="submit"]');
  console.log('   Existing member error:', (await page.textContent('#derr')).trim());

  // 6. Send Valid Invitation
  const inviteEmail = `team.invite.${ts}@example.com`;
  console.log('6. Sending invitation to:', inviteEmail, 'with role Admin...');
  await page.fill('#ie2', inviteEmail);
  await page.selectOption('#ir', 'Admin');
  await page.click('#df button[type="submit"]');

  await page.waitForSelector('dialog#dg', { state: 'hidden', timeout: 8000 });
  await page.waitForSelector('tbody#iv tr', { timeout: 8000 });

  const inviteCols = await page.evaluate(() => {
    const tr = document.querySelector('tbody#iv tr:first-child');
    return Array.from(tr.children).map(td => td.textContent.trim());
  });
  console.log('   Invitation row columns:', inviteCols);
  if (inviteCols[0] === inviteEmail && inviteCols[1] === 'Admin') {
    console.log('   [PASS] Pending invitation rendered in table with email and Admin role.');
  } else {
    throw new Error('Unexpected invitation columns: ' + JSON.stringify(inviteCols));
  }

  // 7. Verify email received in Mailpit
  console.log('7. Verifying Mailpit received the team invitation...');
  const matchedMsg = await waitForMail(inviteEmail, 'invitation');

  if (matchedMsg) {
    console.log('   [PASS] Found invitation email in Mailpit! Message ID:', matchedMsg.ID, 'Subject:', matchedMsg.Subject);
    const msgDetailRes = await fetch(`http://localhost:8025/api/v1/message/${matchedMsg.ID}`);
    const msgDetail = await msgDetailRes.json();
    const tokenMatch = msgDetail.Text?.match(/\/invitations\/accept\?token=([A-Za-z0-9_-]+)/);
    if (tokenMatch) {
      console.log('   [PASS] Extracted invitation accept link from email text!');
    } else {
      throw new Error('No invitation accept token found in email text');
    }
  } else {
    throw new Error('No message found in Mailpit for ' + inviteEmail);
  }

  // 8. Test Cancel Invitation
  console.log('8. Testing Cancel Invitation...');
  const cancelBtn = page.locator('tbody#iv tr:first-child button[data-c]');
  
  // Test Cancel dialog cancelation
  await cancelBtn.click();
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  console.log('   Cancel dialog text:', (await page.textContent('dialog[open] p')).trim());
  await page.click('dialog[open] button[data-n]');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });

  let ivCount = await page.locator('tbody#iv tr').count();
  if (ivCount === 1) {
    console.log('   [PASS] Cancellation aborted: invitation remains in table.');
  } else {
    throw new Error('Expected invitation to remain after canceling dialog');
  }

  // Test Confirm Cancel
  await cancelBtn.click();
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  await page.click('dialog[open] button.btn.red');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });

  await page.waitForFunction(() => document.querySelectorAll('tbody#iv tr').length === 0, { timeout: 8000 });
  console.log('   [PASS] Invitation successfully revoked via API and removed from DOM.');

  const isIeVisibleAfter = await page.evaluate(() => {
    const ie = document.getElementById('ie');
    return ie && !ie.hidden;
  });
  if (isIeVisibleAfter) {
    console.log('   [PASS] Empty state #ie restored when 0 invitations remain.');
  } else {
    throw new Error('Expected #ie to be visible');
  }

  // 9. Multi-member role changes & optimistic concurrency (If-Match)
  console.log('9. Seeding second member via API to test role promotion and 412 STALE_REVISION...');
  const secondEmail = `team.colleague.${ts}@example.com`;
  const seededColleague = await page.evaluate(async ({ colEmail }) => {
    const orgId = window.__AUTH__.activeOrgId;
    // Create invite
    const inv = await window.__API__.post(`/organizations/${orgId}/invitations`, {
      email: colEmail,
      role: 'MEMBER'
    });
    return { orgId, inv };
  }, { colEmail: secondEmail });

  // Accept invitation as a new user
  const inviteMsg2 = await waitForMail(secondEmail, 'invitation');
  if (!inviteMsg2) throw new Error('No invitation found for colleague');

  const detailRes2 = await fetch(`http://localhost:8025/api/v1/message/${inviteMsg2.ID}`);
  const detail2 = await detailRes2.json();
  const token2 = detail2.Text.match(/\/invitations\/accept\?token=([A-Za-z0-9_-]+)/)[1];

  // Accept invitation via dedicated context
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto(`${BASE_URL}/register`);
  await page2.waitForSelector('#n', { timeout: 8000 });
  await page2.fill('#n', 'Samir Colleague');
  await page2.fill('#e', secondEmail);
  await page2.fill('#p', ownerPass);
  await page2.fill('#c', ownerPass);
  await page2.click('button[type="submit"]');
  await page2.waitForSelector('#done', { state: 'visible', timeout: 8000 });

  const userMsg2 = await waitForMail(secondEmail, 'Verify');
  const msgDetail2 = await (await fetch(`http://localhost:8025/api/v1/message/${userMsg2.ID}`)).json();
  const verifyToken2 = new URL(/https?:\/\/[^\s]+/.exec(msgDetail2.Text)[0]).searchParams.get('token');

  await page2.goto(`${BASE_URL}/register?token=${verifyToken2}`);
  await page2.waitForSelector('#verified-banner', { timeout: 8000 });

  // Navigate to invitation accept page as Samir
  await page2.goto(`${BASE_URL}/invitation?token=${token2}`);
  await page2.waitForSelector('form#f, button#acc', { timeout: 8000 });
  const hasAccBtn = await page2.$('button#acc');
  if (hasAccBtn) {
    await page2.click('button#acc');
  } else {
    await page2.fill('#e', secondEmail);
    await page2.fill('#p', ownerPass);
    await page2.click('button[type="submit"]');
  }
  await page2.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  await context2.close();

  // Reload team page in owner session
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('tbody#mb tr').length === 2, { timeout: 8000 });
  console.log('   [PASS] Second team member accepted invitation and is rendered in members table!');

  // Promote Samir to Admin
  console.log('   Testing role promotion of Samir from Member to Admin...');
  const samirRow = page.locator('tbody#mb tr', { hasText: 'Samir Colleague' });
  const samirSelect = samirRow.locator('select.sel');
  await samirSelect.selectOption('Admin');
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  const revokeMsg = (await page.textContent('dialog[open] p')).trim();
  console.log('   Revocation dialog text:', revokeMsg);
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(1000);

  const samirRoleInDB = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const team = await window.__API__.get(`/organizations/${orgId}/team`);
    const samir = team.items.find(m => m.name && m.name.includes('Samir'));
    return samir?.role;
  });
  console.log('   Samir role in DB after promotion:', samirRoleInDB);
  if (samirRoleInDB === 'ADMIN') {
    console.log('   [PASS] Role successfully promoted to Admin with If-Match revision in DB.');
  } else {
    throw new Error('Expected role ADMIN, got ' + samirRoleInDB);
  }

  // 10. Test 412 STALE_REVISION on member patch
  console.log('10. Testing 412 STALE_REVISION on member update...');
  const staleHandled = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const team = await window.__API__.get(`/organizations/${orgId}/team`);
    const samir = team.items.find(m => m.name && m.name.includes('Samir'));
    try {
      await window.__API__.patch(`/organizations/${orgId}/team/${samir.id}`, {
        role: 'MEMBER',
        status: samir.status
      }, { revision: samir.revision + 999 });
      return false;
    } catch (err) {
      return err.status === 412 && err.code === 'STALE_REVISION';
    }
  });
  console.log('   412 STALE_REVISION handled:', staleHandled);
  if (staleHandled) {
    console.log('   [PASS] 412 STALE_REVISION correctly detected and handled for team mutations.');
  } else {
    throw new Error('Expected 412 STALE_REVISION');
  }

  console.log('\n=== ALL WORKSPACE/TEAM BROWSER CHECKS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED WORKSPACE/TEAM VERIFICATION:', err);
  process.exit(1);
});
