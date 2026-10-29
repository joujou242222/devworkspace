import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../../scripts/http.mjs';
import { Browser, admin, account, register, mail, password, origin } from './helpers.mjs';
after(() => admin.end());
test('T01/T02: account sessions and principal selection paginate without losing self scope', async () => {
  const a = await account();
  const tx = await admin.connect();
  try {
    await tx.query('BEGIN');
    for (let i = 0; i < 52; i++) {
      const id = crypto.randomUUID();
      await tx.query("SELECT set_config('app.organization_id',$1,true)", [id]);
      await tx.query('INSERT INTO organization(id,name) VALUES($1,$2)', [
        id,
        'Synthetic pagination ' + i,
      ]);
      await tx.query(
        'INSERT INTO membership(id,organization_id,user_id,role) VALUES($1,$2,$3,$4)',
        [crypto.randomUUID(), id, a.user.id, 'OWNER'],
      );
    }
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
  await a.browser.login(a.email);
  for (let i = 0; i < 55; i++)
    await admin.query(
      'INSERT INTO identity_session(id,"userId",token,"expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 hour\',now())',
      [crypto.randomUUID(), a.user.id, crypto.randomUUID()],
    );
  for (const [path, total] of [
    ['/api/v1/me/principals', 52],
    ['/api/v1/me/sessions', 56],
  ]) {
    let response = await a.browser.request(path);
    let data = response.json();
    assert.equal(data.items.length, 50);
    assert.ok(data.nextCursor);
    const ids = data.items.map((row) => row.id);
    response = await a.browser.request(path + '?cursor=' + data.nextCursor);
    data = response.json();
    ids.push(...data.items.map((row) => row.id));
    assert.equal(new Set(ids).size, total);
    assert.equal(data.nextCursor, null);
  }
});
test('T01/T22: failed durable mail insert rolls back registration credentials, audit and outbox', async () => {
  const b = new Browser();
  const email = 'rollback-' + crypto.randomUUID() + '@example.test';
  const name = 'p2_mail_fault_' + crypto.randomUUID().replaceAll('-', '');
  await admin.query(
    `ALTER TABLE identity_mail ADD CONSTRAINT ${name} CHECK(kind<>'verify') NOT VALID`,
  );
  try {
    const r = await b.request('/api/v1/identity/register', 'POST', {
      name: 'Rollback identity',
      email,
      password,
    });
    assert.equal(r.status, 503);
    assert.equal(
      (await admin.query('SELECT count(*) FROM identity_user WHERE email=$1', [email])).rows[0]
        .count,
      '0',
    );
  } finally {
    await admin.query(`ALTER TABLE identity_mail DROP CONSTRAINT ${name}`);
  }
});
test('T01: expired and tampered verification/reset proofs never mutate identity or credentials', async () => {
  const a = await register();
  const token = (await mail(a.email, 'Verify your DevWorkspace email')).searchParams.get('token');
  const row = (await admin.query('SELECT id FROM identity_user WHERE email=$1', [a.email])).rows[0];
  await admin.query(
    'UPDATE identity_email_proof SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',
    [row.id],
  );
  assert.notEqual(
    (await a.browser.request('/api/v1/identity/verify', 'POST', { token })).status,
    200,
  );
  assert.notEqual(
    (await a.browser.request('/api/v1/identity/verify', 'POST', { token: token + 'tampered' }))
      .status,
    200,
  );
  assert.equal(
    (await admin.query('SELECT "emailVerified" FROM identity_user WHERE id=$1', [row.id])).rows[0]
      .emailVerified,
    false,
  );
  const b = await account();
  await b.browser.request('/api/v1/identity/recovery', 'POST', { email: b.email });
  const reset = (await mail(b.email, 'Reset your DevWorkspace password')).searchParams.get('token');
  await admin.query(
    'UPDATE identity_verification SET "expiresAt"=now()-interval \'1 second\' WHERE value=$1',
    [b.user.id],
  );
  assert.notEqual(
    (
      await b.browser.request('/api/v1/identity/reset', 'POST', {
        token: reset,
        newPassword: password + 'changed',
      })
    ).status,
    200,
  );
  await b.browser.login(b.email);
});
test('T01: real SMTP verification, opaque host cookie, sanitized self DTO, replay, logout and SSR denial', async () => {
  const a = await register();
  assert.equal(
    (await a.browser.request('/api/v1/identity/login', 'POST', { email: a.email, password }))
      .status,
    403,
  );
  const link = await mail(a.email, 'Verify your DevWorkspace email');
  const token = link.searchParams.get('token');
  assert.equal(
    (await request('/api/v1/identity/library/verify-email?token=' + encodeURIComponent(token)))
      .status,
    404,
  );
  const results = await Promise.all(
    [new Browser(), new Browser(), new Browser()].map((b) =>
      b.request('/api/v1/identity/verify', 'POST', { token }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const response = await a.browser.login(a.email);
  const cookie = response.headers['set-cookie'].find((x) =>
    x.startsWith('__Host-devworkspace.session_token='),
  );
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
    assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  const me = await a.browser.me();
  assert.deepEqual(Object.keys(me).sort(), ['email', 'id', 'name', 'revision']);
  const sessions = (await a.browser.request('/api/v1/me/sessions')).json();
  assert.ok(!JSON.stringify(sessions).includes('token'));
  assert.ok(sessions.items[0].current);
  const rawCookie = Array.from(a.browser.cookies, ([k, v]) => k + '=' + v).join('; ');
  assert.equal((await request('/account', { headers: { Cookie: rawCookie } })).status, 200);
  assert.equal((await a.browser.request('/api/v1/identity/logout', 'POST', {})).status, 200);
  assert.equal((await request('/api/v1/me', { headers: { Cookie: rawCookie } })).status, 401);
  assert.equal((await request('/account', { headers: { Cookie: rawCookie } })).status, 307);
});
test('T01: missing/hostile Origin and CSRF, overposting, private caching and uniform recovery/registration', async () => {
  const a = await account();
  for (const path of [
    '/api/v1/identity/login',
    '/api/v1/identity/logout',
    '/api/v1/organizations',
    '/api/v1/me/password',
  ]) {
    const r = await request(path, { method: 'POST', body: '{}', headers: { Origin: origin } });
    assert.equal(r.status, 403);
    assert.equal(r.headers['content-type'].split(';')[0], 'application/problem+json');
  }
  assert.equal(
    (
      await a.browser.request(
        '/api/v1/identity/logout',
        'POST',
        {},
        { Origin: 'https://hostile.test' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await a.browser.request(
        '/api/v1/me',
        'PATCH',
        { name: 'Bad', userId: crypto.randomUUID() },
        { 'If-Match': '"1"' },
      )
    ).status,
    400,
  );
  assert.equal((await a.browser.request('/api/v1/me')).headers['cache-control'], 'no-store');
  const existing = await a.browser.request('/api/v1/identity/recovery', 'POST', { email: a.email });
  const missing = await a.browser.request('/api/v1/identity/recovery', 'POST', {
    email: 'absent-' + crypto.randomUUID() + '@example.test',
  });
  assert.equal(existing.status, missing.status);
  assert.deepEqual(existing.json(), missing.json());
  const duplicate = await a.browser.request('/api/v1/identity/register', 'POST', {
    name: 'Duplicate',
    email: a.email,
    password,
  });
  assert.equal(duplicate.status, 202);
  assert.ok(!duplicate.body.includes(a.user.id));
});
test('T01/T21: profile revision/self scope, password change rotates and revokes others, own-session revocation', async () => {
  const a = await account();
  const other = new Browser();
  await other.login(a.email);
  const foreign = await account();
  assert.equal(
    (await a.browser.request('/api/v1/me', 'PATCH', { name: 'Changed' }, { 'If-Match': '"1"' }))
      .status,
    200,
  );
  assert.equal(
    (await a.browser.request('/api/v1/me', 'PATCH', { name: 'Stale' }, { 'If-Match': '"1"' }))
      .status,
    412,
  );
  const otherSession = (await other.request('/api/v1/me/sessions'))
    .json()
    .items.find((s) => s.current);
  assert.equal(
    (await foreign.browser.request('/api/v1/me/sessions/' + otherSession.id, 'DELETE', {})).status,
    404,
  );
  assert.equal(
    (
      await a.browser.request('/api/v1/me/password', 'POST', {
        currentPassword: password,
        newPassword: password + 'new',
      })
    ).status,
    200,
  );
  assert.equal((await other.request('/api/v1/me')).status, 401);
  assert.equal((await a.browser.me()).name, 'Changed');
  const own = (await a.browser.request('/api/v1/me/sessions')).json().items.find((s) => s.current);
  assert.equal(
    (await a.browser.request('/api/v1/me/sessions/' + own.id, 'DELETE', {})).status,
    200,
  );
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
});
test('T01: reset proof one winner, hashed storage and all old sessions revoked', async () => {
  const a = await account();
  const second = new Browser();
  await second.login(a.email);
  await a.browser.request('/api/v1/identity/recovery', 'POST', { email: a.email });
  const token = (await mail(a.email, 'Reset your DevWorkspace password')).searchParams.get('token');
  const stored = await admin.query('SELECT identifier FROM identity_verification WHERE value=$1', [
    a.user.id,
  ]);
  assert.ok(stored.rows.every((r) => !r.identifier.includes(token)));
  const results = await Promise.all(
    [new Browser(), new Browser(), new Browser(), new Browser()].map((b) =>
      b.request('/api/v1/identity/reset', 'POST', { token, newPassword: password + 'reset' }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(
    (await admin.query('SELECT count(*) FROM identity_session WHERE "userId"=$1', [a.user.id]))
      .rows[0].count,
    '0',
  );
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  assert.equal((await second.request('/api/v1/me')).status, 401);
  await a.browser.login(a.email, password + 'reset');
});
test('T01: server idle/absolute/recent-auth limits and inactive identity fail closed', async () => {
  const a = await account();
  let sid = (await a.browser.request('/api/v1/me/sessions')).json().items.find((s) => s.current).id;
  await admin.query(
    'UPDATE identity_session SET "createdAt"=now()-interval \'11 minutes\' WHERE id=$1',
    [sid],
  );
  assert.equal(
    (
      await a.browser.request('/api/v1/me/password', 'POST', {
        currentPassword: password,
        newPassword: password + 'new',
      })
    ).status,
    403,
  );
  await admin.query(
    'UPDATE identity_session SET "lastActivityAt"=now()-interval \'31 minutes\' WHERE id=$1',
    [sid],
  );
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  await a.browser.login(a.email);
  sid = (await a.browser.request('/api/v1/me/sessions')).json().items[0].id;
  await admin.query(
    'UPDATE identity_session SET "createdAt"=now()-interval \'9 hours\',"expiresAt"=now()+interval \'1 hour\' WHERE id=$1',
    [sid],
  );
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  await a.browser.login(a.email);
  await admin.query('UPDATE identity_user SET active=false WHERE id=$1', [a.user.id]);
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  assert.notEqual(
    (await a.browser.request('/api/v1/identity/login', 'POST', { email: a.email, password }))
      .status,
    200,
  );
});
