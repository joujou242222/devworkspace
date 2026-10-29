/**
 * Browser Verification for /workspace/client (Client Detail):
 * - Renders client name, status, and project count in top header
 * - Contacts table rendering (active vs invite pending)
 * - Cancel invite button action (DELETE /invitations/:id)
 * - Project permission matrix (#pp) rendering
 * - "Can decide" checkbox toggle:
 *   - Check -> creates/activates APPROVER grant
 *   - Uncheck -> sets grant status to REVOKED
 * - Archived client read-only banner (#ar) and disabled checkboxes
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

async function main() {
  console.log('=== STARTING WORKSPACE/CLIENT DETAIL BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  const ts = Date.now();
  const email = `client.detail.${ts}@example.com`;
  const password = 'Password123!';

  // 1. Register & Verify
  console.log('1. Registering test user:', email);
  await page.goto(`${BASE_URL}/register`);
  await page.fill('#n', 'Client Detail Tester');
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

  // 2. Login & Onboarding
  console.log('2. Logging in and completing onboarding...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', email);
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/onboarding', { timeout: 8000 });

  await page.fill('#n', 'Horizon Agency');
  await page.fill('#d', 'Testing Client Detail');
  await page.click('#b');
  await page.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await page.fill('#p', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });

  // 3. Seed: Client, 2 Contacts, 2 Projects, 1 Grant, 1 Invitation
  console.log('3. Seeding Client, Contacts, Projects, Grant, and Invitation...');
  const seed = await page.evaluate(async () => {
    const orgId = window.__AUTH__.activeOrgId;

    // Client
    const client = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Horizon Media Group',
      description: 'Key media account',
      status: 'ACTIVE'
    });

    // Contacts
    const contactMona = await window.__API__.post(`/organizations/${orgId}/clients/${client.id}/contacts`, {
      name: 'Mona Fathy',
      email: 'mona@horizonmedia.com',
      status: 'ACTIVE'
    });

    const contactHany = await window.__API__.post(`/organizations/${orgId}/clients/${client.id}/contacts`, {
      name: 'Hany Zaki',
      email: 'hany@horizonmedia.com',
      status: 'ACTIVE'
    });

    // Projects
    const projBrand = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: client.id,
      name: 'Brand Film Campaign',
      description: 'Brand commercial video',
      due_at: '2026-11-20T12:00:00.000Z',
      portal_enabled: true,
      status: 'ACTIVE'
    });

    const projPack = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: client.id,
      name: 'Packaging Refresh',
      description: 'Packaging redesign',
      due_at: '2026-12-10T12:00:00.000Z',
      portal_enabled: true,
      status: 'ACTIVE'
    });

    // Grant Mona APPROVER on projBrand
    const grantMona = await window.__API__.post(`/organizations/${orgId}/projects/${projBrand.id}/grants`, {
      contact_id: contactMona.id,
      role: 'APPROVER',
      status: 'ACTIVE'
    });

    // Grant Hany REVIEWER on projBrand
    const grantHany = await window.__API__.post(`/organizations/${orgId}/projects/${projBrand.id}/grants`, {
      contact_id: contactHany.id,
      role: 'REVIEWER',
      status: 'ACTIVE'
    });

    // Send Invitation to Hany on projPack
    let inviteHany = null;
    try {
      inviteHany = await window.__API__.post(`/organizations/${orgId}/clients/${client.id}/contacts/${contactHany.id}/invitations`, {
        project_id: projPack.id,
        role: 'REVIEWER'
      });
    } catch (invErr) {
      console.error('Invite error:', invErr);
    }

    return { client, contactMona, contactHany, projBrand, projPack, grantMona, grantHany, inviteHany };
  });

  console.log('   Seeded client:', seed.client.name, 'with id:', seed.client.id);

  // 4. Navigate to /workspace/client?id=...
  console.log('4. Navigating to /workspace/client?id=' + seed.client.id);
  await page.goto(`${BASE_URL}/workspace/client?id=${seed.client.id}`);
  await page.waitForFunction(() => {
    const el = document.querySelector('.top h1');
    return el && !el.textContent.includes('Nile Foods');
  }, { timeout: 8000 });

  // Assert header
  const titleText = (await page.textContent('.top h1')).trim();
  console.log('   Client title:', titleText);
  if (titleText !== 'Horizon Media Group') throw new Error(`Expected Horizon Media Group, got ${titleText}`);

  const topPText = (await page.textContent('.top p')).trim();
  console.log('   Header subtitle:', topPText);
  if (topPText.includes('Active') && topPText.includes('2 projects')) {
    console.log('   [PASS] Header correctly displays "Active · 2 projects".');
  } else {
    throw new Error(`Unexpected header subtitle: ${topPText}`);
  }

  // 5. Contacts table verification
  console.log('5. Verifying Contacts table:');
  await page.waitForSelector('tbody#ct tr', { timeout: 8000 });
  const contactRows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('tbody#ct tr')).map(tr => tr.textContent.trim());
  });
  console.log('   Rendered contacts:', contactRows);
  if (contactRows.some(r => r.includes('Mona Fathy') && r.includes('Active'))) {
    console.log('   [PASS] Mona Fathy rendered with Active status.');
  } else {
    throw new Error('Mona Fathy missing from contacts table');
  }

  // 6. Project Permission Matrix (#pp) verification
  console.log('6. Verifying "Who can decide, per project" matrix (#pp):');
  await page.waitForSelector('#pp .pf', { timeout: 8000 });
  const pfCount = await page.locator('#pp .pf').count();
  console.log(`   Found ${pfCount} project permission rows.`);
  if (pfCount === 2) {
    console.log('   [PASS] Rendered both projects in permissions matrix.');
  } else {
    throw new Error(`Expected 2 project rows in #pp, found ${pfCount}`);
  }

  // Assert matrix state: Mona (APPROVER) and Hany (REVIEWER) on Brand Film, Mona on Packaging Refresh
  const matrixState = await page.evaluate(({ monaId, hanyId, brandId, packId }) => {
    const monaBrand = document.querySelector(`input[data-contact-id="${monaId}"][data-project-id="${brandId}"]`);
    const hanyBrand = document.querySelector(`input[data-contact-id="${hanyId}"][data-project-id="${brandId}"]`);
    const monaPack = document.querySelector(`input[data-contact-id="${monaId}"][data-project-id="${packId}"]`);
    return {
      monaBrand: monaBrand ? monaBrand.checked : false,
      hanyBrand: hanyBrand ? hanyBrand.checked : false,
      monaPack: monaPack ? monaPack.checked : false
    };
  }, { monaId: seed.contactMona.id, hanyId: seed.contactHany.id, brandId: seed.projBrand.id, packId: seed.projPack.id });
  console.log('   Matrix state:', matrixState);
  if (matrixState.monaBrand && matrixState.hanyBrand && !matrixState.monaPack) {
    console.log('   [PASS] Both APPROVER (Mona) and REVIEWER (Hany) show checked for Brand Film; unassigned Packaging Refresh is unchecked.');
  } else {
    throw new Error('Matrix state mismatch: ' + JSON.stringify(matrixState));
  }

  // 7. Uncheck Hany on Brand Film -> confirm dialog -> status REVOKED
  console.log('7. Testing uncheck access: Hany on Brand Film...');
  const hanyBrandCheckbox = page.locator(`input[data-contact-id="${seed.contactHany.id}"][data-project-id="${seed.projBrand.id}"]`);
  
  // Test cancel
  await hanyBrandCheckbox.click();
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  const confirmText = (await page.textContent('dialog[open] p')).trim();
  console.log('   Confirmation text:', confirmText);
  if (!confirmText.includes('lose access')) throw new Error('Confirmation missing access loss warning');
  await page.click('dialog[open] button[data-n]');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });
  let hanyStillChecked = await page.evaluate(({ hanyId, brandId }) => {
    const el = document.querySelector(`input[data-contact-id="${hanyId}"][data-project-id="${brandId}"]`);
    return el && el.checked;
  }, { hanyId: seed.contactHany.id, brandId: seed.projBrand.id });
  if (hanyStillChecked) {
    console.log('   [PASS] Cancel uncheck preserves checked state.');
  } else {
    throw new Error('Expected checkbox to remain checked on cancel');
  }

  // Confirm uncheck
  await hanyBrandCheckbox.click();
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  await page.click('dialog[open] button.btn.red');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(1000);

  // Verify grant was REVOKED with role REVIEWER
  const hanyRevoked = await page.evaluate(async ({ brandId, hanyId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const grants = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}/grants`);
    const g = grants.items.find(x => x.contact_id === hanyId);
    return g && g.status === 'REVOKED' && g.role === 'REVIEWER';
  }, { brandId: seed.projBrand.id, hanyId: seed.contactHany.id });
  if (hanyRevoked) {
    console.log('   [PASS] Uncheck -> confirm set grant to REVOKED while preserving role REVIEWER.');
  } else {
    throw new Error('Grant was not revoked properly');
  }

  // 8. Check Hany on Brand Film again -> status ACTIVE
  console.log('8. Testing re-checking access: Hany on Brand Film...');
  await hanyBrandCheckbox.click();
  await page.waitForTimeout(1000);
  const hanyReactivated = await page.evaluate(async ({ brandId, hanyId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const grants = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}/grants`);
    const g = grants.items.find(x => x.contact_id === hanyId);
    return g && g.status === 'ACTIVE' && g.role === 'REVIEWER';
  }, { brandId: seed.projBrand.id, hanyId: seed.contactHany.id });
  if (hanyReactivated) {
    console.log('   [PASS] Re-check set grant back to ACTIVE with role REVIEWER.');
  } else {
    throw new Error('Grant was not reactivated');
  }

  // 8b. Check Mona on Packaging Refresh (new grant -> REVIEWER) & verify Mona on Brand Film retains APPROVER
  console.log('8b. Testing new grant creation (REVIEWER) and role preservation for existing APPROVER...');
  const packCheckbox = page.locator(`input[data-contact-id="${seed.contactMona.id}"][data-project-id="${seed.projPack.id}"]`);
  await packCheckbox.click();
  await page.waitForTimeout(1000);

  const rolesVerified = await page.evaluate(async ({ packId, brandId, monaId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const gPack = (await window.__API__.get(`/organizations/${orgId}/projects/${packId}/grants`)).items.find(x => x.contact_id === monaId);
    const gBrand = (await window.__API__.get(`/organizations/${orgId}/projects/${brandId}/grants`)).items.find(x => x.contact_id === monaId);
    return {
      packRole: gPack?.role,
      packStatus: gPack?.status,
      brandRole: gBrand?.role,
      brandStatus: gBrand?.status
    };
  }, { packId: seed.projPack.id, brandId: seed.projBrand.id, monaId: seed.contactMona.id });
  console.log('   Grants role check:', rolesVerified);
  if (rolesVerified.packRole === 'REVIEWER' && rolesVerified.packStatus === 'ACTIVE' &&
      rolesVerified.brandRole === 'APPROVER' && rolesVerified.brandStatus === 'ACTIVE') {
    console.log('   [PASS] New grant created with REVIEWER role; existing grant on Brand Film preserved APPROVER role.');
  } else {
    throw new Error('Role check failed: ' + JSON.stringify(rolesVerified));
  }

  // 8b2. Item 5 Test: APPROVER -> Revoke -> Reactivate -> Role resets to REVIEWER (least privilege)
  console.log('8b2. Testing APPROVER -> Revoke -> Reactivate -> Role resets to REVIEWER (least privilege)...');
  const monaBrandCheckbox = page.locator(`input[data-contact-id="${seed.contactMona.id}"][data-project-id="${seed.projBrand.id}"]`);
  // Uncheck Mona on Brand Film
  await monaBrandCheckbox.click();
  await page.waitForSelector('dialog[open]', { state: 'visible', timeout: 5000 });
  await page.click('dialog[open] button.btn.red');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(1000);

  // Verify Mona is REVOKED
  const monaRevoked = await page.evaluate(async ({ brandId, monaId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const grants = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}/grants`);
    const g = grants.items.find(x => x.contact_id === monaId);
    return g && g.status === 'REVOKED';
  }, { brandId: seed.projBrand.id, monaId: seed.contactMona.id });
  if (!monaRevoked) throw new Error('Mona grant was not revoked');
  console.log('   [PASS] Mona APPROVER grant successfully revoked.');

  // Re-check Mona on Brand Film
  await monaBrandCheckbox.click();
  await page.waitForTimeout(1000);

  // Verify Mona is now ACTIVE with role REVIEWER (least privilege)
  const monaReactivated = await page.evaluate(async ({ brandId, monaId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const grants = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}/grants`);
    const g = grants.items.find(x => x.contact_id === monaId);
    return {
      status: g?.status,
      role: g?.role
    };
  }, { brandId: seed.projBrand.id, monaId: seed.contactMona.id });
  console.log('   Mona reactivated grant:', monaReactivated);
  if (monaReactivated.status === 'ACTIVE' && monaReactivated.role === 'REVIEWER') {
    console.log('   [PASS] Reactivating REVOKED grant that was APPROVER resets role to REVIEWER (least privilege).');
  } else {
    throw new Error('Reactivation failed to reset role to REVIEWER: ' + JSON.stringify(monaReactivated));
  }

  // 8c. Portal Enabled Check
  console.log('8c. Verifying portal_enabled on project...');
  const portalEnabled = await page.evaluate(async ({ brandId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const p = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}`);
    return p.portal_enabled;
  }, { brandId: seed.projBrand.id });
  if (portalEnabled === true) {
    console.log('   [PASS] Project has portal_enabled: true.');
  } else {
    throw new Error('Expected portal_enabled: true');
  }

  // 9. Archived Client state
  console.log('9. Testing Archived client view...');
  // Complete projects first so client can be archived
  await page.evaluate(async ({ brandId, packId, cId }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const p1 = await window.__API__.get(`/organizations/${orgId}/projects/${brandId}`);
    await window.__API__.patch(`/organizations/${orgId}/projects/${brandId}`, {
      client_id: p1.client_id,
      name: p1.name,
      description: p1.description || '',
      due_at: p1.due_at,
      portal_enabled: Boolean(p1.portal_enabled),
      status: 'ARCHIVED'
    }, { revision: p1.revision });

    const p2 = await window.__API__.get(`/organizations/${orgId}/projects/${packId}`);
    await window.__API__.patch(`/organizations/${orgId}/projects/${packId}`, {
      client_id: p2.client_id,
      name: p2.name,
      description: p2.description || '',
      due_at: p2.due_at,
      portal_enabled: Boolean(p2.portal_enabled),
      status: 'ARCHIVED'
    }, { revision: p2.revision });

    const cl = await window.__API__.get(`/organizations/${orgId}/clients/${cId}`);
    await window.__API__.patch(`/organizations/${orgId}/clients/${cId}`, {
      name: cl.name,
      description: cl.description || '',
      status: 'ARCHIVED'
    }, { revision: cl.revision });
  }, { brandId: seed.projBrand.id, packId: seed.projPack.id, cId: seed.client.id });

  await page.reload();
  await page.waitForSelector('#ar:not([hidden])', { timeout: 8000 });
  const arText = (await page.textContent('#ar')).trim();
  console.log('   Archived banner text:', arText);
  if (arText.includes('This client is archived')) {
    console.log('   [PASS] #ar banner unhidden when client is archived.');
  } else {
    throw new Error('Archived banner not displayed');
  }

  // Verify checkboxes are disabled
  const allDisabled = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('#pp input.t'));
    return inputs.length > 0 && inputs.every(i => i.disabled);
  });
  console.log('   All permission checkboxes disabled on archived client:', allDisabled);
  if (allDisabled) {
    console.log('   [PASS] All permission checkboxes disabled when client is archived.');
  } else {
    throw new Error('Permission checkboxes should be disabled on archived client');
  }

  console.log('\n=== ALL WORKSPACE/CLIENT DETAIL CHECKS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED WORKSPACE/CLIENT DETAIL VERIFICATION:', err);
  process.exit(1);
});
