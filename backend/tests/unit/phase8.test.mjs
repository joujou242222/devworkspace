import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, reviewQuery } from '../../packages/contracts/dist/index.js';

test('authenticated continuation preserves bounded view state and rejects redirect injection', () => {
  const org = crypto.randomUUID(),
    project = crypto.randomUUID(),
    version = crypto.randomUUID();
  for (const path of [
    `/w/${org}/projects/${project}/tasks?priority=URGENT&page=2`,
    `/w/${org}/reviews?version_id=${version}&due_before=2026-10-20T00%3A00%3A00Z`,
    `/portal/${org}/updates?projectId=${project}`,
    `/w/${org}/documents?q=retained+filter&cursor=opaque`,
  ])
    assert.equal(safeReturnPath(path), path);
  for (const path of [
    '//evil.test',
    'https://evil.test',
    '/account?next=https://evil.test',
    '/account?returnTo=/account',
    '/account#fragment',
    '/account?status=ACTIVE&status=ARCHIVED',
    '/account?projectId=invalid',
    '/account?page=-1',
    '/account?q=%0d%0aLocation%3aevil',
    '/account?due_before=invalid',
    '/account?q=' + 'x'.repeat(4096),
  ])
    assert.equal(safeReturnPath(path), null, 'Unsafe continuation accepted');
});

test('review list validates exact-version and deadline filter input', () => {
  assert.equal(
    reviewQuery.parse({ version_id: crypto.randomUUID(), due_before: '2026-10-20T00:00:00Z' }).page,
    1,
  );
  for (const value of [
    { version_id: 'invalid' },
    { due_before: 'yesterday' },
    { version_id: crypto.randomUUID(), tenant: crypto.randomUUID() },
  ])
    assert.equal(reviewQuery.safeParse(value).success, false);
});
