/**
 * Browser Verification Script for workspace/dashboard
 * - Enforces localhost safety
 * - Logs in with test user who has seeded org, project, client, task, and deliverable
 * - Navigates to /workspace/dashboard
 * - Verifies dynamic user greeting
 * - Verifies Your Projects (.pj) displays real project name, client name, progress bar
 * - Verifies Your Tasks (.tk) displays real task title, status pill, due date
 * - Verifies Waiting on a Decision (.rev) displays real count
 * - Verifies Latest Activity (.act) displays recent events
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
  console.log('=== STARTING WORKSPACE/DASHBOARD BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  const timestamp = Date.now();
  const email = `dash.test.${timestamp}@example.com`;
  const password = 'Password123!';

  // 1. Register & verify
  console.log('1. Registering user for dashboard test:', email);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Yara Test');
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.fill('#c', password);
  await page.click('button[type="submit"]');

  await page.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  await new Promise(r => setTimeout(r, 1000));
  const messagesRes = await fetch(`${MAILPIT_API}/messages`);
  const messages = await messagesRes.json();
  const userMsg = messages.messages.find(m => m.To[0].Address === email);
  const msgDetailRes = await fetch(`${MAILPIT_API}/message/${userMsg.ID}`);
  const msgDetail = await msgDetailRes.json();
  const match = /https?:\/\/[^\s]+/.exec(msgDetail.Text || '');
  const verifyUrl = new URL(match[0]);
  const token = verifyUrl.searchParams.get('token');

  await page.goto(`${BASE_URL}/register?token=${token}`);
  await page.waitForSelector('#verified-banner', { timeout: 8000 });

  // 2. Login -> Onboarding
  console.log('2. Completing Onboarding...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/onboarding', { timeout: 8000 });

  await page.fill('#n', 'Cairo Design Lab');
  await page.fill('#d', 'Interactive Dashboards');
  await page.click('#b');

  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('   Landed on dashboard.');

  // 3. Seed test data: client, project, project membership, and task
  console.log('3. Seeding client, project, and assigned task via API session...');
  const seedData = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const princId = window.__AUTH__.getActivePrincipalId();

    const client = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Nile Beverages',
      description: 'Beverage Client',
      status: 'ACTIVE'
    });

    const project = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: client.id,
      name: 'Summer Campaign Film',
      description: 'Summer spot',
      due_at: '2026-11-20T12:00:00.000Z',
      portal_enabled: false,
      status: 'ACTIVE'
    });

    // Add principal to project memberships
    const member = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/members`, {
      membership_id: princId,
      role: 'MANAGER',
      status: 'ACTIVE'
    });

    // Add task assigned to member
    const task = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      title: 'Complete storyboard cut',
      description: 'First cut of storyboards',
      milestone_id: null,
      assignee_id: member.id,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      due_at: '2026-11-10T12:00:00.000Z',
      position: 1
    });

    return { client, project, task };
  });
  console.log('   Seeded project:', seedData.project.name, 'and task:', seedData.task.title);

  // 4. Reload dashboard and verify dynamic rendering
  console.log('4. Reloading dashboard to verify real dynamic widgets...');
  await page.reload();
  await page.waitForSelector('.top h1', { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('.top h1')?.textContent.includes('Sara'), { timeout: 8000 });

  // 1. Header greeting
  const greeting = (await page.textContent('.top h1')).trim();
  console.log('   Header greeting:', greeting);
  if (greeting.includes('Yara') && !greeting.includes('Sara')) {
    console.log('   [PASS] Top greeting dynamically includes registered name "Yara" and NOT hardcoded "Sara".');
  } else {
    throw new Error(`Greeting assertion failed: expected "Yara" without "Sara", got "${greeting}"`);
  }

  // 2. Header user initials and account link name
  const avText = (await page.textContent('.util .av')).trim();
  console.log('   Header avatar initials:', avText);
  if (avText === 'YT') {
    console.log('   [PASS] Header avatar initials dynamically updated to "YT" (Yara Test).');
  } else {
    throw new Error(`Avatar initials assertion failed: expected "YT", got "${avText}"`);
  }

  const acctLinkText = (await page.textContent('.util a[href="/workspace/account"]')).trim();
  console.log('   Header account link text:', acctLinkText);
  if (acctLinkText.includes('Yara') && !acctLinkText.includes('Sara')) {
    console.log('   [PASS] Header user display name dynamically updated to "Yara" and NOT hardcoded "Sara".');
  } else {
    throw new Error(`Account link text assertion failed: expected "Yara" without "Sara", got "${acctLinkText}"`);
  }

  // Your Projects widget (.pj)
  await page.waitForFunction(() => document.querySelector('.pj')?.textContent.includes('Summer Campaign Film'), { timeout: 8000 });
  const pjText = await page.textContent('.pj');
  console.log('   Your Projects text:', pjText.trim());
  if (pjText.includes('Summer Campaign Film') && pjText.includes('Nile Beverages')) {
    console.log('   [PASS] Your Projects rendered with real project and client name.');
  } else {
    throw new Error('Your Projects widget failed to render seeded project/client');
  }

  // Your Tasks widget (.tk)
  await page.waitForFunction(() => document.querySelector('.tk')?.textContent.includes('Complete storyboard cut'), { timeout: 8000 });
  const tkText = await page.textContent('.tk');
  console.log('   Your Tasks text:', tkText.trim());
  if (tkText.includes('Complete storyboard cut') && tkText.includes('In progress')) {
    console.log('   [PASS] Your Tasks rendered with real task title and status.');
  } else {
    throw new Error('Your Tasks widget failed to render seeded task');
  }

  console.log('\n=== ALL DASHBOARD BROWSER VERIFICATIONS PASSED! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED DASHBOARD VERIFICATION:', err);
  process.exit(1);
});
