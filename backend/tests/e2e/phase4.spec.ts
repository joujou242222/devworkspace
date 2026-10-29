import { test, expect } from '@playwright/test';
import { account, tenant, admin, password } from '../phase2/helpers.mjs';
import { image, hash } from '../phase4/fixtures.mjs';
test.afterAll(async () => {
  await admin.end();
});
test('P21/P22: real quarantined upload, folder, preview/download and immutable version persist in browser', async ({
  page,
}) => {
  test.setTimeout(180000);
  const owner = await account();
  const t = await tenant(owner, 'Browser files agency');
  const req = async (p: string, b: object) => {
    const r = await owner.browser.request(t.path + p, 'POST', b, t.headers);
    expect(r.status).toBe(201);
    return r.json();
  };
  const client = await req('/clients', {
    name: 'Browser files client',
    description: 'Synthetic',
    status: 'ACTIVE',
  });
  const project = await req('/projects', {
    client_id: client.id,
    name: 'Browser files project',
    description: 'Synthetic',
    status: 'ACTIVE',
    portal_enabled: false,
    due_at: null,
  });
  const root = '/w/' + t.organizationId + '/projects/' + project.id;
  await page.goto('/login?returnTo=' + encodeURIComponent(root + '/files'));
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Project files — Browser files project', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Folder name', { exact: true }).fill('Browser folder');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(
    page.getByRole('option', { name: 'Browser folder', exact: true }).first(),
  ).toBeAttached();
  const bytes = await image();
  await page.getByLabel('Project file', { exact: true }).setInputFiles({
    name: 'blocked.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<html>blocked</html>'),
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'Upload file', exact: true }).getByRole('alert'),
  ).toContainText(/PNG|JPEG|PDF/i);
  await page
    .getByLabel('Project file', { exact: true })
    .setInputFiles({ name: 'browser.png', mimeType: 'image/png', buffer: bytes });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Upload processing' }).getByText('READY', { exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await expect(page.getByRole('heading', { name: 'browser.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Verified file preview', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const stale = await page.context().newPage();
  await stale.goto(root + '/files');
  await stale.getByLabel('File title', { exact: true }).fill('Unsaved retained file');
  await page.getByLabel('File title', { exact: true }).fill('Browser renamed file');
  await page.getByRole('button', { name: 'Save file listing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser renamed file', exact: true }),
  ).toBeVisible();
  await stale.getByRole('button', { name: 'Save file listing', exact: true }).click();
  await expect(stale.getByRole('alert').filter({ hasText: /changed/i })).toBeVisible();
  await expect(stale.getByLabel('File title', { exact: true })).toHaveValue(
    'Unsaved retained file',
  );
  await stale.close();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Browser renamed file', exact: true }),
  ).toBeVisible();
  const folderRows = (
    await owner.browser.request(
      t.path + '/projects/' + project.id + '/folders',
      'GET',
      undefined,
      t.headers,
    )
  ).json().items;
  const folderId = folderRows.find((f: { name: string }) => f.name === 'Browser folder').id;
  await page.getByLabel('Move to folder', { exact: true }).selectOption(folderId);
  await page.getByRole('button', { name: 'Save file listing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser renamed file', exact: true }),
  ).toBeHidden();
  await page.getByLabel('Folder', { exact: true }).selectOption(folderId);
  await expect(
    page.getByRole('heading', { name: 'Browser renamed file', exact: true }),
  ).toBeVisible();
  const numericId = BigInt('0x' + folderId.replaceAll('-', ''));
  const earlier = Array.from({ length: 100 }, (_, i) => {
    const h = (numericId - BigInt(i + 1)).toString(16).padStart(32, '0');
    return (
      h.slice(0, 8) +
      '-' +
      h.slice(8, 12) +
      '-' +
      h.slice(12, 16) +
      '-' +
      h.slice(16, 20) +
      '-' +
      h.slice(20)
    );
  });
  await admin.query(
    "INSERT INTO public.project_folder(id,organization_id,project_id,name,position) SELECT x::uuid,$2::uuid,$3::uuid,'Pagination folder '||n::text,0 FROM unnest($1::text[]) WITH ORDINALITY AS s(x,n)",
    [earlier, t.organizationId, project.id],
  );
  await page.getByRole('button', { name: 'Reload current data', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Selected folder', exact: true })).toBeAttached();
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue(folderId);
  await expect(page.getByLabel('Move to folder', { exact: true })).toHaveValue(folderId);
  await page.getByLabel('File title', { exact: true }).fill('Browser paged folder file');
  await page.getByRole('button', { name: 'Save file listing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser paged folder file', exact: true }),
  ).toBeVisible();
  const persisted = (
    await owner.browser.request(
      t.path + '/projects/' + project.id + '/files',
      'GET',
      undefined,
      t.headers,
    )
  )
    .json()
    .items.find((f: { title: string }) => f.title === 'Browser paged folder file');
  expect(persisted.folder_id).toBe(folderId);
  await page.getByRole('link', { name: 'Deliverables', exact: true }).click();
  await page.getByLabel('Deliverable title', { exact: true }).fill('Browser deliverable');
  await page.getByRole('button', { name: 'Create deliverable', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Version history — Browser deliverable', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Ready source', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Prepare immutable version', exact: true }).click();
  await expect(page.getByText(hash(bytes), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download version 1', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open version history', exact: true }).click();
  await expect(page.getByText(hash(bytes), { exact: true })).toBeVisible();
});
test('P31: own image uploads, explicit attachment and removal use real private processing', async ({
  page,
}) => {
  test.setTimeout(180000);
  const owner = await account();
  await page.goto('/login?returnTo=%2Faccount');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const region = page.getByRole('region', { name: 'Profile image', exact: true });
  await expect(region).toBeVisible();
  await region
    .getByLabel('Image file', { exact: true })
    .setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer: await image() });
  await region.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Use ready image', exact: true })).toBeVisible({
    timeout: 100000,
  });
  await region.getByRole('button', { name: 'Use ready image', exact: true }).click();
  await expect(region.getByRole('img', { name: 'Profile image', exact: true })).toBeVisible();
  await page.reload();
  await expect(region.getByRole('img', { name: 'Profile image', exact: true })).toBeVisible();
  await region.getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(region.getByText('No available image.', { exact: true })).toBeVisible();
});

test('P29: organization owner attaches a processed logo that survives reload and can be removed', async ({
  page,
}) => {
  test.setTimeout(180000);
  const owner = await account();
  const t = await tenant(owner, 'Browser logo agency');
  await page.goto('/login?returnTo=' + encodeURIComponent('/w/' + t.organizationId + '/settings'));
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const region = page.getByRole('region', { name: 'Organization logo', exact: true });
  await expect(region).toBeVisible();
  await region.getByLabel('Image file', { exact: true }).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await image(),
  });
  await region.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Use ready image', exact: true })).toBeVisible({
    timeout: 100000,
  });
  await region.getByRole('button', { name: 'Use ready image', exact: true }).click();
  await expect(region.getByRole('img', { name: 'Organization logo', exact: true })).toBeVisible();
  await page.reload();
  await expect(region.getByRole('img', { name: 'Organization logo', exact: true })).toBeVisible();
  await region.getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(region.getByText('No available image.', { exact: true })).toBeVisible();
});
