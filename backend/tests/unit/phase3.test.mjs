import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnPath, coreSchemas, coreQuery } from '../../packages/contracts/dist/index.js';
test('Phase 3 return paths preserve scoped deep links and reject redirect injection', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  for (const p of [
    '/account',
    `/w/${id}`,
    `/w/${id}/clients`,
    `/w/${id}/clients/${id}`,
    `/w/${id}/projects/${id}/tasks/${id}`,
    `/w/${id}/projects/${id}/access`,
    `/w/${id}/projects/${id}/files`,
    `/w/${id}/projects/${id}/deliverables`,
  ])
    assert.equal(safeReturnPath(p), p);
  for (const p of [
    'https://hostile.test',
    '//hostile.test',
    '/\\hostile.test',
    '/account?returnTo=//hostile.test',
    `/w/${id}/projects/../settings`,
  ])
    assert.equal(safeReturnPath(p), null);
});
test('Phase 3 command fields and date windows reject forged ownership, malformed priorities and invalid bounds', () => {
  assert.equal(
    coreSchemas.task.safeParse({
      title: 'Task',
      description: '',
      milestone_id: null,
      assignee_id: null,
      priority: 'IMMEDIATE',
      status: 'TODO',
      due_at: null,
      position: 0,
    }).success,
    false,
  );
  assert.equal(
    coreSchemas.workState.safeParse({ status: 'DONE', assignee_id: 'forged' }).success,
    false,
  );
  assert.equal(coreQuery.safeParse({ page: 0 }).success, false);
  assert.equal(
    coreQuery.safeParse({ due_from: '2027-01-01T00:00:00Z', due_to: '2026-01-01T00:00:00Z' })
      .success,
    false,
  );
});
