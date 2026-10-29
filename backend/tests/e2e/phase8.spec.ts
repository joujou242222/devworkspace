import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { image } from '../phase4/fixtures.mjs';
import { account, tenant, join, admin, password, mail } from '../phase2/helpers.mjs';

test.afterAll(async () => {
  await admin.end();
});
async function login(page: Page, email: string, target: string, secret = password) {
  await page.goto('/login?returnTo=' + encodeURIComponent(target));
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('https://localhost:8443' + target);
}

test('connected internal navigation, filters with back/reload, multiple organizations and keyboard document entry', async ({
  page,
}) => {
  test.setTimeout(180000);
  const owner = await account();
  const a = await tenant(owner, 'Phase8 first agency');
  const b = await tenant(owner, 'Phase8 second agency');
  const root = `/w/${a.organizationId}`;
  await login(page, owner.email, root + '/clients');
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue(a.principal.id);
  await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Sort', { exact: true }).locator('option[value="position"]'),
  ).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByLabel('Client name', { exact: true }).fill('Phase8 journey client');
  await page.getByRole('button', { name: 'Save clients', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Phase8 journey client' })).toBeVisible();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Phase8 journey client' });
  await page.getByLabel('Project name', { exact: true }).fill('Phase8 journey project');
  await page.getByLabel('Project status').selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await page.getByRole('link', { name: 'Phase8 journey project', exact: true }).click();
  const project = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(
    page.getByLabel('Sort', { exact: true }).locator('option[value="position"]'),
  ).toHaveCount(1);
  await expect(
    page.getByLabel('Sort', { exact: true }).locator('option[value="name"]'),
  ).toHaveCount(0);
  await page.getByLabel('Task title', { exact: true }).fill('Phase8 urgent task');
  await page.getByLabel('Priority', { exact: true }).last().selectOption('URGENT');
  await page.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Phase8 urgent task' })).toBeVisible();
  await page.getByLabel('Priority', { exact: true }).first().selectOption('URGENT');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/priority=URGENT/);
  await page.getByLabel('Priority', { exact: true }).first().selectOption('LOW');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Phase8 urgent task' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel('Priority', { exact: true }).first()).toHaveValue('URGENT');
  await expect(page.getByRole('link', { name: 'Phase8 urgent task' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Priority', { exact: true }).first()).toHaveValue('URGENT');
  // Every project module is reachable from the other modules, without an API/manual URL.
  for (const [link, ending] of [
    ['Files', '/files'],
    ['Reviews', '/reviews'],
    ['Discussions', '/discussions'],
    ['Activity', '/activity'],
    ['Milestones', '/milestones'],
    ['Team & access', '/access'],
    ['Deliverables', '/deliverables'],
  ] as const) {
    await page
      .getByRole('navigation', { name: 'Project', exact: true })
      .getByRole('link', { name: link, exact: true })
      .click();
    await expect(page).toHaveURL('https://localhost:8443' + project + ending);
    await expect(page.getByRole('navigation', { name: 'Project', exact: true })).toBeVisible();
  }
  await page
    .getByRole('navigation', { name: 'Project', exact: true })
    .getByRole('link', { name: 'Documents', exact: true })
    .click();
  await page.getByLabel('Create document title').fill('Phase8 connected document');
  await page.getByLabel('Destination project').selectOption(project.split('/').at(-1)!);
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document content', exact: true }).press('Tab');
  await page
    .getByRole('textbox', { name: 'Document content', exact: true })
    .fill('Phase8 persisted content');
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Document saved.' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Document content', exact: true }),
  ).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('link', { name: 'Discussions', exact: true }).click();
  await page.getByLabel('Create topic title').fill('Phase8 archived topic');
  await page.getByLabel('Create topic body').fill('Retained discussion history');
  await page.getByRole('button', { name: 'Create topic', exact: true }).click();
  await page.getByRole('link', { name: 'Phase8 archived topic', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Post reply', exact: true })).toHaveCount(0);
  await expect(page.getByText('Retained discussion history', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByLabel('Project filter').selectOption(project.split('/').at(-1)!);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Project filter')).toHaveValue(project.split('/').at(-1)!);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Organization', { exact: true }).selectOption(b.principal.id);
  await expect(page).toHaveURL(`https://localhost:8443/w/${b.organizationId}`);
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue(b.principal.id);
  await expect(page.getByRole('link', { name: 'Phase8 journey project', exact: true })).toHaveCount(
    0,
  );
  await page.goBack();
  await expect(page.getByLabel('Project filter')).toHaveValue(project.split('/').at(-1)!);
  await page.screenshot({ path: '.local/phase8/mobile-reports.png', fullPage: true });
  await page.getByRole('link', { name: 'My Tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await expect(page.getByLabel('Assignee filter', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Milestone', { exact: true })).toHaveCount(0);
});

test('review filters, portal navigation separation and account session revocation clear stale private views', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const internal = await browser.newContext({ ignoreHTTPSErrors: true });
  const external = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await internal.newPage(),
    client = await external.newPage();
  try {
    await login(page, f.owner.email, `/w/${f.org}/reviews`);
    await page.getByLabel('Exact version identifier').fill(f.version.id);
    await page.getByRole('button', { name: 'Apply review filters' }).click();
    await expect(page).toHaveURL(new RegExp('version_id=' + f.version.id));
    await page.reload();
    await expect(page.getByLabel('Exact version identifier')).toHaveValue(f.version.id);
    await login(client, f.approver2.email, `/portal/${f.org}/projects/${f.project}`);
    await expect(client.getByRole('link', { name: 'Internal workspace', exact: true })).toHaveCount(
      0,
    );
    await expect(client.locator(`a[href^="/w/${f.org}"]`)).toHaveCount(0);
    await client
      .getByRole('navigation', { name: 'Project', exact: true })
      .getByRole('link', { name: 'Client updates', exact: true })
      .click();
    await expect(client.getByLabel('Project filter')).toHaveValue(f.project);
    await client.reload();
    await expect(client.getByLabel('Project filter')).toHaveValue(f.project);
    await expect(client.getByRole('main')).toHaveCount(1);
    const other = await internal.newPage();
    await other.goto('/account');
    await expect(other.getByText('Signed in as ' + f.owner.email)).toBeVisible();
    await other.getByRole('button', { name: 'Revoke this session', exact: true }).click();
    await expect(other).toHaveURL(/\/login$/);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('alert').filter({ hasText: 'This session or resource' }),
    ).toContainText('no longer available');
    await expect(page.getByRole('heading', { name: 'Review Center', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Sign in again', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  } finally {
    await internal.close();
    await external.close();
  }
});

test('two client capacities in one organization persist through navigation and revoked project content disappears', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const owner = await account(),
    contact = await account();
  const t = await tenant(owner, 'Phase8 capacity agency');
  const create = async (path: string, body: unknown) => {
    const r = await owner.browser.request(t.path + path, 'POST', body, t.headers);
    expect(r.status).toBe(201);
    return r.json();
  };
  const fixtures = [];
  const consumed = new Set<string>();
  for (const name of ['First', 'Second']) {
    const c = await create('/clients', {
      name: name + ' client',
      description: '',
      status: 'ACTIVE',
    });
    const p = await create('/projects', {
      client_id: c.id,
      name: name + ' private project',
      description: '',
      status: 'ACTIVE',
      due_at: null,
      portal_enabled: true,
    });
    const person = await create(`/clients/${c.id}/contacts`, {
      name: name + ' contact',
      email: contact.email,
      status: 'ACTIVE',
    });
    await create(`/clients/${c.id}/contacts/${person.id}/invitations`, {
      project_id: p.id,
      role: 'REVIEWER',
    });
    let proof = await mail(contact.email, 'DevWorkspace client invitation');
    for (
      let attempt = 0;
      consumed.has(proof.searchParams.get('token')!) && attempt < 100;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      proof = await mail(contact.email, 'DevWorkspace client invitation');
    }
    expect(consumed.has(proof.searchParams.get('token')!)).toBe(false);
    consumed.add(proof.searchParams.get('token')!);
    const accepted = await contact.browser.request(
      '/api/v1/invitations/accept',
      'POST',
      { token: proof.searchParams.get('token') },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    expect(accepted.status).toBe(200);
    await contact.browser.login(contact.email);
    fixtures.push({ person, p });
  }
  const selected = fixtures[1]!;
  for (let n = 1; n <= 26; n++)
    await create(`/projects/${selected.p.id}/milestones`, {
      title: 'Portal milestone ' + n,
      due_at: null,
      status: 'OPEN',
      position: n,
    });
  const internal = await browser.newContext({ ignoreHTTPSErrors: true });
  const external = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await internal.newPage(),
    client = await external.newPage();
  try {
    await login(client, contact.email, `/portal/${t.organizationId}/projects`);
    await expect(client.getByRole('link', { name: /private project$/ }).first()).toBeVisible();
    await expect(client.getByLabel('Review status', { exact: true })).toHaveCount(0);
    await client.getByLabel('Acting capacity', { exact: true }).selectOption(selected.person.id);
    await client.getByRole('link', { name: selected.p.name, exact: true }).click();
    await expect(
      client.getByRole('listitem').filter({ hasText: 'Portal milestone 1 ·' }),
    ).toBeVisible();
    await client.getByRole('button', { name: 'Next milestones', exact: true }).click();
    await expect(
      client.getByRole('listitem').filter({ hasText: 'Portal milestone 26 ·' }),
    ).toBeVisible();
    await client.reload();
    await expect(
      client.getByRole('listitem').filter({ hasText: 'Portal milestone 26 ·' }),
    ).toBeVisible();

    await expect(client.getByRole('heading', { name: selected.p.name, exact: true })).toBeVisible();
    await client
      .getByRole('navigation', { name: 'Project', exact: true })
      .getByRole('link', { name: 'Client updates', exact: true })
      .click();
    await expect(client.getByLabel('Acting capacity', { exact: true })).toHaveValue(
      selected.person.id,
    );
    await client.reload();
    await expect(client.getByLabel('Acting capacity', { exact: true })).toHaveValue(
      selected.person.id,
    );
    await client.getByRole('link', { name: 'My projects', exact: true }).click();
    await client.getByRole('link', { name: selected.p.name, exact: true }).click();
    await login(page, owner.email, `/w/${t.organizationId}/projects/${selected.p.id}/access`);
    await page.getByRole('button', { name: 'Edit grant', exact: true }).click();
    await page.getByLabel('Grant status', { exact: true }).selectOption('REVOKED');
    await page.getByRole('button', { name: 'Save grants', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'REVOKED' })).toBeVisible();
    await client.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      client.getByRole('alert').filter({ hasText: 'This session or resource' }),
    ).toContainText('no longer available');
    await expect(client.getByRole('heading', { name: selected.p.name, exact: true })).toHaveCount(
      0,
    );
    await expect(client.getByRole('link', { name: fixtures[0]!.p.name, exact: true })).toHaveCount(
      0,
    );
  } finally {
    await internal.close();
    await external.close();
  }
});

