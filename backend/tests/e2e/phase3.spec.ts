import { test, expect } from '@playwright/test';
import { account, tenant, admin, password, mail } from '../phase2/helpers.mjs';
test.afterAll(async () => {
  await admin.end();
});
test('P08–P12/P16–P19/P23: persistent client, project, milestone, task, checklist, threads and access', async ({
  page,
}) => {
  test.setTimeout(90000);
  const owner = await account();
  const t = await tenant(owner, 'Browser core agency');
  const root = '/w/' + t.organizationId;
  await page.goto('/login?returnTo=' + encodeURIComponent(root + '/clients'));
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'clients', exact: true })).toBeVisible();
  await page.getByLabel('Client name', { exact: true }).fill('Browser persistent client');
  await page.getByRole('button', { name: 'Save clients', exact: true }).click();
  await page.getByRole('link', { name: 'Browser persistent client', exact: true }).click();
  await page.getByLabel('Contact name', { exact: true }).fill('Browser contact');
  const contactEmail = 'contact-' + crypto.randomUUID() + '@example.test';
  await page.getByLabel('Contact email', { exact: true }).fill(contactEmail);
  await page.getByRole('button', { name: 'Save contacts', exact: true }).click();
  await expect(page.getByText('Browser contact', { exact: false }).first()).toBeVisible();
  await page.goto(root + '/projects');
  await page
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Browser persistent client' });
  await page.getByLabel('Project name', { exact: true }).fill('Browser persistent project');
  await page.getByLabel('Project status', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Save projects', exact: true }).click();
  await page.getByRole('link', { name: 'Browser persistent project', exact: true }).click();
  const projectUrl = page.url();
  await expect(page.getByText('Progress: No tasks', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Milestones', exact: true }).click();
  await page.getByLabel('Milestone title', { exact: true }).fill('Browser milestone');
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByText('Browser milestone', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Browser task');
  await page
    .getByLabel('Milestone', { exact: true })
    .last()
    .selectOption({ label: 'Browser milestone' });
  await page.getByLabel('Priority', { exact: true }).last().selectOption('URGENT');
  await page.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Browser task', exact: true })).toBeVisible();
  await page.getByLabel('Priority', { exact: true }).first().selectOption('URGENT');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/priority=URGENT/);
  await page.reload();
  await expect(page.getByLabel('Priority', { exact: true }).first()).toHaveValue('URGENT');
  await page.getByRole('link', { name: 'Browser task', exact: true }).click();
  await page.getByLabel('Checklist label', { exact: true }).fill('Browser check item');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await page.getByLabel('Browser check item', { exact: true }).check();
  await expect(page.getByText('1/1 checked', { exact: false })).toBeVisible();
  await page.getByLabel('Comment', { exact: true }).fill('Browser internal thread');
  await page.getByRole('button', { name: 'Post internal comment', exact: true }).click();
  await expect(page.getByText('Browser internal thread', { exact: false }).first()).toBeVisible();
  await page
    .getByLabel('Reply to', { exact: true })
    .selectOption({ label: 'Browser internal thread' });
  await page.getByLabel('Comment', { exact: true }).fill('Browser reply');
  await page.getByRole('button', { name: 'Post internal comment', exact: true }).click();
  await expect(page.getByText('Reply: Browser reply', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Priority', { exact: true })).toHaveValue('URGENT');
  await expect(page.getByLabel('Browser check item', { exact: true })).toBeChecked();
  await expect(page.getByText('tasks.created', { exact: false })).toBeVisible();
  const stale = await page.context().newPage();
  await stale.goto(page.url());
  await stale.getByLabel('Task title', { exact: true }).fill('Unsaved retained title');
  await page.getByLabel('Description', { exact: true }).fill('Saved concurrent metadata');
  await page.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to the database');
  await stale.getByRole('button', { name: 'Save tasks', exact: true }).click();
  await expect(stale.getByRole('main').getByRole('alert')).toContainText('changed');
  await expect(stale.getByLabel('Task title', { exact: true })).toHaveValue(
    'Unsaved retained title',
  );
  await stale.getByRole('button', { name: 'Reload current data', exact: true }).click();
  await expect(stale.getByLabel('Description', { exact: true })).toHaveValue(
    'Saved concurrent metadata',
  );
  await stale.close();
  await page.goto(projectUrl + '/access');
  await page.getByLabel('Organization member', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Project role', { exact: true }).selectOption('MANAGER');
  await page.getByRole('button', { name: 'Save members', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'MANAGER' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await page.getByRole('link', { name: 'Browser persistent client', exact: true }).click();
  await page
    .getByLabel('Invitation project', { exact: true })
    .selectOption({ label: 'Browser persistent project' });
  await page.getByRole('button', { name: 'Invite contact', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Revoke client invitation', exact: true }),
  ).toBeVisible();
  await mail(contactEmail, 'DevWorkspace client invitation');
  await page.getByRole('button', { name: 'Revoke client invitation', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'REVOKED' })).toBeVisible();
  await page.goto(root + '/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await page.goto(root);
  await expect(
    page.getByRole('link', { name: 'Browser persistent project', exact: true }),
  ).toBeVisible();
});

test('Contributor and Viewer task interfaces and explicit client invitation capacity remain isolated', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const { join } = await import('../phase2/helpers.mjs');
  const owner = await account();
  const t = await tenant(owner, 'Browser role agency');
  const contributor = await account();
  const participant = await join(owner, t, contributor);
  const viewer = await account();
  const readOnly = await join(owner, t, viewer);
  const external = await account();
  const create = async (path: string, body: unknown) => {
    const r = await owner.browser.request(t.path + path, 'POST', body, t.headers);
    expect(r.status).toBe(201);
    return r.json();
  };
  const client = await create('/clients', {
    name: 'Browser client scope',
    description: '',
    status: 'ACTIVE',
  });
  const project = await create('/projects', {
    client_id: client.id,
    name: 'Browser scoped project',
    description: '',
    status: 'ACTIVE',
    portal_enabled: true,
    due_at: null,
  });
  const base = '/projects/' + project.id;
  const pm = await create(base + '/members', {
    membership_id: participant.principal.id,
    role: 'CONTRIBUTOR',
    status: 'ACTIVE',
  });
  await create(base + '/members', {
    membership_id: readOnly.principal.id,
    role: 'VIEWER',
    status: 'ACTIVE',
  });
  const task = await create(base + '/tasks', {
    title: 'Browser assigned work',
    description: '',
    milestone_id: null,
    assignee_id: pm.id,
    priority: 'HIGH',
    status: 'TODO',
    due_at: null,
    position: 0,
  });
  await create(base + '/tasks/' + task.id + '/checklist', {
    label: 'Contributor check',
    position: 0,
    completed: false,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const taskUrl = `/w/${t.organizationId}/projects/${project.id}/tasks/${task.id}`;
  const login = async (email: string, path: string) => {
    await page.goto('https://localhost:8443/login?returnTo=' + encodeURIComponent(path));
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('https://localhost:8443' + path);
  };
  try {
    await login(contributor.email, taskUrl);
    await expect(page.getByRole('heading', { name: 'Task details', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save tasks', exact: true })).toHaveCount(0);
    await page.getByLabel('Work status', { exact: true }).selectOption('IN_PROGRESS');
    await page.getByRole('button', { name: 'Update work status', exact: true }).click();
    await expect(page.getByText('Status: IN_PROGRESS.', { exact: false })).toBeVisible();
    await page.getByLabel('Contributor check', { exact: true }).check();
    await expect(page.getByText('1/1 checked', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(viewer.email, taskUrl);
    await expect(page.getByLabel('Contributor check', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Update work status', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Post internal comment', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const contact = await create('/clients/' + client.id + '/contacts', {
      name: 'Browser external identity',
      email: external.email,
      status: 'ACTIVE',
    });
    await create(`/clients/${client.id}/contacts/${contact.id}/invitations`, {
      project_id: project.id,
      role: 'REVIEWER',
    });
    const link = await mail(external.email, 'DevWorkspace client invitation');
    await login(external.email, '/account');
    await page.goto(link.href);
    await page.getByRole('button', { name: 'Review invitation', exact: true }).click();
    await expect(page.getByText('Browser role agency — CLIENT, REVIEWER')).toBeVisible();
    await expect(
      page.getByText('Client: Browser client scope; project: Browser scoped project.', {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Accept client project access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Client portal', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Browser scoped project', exact: true }),
    ).toBeVisible();
    await page.goto(taskUrl);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Organization access unavailable',
    );
  } finally {
    await context.close();
  }
});
