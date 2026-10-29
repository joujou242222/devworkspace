import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationPreferenceSchema,
  notificationQuery,
  socketContext,
  socketSubscription,
  safeReturnPath,
} from '../../packages/contracts/dist/index.js';
test('notification and socket DTOs reject authority overposting, unsupported categories and malformed scope', () => {
  assert.equal(
    notificationPreferenceSchema.safeParse({ assignments: true, reviews: false, user_id: 'other' })
      .success,
    false,
  );
  assert.equal(
    notificationPreferenceSchema.safeParse({ assignments: true, reviews: false, email: false })
      .success,
    false,
  );
  assert.equal(notificationQuery.safeParse({ limit: 101 }).success, false);
  assert.equal(notificationQuery.safeParse({ category: 'security' }).success, false);
  assert.equal(
    socketContext.safeParse({
      organization_id: crypto.randomUUID(),
      principal_id: crypto.randomUUID(),
      capacity: 'ADMIN',
    }).success,
    false,
  );
  assert.equal(
    socketSubscription.safeParse({ project_id: crypto.randomUUID(), room: 'internal' }).success,
    false,
  );
});
test('notification login continuations remain exact local internal/portal templates', () => {
  const org = crypto.randomUUID();
  for (const path of [`/w/${org}/notifications`, `/portal/${org}/notifications`])
    assert.equal(safeReturnPath(path), path);
  for (const path of [
    `//host/portal/${org}/notifications`,
    `/portal/${org}/notifications?redirect=https://host`,
    `/w/${org}/notifications/unknown`,
  ])
    assert.equal(safeReturnPath(path), null);
});
