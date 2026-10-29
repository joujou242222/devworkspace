import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('all seven expansion templates: discussion/activity, visual document formats/conflict, report/audit and published client feed', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const f = JSON.parse(await readFile('.local/phase7/browser.json', 'utf8'));
  const context = await browser.newContext({ ignoreHTTPSErrors: true }),
    external = await browser.newContext({ ignoreHTTPSErrors: true }),
    readOnly = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage(),
    client = await external.newPage(),
    viewer = await readOnly.newPage();
  async function login(p: Page, email: string, path: string) {
    await p.goto('/login?returnTo=' + encodeURIComponent(path));
    await p.getByLabel('Email', { exact: true }).fill(email);
    await p.getByLabel('Password', { exact: true }).fill('Disposable-phase2-password-123!');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p).toHaveURL(new RegExp(path + '$'));
  }
  const topicTitle = 'Browser discussion ' + crypto.randomUUID();
  const publishedBody = 'Browser published news ' + crypto.randomUUID();
  const root = `/w/${f.org}`,
    project = `${root}/projects/${f.project}`;
  try {
    await login(page, f.owner, project + '/discussions');
    await page.getByLabel('Create topic title').fill(topicTitle);
    await page.getByLabel('Create topic body').fill('Persistent browser topic');
    await page.getByRole('button', { name: 'Create topic', exact: true }).click();
    await page.getByRole('link', { name: topicTitle, exact: true }).click();
    await page.getByLabel('Post reply body').fill('Browser reply');
    await page.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Browser reply' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Browser reply' })).toBeVisible();
    await page.goto(root + '/documents');
    await page.getByLabel('Create document title').fill('Browser rich document');
    await page.getByLabel('Destination project').selectOption(f.project);
    await page.getByRole('button', { name: 'Create document', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Document content', exact: true });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.click();
    await page.getByRole('button', { name: 'Heading 2', exact: true }).click();
    await page.keyboard.type('Browser heading');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Paragraph', exact: true }).click();
    await page.keyboard.type('Combined marks');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.getByRole('button', { name: 'Italic', exact: true }).click();
    await page.getByLabel('Link URL').fill('https://example.test/docs');
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bulleted list', exact: true }).click();
    await page.keyboard.type('Bullet item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Numbered list', exact: true }).click();
    await page.keyboard.type('Number item');
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Document saved.' })).toBeVisible();
    const documentUrl = page.url();
    await page.reload();
    await expect(editor.locator('h2')).toContainText('Browser heading');
    await expect(editor.locator('strong').filter({ hasText: 'Combined marks' })).toContainText(
      'Combined marks',
    );
    await expect(editor.locator('em').filter({ hasText: 'Combined marks' })).toContainText(
      'Combined marks',
    );
    await expect(editor.locator('a').filter({ hasText: 'Combined marks' })).toHaveAttribute(
      'href',
      'https://example.test/docs',
    );
    await expect(editor.locator('ul')).toContainText('Bullet item');
    await expect(editor.locator('ol')).toContainText('Number item');
    await page.screenshot({ path: '.local/phase7/browser-editor.png', fullPage: true });
    await page.getByLabel('Link URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'HTTP(S)' })).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+End');
    await editor.evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.setData('text/html', '<img src=x onerror=alert(1)><script>evil()</script>');
      transfer.setData('text/plain', 'Safe pasted text');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(editor).toContainText('Safe pasted text');
    await editor.evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.setData('text/html', '<img src=x onerror=alert(1)>');
      transfer.setData('text/plain', 'Safe dropped text');
      el.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(editor).toContainText('Safe dropped text');
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Document saved.' })).toBeVisible();
    await expect(editor.locator('script,img')).toHaveCount(0);
    const other = await context.newPage();
    await other.goto(documentUrl);
    await expect(other.getByLabel('Document title')).toHaveValue('Browser rich document');
    await page.getByLabel('Document title').fill('First browser save');
    await other.getByLabel('Document title').fill('Retained conflicting draft');
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Document saved.' })).toBeVisible();
    await other.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(other.getByRole('alert').filter({ hasText: /changed/ })).toBeVisible();
    await expect(other.getByLabel('Document title')).toHaveValue('Retained conflicting draft');
    await other.getByRole('button', { name: 'Use latest revision and keep my draft' }).click();
    await other.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(other.getByRole('status').filter({ hasText: 'Document saved.' })).toBeVisible();
    await other.close();
    await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
    await expect(page.getByLabel('Document title')).toHaveValue('Retained conflicting draft');
    await page.getByLabel('Document title').fill('Unsaved draft to discard');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
    await expect(page.getByLabel('Document title')).toHaveValue('Retained conflicting draft');
    await login(viewer, f.viewer.email, new URL(documentUrl).pathname);
    await expect(viewer.getByRole('textbox', { name: 'Document content' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
    await expect(viewer.getByRole('button', { name: 'Save document', exact: true })).toHaveCount(0);
    await page.goto(project + '/activity');
    await expect(
      page.getByText('Project lifecycle activity', { exact: false }).first(),
    ).toBeVisible();
    await page.getByLabel('Action filter').fill('document.saved');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('listitem').first()).toContainText('document.saved');
    await page.goto(root + '/reports');
    await expect(page.getByRole('table')).toContainText('Noncancelled tasks');
    await page.getByLabel('Project filter').selectOption(f.project);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('table')).toContainText('50.0%');
    await page.goto(root + '/audit');
    await page.getByLabel('Action filter').fill('document.created');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'document.created' }).first(),
    ).toBeVisible();
    await viewer.goto(root + '/audit');
    await expect(viewer.getByRole('alert').filter({ hasText: /permission/ })).toBeVisible();
    await page.goto(project);
    await page.getByLabel('Publish client update body').fill(publishedBody);
    await page.getByRole('button', { name: 'Publish client update', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: publishedBody })).toBeVisible();
    await login(client, f.client.email, `/portal/${f.org}/updates`);
    await client.goto(`/portal/${f.org}/projects/${f.project}`);
    await client.getByRole('link', { name: 'Client updates', exact: true }).click();
    await expect(client).toHaveURL(
      `https://localhost:8443/portal/${f.org}/updates?projectId=${f.project}`,
    );
    await expect(client.getByLabel('Project filter')).toHaveValue(f.project);
    await expect(client.getByRole('listitem').filter({ hasText: publishedBody })).toBeVisible();
    await client.getByLabel('Project filter').selectOption(f.project);
    await client.getByRole('button', { name: 'Apply filters' }).click();
    await expect(client.getByRole('listitem').filter({ hasText: publishedBody })).toBeVisible();
    await page
      .getByRole('listitem')
      .filter({ hasText: publishedBody })
      .getByRole('button', { name: 'Withdraw update' })
      .click();
    await client.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await expect(client.getByRole('listitem').filter({ hasText: publishedBody })).toHaveCount(0);
    await page.goto('/account');
    await page.getByLabel('Discussions and documents', { exact: true }).uncheck();
    await page.getByLabel('Client updates', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save notification preferences' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Notification preferences saved.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Discussions and documents', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Client updates', { exact: true })).not.toBeChecked();
    await page.screenshot({ path: '.local/phase7/browser-account.png' });
    await client.screenshot({ path: '.local/phase7/browser-client.png' });
  } finally {
    await context.close();
    await external.close();
    await readOnly.close();
  }
});
