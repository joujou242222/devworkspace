import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { password } from '../phase2/helpers.mjs';

test('Phase 9 bounded workload remains responsive in real task, milestone and document lists', async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = JSON.parse(await readFile('.local/phase9/workload-fixture.json', 'utf8')) as {
    organizationId: string;
    projectId: string;
    pageFourTaskTitle: string;
    email: string;
    taskCount: number;
    milestoneCount: number;
    documentCount: number;
  };
  const root = `/w/${fixture.organizationId}`;
  const taskList = `${root}/projects/${fixture.projectId}/tasks`;
  await page.goto('/login?returnTo=' + encodeURIComponent(taskList));
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('https://localhost:8443' + taskList);

  const taskStart = performance.now();
  await expect(page.getByRole('heading', { name: 'tasks', exact: true })).toBeVisible();
  await expect(
    page.getByText(`${fixture.taskCount} matching records`, { exact: true }),
  ).toBeVisible();
  for (let pageNumber = 2; pageNumber <= 4; pageNumber++) {
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`page=${pageNumber}`));
  }
  await expect(
    page.getByRole('link', { name: fixture.pageFourTaskTitle, exact: true }),
  ).toBeVisible();
  const taskListMs = performance.now() - taskStart;

  const milestoneStart = performance.now();
  await page.goto(`${root}/projects/${fixture.projectId}/milestones`);
  await expect(page.getByRole('heading', { name: 'milestones', exact: true })).toBeVisible();
  await expect(
    page.getByText(`${fixture.milestoneCount} matching records`, { exact: true }),
  ).toBeVisible();
  const milestoneListMs = performance.now() - milestoneStart;

  const documentStart = performance.now();
  await page.goto(`${root}/documents`);
  await expect(page.getByRole('heading', { name: 'Documents library', exact: true })).toBeVisible();
  await expect(page.getByText(`${fixture.documentCount} results`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  const documentListMs = performance.now() - documentStart;

  const evidence = {
    measuredAt: new Date().toISOString(),
    taskListToPageFourMs: Number(taskListMs.toFixed(2)),
    milestoneListReadyMs: Number(milestoneListMs.toFixed(2)),
    documentListAndNextPageMs: Number(documentListMs.toFixed(2)),
    retainedRows: {
      tasks: fixture.taskCount,
      milestones: fixture.milestoneCount,
      documents: fixture.documentCount,
    },
  };
  await writeFile('.local/phase9/e2e-results.json', JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log('PHASE9_UI ' + JSON.stringify(evidence));
});
