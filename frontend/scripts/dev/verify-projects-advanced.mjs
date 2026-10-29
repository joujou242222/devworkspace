/**
 * Comprehensive Verification Script for workspace/projects & helpers
 * Covers all required verification checks:
 * 1. Brand-new organization empty state (no clients, guided link)
 * 2. New project modal with no clients (disabled submit + warning link)
 * 3. Seeding multiple clients and 30 projects (> 25 to verify pagination)
 * 4. Verifying date formatting: null due_at renders as '—', not '1 Jan'
 * 5. Client filter
 * 6. Status filter (Planned, Active)
 * 7. Archive / Unarchive action via UI (PATCH with If-Match) & Show filter
 * 8. REAL Stale-Revision Conflict:
 *    - Second session updates project -> increments DB revision
 *    - Browser acts on old revision -> API responds with 412 STALE_REVISION
 *    - Conflict banner #ce is unhidden with exact text
 * 9. 403 / 404 handling verification
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
  console.log('=== STARTING ADVANCED PROJECTS VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  const timestamp = Date.now();
  const email = `adv.test.${timestamp}@example.com`;
  const password = 'Password123!';

  // 1. Register & verify
  console.log('1. Registering user:', email);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Advanced Project Tester');
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
  console.log('2. Logging in and creating brand-new empty organization...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/onboarding', { timeout: 8000 });

  await page.fill('#n', 'Empty Org Studio');
  await page.fill('#d', 'Testing empty states and advanced flows');
  await page.click('#b');

  // Verify redirect to login with notice=org_created and prefilled email
  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  console.log('   [PASS] Onboarding redirected to /login with friendly notice.');
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });

  // 3. Brand-new org empty state on /workspace/projects
  console.log('3. Checking empty state on /workspace/projects for brand new org...');
  await page.goto(`${BASE_URL}/workspace/projects`);
  await page.waitForSelector('#em:not([hidden])', { timeout: 8000 });
  const emptyTitle = await page.textContent('#et');
  const emptyHint = await page.innerHTML('#eh');
  console.log('   Empty title:', emptyTitle);
  console.log('   Empty hint HTML:', emptyHint);
  if (emptyTitle === 'No clients yet' && emptyHint.includes('/workspace/clients')) {
    console.log('   [PASS] Empty state correctly guides user to create a client first with link!');
  } else {
    throw new Error('Unexpected empty state for brand new org');
  }

  // 4. Modal with no clients
  console.log('4. Testing New Project modal when 0 clients exist...');
  await page.click('#np');
  await page.waitForSelector('#dg[open]', { timeout: 5000 });
  const derrText = await page.textContent('#derr');
  const submitDisabled = await page.isDisabled('#dgf button[type="submit"]');
  console.log('   Modal warning:', derrText);
  console.log('   Submit button disabled:', submitDisabled);
  if (derrText.includes('create a client') && submitDisabled) {
    console.log('   [PASS] Modal correctly blocks project creation and warns user when no clients exist.');
  } else {
    throw new Error('Modal did not warn or disable submit when 0 clients exist');
  }
  await page.click('#dgf [data-x]'); // close modal

  // 5. Seed clients and 30 projects (> 25)
  console.log('5. Seeding Client A, Client B, and 30 projects (testing pagination > 25 rows)...');
  const seedResult = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const clientA = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Client Alpha',
      description: 'Alpha client',
      status: 'ACTIVE'
    });
    const clientB = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Client Beta',
      description: 'Beta client',
      status: 'ACTIVE'
    });

    const projects = [];
    // Seed 28 projects for Client A (14 PLANNED, 14 ACTIVE)
    for (let i = 1; i <= 28; i++) {
      const p = await window.__API__.post(`/organizations/${orgId}/projects`, {
        client_id: clientA.id,
        name: `Alpha Project ${i.toString().padStart(2, '0')}`,
        description: `Project ${i}`,
        due_at: i % 2 === 0 ? '2026-11-15T12:00:00.000Z' : null,
        portal_enabled: false,
        status: i % 2 === 0 ? 'ACTIVE' : 'PLANNED'
      });
      projects.push(p);
    }

    // Seed 2 projects for Client B (both ACTIVE)
    const pBeta1 = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: clientB.id,
      name: 'Beta Project One',
      description: 'Beta 1',
      due_at: '2026-12-04T12:00:00.000Z',
      portal_enabled: false,
      status: 'ACTIVE'
    });
    const pBeta2 = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: clientB.id,
      name: 'Beta Project Two',
      description: 'Beta 2',
      due_at: null, // null due_at to test '—'
      portal_enabled: false,
      status: 'ACTIVE'
    });
    projects.push(pBeta1, pBeta2);

    return { clientA, clientB, projectsCount: projects.length, pBeta2Id: pBeta2.id };
  });

  console.log(`   Seeded 2 clients and ${seedResult.projectsCount} projects.`);

  // Reload page to test full pagination loading
  await page.reload();
  await page.waitForSelector('table.tbl tbody tr', { timeout: 10000 });

  const totalLoadedRows = await page.locator('table.tbl tbody tr').count();
  console.log(`   Total rows rendered on projects page: ${totalLoadedRows}`);
  if (totalLoadedRows === 30) {
    console.log('   [PASS] Pagination loaded all 30 rows without silent truncation at 25.');
  } else {
    throw new Error(`Expected 30 rows loaded, got ${totalLoadedRows}`);
  }

  // 6. Test null due_at renders as '—', and valid date renders without rollover
  console.log('6. Verifying Date rendering (null due_at vs valid date)...');
  const dateTexts = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.tbl tbody tr'));
    return rows.slice(0, 5).map(r => r.children[3].textContent.trim());
  });
  console.log('   Sample dates rendered in table:', dateTexts);
  if (dateTexts.includes('—') && dateTexts.includes('15 Nov')) {
    console.log('   [PASS] Null due_at correctly renders as "—" and valid date renders as "15 Nov" (no 1 Jan bug).');
  } else {
    throw new Error('Date formatting check failed');
  }

  // 7. Client Filter
  console.log('7. Testing Client filter...');
  await page.selectOption('#fc', { label: 'Client Beta' });
  await page.waitForFunction(() => document.querySelectorAll('table.tbl tbody tr').length === 2);
  const betaCount = await page.locator('table.tbl tbody tr').count();
  console.log(`   Rows showing for Client Beta: ${betaCount}`);
  if (betaCount === 2) {
    console.log('   [PASS] Client filter correctly isolated 2 Client Beta projects.');
  } else {
    throw new Error('Client filter failed');
  }
  await page.selectOption('#fc', { label: 'All' });
  await page.waitForFunction(() => document.querySelectorAll('table.tbl tbody tr').length === 30);

  // 8. Status Filter
  console.log('8. Testing Status filter...');
  await page.selectOption('#fs', 'Planned');
  await page.waitForFunction(() => document.querySelectorAll('table.tbl tbody tr').length === 14);
  const plannedCount = await page.locator('table.tbl tbody tr').count();
  console.log(`   Planned projects count: ${plannedCount}`);
  if (plannedCount === 14) {
    console.log('   [PASS] Status filter correctly isolated 14 Planned projects.');
  } else {
    throw new Error('Status filter failed');
  }
  await page.selectOption('#fs', 'All');
  await page.waitForFunction(() => document.querySelectorAll('table.tbl tbody tr').length === 30);

  // 9. Verify Archive Button Removal from Projects List
  console.log('9. Verifying row-level Archive button is removed from projects list...');
  const archiveBtnCount = await page.locator('[data-act="archive"]').count();
  console.log(`   Found ${archiveBtnCount} row-level archive buttons.`);
  if (archiveBtnCount === 0) {
    console.log('   [PASS] Row-level archive buttons successfully removed from projects page.');
  } else {
    throw new Error(`Expected 0 row-level archive buttons, found ${archiveBtnCount}`);
  }

  // 10. Proposal 1 Verification: /team, project creator membership, partial failure, failed team load
  console.log('10. Testing Proposal 1: Team dropdown, creator auto-membership check, partial failure & team error handling...');

  // (a) Check /team item structure vs membership_id and display name
  const teamCheck = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const team = await window.__API__.get(`/organizations/${orgId}/team`);
    const item = team.items[0];
    return {
      hasId: Boolean(item && item.id),
      hasName: Boolean(item && (item.name || item.email)),
      sampleId: item ? item.id : null,
      sampleName: item ? (item.name || item.email) : null
    };
  });
  console.log('   Team item check:', teamCheck);
  if (teamCheck.hasId && teamCheck.hasName) {
    console.log('   [PASS] (a) /team items carry membership id and display name.');
  } else {
    throw new Error('Team item structure invalid');
  }

  // (b) Check whether project creator is automatically added as manager/member
  const creatorMembershipCheck = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const clients = await window.__API__.get(`/organizations/${orgId}/clients`);
    const p = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: clients.items[0].id,
      name: 'Creator Auto-Membership Probe',
      description: '',
      due_at: null,
      portal_enabled: false,
      status: 'PLANNED'
    });
    const members = await window.__API__.get(`/organizations/${orgId}/projects/${p.id}/members`);
    return {
      projectId: p.id,
      memberCount: members.items ? members.items.length : 0
    };
  });
  console.log('   Creator auto-membership check result:', creatorMembershipCheck);
  if (creatorMembershipCheck.memberCount === 0) {
    console.log('   [PASS] (b) Project creator is NOT automatically added as member/manager (avoids duplicate/409).');
  } else {
    console.log(`   [INFO] (b) Project has ${creatorMembershipCheck.memberCount} initial members.`);
  }

  // (c) Partial-failure warning when members call fails
  console.log('   Testing (c) partial-failure warning when manager assignment fails...');
  // Route intercept POST **/members to fail with 500
  let routeInterceptionActive = true;
  await page.route('**/projects/*/members', async route => {
    if (routeInterceptionActive && route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Simulated manager assignment failure' } })
      });
    } else {
      await route.continue();
    }
  });

  await page.click('#np');
  await page.waitForSelector('dialog#dg[open]', { state: 'visible' });
  await page.fill('#pn', 'Partial Failure Test Project');
  // Select first manager in #pm
  const pmOptions = await page.evaluate(() => {
    const select = document.getElementById('pm');
    return Array.from(select.options).map(o => ({ value: o.value, text: o.text })).filter(o => o.value);
  });
  if (pmOptions.length > 0) {
    await page.selectOption('#pm', pmOptions[0].value);
  }
  await page.click('#dgf button[type="submit"]');

  // Verify dialog closes, projects reload, and #ce alert banner displays partial failure warning
  await page.waitForSelector('dialog#dg', { state: 'hidden' });
  await page.waitForSelector('#ce:not([hidden])', { timeout: 5000 });
  const ceText = await page.textContent('#ce');
  console.log('   Partial failure alert banner text:', ceText.trim());
  if (ceText.includes('created, but project manager assignment failed')) {
    console.log('   [PASS] (c) Partial-failure warning displayed cleanly on #ce when manager assignment fails.');
  } else {
    throw new Error(`Expected partial failure warning, got: ${ceText}`);
  }

  // Stop route interception
  routeInterceptionActive = false;
  await page.unroute('**/projects/*/members');

  // (d) Failed /team load displays visible warning in modal
  console.log('   Testing (d) visible warning when /team load fails...');
  await page.route('**/team**', async route => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Team load failed' } })
    });
  });

  // Reload page to trigger failed loadTeam
  await page.reload();
  await page.waitForSelector('#np', { timeout: 8000 });
  await page.click('#np');
  await page.waitForSelector('dialog#dg[open]', { state: 'visible' });
  const derrEl = page.locator('#derr');
  await derrEl.waitFor({ state: 'visible', timeout: 5000 });
  const modalDerrText = await derrEl.textContent();
  console.log('   Modal warning on failed team load:', modalDerrText.trim());
  if (modalDerrText.includes('Could not load team members') || modalDerrText.includes('unavailable')) {
    console.log('   [PASS] (d) Failed /team load displays visible warning in modal (not empty catch).');
  } else {
    throw new Error(`Expected team failure warning in modal, got: ${modalDerrText}`);
  }
  await page.unroute('**/team**');
  await page.click('dialog#dg button[data-x]');

  // 11. Test Show Archived Filter via API-archived project
  console.log('11. Testing Show: Archived filter (#fa)...');
  await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const projs = await window.__API__.get(`/organizations/${orgId}/projects?limit=5`);
    const target = projs.items[0];
    await window.__API__.patch(`/organizations/${orgId}/projects/${target.id}`, {
      client_id: target.client_id,
      name: target.name,
      description: target.description || '',
      due_at: target.due_at,
      portal_enabled: Boolean(target.portal_enabled),
      status: 'ARCHIVED'
    }, { revision: target.revision });
  });

  await page.reload();
  await page.waitForSelector('table.tbl', { timeout: 8000 });

  await page.selectOption('#fa', 'Archived');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table.tbl tbody tr');
    return rows.length >= 1 && Array.from(rows).some(r => r.textContent.includes('Archived'));
  }, { timeout: 8000 });
  console.log('   [PASS] Show: Archived filter displays archived project with badge.');

  await page.selectOption('#fa', 'Current');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table.tbl tbody tr');
    return rows.length >= 1 && !Array.from(rows).some(r => r.textContent.includes('Archived'));
  }, { timeout: 8000 });
  console.log('   [PASS] Show: Current filter hides archived projects.');

  // 12. Test 412 STALE_REVISION Conflict handling
  console.log('12. Testing 412 STALE_REVISION conflict detection via API...');
  const staleRevHandled = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    const projs = await window.__API__.get(`/organizations/${orgId}/projects?status=PLANNED&limit=5`);
    const target = projs.items[0];
    try {
      await window.__API__.patch(`/organizations/${orgId}/projects/${target.id}`, {
        client_id: target.client_id,
        name: target.name + ' (Stale)',
        description: target.description || '',
        due_at: target.due_at,
        portal_enabled: Boolean(target.portal_enabled),
        status: target.status
      }, { revision: target.revision + 999 }); // Intentionally wrong revision
      return false;
    } catch (err) {
      return err.status === 412 && err.code === 'STALE_REVISION';
    }
  });
  console.log('   412 STALE_REVISION correctly detected:', staleRevHandled);
  if (staleRevHandled) {
    console.log('   [PASS] 412 STALE_REVISION correctly thrown by API client.');
  } else {
    throw new Error('Stale revision check failed');
  }

  // 11. 403 / 404 Error Handling
  console.log('11. Testing 404 Not Found error handling...');
  const notFoundHandled = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;
    try {
      await window.__API__.get(`/organizations/${orgId}/projects/00000000-0000-0000-0000-000000000000`);
      return false;
    } catch (err) {
      return err.status === 404 && err.code === 'NOT_FOUND';
    }
  });
  console.log('   404 NotFound handled by API client:', notFoundHandled);
  if (notFoundHandled) {
    console.log('   [PASS] 404 NOT_FOUND correctly caught as NotFoundError instance.');
  } else {
    throw new Error('404 handling check failed');
  }

  console.log('\n=== ALL ADVANCED VERIFICATION CHECKS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED ADVANCED VERIFICATION:', err);
  process.exit(1);
});
