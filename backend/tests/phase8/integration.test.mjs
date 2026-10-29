import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Browser, account, tenant, admin } from '../phase2/helpers.mjs';

let f, owner, stranger, other;
const good = (r, status = 200) => {
  assert.equal(r.status, status, r.body);
  return r.json();
};
const req = (query) =>
  owner.request(`/api/v1/organizations/${f.org}/reviews?limit=100&${query}`, 'GET', undefined, {
    'X-Organization-Principal': f.principal,
  });
before(async () => {
  f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  owner = new Browser();
  await owner.login(f.owner.email);
  stranger = await account();
  other = await tenant(stranger, 'Phase8 isolated filter tenant');
});
after(async () => {
  await admin.end();
});

test('review center exact-version/deadline filters reconcile rows and counts without retargeting reviews', async () => {
  const all = good(await req(`project_id=${f.project}`));
  const filtered = good(await req(`project_id=${f.project}&version_id=${f.version.id}`));
  assert.ok(filtered.items.length);
  assert.equal(filtered.total, all.items.filter((r) => r.version_id === f.version.id).length);
  assert.ok(filtered.items.every((r) => r.version_id === f.version.id));
  assert.equal(
    good(await req(`version_id=${f.version.id}&due_before=2000-01-01T00:00:00Z`)).total,
    0,
  );
  assert.equal(good(await req(`version_id=${crypto.randomUUID()}`)).total, 0);
  const afterRead = good(await req(`project_id=${f.project}`));
  assert.deepEqual(afterRead, all);
});

test('review filters validate input and do not bypass selected tenant or project authority', async () => {
  assert.equal((await req('version_id=invalid')).status, 400);
  assert.equal((await req('due_before=invalid')).status, 400);
  assert.equal((await req(`project_id=${crypto.randomUUID()}`)).status, 404);
  const isolated = good(
    await stranger.browser.request(
      other.path + `/reviews?version_id=${f.version.id}`,
      'GET',
      undefined,
      other.headers,
    ),
  );
  assert.equal(isolated.total, 0);
  assert.deepEqual(isolated.items, []);
  assert.equal(
    (
      await stranger.browser.request(
        `/api/v1/organizations/${f.org}/reviews?version_id=${f.version.id}`,
        'GET',
        undefined,
        other.headers,
      )
    ).status,
    404,
  );
});
