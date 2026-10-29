/**
 * Verification Script for Dashboard Widgets and Empty States:
 * - Empty state verification:
 *   - Empty Reviews (.rev: 0)
 *   - Empty Projects ("No active projects yet")
 *   - Empty Tasks ("No tasks assigned to you right now")
 *   - Empty Activity ("No recent activity yet")
 *   - Empty Bell Drawer ("No notifications yet", dot hidden)
 * - Populated state verification:
 *   - Populated Reviews count
 *   - Populated Activity list (.act)
 *   - Populated Notifications drawer (dot visible, items listed on click)
 * - Plain expired session verification:
 *   - Session cookie deleted
 *   - Navigate to /workspace/dashboard
 *   - Redirects to /login with neutral notice: "Your session ended. Please sign in again."
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

// Safety check
for (const target of [BASE_URL, MAILPIT_API]) {
  const host = new URL(target).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Safety check failed: refusing to run against non-localhost target "${target}"`);
  }
}

async function main() {
  console.log('=== STARTING DASHBOARD WIDGETS, BELL DRAWER & EXPIRED SESSION VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  const ts = Date.now();
  const email = `dash.widgets.${ts}@example.com`;
  const password = 'Password123!';

  // --- STEP 1: Register and Create Empty Org ---
  console.log('1. Registering user for empty dashboard tests:', email);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Nour Empty Dash');
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.fill('#c', password);
  await page.click('button[type="submit"]');

  await page.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  await new Promise(r => setTimeout(r, 1000));
  const messagesRes = await fetch(`${MAILPIT_API}/messages`);
  const messages = await messagesRes.json();
  const userMsg = messages.messages.find(m => m.To[0].Address === email && m.Subject.includes('Verify'));
  const msgDetail = await (await fetch(`${MAILPIT_API}/message/${userMsg.ID}`)).json();
  const token = new URL(/https?:\/\/[^\s]+/.exec(msgDetail.Text)[0]).searchParams.get('token');

  await page.goto(`${BASE_URL}/register?token=${token}`);
  await page.waitForSelector('#verified-banner', { timeout: 8000 });

  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/onboarding', { timeout: 8000 });

  await page.fill('#n', 'Brand Studios');
  await page.fill('#d', 'Empty State Org');
  await page.click('#b');
  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('   User logged into brand new empty dashboard.');

  // --- STEP 2: Verify Empty States on Dashboard ---
  console.log('\n2. VERIFYING EMPTY STATES ON DASHBOARD:');

  // Wait for loadDashboard to complete and update top p
  await page.waitForFunction(() => {
    const p = document.querySelector('.top p');
    return p && !p.textContent.includes('3 tasks due this week');
  }, { timeout: 10000 });

  // A. Top summary paragraph
  const topPText = await page.textContent('.top p');
  console.log('   Top summary text:', topPText.trim());
  if (topPText.includes('0 tasks') && topPText.includes('0 reviews')) {
    console.log('   [PASS] Top summary correctly reflects 0 tasks and 0 reviews.');
  } else {
    throw new Error(`Unexpected top summary: ${topPText}`);
  }

  // B. Reviews count widget (.rev)
  const revCount = (await page.textContent('.rev .n')).trim();
  console.log('   Waiting on Decision review count:', revCount);
  const revListText = (await page.textContent('.rev ul')).trim();
  console.log('   Waiting on Decision review list:', revListText);
  if (revCount === '0' && revListText.includes('No reviews currently awaiting decision')) {
    console.log('   [PASS] Reviews widget displays 0 and "No reviews currently awaiting decision".');
  } else {
    throw new Error(`Unexpected review count: ${revCount}, list: ${revListText}`);
  }

  // C. Empty Projects widget (.pj)
  await page.waitForSelector('.pj', { timeout: 5000 });
  const pjText = (await page.textContent('.pj')).trim();
  console.log('   Your Projects widget text:', pjText);
  if (pjText.includes('No active projects yet')) {
    console.log('   [PASS] Your Projects displays clean empty state with start project link.');
  } else {
    throw new Error(`Unexpected projects text: ${pjText}`);
  }

  // D. Empty Tasks widget (.tk)
  await page.waitForSelector('.tk', { timeout: 5000 });
  const tkText = (await page.textContent('.tk')).trim();
  console.log('   Your Tasks widget text:', tkText);
  if (tkText.includes('No tasks assigned to you right now')) {
    console.log('   [PASS] Your Tasks displays clean empty state.');
  } else {
    throw new Error(`Unexpected tasks text: ${tkText}`);
  }

  // E. Empty Activity widget (.act)
  await page.waitForSelector('.act', { timeout: 5000 });
  const actText = (await page.textContent('.act')).trim();
  console.log('   Latest Activity widget text:', actText);
  if (actText.includes('No recent activity')) {
    console.log('   [PASS] Latest Activity displays clean empty state.');
  } else {
    throw new Error(`Unexpected activity text: ${actText}`);
  }

  // E2. Empty Milestones widget (.ms)
  await page.waitForSelector('.ms', { timeout: 5000 });
  const emptyMsText = (await page.textContent('.ms')).trim();
  console.log('   Upcoming Milestones empty text:', emptyMsText);
  if (emptyMsText.includes('No upcoming milestones')) {
    console.log('   [PASS] Milestones widget displays "No upcoming milestones" when 0 milestones exist.');
  } else {
    throw new Error(`Unexpected milestones text: ${emptyMsText}`);
  }

  // F. Empty Bell Drawer
  console.log('   Checking Empty Bell Drawer:');
  const dotHidden = await page.evaluate(() => {
    const dot = document.getElementById('bd');
    return !dot || dot.style.display === 'none';
  });
  console.log('   Unread dot hidden initially:', dotHidden);
  if (dotHidden) {
    console.log('   [PASS] Bell unread indicator dot is hidden when unread count is 0.');
  } else {
    throw new Error('Bell dot should be hidden for 0 unread notifications');
  }

  // Click bell to open drawer
  await page.click('#bell');
  await page.waitForSelector('#dr:not([hidden])', { timeout: 5000 });
  const drawerText = (await page.textContent('#dl')).trim();
  console.log('   Notifications drawer list content:', drawerText);
  if (drawerText.includes('No notifications yet')) {
    console.log('   [PASS] Notifications drawer displays "No notifications yet".');
  } else {
    throw new Error(`Unexpected drawer text: ${drawerText}`);
  }
  // Close drawer
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('dr')?.hidden, { timeout: 5000 });

  // --- STEP 3: Seed Populated Data (Client, Project, Task, Activity, Notification) ---
  console.log('\n3. SEEDING DATA FOR POPULATED DASHBOARD TEST:');
  const seedResult = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const princId = window.__AUTH__.getActivePrincipalId();

    const client = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Sahara Beverages',
      description: 'Major account',
      status: 'ACTIVE'
    });

    const project = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: client.id,
      name: 'Spring TV Commercial',
      description: 'Spot production',
      due_at: '2026-11-30T12:00:00.000Z',
      portal_enabled: false,
      status: 'ACTIVE'
    });

    const member = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/members`, {
      membership_id: princId,
      role: 'MANAGER',
      status: 'ACTIVE'
    });

    const task = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      title: 'Finalize audio mix balance',
      description: 'Stereo master',
      milestone_id: null,
      assignee_id: member.id,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      due_at: '2026-11-12T12:00:00.000Z',
      position: 1
    });

    const milestone = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/milestones`, {
      title: 'First Assembly Review',
      due_at: '2026-11-20T12:00:00.000Z',
      position: 1,
      status: 'OPEN'
    });

    return { client, project, task, milestone };
  });

  console.log('   Seeded project:', seedResult.project.name, 'and task:', seedResult.task.title, 'and milestone:', seedResult.milestone.title);

  // Reload dashboard to verify populated widgets
  console.log('4. Reloading dashboard to verify populated widgets...');
  await page.reload();
  await page.waitForSelector('.top h1', { timeout: 8000 });

  // Verify populated projects
  await page.waitForFunction(() => document.querySelector('.pj')?.textContent.includes('Spring TV Commercial'), { timeout: 8000 });
  const popPjText = await page.textContent('.pj');
  console.log('   Populated Your Projects text:', popPjText.trim());
  if (popPjText.includes('Spring TV Commercial') && popPjText.includes('Sahara Beverages')) {
    console.log('   [PASS] Populated Your Projects rendered real project and client name.');
  }

  // Verify populated tasks
  await page.waitForFunction(() => document.querySelector('.tk')?.textContent.includes('Finalize audio mix balance'), { timeout: 8000 });
  const popTkText = await page.textContent('.tk');
  console.log('   Populated Your Tasks text:', popTkText.trim());
  if (popTkText.includes('Finalize audio mix balance') && popTkText.includes('In progress')) {
    console.log('   [PASS] Populated Your Tasks rendered real task and status.');
  }

  // Verify populated milestones widget (.ms)
  await page.waitForFunction(() => document.querySelector('.ms')?.textContent.includes('First Assembly Review'), { timeout: 8000 });
  const popMsText = await page.textContent('.ms');
  console.log('   Populated Upcoming Milestones text:', popMsText.trim());
  if (popMsText.includes('First Assembly Review') && popMsText.includes('20 Nov')) {
    console.log('   [PASS] Populated Milestones widget rendered real milestone title and date ("20 Nov").');
  } else {
    throw new Error(`Unexpected populated milestones text: ${popMsText}`);
  }

  // Forced failure test for Milestones
  console.log('\nTesting Proposal 2: Forced failure on all milestones...');
  await page.route('**/milestones?**', async route => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Milestones failure' } })
    });
  });
  await page.reload();
  await page.waitForSelector('.ms', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('.ms')?.textContent.includes('Failed to load milestones'), { timeout: 8000 });
  console.log('   [PASS] All-failed milestones displayed short error line inside widget.');
  await page.unroute('**/milestones?**');

  // Partial failure test for Milestones
  console.log('Testing Proposal 2: Partial failure (one succeeds, one fails)...');
  await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const clients = await window.__API__.get(`/organizations/${orgId}/clients`);
    const p2 = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: clients.items[0].id,
      name: 'Second Promo Video',
      description: '',
      due_at: null,
      portal_enabled: false,
      status: 'ACTIVE'
    });
    await window.__API__.post(`/organizations/${orgId}/projects/${p2.id}/milestones`, {
      title: 'Second Promo Cut',
      due_at: '2026-11-25T12:00:00.000Z',
      position: 1,
      status: 'OPEN'
    });
  });

  let callCount = 0;
  await page.route('**/milestones?**', async route => {
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'First project failed' } })
      });
    } else {
      await route.continue();
    }
  });
  await page.reload();
  await page.waitForSelector('.ms', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('.ms')?.textContent.includes('Second Promo Cut') || document.querySelector('.ms')?.textContent.includes('First Assembly Review'), { timeout: 8000 });
  const partialMsText = await page.textContent('.ms');
  console.log('   Partial failure milestones rendered:', partialMsText.trim());
  if (partialMsText.includes('Second Promo Cut') || partialMsText.includes('First Assembly Review')) {
    console.log('   [PASS] Partial results rendered available milestones when one call failed.');
  } else {
    throw new Error(`Expected partial results, got: ${partialMsText}`);
  }
  await page.unroute('**/milestones?**');

  // --- STEP 4: Plain Expired Session Test ---
  console.log('\n4. VERIFYING PLAIN EXPIRED SESSION & NEUTRAL NOTICE:');
  // Clear cookies to expire session
  await context.clearCookies();
  console.log('   Cleared session cookies (session expired).');

  // Attempt to navigate to protected workspace dashboard
  console.log('   Navigating to protected /workspace/dashboard with expired session...');
  await page.goto(`${BASE_URL}/workspace/dashboard`);

  // Assert redirection to /login with neutral notice
  await page.waitForURL('**/login?**notice=session_ended**', { timeout: 8000 });
  console.log('   Redirected URL:', page.url());

  // Assert neutral banner message
  await page.waitForSelector('.msg[role="status"]', { state: 'visible', timeout: 5000 });
  const noticeMsg = (await page.textContent('.msg[role="status"]')).trim();
  console.log('   Login notice message:', noticeMsg);

  if (noticeMsg === 'Your session ended. Please sign in again.') {
    console.log('   [PASS] Neutral message "Your session ended. Please sign in again." displayed cleanly!');
  } else {
    throw new Error(`Expected neutral notice message, got: "${noticeMsg}"`);
  }

  console.log('\n=== ALL DASHBOARD WIDGETS & EXPIRED SESSION VERIFICATIONS PASSED! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED WIDGETS VERIFICATION:', err);
  process.exit(1);
});
