import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { image } from '../phase4/fixtures.mjs';
// These are retained synthetic records produced by test:phase5 against real services.
test('P25/P26/P32-P35: real image/PDF pins through zoom/rotation, internal conversion and exact-version decision', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const pdf = JSON.parse(await readFile('.local/phase5-browser-pdf.json', 'utf8'));
  const password = 'Disposable-phase2-password-123!';
  const imageBody = 'Browser image anchored feedback ' + crypto.randomUUID();
  const pdfBody = 'Browser page two anchored feedback ' + crypto.randomUUID();
  const contexts = [];
  async function login(email: string, path: string) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto('/login?returnTo=' + encodeURIComponent(path));
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Client portal|Review Center/ })).toBeVisible();
    return page;
  }
  try {
    const internal = await login(f.owner.email, `/w/${f.org}/projects/${f.project}/reviews`);
    const imageReview = internal.getByRole('link', {
      name: 'OPEN: exact version ' + f.version.id,
      exact: true,
    });
    await expect(internal.getByLabel('Target version', { exact: true })).toBeVisible();
    if ((await imageReview.count()) === 0) {
      await internal.getByLabel('Target version', { exact: true }).selectOption(f.version.id);
      await internal.getByLabel(new RegExp(f.approver2.id)).check();
      await internal.getByRole('button', { name: 'Open review', exact: true }).click();
    }
    await imageReview.click();
    await expect(
      internal.getByRole('img', { name: 'Exact review preview page 1', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        internal
          .getByRole('img', { name: 'Exact review preview page 1', exact: true })
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await internal
      .locator('[aria-label="Annotation surface"]')
      .click({ position: { x: 20, y: 40 } });
    const ix = await internal.getByLabel('X', { exact: true }).inputValue(),
      iy = await internal.getByLabel('Y', { exact: true }).inputValue();
    await internal.getByLabel('Feedback', { exact: true }).fill(imageBody);
    await internal.getByRole('button', { name: 'Save feedback', exact: true }).click();
    await expect(internal.getByRole('article').filter({ hasText: imageBody })).toBeVisible();
    await internal.getByLabel('Zoom', { exact: true }).fill('2');
    await internal.getByRole('button', { name: 'Rotate 0°', exact: true }).click();
    await internal.reload();
    await expect(
      internal
        .getByRole('article')
        .filter({ hasText: imageBody })
        .getByText(`IMAGE_PIN ${Number(ix).toFixed(3)}, ${Number(iy).toFixed(3)}`, {
          exact: false,
        }),
    ).toBeVisible();
    await internal.screenshot({ path: '.local/phase5-image-annotation.png', fullPage: true });
    const imageCycle = new URL(internal.url()).pathname.split('/').at(-1);
    const imageApprover = await login(
      f.approver2.email,
      `/portal/${f.org}/projects/${f.project}/reviews/${imageCycle}`,
    );
    const api = `/api/v1/organizations/${f.org}/projects/${f.project}`;
    const headers = { 'X-Organization-Principal': f.principal };
    const d = await (
      await internal.request.get(api + '/deliverables/' + f.version.deliverable_id, { headers })
    ).json();
    const csrf = await (await internal.request.get('/api/v1/identity/csrf')).json();
    const title = 'Browser replacement ' + crypto.randomUUID();
    const renamed = await internal.request.patch(api + '/deliverables/' + d.id, {
      headers: {
        ...headers,
        'X-CSRF-Token': csrf.token,
        Origin: 'https://localhost:8443',
        'If-Match': `"${d.revision}"`,
      },
      data: { title, description: d.description, task_id: d.task_id, status: d.status },
    });
    expect(renamed.status()).toBe(200);
    await internal.goto(`/w/${f.org}/projects/${f.project}/deliverables`);
    await internal
      .getByRole('listitem')
      .filter({ has: internal.getByRole('heading', { name: title, exact: true }) })
      .getByRole('button', { name: 'Open version history', exact: true })
      .click();
    const filename = 'browser-replacement-' + crypto.randomUUID() + '.png';
    await internal.getByLabel('Project file', { exact: true }).setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: await image('png', '#705090'),
    });
    await internal.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(
      internal
        .getByRole('region', { name: 'Upload processing' })
        .getByRole('listitem')
        .filter({ hasText: filename })
        .getByText('READY', { exact: true }),
    ).toBeVisible({ timeout: 100000 });
    const option = internal
      .getByLabel('Ready source', { exact: true })
      .getByRole('option')
      .filter({ hasText: filename });
    await internal
      .getByLabel('Ready source', { exact: true })
      .selectOption((await option.getAttribute('value'))!);
    const prepared = internal.waitForResponse(
      (r) => r.url().endsWith(`/deliverables/${d.id}/versions`) && r.request().method() === 'POST',
    );
    await internal.getByRole('button', { name: 'Prepare immutable version', exact: true }).click();
    const preparedResponse = await prepared;
    expect(preparedResponse.status()).toBe(201);
    const next = await preparedResponse.json();
    // Preparing N+1 does not move the old review or invalidate the client's screen.
    await imageApprover.reload();
    await expect(imageApprover.getByRole('heading', { name: /Cycle .*OPEN/ })).toBeVisible();
    await internal.goto(`/w/${f.org}/projects/${f.project}/reviews/${imageCycle}`);
    await internal
      .getByText('Shared version history and review management', { exact: true })
      .click();
    const nextRow = internal
      .getByRole('listitem')
      .filter({ hasText: `${title}: version ${next.version_number} (PRIVATE)` });
    await nextRow.getByRole('button', { name: 'Share version', exact: true }).click();
    await internal.getByLabel('Target version', { exact: true }).selectOption(next.id);
    await internal.getByLabel(new RegExp(f.approver2.id)).check();
    await internal.getByRole('button', { name: 'Replace active review', exact: true }).click();
    await expect(internal.getByRole('heading', { name: /Cycle .*SUPERSEDED/ })).toBeVisible();
    await expect(
      internal.getByRole('button', { name: 'Replace active review', exact: true }),
    ).toHaveCount(0);
    // A stale decision must fail against the old revision and preserve its old feedback.
    await imageApprover.getByLabel(/I confirm version/).check();
    await imageApprover.getByRole('button', { name: 'Approve exact version', exact: true }).click();
    await expect(imageApprover.getByRole('alert')).toBeVisible();
    await imageApprover.reload();
    await expect(imageApprover.getByRole('heading', { name: /Cycle .*SUPERSEDED/ })).toBeVisible();
    await expect(imageApprover.getByRole('article').filter({ hasText: imageBody })).toBeVisible();
    const management = internal.locator('details').filter({
      has: internal.getByText('Shared version history and review management', { exact: true }),
    });
    if ((await management.getAttribute('open')) === null)
      await management
        .getByText('Shared version history and review management', { exact: true })
        .click();
    await internal
      .getByRole('listitem')
      .filter({ hasText: `${title}: version ${next.version_number} (ACTIVE)` })
      .getByRole('link', { name: 'Exact-version review: OPEN', exact: true })
      .click();
    const nextCycle = new URL(internal.url()).pathname.split('/').at(-1);
    await imageApprover.goto(`/portal/${f.org}/projects/${f.project}/reviews/${nextCycle}`);
    await expect(imageApprover.getByRole('article').filter({ hasText: imageBody })).toHaveCount(0);
    await imageApprover.getByLabel(/I confirm version/).check();
    await imageApprover.getByRole('button', { name: 'Approve exact version', exact: true }).click();
    await expect(imageApprover.getByRole('heading', { name: /Cycle .*APPROVED/ })).toBeVisible();
    await expect(
      imageApprover.getByRole('button', { name: 'Approve exact version', exact: true }),
    ).toHaveCount(0);
    // Browser runs consume their own review cycle. Keep that immutable decision and
    // explicitly prepare another cycle on this still-unapproved PDF version on rerun.
    const pdfState = await internal.request.get(api + '/reviews/' + pdf.cycle, { headers });
    expect(pdfState.status()).toBe(200);
    if ((await pdfState.json()).status === 'CHANGES_REQUESTED') {
      const active = await internal.request.get(
        api + `/reviews?status=OPEN&version_id=${pdf.version.id}`,
        { headers },
      );
      expect(active.status()).toBe(200);
      const cycles = (await active.json()).items;
      expect(cycles.length).toBeLessThanOrEqual(1);
      if (cycles.length) pdf.cycle = cycles[0].id;
      else {
        const secure = await (await internal.request.get('/api/v1/identity/csrf')).json();
        const opened = await internal.request.post(api + '/reviews', {
          headers: {
            ...headers,
            'X-CSRF-Token': secure.token,
            Origin: 'https://localhost:8443',
            'Idempotency-Key': crypto.randomUUID(),
          },
          data: {
            version_id: pdf.version.id,
            digest: pdf.version.digest,
            approver_ids: [f.approver2.id],
            due_at: null,
          },
        });
        expect(opened.status()).toBe(201);
        pdf.cycle = (await opened.json()).id;
      }
    }
    await internal.goto(`/w/${f.org}/projects/${f.project}/reviews/${pdf.cycle}`);
    await expect(internal.getByRole('heading', { name: /Cycle .*OPEN/ })).toBeVisible();
    const page = await login(
      f.reviewer.email,
      `/portal/${f.org}/projects/${f.project}/reviews/${pdf.cycle}`,
    );
    await expect(page.getByRole('img', { name: 'Exact review preview page 1' })).toBeVisible();
    await page.getByLabel('Page', { exact: true }).selectOption('2');
    await expect(page.getByRole('img', { name: 'Exact review preview page 2' })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Exact review preview page 2', exact: true })
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByLabel('Zoom', { exact: true }).fill('1.5');
    await page.getByRole('button', { name: 'Rotate 0°', exact: true }).click();
    await page.locator('[aria-label="Annotation surface"]').click({ position: { x: 120, y: 180 } });
    const x = await page.getByLabel('X', { exact: true }).inputValue(),
      y = await page.getByLabel('Y', { exact: true }).inputValue();
    expect(Number(x)).toBeGreaterThanOrEqual(0);
    expect(Number(y)).toBeLessThanOrEqual(1);
    await page.getByLabel('Feedback', { exact: true }).fill(pdfBody);
    await page.getByRole('button', { name: 'Save feedback', exact: true }).click();
    await expect(page.getByRole('article').filter({ hasText: pdfBody })).toBeVisible();
    await page.reload();
    await page.getByLabel('Page', { exact: true }).selectOption('2');
    await expect(
      page
        .getByText(/PDF_POINT/)
        .filter({ hasText: `${Number(x).toFixed(3)}, ${Number(y).toFixed(3)} page 2` }),
    ).toBeVisible();
    await page.screenshot({ path: '.local/phase5-pdf-annotation.png', fullPage: true });
    await expect(
      page.getByRole('button', { name: 'Approve exact version', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('Create internal task', { exact: true })).toHaveCount(0);
    await internal.getByRole('button', { name: 'Reload current state', exact: true }).click();
    const article = internal.getByRole('article').filter({ hasText: pdfBody });
    await article.getByText('Create internal task', { exact: true }).click();
    await article.getByLabel('Task title', { exact: true }).fill('Browser converted PDF task');
    await article.getByRole('button', { name: 'Convert feedback to task', exact: true }).click();
    await expect(
      article.getByRole('link', { name: 'Internal source task', exact: true }),
    ).toBeVisible();
    await article.getByRole('link', { name: 'Internal source task', exact: true }).click();
    await expect(
      internal.getByRole('heading', { name: 'Task details', exact: true }),
    ).toBeVisible();
    await internal.getByRole('link', { name: 'Original review feedback', exact: true }).click();
    await expect(internal.getByRole('article').filter({ hasText: pdfBody })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Internal source task', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText('Browser converted PDF task', { exact: true })).toHaveCount(0);
    const approver = await login(
      f.approver2.email,
      `/portal/${f.org}/projects/${f.project}/reviews/${pdf.cycle}`,
    );
    await expect(
      approver.getByRole('button', { name: 'Approve exact version', exact: true }),
    ).toBeDisabled();
    await approver.getByLabel(/I confirm version/).check();
    await approver
      .getByLabel('Reason (required for changes)', { exact: true })
      .fill('Browser exact-version revision requested');
    await approver.getByRole('button', { name: 'Request changes', exact: true }).click();
    await expect(
      approver.getByRole('heading', { name: /Cycle .*CHANGES_REQUESTED/ }),
    ).toBeVisible();
    await expect(approver.getByRole('button', { name: 'Save feedback', exact: true })).toHaveCount(
      0,
    );
    const viewer = await login(f.viewer.email, `/portal/${f.org}`);
    await expect(viewer.getByRole('link', { name: 'Review project', exact: true })).toBeVisible();
    await viewer.getByRole('link', { name: 'Review project', exact: true }).click();
    await expect(
      viewer.getByText('Shared version history and review management', { exact: true }),
    ).toBeVisible();
    await viewer.screenshot({ path: '.local/phase5-portal.png', fullPage: true });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('P32/P34 authentication continuation returns only to the requested approved portal template', async ({
  browser,
}) => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  for (const path of [
    `/portal/${f.org}/projects`,
    `/portal/${f.org}/projects/${f.project}/deliverables`,
  ]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await page.getByLabel('Email', { exact: true }).fill(f.viewer.email);
      await page.getByLabel('Password', { exact: true }).fill('Disposable-phase2-password-123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path + '/?$'));
      await expect(page.getByRole('heading', { name: 'Client portal', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Approve exact version', exact: true }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