test('remaining management controls persist task/milestone/client lifecycle, checklist removal and membership changes', async ({
  page,
}) => {
  test.setTimeout(180000);
  const owner = await account(),
    colleague = await account();
  const t = await tenant(owner, 'Phase8 lifecycle agency');
  const member = await join(owner, t, colleague);
  const create = async (path: string, body: unknown) => {
    const r = await owner.browser.request(t.path + path, 'POST', body, t.headers);
    expect(r.status).toBe(201);
    return r.json();
  };
  const c = await create('/clients', {
    name: 'Lifecycle client',
    description: '',
    status: 'ACTIVE',
  });
  const p = await create('/projects', {
    client_id: c.id,
    name: 'Lifecycle project',
    description: '',
    status: 'ACTIVE',
    due_at: null,
    portal_enabled: false,
  });
  const task = await create(`/projects/${p.id}/tasks`, {
    title: 'Lifecycle task',
    description: '',
    status: 'TODO',
    priority: 'NORMAL',
    due_at: null,
    position: 0,
    assignee_id: null,
    milestone_id: null,
  });
  const root = `/w/${t.organizationId}`,
    project = `${root}/projects/${p.id}`;
  await login(page, owner.email, project + '/access');
  await page.getByLabel('Organization member', { exact: true }).selectOption(member.principal.id);
  await page.getByLabel('Project role', { exact: true }).selectOption('MANAGER');
  await page.getByRole('button', { name: 'Save members', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'MANAGER' })).toBeVisible();
  const managerContext = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  try {
    const managerPage = await managerContext.newPage();
    await login(managerPage, colleague.email, project);
    await managerPage.getByLabel('Description', { exact: true }).fill('Saved by a project Manager');
    await managerPage.getByRole('button', { name: 'Save projects', exact: true }).click();
    await expect(
      managerPage.getByRole('status').filter({ hasText: 'Saved to the database' }),
    ).toBeVisible();
    await managerPage.reload();
    await expect(managerPage.getByLabel('Description', { exact: true })).toHaveValue(
      'Saved by a project Manager',
    );
  } finally {
    await managerContext.close();
  }
  await page.getByRole('link', { name: 'Milestones', exact: true }).click();
  await page.getByLabel('Milestone title').fill('Lifecycle milestone');
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByText('Lifecycle milestone', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByRole('link', { name: 'Lifecycle task', exact: true }).click();
  await page
    .getByLabel('Milestone', { exact: true })
    .selectOption({ label: 'Lifecycle milestone' });
  await page
    .getByLabel('Assignee (project participant)', { exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel('Order', { exact: true }).first().fill('3');
  await page.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await page.getByLabel('Checklist label', { exact: true }).fill('Remove after verification');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(page.getByLabel('Remove after verification', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove item', exact: true }).click();
  await expect(page.getByLabel('Remove after verification', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByLabel('Project status').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Finish or cancel outstanding tasks first' }),
  ).toBeVisible();
  await expect(page.getByLabel('Project status')).toHaveValue('COMPLETED');
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByRole('link', { name: 'Lifecycle task', exact: true }).click();
  await page.getByLabel('Task status').selectOption('DONE');
  await page.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await page.reload();
  await expect(page.getByLabel('Task status')).toHaveValue('DONE');
  await page.getByRole('link', { name: 'Milestones', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Lifecycle milestone', exact: true }).click();
  await page.getByLabel('Milestone status').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Lifecycle milestone' })).toContainText(
    'COMPLETED',
  );
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByLabel('Project status').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await expect(page.getByText(/^Status: COMPLETED\. Revision:/)).toBeVisible();
  await page.getByLabel('Project status').selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await expect(page.getByText(/^Status: ACTIVE\. Revision:/)).toBeVisible();
  await page.getByLabel('Project status').selectOption('ARCHIVED');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await expect(page.getByText(/^Status: ARCHIVED\. Revision:/)).toBeVisible();
  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await page.getByRole('link', { name: 'Lifecycle client', exact: true }).click();
  await page.getByLabel('Contact name', { exact: true }).fill('Lifecycle contact');
  await page
    .getByLabel('Contact email', { exact: true })
    .fill('lifecycle-' + crypto.randomUUID() + '@example.test');
  await page.getByRole('button', { name: 'Save contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
  await page.getByLabel('Contact status').selectOption('INACTIVE');
  await page.getByRole('button', { name: 'Save contacts', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Lifecycle contact' })).toContainText(
    'INACTIVE',
  );
  await page.getByLabel('Client status').selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Save clients', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  const membership = page.locator('form').filter({ hasText: colleague.email });
  await membership.locator('select[name="role"]').selectOption('ADMIN');
  await membership.getByRole('button', { name: 'Save membership', exact: true }).click();
  await expect(membership.locator('select[name="role"]')).toHaveValue('ADMIN');
  await membership.locator('select[name="status"]').selectOption('INACTIVE');
  await membership.getByRole('button', { name: 'Save membership', exact: true }).click();
  await expect(membership.locator('select[name="status"]')).toHaveValue('INACTIVE');
  // History and archived resources remain readable; no database rows or bytes are purged.
  await page.goto(project + '/tasks/' + task.id);
  await expect(page.getByRole('heading', { name: 'Task details', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await membership.locator('select[name="status"]').selectOption('ACTIVE');
  await membership.getByRole('button', { name: 'Save membership', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('New Owner', { exact: true }).selectOption(member.principal.id);
  await page.getByLabel('Confirm ownership transfer', { exact: true }).check();
  await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, owner.email, root + '/settings');
  await expect(page.getByText('Acting as ADMIN', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer ownership', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'My account', exact: true }).click();
  const nextPassword = password + crypto.randomUUID();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('New password', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Password changed; other sessions revoked.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, owner.email, '/account', nextPassword);
  await expect(page.getByText('Signed in as ' + owner.email)).toBeVisible();
});

test('offline upload retry, folder administration and optional task/version linkage complete through real controls', async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const owner = await account(),
    t = await tenant(owner, 'Phase8 upload agency');
  const create = async (path: string, body: unknown) => {
    const r = await owner.browser.request(t.path + path, 'POST', body, t.headers);
    expect(r.status).toBe(201);
    return r.json();
  };
  const c = await create('/clients', { name: 'Upload client', description: '', status: 'ACTIVE' });
  const p = await create('/projects', {
    client_id: c.id,
    name: 'Upload project',
    description: '',
    status: 'ACTIVE',
    due_at: null,
    portal_enabled: false,
  });
  const task = await create(`/projects/${p.id}/tasks`, {
    title: 'Linked upload task',
    description: '',
    status: 'TODO',
    priority: 'NORMAL',
    due_at: null,
    position: 0,
    assignee_id: null,
    milestone_id: null,
  });
  const root = `/w/${t.organizationId}/projects/${p.id}`;
  await login(page, owner.email, root + '/files');
  await page.getByLabel('Folder name', { exact: true }).fill('Empty folder');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  const folder = page.getByRole('form', { name: 'Manage folder Empty folder', exact: true });
  await folder.getByLabel('Rename folder Empty folder').fill('Renamed empty folder');
  await folder.getByRole('button', { name: 'Rename folder', exact: true }).click();
  const renamed = page.getByRole('form', {
    name: 'Manage folder Renamed empty folder',
    exact: true,
  });
  await expect(renamed).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await renamed.getByRole('button', { name: 'Remove empty folder', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await page
    .getByLabel('Project file', { exact: true })
    .setInputFiles({ name: 'phase8-retry.png', mimeType: 'image/png', buffer: await image() });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const upload = page.getByRole('form', { name: 'Upload file', exact: true });
  await expect(upload.getByRole('alert')).toBeVisible();
  expect(
    await page
      .getByLabel('Project file', { exact: true })
      .evaluate((e: HTMLInputElement) => e.files?.length),
  ).toBe(1);
  await context.setOffline(false);
  await upload.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Upload processing', exact: true })
      .getByText('READY', { exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await expect(page.getByRole('heading', { name: 'phase8-retry.png', exact: true })).toBeVisible();
  await page.getByLabel('Listing status').selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Save file listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'phase8-retry.png', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByRole('link', { name: 'Linked upload task', exact: true }).click();
  await page
    .getByRole('link', { name: 'Project deliverables and optional task link', exact: true })
    .click();
  await expect(page.getByLabel('Optional task ID')).toHaveValue(task.id);
  await page.getByLabel('Deliverable title', { exact: true }).fill('Linked immutable deliverable');
  await page.getByRole('button', { name: 'Create deliverable', exact: true }).click();
  const history = page.getByRole('region', { name: 'Version history', exact: true });
  await expect(history).toContainText('Task: ' + task.id);
  await page.getByLabel('Linked task ID', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save deliverable', exact: true }).click();
  await expect(history).toContainText('Task: Unlinked');
  await page.getByLabel('Ready source', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Prepare immutable version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download version 1', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download version 1', exact: true }).click();
  expect(await (await downloaded).failure()).toBeNull();
  await page.getByLabel('Deliverable status').selectOption('ARCHIVED');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save deliverable', exact: true }).click();
  await expect(
    history.getByRole('button', { name: 'Download version 1', exact: true }),
  ).toBeVisible();
});
