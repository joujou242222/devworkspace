import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, admin, account, tenant, join, mail } from './helpers.mjs';
after(() => admin.end());
test('T02: six overlapping invitation requests cannot exhaust the tenant pool while acquiring rate limits', async () => {
  const a = await account();
  const t = await tenant(a);
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      a.browser.request(
        t.path + '/invitations',
        'POST',
        { email: 'parallel-' + crypto.randomUUID() + '@example.test', role: 'MEMBER' },
        t.headers,
      ),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(
    (
      await admin.query('SELECT count(*) FROM invitation WHERE organization_id=$1', [
        t.organizationId,
      ])
    ).rows[0].count,
    '6',
  );
});
test('T02/T22: onboarding idempotency, changed payload, atomic audit/outbox/receipt and session revision', async () => {
  const a = await account();
  const t = await tenant(a);
  const repeat = await a.browser.request('/api/v1/organizations', 'POST', t.body, {
    'Idempotency-Key': t.key,
  });
  assert.equal(repeat.status, 201);
  assert.equal(repeat.json().organizationId, t.organizationId);
  assert.equal(
    (
      await a.browser.request(
        '/api/v1/organizations',
        'POST',
        { ...t.body, name: 'Changed' },
        { 'Idempotency-Key': t.key },
      )
    ).status,
    409,
  );
  const result = await admin.query(
    `SELECT (SELECT count(*) FROM membership WHERE organization_id=$1 AND role='OWNER') owners,(SELECT count(*) FROM audit_event WHERE organization_id=$1) audits,(SELECT count(*) FROM tenant_event WHERE organization_id=$1) events,(SELECT count(*) FROM onboarding_receipt WHERE organization_id=$1) receipts`,
    [t.organizationId],
  );
  assert.deepEqual(result.rows[0], { owners: '1', audits: '1', events: '1', receipts: '1' });
  const b = await account();
  const constraint = 'p2_fault_' + crypto.randomUUID().replaceAll('-', '');
  await admin.query(
    `ALTER TABLE audit_event ADD CONSTRAINT ${constraint} CHECK(actor_id <> '${b.user.id}') NOT VALID`,
  );
  try {
    const r = await b.browser.request(
      '/api/v1/organizations',
      'POST',
      { name: 'Must roll back', description: '', timezone: 'UTC' },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    assert.equal(r.status, 409);
    assert.equal(
      (await admin.query('SELECT count(*) FROM membership WHERE user_id=$1', [b.user.id])).rows[0]
        .count,
      '0',
    );
    assert.equal(
      (await admin.query('SELECT count(*) FROM onboarding_receipt WHERE user_id=$1', [b.user.id]))
        .rows[0].count,
      '0',
    );
    assert.equal(
      (await b.browser.request('/api/v1/me')).status,
      200,
      'Rolled-back membership insert must not revoke sessions',
    );
  } finally {
    await admin.query(`ALTER TABLE audit_event DROP CONSTRAINT ${constraint}`);
  }
});
test('T02/T03/T21: explicit principal, settings conflict/field policy, internal invitation binding and replay', async () => {
  const a = await account(),
    b = await account(),
    stranger = await account();
  const t = await tenant(a);
  assert.equal((await a.browser.request(t.path)).status, 400);
  assert.equal((await stranger.browser.request(t.path, 'GET', undefined, t.headers)).status, 404);
  const settings = (await a.browser.request(t.path, 'GET', undefined, t.headers)).json();
  assert.equal(
    (
      await a.browser.request(
        t.path,
        'PATCH',
        { ...t.body, name: 'Persisted settings' },
        { ...t.headers, 'If-Match': `"${settings.revision}"` },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await a.browser.request(t.path, 'PATCH', t.body, {
        ...t.headers,
        'If-Match': `"${settings.revision}"`,
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await a.browser.request(
        t.path,
        'PATCH',
        { ...t.body, ownerId: b.user.id },
        { ...t.headers, 'If-Match': '"2"' },
      )
    ).status,
    400,
  );
  const invited = await a.browser.request(
    t.path + '/invitations',
    'POST',
    { email: b.email, role: 'MEMBER' },
    t.headers,
  );
  assert.equal(invited.status, 201);
  const token = (await mail(b.email, 'DevWorkspace team invitation')).searchParams.get('token');
  assert.equal(
    (
      await stranger.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await b.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token, role: 'OWNER' },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    400,
  );
  const key = crypto.randomUUID();
  assert.equal(
    (
      await b.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': key },
      )
    ).status,
    200,
  );
  assert.equal((await b.browser.request('/api/v1/me')).status, 401);
  await b.browser.login(b.email);
  assert.equal(
    (
      await b.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': key },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await b.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    409,
  );
  const principal = (await b.browser.request('/api/v1/me/principals')).json().items[0];
  const headers = { 'X-Organization-Principal': principal.id };
  assert.equal((await b.browser.request(t.path + '/team', 'GET', undefined, headers)).status, 403);
  assert.equal(
    (await b.browser.request(t.path, 'PATCH', t.body, { ...headers, 'If-Match': '"2"' })).status,
    403,
  );
  assert.equal(
    (
      await admin.query('SELECT count(*) FROM membership WHERE organization_id=$1 AND user_id=$2', [
        t.organizationId,
        b.user.id,
      ])
    ).rows[0].count,
    '1',
  );
});
test('T02: invitation revocation, expiry and live issuer loss; no client/Owner target accepted', async () => {
  const a = await account(),
    issuer = await account(),
    b = await account();
  const t = await tenant(a);
  const j = await join(a, t, issuer, 'ADMIN');
  assert.equal(
    (
      await a.browser.request(
        t.path + '/invitations',
        'POST',
        { email: b.email, role: 'OWNER' },
        t.headers,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await a.browser.request(
        t.path + '/invitations',
        'POST',
        { email: b.email, role: 'MEMBER', capacity: 'CLIENT' },
        t.headers,
      )
    ).status,
    400,
  );
  const r = await issuer.browser.request(
    t.path + '/invitations',
    'POST',
    { email: b.email, role: 'MEMBER' },
    j.headers,
  );
  assert.equal(r.status, 201);
  const token = (await mail(b.email, 'DevWorkspace team invitation')).searchParams.get('token');
  const m = (await a.browser.request(t.path + '/team', 'GET', undefined, t.headers))
    .json()
    .items.find((m) => m.id === j.principal.id);
  assert.equal(
    (
      await a.browser.request(
        t.path + '/team/' + m.id,
        'PATCH',
        { role: 'MEMBER', status: 'ACTIVE' },
        { ...t.headers, 'If-Match': `"${m.revision}"` },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await b.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await a.browser.request(
        t.path + '/invitations/' + r.json().id,
        'DELETE',
        {},
        { ...t.headers, 'If-Match': '"1"' },
      )
    ).status,
    200,
  );
  assert.equal(
    (await b.browser.request('/api/v1/invitations/inspect', 'POST', { token })).status,
    404,
  );
  const c = await account();
  const exp = await a.browser.request(
    t.path + '/invitations',
    'POST',
    { email: c.email, role: 'MEMBER' },
    t.headers,
  );
  const expiredToken = (await mail(c.email, 'DevWorkspace team invitation')).searchParams.get(
    'token',
  );
  await admin.query("UPDATE invitation SET expires_at=now()-interval '1 second' WHERE id=$1", [
    exp.json().id,
  ]);
  assert.equal(
    (
      await c.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token: expiredToken },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    404,
  );
  await admin.query("UPDATE invitation SET expires_at=now()+interval '1 day' WHERE id=$1", [
    exp.json().id,
  ]);
  assert.equal(
    (await c.browser.request('/api/v1/invitations/inspect', 'POST', { token: expiredToken }))
      .status,
    200,
  );
  await admin.query("UPDATE organization SET status='ARCHIVED' WHERE id=$1", [t.organizationId]);
  assert.equal(
    (
      await c.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token: expiredToken },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    404,
  );
});
test('T02/T06: Admin cannot grant ownership; synchronized Owner demotions preserve one Owner', async () => {
  const a = await account(),
    b = await account();
  const t = await tenant(a);
  const j = await join(a, t, b, 'ADMIN');
  let team = (await a.browser.request(t.path + '/team', 'GET', undefined, t.headers)).json().items;
  const own = team.find((m) => m.id === t.principal.id);
  const second = team.find((m) => m.id === j.principal.id);
  assert.equal(
    (
      await b.browser.request(
        t.path + '/team/' + second.id,
        'PATCH',
        { role: 'OWNER', status: 'ACTIVE' },
        { ...j.headers, 'If-Match': `"${second.revision}"` },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await b.browser.request(
        t.path + '/team/' + own.id,
        'PATCH',
        { role: 'MEMBER', status: 'ACTIVE' },
        { ...j.headers, 'If-Match': `"${own.revision}"` },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await a.browser.request(
        t.path + '/team/' + second.id,
        'PATCH',
        { role: 'OWNER', status: 'ACTIVE' },
        { ...t.headers, 'If-Match': `"${second.revision}"` },
      )
    ).status,
    200,
  );
  await b.browser.login(b.email);
  const lock = await admin.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [t.organizationId]);
  const attempts = [
    a.browser.request(
      t.path + '/team/' + own.id,
      'PATCH',
      { role: 'ADMIN', status: 'ACTIVE' },
      { ...t.headers, 'If-Match': `"${own.revision}"` },
    ),
    b.browser.request(
      t.path + '/team/' + second.id,
      'PATCH',
      { role: 'ADMIN', status: 'ACTIVE' },
      { ...j.headers, 'If-Match': `"${second.revision + 1}"` },
    ),
  ];
  try {
    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      blocked = Number(
        (
          await admin.query(
            "SELECT count(*) FROM pg_stat_activity WHERE usename='dw2_api' AND wait_event_type='Lock'",
          )
        ).rows[0].count,
      );
      if (blocked >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(blocked >= 2, 'Both commands must overlap behind the organization lock');
  } finally {
    await lock.query('COMMIT');
    lock.release();
  }
  const results = await Promise.all(attempts);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM membership WHERE organization_id=$1 AND role='OWNER' AND status='ACTIVE'",
        [t.organizationId],
      )
    ).rows[0].count,
    '1',
  );
});
test('T02/T21: ownership transfer requires recent authentication and revokes both identities', async () => {
  const a = await account(),
    b = await account();
  const t = await tenant(a);
  const j = await join(a, t, b);
  const sid = (await a.browser.request('/api/v1/me/sessions'))
    .json()
    .items.find((s) => s.current).id;
  await admin.query(
    'UPDATE identity_session SET "createdAt"=now()-interval \'11 minutes\' WHERE id=$1',
    [sid],
  );
  assert.equal(
    (
      await a.browser.request(
        t.path + '/ownership',
        'POST',
        { membershipId: j.principal.id },
        t.headers,
      )
    ).status,
    403,
  );
  await a.browser.login(a.email);
  assert.equal(
    (
      await a.browser.request(
        t.path + '/ownership',
        'POST',
        { membershipId: j.principal.id },
        t.headers,
      )
    ).status,
    200,
  );
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  assert.equal((await b.browser.request('/api/v1/me')).status, 401);
  await b.browser.login(b.email);
  assert.equal((await b.browser.request('/api/v1/me/principals')).json().items[0].role, 'OWNER');
});
