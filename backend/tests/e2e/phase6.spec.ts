import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { admin } from '../phase2/helpers.mjs';
test.afterAll(() => admin.end());
test('P14/P31: real realtime notifications, read state, preference effects, offline REST catch-up and portal isolation', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = JSON.parse(await readFile('.local/phase6-browser-fixture.json', 'utf8'));
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const portal = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  async function login(p: typeof page, email: string, path: string) {
    await p.goto('/login?returnTo=' + encodeURIComponent(path));
    await p.getByLabel('Email', { exact: true }).fill(email);
    await p.getByLabel('Password', { exact: true }).fill('Disposable-phase2-password-123!');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      p.getByRole('heading', { name: /Review Center|Client portal|Notifications/ }),
    ).toBeVisible();
  }
  const route = `/w/${f.org}/notifications`;
  async function task() {
    const csrf = await (await page.request.get('/api/v1/identity/csrf')).json();
    const response = await page.request.post(
      `/api/v1/organizations/${f.org}/projects/${f.project}/tasks`,
      {
        headers: {
          Origin: 'https://localhost:8443',
          'X-CSRF-Token': csrf.token,
          'X-Organization-Principal': f.principal,
        },
        data: {
          title: 'Browser notification ' + crypto.randomUUID(),
          description: 'Synthetic',
          priority: 'NORMAL',
          status: 'TODO',
          milestone_id: null,
          assignee_id: f.ownerPm,
          due_at: null,
          position: 0,
        },
      },
    );
    expect(response.status()).toBe(201);
    return response.json();
  }
  async function completed(id: string) {
    await expect
      .poll(
        async () => {
          const r = await admin.query(
            'SELECT d.completed_at FROM public.delivery d JOIN public.tenant_event e ON e.id=d.event_id WHERE e.organization_id=$1 AND e.target_id=$2 ORDER BY e.created_at DESC LIMIT 1',
            [f.org, id],
          );
          return !!r.rows[0]?.completed_at;
        },
        { timeout: 20000 },
      )
      .toBe(true);
  }
  try {
    await login(page, f.owner, route);
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Live updates connected' }),
    ).toBeVisible();
    const first = await task(),
      href = `/w/${f.org}/projects/${f.project}/tasks/${first.id}`;
    const row = page.getByRole('listitem').filter({ has: page.locator(`a[href="${href}"]`) });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Mark read', exact: true })).toHaveCount(0);
    await expect(row).toContainText('Read');
    await page.getByLabel('Notification state', { exact: true }).selectOption('false');
    await expect(row).toBeVisible();
    await page.reload();
    await page.getByLabel('Notification state', { exact: true }).selectOption('false');
    await expect(row).toBeVisible();
    await page.getByLabel('Notification state', { exact: true }).selectOption('');
    await expect(row).toBeVisible();
    await page.screenshot({ path: '.local/phase6-notifications.png', fullPage: true });
    await page
      .getByRole('button', { name: 'Mark all authorized notifications read', exact: true })
      .click();
    await page.getByLabel('Notification state', { exact: true }).selectOption('true');
    await expect(page.getByText('No authorized notifications.', { exact: true })).toBeVisible();
    await page.goto('/account');
    await expect(
      page.getByRole('heading', { name: 'In-app notification preferences', exact: true }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'Assignments', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save notification preferences', exact: true }).click();
    await expect(page.getByText('Notification preferences saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('checkbox', { name: 'Assignments', exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Review activity', exact: true }),
    ).toBeChecked();
    const suppressed = await task();
    await completed(suppressed.id);
    await page.goto(route);
    await expect(page.locator(`a[href$="/tasks/${suppressed.id}"]`)).toHaveCount(0);
    await page.goto('/account');
    await page.getByRole('checkbox', { name: 'Assignments', exact: true }).check();
    await page.getByRole('button', { name: 'Save notification preferences', exact: true }).click();
    await expect(page.getByText('Notification preferences saved.', { exact: true })).toBeVisible();
    await page.goto(route);
    await expect(page.locator(`a[href$="/tasks/${suppressed.id}"]`)).toHaveCount(0);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Reload notifications', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /fetch|network|unavailable/i }),
    ).toBeVisible();
    const catchup = await task();
    await completed(catchup.id);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Reload notifications', exact: true }).click();
    await expect(page.locator(`a[href$="/tasks/${catchup.id}"]`)).toBeVisible({ timeout: 15000 });
    const client = await portal.newPage();
    await login(client, f.contact, `/portal/${f.org}/notifications`);
    await expect(
      client.getByRole('heading', { name: 'Your notifications', exact: true }),
    ).toBeVisible();
    await expect(
      client.getByRole('link', { name: 'Review activity updated', exact: true }).first(),
    ).toBeVisible();
    await expect(client.locator('a[href*="/tasks/"]')).toHaveCount(0);
    await client.screenshot({ path: '.local/phase6-portal-notifications.png', fullPage: true });
  } finally {
    await context.setOffline(false);
    await context.close();
    await portal.close();
  }
});
