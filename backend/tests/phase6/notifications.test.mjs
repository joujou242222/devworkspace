import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { account, tenant, join, mail, admin, runtime } from '../phase2/helpers.mjs';
import { image, hash } from '../phase4/fixtures.mjs';
import { request } from '../../scripts/http.mjs';
let owner, member, viewer, t, p, client, pm, ownerPm, version, contact, clientViewer, cycle;
const good = (r, n = 201) => {
  assert.equal(r.status, n, r.body);
  return r.json();
};
const req = (path, method = 'GET', body, a = owner, h = a?.headers ?? t.headers) =>
  a.browser.request(t.path + path, method, body, h);
const base = () => '/projects/' + p.id;
const revision = (r) => ({
  'If-Match': `"${r.revision}"`,
  'Idempotency-Key': crypto.randomUUID(),
  ...t.headers,
});
const taskBody = (title, assignee = pm.id) => ({
  title,
  description: 'Synthetic Phase6',
  priority: 'HIGH',
  status: 'TODO',
  milestone_id: null,
  assignee_id: assignee,
  due_at: null,
  position: 0,
});
const notices = (a = member, query = '') =>
  req(
    (a === contact || a === clientViewer ? '/portal' : '') + '/notifications' + query,
    'GET',
    undefined,
    a,
  );
const wait = async (fn, attempts = 150) => {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('Expected durable effect within the bounded recovery window');
};
async function eventFor(id) {
  return (
    await admin.query(
      'SELECT id FROM public.tenant_event WHERE organization_id=$1 AND target_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
      [t.organizationId, id],
    )
  ).rows[0].id;
}
async function completed(event) {
  await wait(
    async () =>
      (
        await admin.query(
          "SELECT completed_at FROM public.delivery WHERE lane='tenant' AND event_id=$1",
          [event],
        )
      ).rows[0]?.completed_at,
  );
}
async function invite(role) {
  const a = await account();
  const c = good(
    await req('/clients/' + client.id + '/contacts', 'POST', {
      name: 'Phase6 ' + role,
      email: a.email,
      status: 'ACTIVE',
    }),
  );
  good(
    await req(`/clients/${client.id}/contacts/${c.id}/invitations`, 'POST', {
      project_id: p.id,
      role,
    }),
  );
  const link = await mail(a.email, 'DevWorkspace client invitation');
  good(
    await a.browser.request(
      '/api/v1/invitations/accept',
      'POST',
      { token: link.searchParams.get('token') },
      { 'Idempotency-Key': crypto.randomUUID() },
    ),
    200,
  );
  await a.browser.login(a.email);
  return { ...a, id: c.id, headers: { 'X-Organization-Principal': c.id } };
}
before(async () => {
  owner = await account();
  t = await tenant(owner, 'Phase6 agency');
  owner.headers = t.headers;
  member = await account();
  member.headers = (await join(owner, t, member)).headers;
  viewer = await account();
  viewer.headers = (await join(owner, t, viewer)).headers;
  client = good(
    await req('/clients', 'POST', { name: 'Phase6 customer', description: '', status: 'ACTIVE' }),
  );
  p = good(
    await req('/projects', 'POST', {
      client_id: client.id,
      name: 'Phase6 project',
      description: '',
      status: 'ACTIVE',
      portal_enabled: true,
      due_at: null,
    }),
  );
  ownerPm = good(
    await req(base() + '/members', 'POST', {
      membership_id: t.principal.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    }),
  );
  pm = good(
    await req(base() + '/members', 'POST', {
      membership_id: member.headers['X-Organization-Principal'],
      role: 'CONTRIBUTOR',
      status: 'ACTIVE',
    }),
  );
  contact = await invite('APPROVER');
  clientViewer = await invite('VIEWER');
  const bytes = await image('png', '#718293');
  const u = good(
    await req(base() + '/uploads', 'POST', {
      name: 'phase6.png',
      purpose: 'DELIVERABLE',
      folder_id: null,
      size: bytes.length,
      digest: hash(bytes),
      mime: 'image/png',
    }),
  );
  const url = new URL(u.capability.url);
  assert.equal(
    (
      await request(url.pathname + url.search, {
        method: 'PUT',
        body: bytes,
        headers: { ...u.capability.headers, Origin: 'https://localhost:8443' },
      })
    ).status,
    200,
  );
  good(await req(base() + '/uploads/' + u.id + '/finalize', 'POST', {}), 200);
  await wait(async () => {
    const s = good(await req(base() + '/uploads/' + u.id), 200);
    assert.ok(!['FAILED', 'REJECTED'].includes(s.status), s.error_code);
    return s.status === 'READY';
  }, 1800);
  const processed = (
    await admin.query(
      "SELECT audit_id,actor_id,request_id FROM public.tenant_event WHERE organization_id=$1 AND target_id=$2 AND action='file.processed'",
      [t.organizationId, u.id],
    )
  ).rows[0];
  assert.ok(processed?.audit_id);
  assert.equal(processed.actor_id, owner.user.id);
  assert.ok(processed.request_id);
  const d = good(
    await req(base() + '/deliverables', 'POST', {
      title: 'Phase6 exact review',
      description: '',
      task_id: null,
      status: 'ACTIVE',
    }),
  );
  version = good(
    await req(
      base() + '/deliverables/' + d.id + '/versions',
      'POST',
      { asset_id: u.id },
      owner,
      revision(d),
    ),
  );
  good(
    await req(base() + '/versions/' + version.id + '/share', 'PATCH', { status: 'ACTIVE' }, owner, {
      'If-Match': '"1"',
      ...t.headers,
    }),
    200,
  );
  cycle = good(
    await req(
      base() + '/reviews',
      'POST',
      { version_id: version.id, digest: version.digest, approver_ids: [contact.id], due_at: null },
      owner,
      { 'Idempotency-Key': crypto.randomUUID(), ...t.headers },
    ),
  );
  await completed(await eventFor(cycle.id));
  await writeFile(
    '.local/phase6-browser-fixture.json',
    JSON.stringify({
      org: t.organizationId,
      project: p.id,
      principal: t.principal.id,
      owner: owner.email,
      member: member.email,
      memberPrincipal: member.headers['X-Organization-Principal'],
      contact: contact.email,
      contactPrincipal: contact.id,
      ownerPm: ownerPm.id,
      cycle: cycle.id,
      version,
      task: null,
    }),
  );
});
after(() => admin.end());

