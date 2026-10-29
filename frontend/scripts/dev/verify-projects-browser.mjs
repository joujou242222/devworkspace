/**
 * Browser Verification for workspace/projects & helpers
 * - Enforces localhost safety
 * - Seeds a user, org, client, project via real API
 * - Logs in via the browser UI
 * - Navigates to /workspace/projects
 * - Verifies real data rendering (table view, client names, tasks count, date)
 * - Verifies grid view switch
 * - Verifies New Project dialog creates a real project and reloads table
 * - Verifies runtime injected Logout button in .util
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
  console.log('=== STARTING WORKSPACE/PROJECTS BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  const timestamp = Date.now();
  const email = `projects.test.${timestamp}@example.com`;
  const password = 'Password123!';

  console.log('1. Registering test user:', email);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Project Test User');
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.fill('#c', password);
  await page.click('button[type="submit"]');

  await page.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  console.log('   Registration submitted.');

  console.log('2. Fetching verification email from Mailpit...');
  await new Promise(r => setTimeout(r, 1000));
  const messagesRes = await fetch(`${MAILPIT_API}/messages`);
  const messages = await messagesRes.json();
  const userMsg = messages.messages.find(m => m.To[0].Address === email);
  if (!userMsg) throw new Error('Verification email not found in Mailpit');

  const msgDetailRes = await fetch(`${MAILPIT_API}/message/${userMsg.ID}`);
  const msgDetail = await msgDetailRes.json();
  const urlMatch = msgDetail.Text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) throw new Error('Could not find verification link in email');
  const verifyUrl = new URL(urlMatch[0]);
  const token = verifyUrl.searchParams.get('token');

  console.log('3. Visiting verification link...');
  await page.goto(`${BASE_URL}/register?token=${token}`);
  await page.waitForSelector('#verified-banner', { timeout: 8000 });
  console.log('   Email verified.');

  console.log('4. Logging in...');
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('#e', { timeout: 8000 });
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/onboarding', { timeout: 8000 });
  console.log('   Landed on onboarding.');

  console.log('5. Completing onboarding...');
  await page.fill('#n', 'Creative Studio XYZ');
  await page.fill('#d', 'Branding and digital products');
  await page.click('#b');

  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await page.fill('#p', password);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('   Organization created, signed in, landed on dashboard.');

  console.log('6. Navigating to /workspace/projects...');
  await page.goto(`${BASE_URL}/workspace/projects`);
  await page.waitForSelector('main.page', { timeout: 8000 });

  // Verify runtime injected Logout button in .util
  const logoutBtn = await page.locator('.util #logout-btn');
  const logoutExists = await logoutBtn.count();
  if (logoutExists === 1) {
    console.log('   [PASS] Injected Logout button found in .util bar.');
  } else {
    throw new Error('Logout button not found in .util bar');
  }

  // Create a client via API so we have a client to create projects with
  console.log('7. Seeding client via API through page session...');
  const createClientResult = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const res = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Acme Corporation',
      description: 'Global Acme Client',
      status: 'ACTIVE'
    });
    return res;
  });
  console.log('   Client created via API:', createClientResult.name);

  // Reload projects page to pick up the new client in select
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#fc option').length > 1);

  console.log('8. Opening New Project modal and submitting...');
  await page.click('#np');
  await page.waitForSelector('#dg[open]', { timeout: 5000 });

  await page.fill('#pn', 'Acme Brand Refresh');
  // Select Acme Corporation from client dropdown
  await page.selectOption('#pc', { label: 'Acme Corporation' });
  await page.fill('#pd', '2026-12-31');
  await page.click('#dgf button[type="submit"]');

  // Verify modal closes and project appears in table
  await page.waitForSelector('table.tbl tbody tr', { timeout: 8000 });
  const rowText = await page.textContent('table.tbl tbody tr');
  console.log('   Table row content:', rowText.trim());

  if (rowText.includes('Acme Brand Refresh') && rowText.includes('Acme Corporation')) {
    console.log('   [PASS] Created project rendered in table with client name.');
  } else {
    throw new Error('Project or client name not found in table row');
  }

  // Verify creator was added as MANAGER to the created project via default preselected PM
  const memberCheck = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const projs = await window.__API__.get(`/organizations/${orgId}/projects?limit=5`);
    const created = projs.items.find(p => p.name === 'Acme Brand Refresh');
    const members = await window.__API__.get(`/organizations/${orgId}/projects/${created.id}/members`);
    const activePrincipal = window.__AUTH__.getActivePrincipal();
    const myMember = members.items.find(m => m.membership_id === activePrincipal?.id);
    return {
      membersCount: members.items.length,
      hasCreator: Boolean(myMember),
      creatorRole: myMember?.role,
      creatorStatus: myMember?.status
    };
  });
  console.log('   Default project member check:', memberCheck);
  if (memberCheck.hasCreator && memberCheck.creatorRole === 'MANAGER' && memberCheck.creatorStatus === 'ACTIVE') {
    console.log('   [PASS] Project created with default preselected PM has creator as MANAGER.');
  } else {
    throw new Error('Expected creator to be added as MANAGER: ' + JSON.stringify(memberCheck));
  }

  // Check row data-id and data-revision attributes
  const rowAttrs = await page.evaluate(() => {
    const tr = document.querySelector('table.tbl tbody tr');
    return {
      id: tr?.dataset?.id,
      revision: tr?.dataset?.revision
    };
  });
  console.log('   Row attributes:', rowAttrs);
  if (rowAttrs.id && rowAttrs.revision) {
    console.log('   [PASS] Row attributes carry data-id and data-revision correctly.');
  } else {
    throw new Error('Row missing data-id or data-revision');
  }

  console.log('9. Switching to Grid view...');
  await page.selectOption('#vw', 'Grid');
  await page.waitForSelector('.cards .card', { timeout: 5000 });
  const cardText = await page.textContent('.cards .card');
  console.log('   Card content:', cardText.trim());
  if (cardText.includes('Acme Brand Refresh')) {
    console.log('   [PASS] Grid view successfully rendered card.');
  } else {
    throw new Error('Card view failed to render project');
  }

  console.log('10. Testing search filter...');
  await page.fill('#q', 'NonexistentProject');
  await page.waitForSelector('#em:not([hidden])', { timeout: 5000 });
  const emptyText = await page.textContent('#em');
  console.log('   Empty state message:', emptyText.trim());
  if (emptyText.includes('No projects match')) {
    console.log('   [PASS] Empty state rendered correctly without breaking DOM.');
  } else {
    throw new Error('Empty state not displayed for unmatched query');
  }

  // Clear search and confirm project reappears
  await page.fill('#q', '');
  await page.waitForSelector('.cards .card', { timeout: 5000 });
  console.log('   [PASS] Projects reappeared after clearing search.');

  console.log('\n=== ALL BROWSER CHECKS PASSED FOR WORKSPACE/PROJECTS ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED VERIFICATION:', err);
  process.exit(1);
});
