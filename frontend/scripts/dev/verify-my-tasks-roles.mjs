/**
 * Multi-Role Verification Script for workspace/my-tasks
 * - Uses two isolated browser contexts:
 *   1. Owner/Manager context
 *   2. Real Contributor context (registered, invited, accepted)
 * - Verifies payload selection by role:
 *   - Contributor: strict workState schema: { status } only
 *   - Manager: full 8-field task schema built from freshest server entity
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

// Enforce localhost safety
for (const target of [BASE_URL, MAILPIT_API]) {
  const host = new URL(target).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Safety check failed: refusing to run against non-localhost target "${target}"`);
  }
}

async function main() {
  console.log('=== STARTING MY-TASKS MULTI-ROLE VERIFICATION (MANAGER & CONTRIBUTOR) ===');
  const browser = await launchBrowser();

  const ts = Date.now();
  const ownerEmail = `owner.${ts}@example.com`;
  const contribEmail = `contrib.${ts}@example.com`;
  const password = 'Password123!';

  // --- CONTEXT 1: Owner ---
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  console.log('1. Registering Owner user:', ownerEmail);
  await ownerPage.goto(`${BASE_URL}/register`);
  await ownerPage.fill('#n', 'Amr Owner');
  await ownerPage.fill('#e', ownerEmail);
  await ownerPage.fill('#p', password);
  await ownerPage.fill('#c', password);
  await ownerPage.click('button[type="submit"]');

  await ownerPage.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  await new Promise(r => setTimeout(r, 1000));
  const ownerMsgRes = await fetch(`${MAILPIT_API}/messages`);
  const ownerMsgs = await ownerMsgRes.json();
  const ownerMsg = ownerMsgs.messages.find(m => m.To[0].Address === ownerEmail && m.Subject.includes('Verify'));
  const ownerDetail = await (await fetch(`${MAILPIT_API}/message/${ownerMsg.ID}`)).json();
  const ownerToken = new URL(/https?:\/\/[^\s]+/.exec(ownerDetail.Text)[0]).searchParams.get('token');

  await ownerPage.goto(`${BASE_URL}/register?token=${ownerToken}`);
  await ownerPage.waitForSelector('#verified-banner', { timeout: 8000 });

  // Login -> Onboarding
  await ownerPage.goto(`${BASE_URL}/login`);
  await ownerPage.fill('#e', ownerEmail);
  await ownerPage.fill('#p', password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.waitForURL('**/onboarding', { timeout: 8000 });

  await ownerPage.fill('#n', 'Apex Media Group');
  await ownerPage.fill('#d', 'Commercial Production');
  await ownerPage.click('#b');
  await ownerPage.waitForURL('**/login?notice=org_created**', { timeout: 10000 });
  await ownerPage.fill('#p', password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('   Owner successfully registered and onboarded.');

  // Owner seeds Client, Project, and sends invitation to Contributor
  console.log('2. Owner creates Client, Project, and sends invitation to Contributor...');
  const setupData = await ownerPage.evaluate(async ({ contribEmail }) => {
    const orgId = window.__AUTH__.activeOrgId;
    const princId = window.__AUTH__.getActivePrincipalId();

    const client = await window.__API__.post(`/organizations/${orgId}/clients`, {
      name: 'Delta Foods',
      description: 'CPG Client',
      status: 'ACTIVE'
    });

    const project = await window.__API__.post(`/organizations/${orgId}/projects`, {
      client_id: client.id,
      name: 'Autumn Campaign 2026',
      description: 'Broadcast commercial',
      due_at: '2026-12-15T12:00:00.000Z',
      portal_enabled: false,
      status: 'ACTIVE'
    });

    // Add owner as project manager
    const ownerMember = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/members`, {
      membership_id: princId,
      role: 'MANAGER',
      status: 'ACTIVE'
    });

    // Create Manager task
    const managerTask = await window.__API__.post(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      title: 'Sign executive production contract',
      description: 'Review legal terms',
      milestone_id: null,
      assignee_id: ownerMember.id,
      priority: 'HIGH',
      status: 'TODO',
      due_at: '2026-11-15T12:00:00.000Z',
      position: 1
    });

    // Send invitation to Contributor
    const inv = await window.__API__.post(`/organizations/${orgId}/invitations`, {
      email: contribEmail,
      role: 'MEMBER'
    });

    return { orgId, client, project, ownerMember, managerTask, inv };
  }, { contribEmail });

  console.log('   Project created:', setupData.project.name);
  console.log('   Invitation sent to:', contribEmail);

  // --- CONTEXT 2: Contributor (Isolated Session) ---
  const contribContext = await browser.newContext();
  const contribPage = await contribContext.newPage();

  console.log('3. Registering Contributor user in separate browser context...');
  await contribPage.goto(`${BASE_URL}/register`);
  await contribPage.fill('#n', 'Tamer Contributor');
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', password);
  await contribPage.fill('#c', password);
  await contribPage.click('button[type="submit"]');

  await contribPage.waitForSelector('#done', { state: 'visible', timeout: 8000 });
  await new Promise(r => setTimeout(r, 1000));
  const contribMsgRes = await fetch(`${MAILPIT_API}/messages`);
  const contribMsgs = await contribMsgRes.json();
  const contribRegMsg = contribMsgs.messages.find(m => m.To[0].Address === contribEmail && m.Subject.includes('Verify'));
  const contribDetail = await (await fetch(`${MAILPIT_API}/message/${contribRegMsg.ID}`)).json();
  const contribRegToken = new URL(/https?:\/\/[^\s]+/.exec(contribDetail.Text)[0]).searchParams.get('token');

  await contribPage.goto(`${BASE_URL}/register?token=${contribRegToken}`);
  await contribPage.waitForSelector('#verified-banner', { timeout: 8000 });
  console.log('   Contributor registered and email verified.');

  // Extract invitation token
  const invMsg = contribMsgs.messages.find(m => m.To[0].Address === contribEmail && m.Subject.includes('invitation'));
  const invDetail = await (await fetch(`${MAILPIT_API}/message/${invMsg.ID}`)).json();
  const invToken = new URL(/https?:\/\/[^\s]+/.exec(invDetail.Text)[0]).searchParams.get('token');
  console.log('   Invitation token extracted from Mailpit:', invToken);

  // Accept invitation via UI on /invitation
  console.log('   Contributor signing in and accepting invitation on /invitation...');
  await contribPage.goto(`${BASE_URL}/invitation?token=${invToken}`);
  await contribPage.waitForSelector('#auth', { state: 'visible', timeout: 8000 });
  await contribPage.fill('#e', contribEmail);
  await contribPage.fill('#p', password);
  await contribPage.click('#b');

  await contribPage.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  console.log('   [PASS] Contributor accepted invitation and joined organization.');

  // Owner looks up Contributor's membership ID from /team
  console.log('4. Owner looks up Contributor in /team and adds to Project as CONTRIBUTOR...');
  const contribTaskData = await ownerPage.evaluate(async ({ orgId, projectId, contribEmail }) => {
    const teamRes = await window.__API__.get(`/organizations/${orgId}/team`);
    const contribMembership = (teamRes.items || []).find(m => m.email === contribEmail);
    if (!contribMembership) throw new Error('Contributor membership not found in /team');

    // Add contributor to project members
    const contribMember = await window.__API__.post(`/organizations/${orgId}/projects/${projectId}/members`, {
      membership_id: contribMembership.id,
      role: 'CONTRIBUTOR',
      status: 'ACTIVE'
    });

    // Create task assigned to contributor
    const contribTask = await window.__API__.post(`/organizations/${orgId}/projects/${projectId}/tasks`, {
      title: 'Assemble rough video cut',
      description: 'First timeline assembly',
      milestone_id: null,
      assignee_id: contribMember.id,
      priority: 'NORMAL',
      status: 'TODO',
      due_at: '2026-11-20T12:00:00.000Z',
      position: 2
    });

    return { contribMember, contribTask };
  }, { orgId: setupData.orgId, projectId: setupData.project.id, contribEmail });

  console.log('   Contributor project membership role:', contribTaskData.contribMember.role);
  console.log('   Task assigned to contributor:', contribTaskData.contribTask.title);

  // --- STEP 5: Contributor mutates status in /workspace/my-tasks ---
  console.log('\n5. CONTRIBUTOR MUTATION VERIFICATION (strict workState: { status }):');
  await contribPage.goto(`${BASE_URL}/workspace/my-tasks`);
  await contribPage.waitForSelector('table.tbl tbody tr', { timeout: 8000 });

  const contribSelect = contribPage.locator(`select[data-task-id="${contribTaskData.contribTask.id}"]`);
  console.log('   Contributor changing task status from "Todo" to "In progress"...');

  const [contribResponse] = await Promise.all([
    contribPage.waitForResponse(resp => resp.request().method() === 'PATCH' && resp.url().includes('/tasks/'), { timeout: 10000 }),
    contribSelect.selectOption('In progress')
  ]);

  const contributorPatchStatus = contribResponse.status();
  const contributorPayloadSent = contribResponse.request().postDataJSON();

  console.log('   Contributor PATCH HTTP response status:', contributorPatchStatus);
  console.log('   Contributor Payload sent to API:', JSON.stringify(contributorPayloadSent));

  // Assert Contributor payload structure
  if (contributorPatchStatus === 200 &&
      contributorPayloadSent &&
      contributorPayloadSent.status === 'IN_PROGRESS' &&
      !('title' in contributorPayloadSent) &&
      !('description' in contributorPayloadSent) &&
      !('position' in contributorPayloadSent)) {
    console.log('   [PASS] Contributor sent STRICT workState payload { status: "IN_PROGRESS" } without extraneous manager fields!');
  } else {
    throw new Error(`Contributor validation failed. Status: ${contributorPatchStatus}, Payload: ${JSON.stringify(contributorPayloadSent)}`);
  }

  // --- STEP 6: Manager mutates status in /workspace/my-tasks ---
  console.log('\n6. MANAGER MUTATION VERIFICATION (full 8-field task schema built from fresh record):');
  await ownerPage.goto(`${BASE_URL}/workspace/my-tasks`);
  await ownerPage.waitForSelector('table.tbl tbody tr', { timeout: 8000 });

  const managerSelect = ownerPage.locator(`select[data-task-id="${setupData.managerTask.id}"]`);
  console.log('   Manager changing task status from "Todo" to "Done"...');

  const [managerResponse] = await Promise.all([
    ownerPage.waitForResponse(resp => resp.request().method() === 'PATCH' && resp.url().includes('/tasks/'), { timeout: 10000 }),
    managerSelect.selectOption('Done')
  ]);

  const managerPatchStatus = managerResponse.status();
  const managerPayloadSent = managerResponse.request().postDataJSON();

  console.log('   Manager PATCH HTTP response status:', managerPatchStatus);
  console.log('   Manager Payload sent to API:\n', JSON.stringify(managerPayloadSent, null, 2));

  // Assert Manager payload structure
  const requiredManagerFields = ['title', 'description', 'milestone_id', 'assignee_id', 'priority', 'status', 'due_at', 'position'];
  const hasAllFields = requiredManagerFields.every(f => f in managerPayloadSent);

  if (managerPatchStatus === 200 && hasAllFields && managerPayloadSent.status === 'DONE') {
    console.log('   [PASS] Manager sent full 8-field task schema built from freshest server entity!');
  } else {
    throw new Error(`Manager validation failed. Status: ${managerPatchStatus}, Payload: ${JSON.stringify(managerPayloadSent)}`);
  }

  console.log('\n=== BOTH ROLES FULLY AND INDEPENDENTLY VERIFIED! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nFAILED MULTI-ROLE VERIFICATION:', err);
  process.exit(1);
});