test('real task events materialize once for the actual assignee, preserve immutable read state and scope counts/pages', async () => {
  const task = good(await req(base() + '/tasks', 'POST', taskBody('Phase6 assigned task')));
  const event = await eventFor(task.id);
  await completed(event);
  const envelope = (
    await admin.query(
      'SELECT e.actor_id,e.audit_id,e.request_id,a.actor_id audit_actor,a.request_id audit_request FROM public.tenant_event e JOIN public.audit_event a ON a.organization_id=e.organization_id AND a.id=e.audit_id WHERE e.id=$1',
      [event],
    )
  ).rows[0];
  assert.ok(envelope.audit_id);
  assert.equal(envelope.actor_id, owner.user.id);
  assert.equal(envelope.actor_id, envelope.audit_actor);
  assert.equal(envelope.request_id, envelope.audit_request);
  let page = good(await notices(member), 200);
  const n = page.items.find((n) => n.event_id === event);
  assert.ok(n);
  assert.equal(n.category, 'assignments');
  assert.equal(n.resource_id, task.id);
  assert.ok(page.unread >= 1);
  assert.equal(good(await notices(viewer), 200).total, 0);
  assert.equal(
    good(await notices(contact), 200).items.some((n) => n.resource_kind === 'TASK'),
    false,
  );
  assert.equal(good(await notices(member, '?limit=1&page=1&unread=true'), 200).items.length, 1);
  good(await req('/notifications/' + n.id + '/read', 'POST', {}, member), 200);
  const first = good(await notices(member), 200).items.find((x) => x.id === n.id).read_at;
  assert.ok(first);
  good(await req('/notifications/' + n.id + '/read', 'POST', {}, member), 200);
  assert.equal(good(await notices(member), 200).items.find((x) => x.id === n.id).read_at, first);
  assert.equal((await req('/notifications/' + n.id + '/read', 'POST', {}, viewer)).status, 404);
  assert.equal(
    (await req('/notifications/' + n.id + '/read', 'POST', { user_id: owner.user.id }, member))
      .status,
    400,
  );
  const f = JSON.parse(await readFile('.local/phase6-browser-fixture.json', 'utf8'));
  await writeFile('.local/phase6-browser-fixture.json', JSON.stringify({ ...f, task: task.id }));
});

test('self preferences CAS, prospective suppression, retained history/no backfill, mandatory mail and unauthorized input', async () => {
  let pref = good(await member.browser.request('/api/v1/me/notification-preferences'), 200);
  assert.equal(pref.assignments, true);
  assert.equal(pref.reviews, true);
  const saved = good(
    await member.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: false, reviews: true },
      { 'If-Match': `"${pref.revision}"` },
    ),
    200,
  );
  assert.equal(
    (
      await member.browser.request(
        '/api/v1/me/notification-preferences',
        'PATCH',
        { assignments: true, reviews: true },
        { 'If-Match': `"${pref.revision}"` },
      )
    ).status,
    412,
  );
  assert.equal(
    (
      await member.browser.request(
        '/api/v1/me/notification-preferences',
        'PATCH',
        { assignments: true, reviews: true, user_id: owner.user.id },
        { 'If-Match': `"${saved.revision}"` },
      )
    ).status,
    400,
  );
  const before = good(await notices(member), 200).total;
  const task = good(await req(base() + '/tasks', 'POST', taskBody('Suppressed task')));
  const event = await eventFor(task.id);
  await completed(event);
  assert.equal(good(await notices(member), 200).total, before);
  pref = good(
    await member.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: true, reviews: true },
      { 'If-Match': `"${saved.revision}"` },
    ),
    200,
  );
  assert.equal(good(await notices(member), 200).total, before);
  good(
    await member.browser.request('/api/v1/identity/recovery', 'POST', { email: member.email }),
    202,
  );
  await mail(member.email, 'Reset your DevWorkspace password');
  assert.equal(
    good(await owner.browser.request('/api/v1/me/notification-preferences'), 200).revision,
    1,
  );
  assert.equal(pref.assignments, true);
});

test('review notifications respect live client share and visibility; internal conversion/resolution never leaks to clients', async () => {
  let external = good(await notices(contact), 200);
  assert.ok(external.items.some((n) => n.resource_id === cycle.id));
  assert.ok(external.items.every((n) => n.resource_kind !== 'TASK'));
  const task = good(await req(base() + '/tasks', 'POST', taskBody('Private task marker')));
  await completed(await eventFor(task.id));
  const feedback = {
    version_id: version.id,
    digest: version.digest,
    visibility: 'INTERNAL',
    body: 'Never send this internal body',
    annotation: null,
  };
  const thread = good(await req(base() + '/reviews/' + cycle.id + '/feedback', 'POST', feedback));
  const eid = await eventFor(thread.id);
  await completed(eid);
  external = good(await notices(contact), 200);
  assert.ok(!external.items.some((n) => n.event_id === eid));
  assert.ok(!JSON.stringify(external).includes(feedback.body));
  assert.equal((await req('/notifications', 'GET', undefined, contact)).status, 404);
  const versions = good(await req(base() + '/versions'), 200).items;
  const shared = versions.find((v) => v.id === version.id);
  good(
    await req(
      base() + '/versions/' + version.id + '/share',
      'PATCH',
      { status: 'REVOKED' },
      owner,
      { 'If-Match': `"${shared.share_revision}"`, ...t.headers },
    ),
    200,
  );
  assert.equal(good(await notices(contact), 200).total, 0);
  assert.equal(good(await notices(contact), 200).unread, 0);
  const old = external.items[0];
  assert.equal(
    (await req('/portal/notifications/' + old.id + '/read', 'POST', {}, contact)).status,
    404,
  );
  good(
    await req(base() + '/versions/' + version.id + '/share', 'PATCH', { status: 'ACTIVE' }, owner, {
      'If-Match': `"${shared.share_revision + 1}"`,
      ...t.headers,
    }),
    200,
  );
});

test('socket authenticated recipient hints, strict subscriptions, cross-project/capacity isolation and live project revocation', async () => {
  const cookie = Array.from(member.browser.cookies, ([k, v]) => k + '=' + v).join('; ');
  const socket = io('https://localhost:8443', {
    transports: ['websocket'],
    rejectUnauthorized: false,
    extraHeaders: { Cookie: cookie, Origin: 'https://localhost:8443' },
    auth: {
      organization_id: t.organizationId,
      principal_id: member.headers['X-Organization-Principal'],
      capacity: 'INTERNAL',
      project_id: p.id,
    },
    autoConnect: false,
    reconnection: false,
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    assert.deepEqual(
      await socket.timeout(3000).emitWithAck('subscribe', { project_id: crypto.randomUUID() }),
      { status: 'denied' },
    );
    assert.deepEqual(
      await socket.timeout(3000).emitWithAck('subscribe', { project_id: p.id, room: 'admin' }),
      { status: 'denied' },
    );
    const hints = [];
    socket.on('notifications.changed', (v) => hints.push(v));
    const task = good(await req(base() + '/tasks', 'POST', taskBody('Socket marker')));
    const eid = await eventFor(task.id);
    await completed(eid);
    await wait(() => hints.find((h) => h.event_id === eid));
    assert.deepEqual(Object.keys(hints.find((h) => h.event_id === eid)), ['event_id']);
    const disconnect = new Promise((resolve) => socket.once('disconnect', resolve));
    good(
      await req(
        base() + '/members/' + pm.id,
        'PATCH',
        {
          membership_id: member.headers['X-Organization-Principal'],
          role: 'CONTRIBUTOR',
          status: 'INACTIVE',
        },
        owner,
        revision(pm),
      ),
      200,
    );
    await Promise.race([
      disconnect,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stale socket stayed connected')), 4000),
      ),
    ]);
    assert.equal(good(await notices(member), 200).total, 0);
    const reconnect = await new Promise((resolve) => {
      socket.once('connect_error', () => resolve('denied'));
      socket.connect();
      setTimeout(() => resolve('timeout'), 4000);
    });
    assert.equal(reconnect, 'denied');
    pm = good(await req(base() + '/members/' + pm.id), 200);
    pm = good(
      await req(
        base() + '/members/' + pm.id,
        'PATCH',
        {
          membership_id: member.headers['X-Organization-Principal'],
          role: 'CONTRIBUTOR',
          status: 'ACTIVE',
        },
        owner,
        revision(pm),
      ),
      200,
    );
  } finally {
    socket.disconnect();
  }
});

test('runtime roles, RLS, no-context and direct forged materialization/notification writes fail closed', async () => {
  const api = new Pool({ connectionString: runtime.PRODUCT_API_URL });
  try {
    assert.equal((await api.query('SELECT * FROM public.notification')).rowCount, 0);
    await assert.rejects(api.query('SELECT * FROM public.notification_preference'));
    await assert.rejects(
      api.query('SELECT public.materialize_notifications($1,$2)', [
        crypto.randomUUID(),
        crypto.randomUUID(),
      ]),
    );
    await assert.rejects(
      api.query('UPDATE public.notification SET resource_id=$1', [crypto.randomUUID()]),
    );
    const r = (
      await admin.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.notification'::regclass",
      )
    ).rows[0];
    assert.ok(r.relrowsecurity && r.relforcerowsecurity);
    const role = (
      await admin.query(
        "SELECT rolcanlogin,rolbypassrls,rolsuper,rolcreaterole FROM pg_roles WHERE rolname='dw2_communications'",
      )
    ).rows[0];
    assert.deepEqual(role, {
      rolcanlogin: false,
      rolbypassrls: false,
      rolsuper: false,
      rolcreaterole: false,
    });
  } finally {
    await api.end();
  }
});

test('a real second tenant cannot reveal or mark another tenant recipient event', async () => {
  const b = await account(),
    other = await tenant(b, 'Phase6 isolated agency');
  const call = (path, body) => b.browser.request(other.path + path, 'POST', body, other.headers);
  const c = good(
    await call('/clients', { name: 'Isolated customer', description: '', status: 'ACTIVE' }),
  );
  const project = good(
    await call('/projects', {
      client_id: c.id,
      name: 'Isolated project',
      description: '',
      status: 'ACTIVE',
      portal_enabled: false,
      due_at: null,
    }),
  );
  const m = good(
    await call('/projects/' + project.id + '/members', {
      membership_id: other.principal.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    }),
  );
  const task = good(
    await call('/projects/' + project.id + '/tasks', taskBody('Other tenant private task', m.id)),
  );
  const notification = await wait(async () => {
    const response = good(
      await b.browser.request(other.path + '/notifications', 'GET', undefined, other.headers),
      200,
    );
    return response.items.find((n) => n.resource_id === task.id);
  });
  assert.equal(
    (await owner.browser.request(other.path + '/notifications', 'GET', undefined, other.headers))
      .status,
    404,
  );
  assert.equal((await req('/notifications/' + notification.id + '/read', 'POST', {})).status, 404);
  assert.ok(!good(await notices(owner), 200).items.some((n) => n.id === notification.id));
});

test('authorized upload status reads do not wait for the finalizer upload-row lock', async () => {
  const lock = await admin.connect();
  const upload = (
    await admin.query(
      'SELECT upload_id FROM public.file_asset WHERE organization_id=$1 AND id=$2',
      [t.organizationId, version.asset_id],
    )
  ).rows[0].upload_id;
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM public.project_upload WHERE id=$1 FOR UPDATE', [upload]);
  try {
    const result = await Promise.race([
      req(base() + '/uploads/' + upload),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Read waited on finalizer row lock')), 2000),
      ),
    ]);
    assert.equal(result.status, 200, result.body);
    assert.equal(result.json().status, 'READY');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
});
