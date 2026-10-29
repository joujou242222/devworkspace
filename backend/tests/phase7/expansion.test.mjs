import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { account, tenant, join, admin, runtime, Browser, mail } from '../phase2/helpers.mjs';

let owner, t, project, second, foreign, outsider, viewer, contributor, topic, doc, update, contact;
let upperDocId;
const good = (r, n = 200) => {
  assert.equal(r.status, n, r.body);
  return r.json();
};
const headers = (a = owner) => a.headers ?? t.headers;
const req = (path, method = 'GET', body, a = owner, h = {}) =>
  a.browser.request(t.path + path, method, body, { ...headers(a), ...h });
const base = () => '/projects/' + project.id;
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const rev = (r) => ({ 'If-Match': `"${r.revision}"` });
const text = (value = 'Text') => ({
  version: 1,
  blocks: [{ type: 'paragraph', spans: [{ text: value }] }],
});
const formats = {
  version: 1,
  blocks: [
    { type: 'heading', level: 2, spans: [{ text: 'Heading' }] },
    {
      type: 'paragraph',
      spans: [{ text: 'Both', bold: true, italic: true, href: 'https://example.test/path' }],
    },
    { type: 'bulletList', items: [[{ text: 'Bullet' }]] },
    { type: 'orderedList', items: [[{ text: 'Number' }]] },
  ],
};
async function until(work) {
  for (let i = 0; i < 100; i++) {
    const r = await work();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Expected durable effect');
}
const api = new Pool({ connectionString: runtime.PRODUCT_API_URL, max: 2 });
before(async () => {
  owner = await account();
  t = await tenant(owner, 'Phase7 expansion ' + crypto.randomUUID());
  foreign = await account();
  await tenant(foreign);
  const c = good(
    await req('/clients', 'POST', { name: 'Client', description: '', status: 'ACTIVE' }),
    201,
  );
  const p = {
    client_id: c.id,
    name: 'Expansion project',
    description: '',
    status: 'ACTIVE',
    portal_enabled: true,
    due_at: null,
  };
  project = good(await req('/projects', 'POST', p), 201);
  second = good(await req('/projects', 'POST', { ...p, name: 'Second permitted project' }), 201);
  for (const [label, role] of [
    ['viewer', 'VIEWER'],
    ['contributor', 'CONTRIBUTOR'],
    ['outsider', null],
  ]) {
    const a = await account(),
      m = await join(owner, t, a);
    a.headers = m.headers;
    if (role)
      a.pm = good(
        await req(base() + '/members', 'POST', {
          membership_id: m.principal.id,
          role,
          status: 'ACTIVE',
        }),
        201,
      );
    if (label === 'viewer') viewer = a;
    else if (label === 'contributor') contributor = a;
    else outsider = a;
  }
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  contact = { browser: new Browser(), headers: { 'X-Organization-Principal': f.approver2.id } };
  await contact.browser.login(f.approver2.email);
});
after(async () => {
  await api.end();
  await admin.end();
});

test('discussions persist, strict actors/ancestry, idempotent roots/replies and stable reply pagination', async () => {
  const k = key(),
    b = { title: 'Internal topic', body: 'Private discussion' };
  topic = good(await req(base() + '/discussions', 'POST', b, contributor, k), 201);
  assert.equal(
    good(await req(base() + '/discussions', 'POST', b, contributor, k), 201).id,
    topic.id,
  );
  assert.equal(
    (await req(base() + '/discussions', 'POST', { ...b, title: 'changed' }, contributor, k)).status,
    409,
  );
  for (let i = 0; i < 4; i++)
    good(
      await req(
        base() + `/discussions/${topic.id}/replies`,
        'POST',
        { body: 'Reply ' + i },
        contributor,
        key(),
      ),
      201,
    );
  const first = good(await req(base() + `/discussions/${topic.id}/replies?limit=2`));
  const next = good(
    await req(base() + `/discussions/${topic.id}/replies?limit=2&cursor=${first.nextCursor}`),
  );
  assert.equal(first.total, 4);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...first.items, ...next.items].map((r) => r.id)).size, 4);
  assert.equal(
    good(await req(base() + '/discussions?q=Internal', 'GET', undefined, viewer)).total,
    1,
  );
  for (const a of [viewer, outsider, contact, foreign])
    assert.ok(
      [403, 404].includes((await req(base() + '/discussions', 'POST', b, a, key())).status),
    );
  for (const a of [outsider, contact, foreign])
    assert.equal((await req(base() + `/discussions/${topic.id}`, 'GET', undefined, a)).status, 404);
  assert.equal((await req(`/projects/${second.id}/discussions/${topic.id}`)).status, 404);
  assert.equal(
    (
      await req(
        base() + '/discussions',
        'POST',
        { ...b, organization_id: t.organizationId },
        owner,
        key(),
      )
    ).status,
    400,
  );
});
test('document schema round-trips every format; library counts/search do not leak inaccessible projects', async () => {
  const upper = structuredClone(formats);
  upper.blocks[1].spans[0].href = 'HTTPS://example.test/path';
  const upperDoc = good(
    await req(
      '/documents',
      'POST',
      { project_id: project.id, title: 'Case-insensitive safe scheme', content: upper },
      owner,
      key(),
    ),
    201,
  );
  upperDocId = upperDoc.id;
  assert.deepEqual(good(await req(base() + `/documents/${upperDoc.id}`)).content, upper);
  doc = good(
    await req(
      '/documents',
      'POST',
      { project_id: project.id, title: 'Formatted document', content: formats },
      contributor,
      key(),
    ),
    201,
  );
  assert.deepEqual(good(await req(base() + `/documents/${doc.id}`)).content, formats);
  assert.equal(good(await req('/documents?q=Formatted', 'GET', undefined, viewer)).total, 1);
  assert.equal(good(await req('/documents?q=Formatted', 'GET', undefined, outsider)).total, 0);
  assert.equal((await req(base() + `/documents/${doc.id}`, 'GET', undefined, contact)).status, 404);
  assert.equal(
    (
      await req(
        '/documents',
        'POST',
        { project_id: second.id, title: 'Forbidden', content: text() },
        contributor,
        key(),
      )
    ).status,
    404,
  );
  for (const content of [
    { version: 1, blocks: [{ type: 'html', html: '<script>x</script>' }] },
    {
      version: 1,
      blocks: [{ type: 'paragraph', spans: [{ text: 'x', href: 'javascript:alert(1)' }] }],
    },
    {
      version: 1,
      blocks: [{ type: 'paragraph', spans: [{ text: 'x', style: 'position:fixed' }] }],
    },
    text('x'.repeat(10001)),
    { version: 1, blocks: Array(201).fill({ type: 'paragraph', spans: [] }) },
  ])
    assert.equal(
      (
        await req(
          base() + `/documents/${doc.id}`,
          'PATCH',
          { title: 'Hostile', content },
          owner,
          rev(doc),
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await req(
        base() + `/documents/${doc.id}`,
        'PATCH',
        { title: 'Viewer', content: text() },
        viewer,
        rev(doc),
      )
    ).status,
    403,
  );
  const r = await Promise.all(
    ['one', 'two'].map((title) =>
      req(
        base() + `/documents/${doc.id}`,
        'PATCH',
        { title, content: formats },
        contributor,
        rev(doc),
      ),
    ),
  );
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 412]);
  doc = good(await req(base() + `/documents/${doc.id}`));
});
test('real restricted runtime enforces no-context/tenant/FK/structured content/immutable history', async () => {
  const c = await api.connect();
  try {
    assert.equal(
      (await c.query('SELECT id FROM public.document WHERE id=$1', [doc.id])).rowCount,
      0,
    );
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    const role = (
      await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    ).rows[0];
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    await c.query('SAVEPOINT negative');
    await assert.rejects(
      c.query('UPDATE public.document SET content=$2,revision=revision+1 WHERE id=$1', [
        doc.id,
        { version: 1, blocks: [{ type: 'script' }] },
      ]),
      (e) => e.code === '23514',
    );
    await c.query('ROLLBACK TO SAVEPOINT negative');
    await assert.rejects(
      c.query('UPDATE public.discussion_reply SET body=$1 WHERE discussion_id=$2', [
        'tamper',
        topic.id,
      ]),
      (e) => ['42501', '23514'].includes(e.code),
    );
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
test('audit/outbox failure rolls back document saves and publication; audit browsing is admin-only and safe', async () => {
  await admin.query(
    `CREATE FUNCTION public.phase7_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${t.organizationId}'::uuid AND NEW.metadata->>'action' IN ('document.saved','update.published') THEN RAISE EXCEPTION 'synthetic phase7 fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase7_fault BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.phase7_fault()`,
  );
  try {
    assert.equal(
      (
        await req(
          base() + `/documents/${doc.id}`,
          'PATCH',
          { title: 'Should rollback', content: text() },
          owner,
          rev(doc),
        )
      ).status,
      503,
    );
    assert.equal(
      (await req(base() + '/updates', 'POST', { body: 'Should rollback' }, owner, key())).status,
      503,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER phase7_fault ON public.audit_event; DROP FUNCTION public.phase7_fault()',
    );
  }
  assert.equal(good(await req(base() + `/documents/${doc.id}`)).revision, doc.revision);
  assert.equal(good(await req(base() + '/updates')).total, 0);
  const rows = good(await req('/audit?action=document.created')).items;
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((r) => r.target_id)), new Set([doc.id, upperDocId]));
  assert.ok(!JSON.stringify(rows).includes('Both'));
  for (const a of [viewer, contributor, outsider, contact, foreign])
    assert.ok([403, 404].includes((await req('/audit', 'GET', undefined, a)).status));
});
test('worker projects activity once with correlated audit/outbox and no client content leakage', async () => {
  const rows = await until(async () => {
    const x = good(await req(base() + '/activity'));
    return x.total >= 7 ? x.items : null;
  });
  assert.equal(new Set(rows.map((x) => x.event_id)).size, rows.length);
  assert.ok(!JSON.stringify(rows).includes('Private discussion'));
  const e = (
    await admin.query(
      "SELECT e.id,e.audit_id,a.id actual,e.actor_id FROM public.tenant_event e JOIN public.audit_event a ON a.id=e.audit_id AND a.organization_id=e.organization_id WHERE e.target_id=$1 AND e.action='document.created'",
      [doc.id],
    )
  ).rows[0];
  assert.equal(e.audit_id, e.actual);
  assert.equal(e.actor_id, contributor.user.id);
  const first = good(await req(base() + '/activity?limit=2'));
  assert.equal(first.items.length, 2);
  assert.equal(
    good(await req(base() + '/activity?limit=2&cursor=' + first.nextCursor)).items.some((x) =>
      first.items.some((y) => x.id === y.id),
    ),
    false,
  );
  assert.equal(
    (await req('/portal/updates?project_id=' + project.id, 'GET', undefined, contact)).status,
    404,
  );
});
test('live reports reconcile task formulas, UTC windows, exact-version counts and Member scope', async () => {
  for (const status of ['TODO', 'DONE', 'CANCELLED'])
    good(
      await req(base() + '/tasks', 'POST', {
        title: status,
        description: '',
        milestone_id: null,
        assignee_id: null,
        priority: 'NORMAL',
        status,
        due_at: '2026-01-01T00:00:00.000Z',
        position: 0,
      }),
      201,
    );
  const result = good(
    await req('/reports?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z'),
  );
  assert.equal(result.totals.tasks, 2);
  assert.equal(result.totals.done, 1);
  assert.equal(result.totals.overdue, 1);
  assert.equal(result.totals.progress, 0.5);
  assert.equal(result.totals.turnaround_seconds, null);
  assert.equal(good(await req('/reports', 'GET', undefined, viewer)).projects.length, 1);
  assert.equal(good(await req('/reports', 'GET', undefined, outsider)).totals.progress, null);
  assert.equal(
    (await req('/reports?project_id=' + second.id, 'GET', undefined, viewer)).status,
    404,
  );
  assert.equal(
    (await req('/reports?from=2027-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')).status,
    400,
  );
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8')),
    b = new Browser();
  await b.login(f.owner.email);
  const r = good(
    await b.request(
      `/api/v1/organizations/${f.org}/reports?project_id=${f.project}`,
      'GET',
      undefined,
      { 'X-Organization-Principal': f.principal },
    ),
  );
  const expected = (
    await admin.query(
      'SELECT count(DISTINCT version_id)::int n FROM public.approval WHERE organization_id=$1 AND project_id=$2',
      [f.org, f.project],
    )
  ).rows[0].n;
  assert.equal(r.totals.approved_versions, expected);
  assert.ok(r.totals.decisions > 0);
  assert.ok(r.totals.turnaround_seconds >= 0);
});
test('publish/withdraw respects Manager scope and concurrent archive/reply/document save preserves lifecycle', async () => {
  assert.equal(
    (await req(base() + '/updates', 'POST', { body: 'Denied' }, contributor, key())).status,
    403,
  );
  update = good(
    await req(base() + '/updates', 'POST', { body: 'Published client news' }, owner, key()),
    201,
  );
  const outcomes = await Promise.all([
    req(base() + `/discussions/${topic.id}/archive`, 'POST', {}, owner, rev(topic)),
    req(base() + `/discussions/${topic.id}/replies`, 'POST', { body: 'Race' }, contributor, key()),
  ]);
  assert.equal(outcomes[0].status, 200);
  assert.ok([201, 409].includes(outcomes[1].status));
  assert.equal(
    (
      await req(
        base() + `/discussions/${topic.id}/replies`,
        'POST',
        { body: 'Closed' },
        contributor,
        key(),
      )
    ).status,
    409,
  );
  const r = await Promise.all([
    req(base() + `/documents/${doc.id}/archive`, 'POST', {}, owner, rev(doc)),
    req(
      base() + `/documents/${doc.id}`,
      'PATCH',
      { title: 'Race', content: formats },
      contributor,
      rev(doc),
    ),
  ]);
  assert.equal(r.filter((x) => x.status === 200).length, 1);
  doc = good(await req(base() + `/documents/${doc.id}`));
  await writeFile(
    '.local/phase7/browser.json',
    JSON.stringify({
      org: t.organizationId,
      principal: t.principal.id,
      owner: owner.email,
      project: project.id,
      second: second.id,
      contributor: {
        email: contributor.email,
        principal: contributor.headers['X-Organization-Principal'],
      },
      viewer: { email: viewer.email, principal: viewer.headers['X-Organization-Principal'] },
      topic: topic.id,
    }),
  );
});

test('client aggregate authorizes each project before counts/pages, denies forged filters and withdraws immediately', async () => {
  const clientA = await account(),
    clientB = await account();
  async function invite(a, clientId, p) {
    const c = good(
      await req(`/clients/${clientId}/contacts`, 'POST', {
        name: 'External reader',
        email: a.email,
        status: 'ACTIVE',
      }),
      201,
    );
    good(
      await req(`/clients/${clientId}/contacts/${c.id}/invitations`, 'POST', {
        project_id: p.id,
        role: 'VIEWER',
      }),
      201,
    );
    const link = await mail(a.email, 'DevWorkspace client invitation');
    good(
      await a.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token: link.searchParams.get('token') },
        key(),
      ),
    );
    await a.browser.login(a.email);
    a.headers = { 'X-Organization-Principal': c.id };
    a.contact = c;
    return c;
  }
  await invite(clientA, project.client_id, project);
  const g = good(
    await req(`/projects/${second.id}/grants`, 'POST', {
      contact_id: clientA.contact.id,
      role: 'VIEWER',
      status: 'ACTIVE',
    }),
    201,
  );
  const otherClient = good(
    await req('/clients', 'POST', { name: 'Other client', description: '', status: 'ACTIVE' }),
    201,
  );
  const otherProject = good(
    await req('/projects', 'POST', {
      client_id: otherClient.id,
      name: 'Other client private project',
      description: '',
      status: 'ACTIVE',
      portal_enabled: true,
      due_at: null,
    }),
    201,
  );
  await invite(clientB, otherClient.id, otherProject);
  const ungranted = good(
    await req('/projects', 'POST', {
      client_id: project.client_id,
      name: 'Same client without grant',
      description: '',
      status: 'ACTIVE',
      portal_enabled: true,
      due_at: null,
    }),
    201,
  );
  for (const p of [second, otherProject, ungranted])
    good(
      await req(`/projects/${p.id}/updates`, 'POST', { body: 'News ' + p.id }, owner, key()),
      201,
    );
  const feed = good(await req('/portal/updates?limit=1', 'GET', undefined, clientA));
  assert.equal(feed.total, 2);
  assert.equal(feed.projects.length, 2);
  assert.ok(feed.nextCursor);
  const next = good(
    await req('/portal/updates?limit=1&cursor=' + feed.nextCursor, 'GET', undefined, clientA),
  );
  assert.notEqual(next.items[0].id, feed.items[0].id);
  assert.equal(next.nextCursor, null);
  for (const p of [otherProject, ungranted, { id: crypto.randomUUID() }])
    assert.equal(
      (await req('/portal/updates?project_id=' + p.id, 'GET', undefined, clientA)).status,
      404,
    );
  assert.equal(good(await req('/portal/updates', 'GET', undefined, clientB)).total, 1);
  const withdrawn = good(
    await req(base() + `/updates/${update.id}/withdraw`, 'POST', {}, owner, rev(update)),
  );
  assert.equal(withdrawn.status, 'WITHDRAWN');
  assert.equal(
    good(await req('/portal/updates?project_id=' + project.id, 'GET', undefined, clientA)).total,
    0,
  );
  good(
    await req(
      `/projects/${second.id}/grants/${g.id}`,
      'PATCH',
      { contact_id: g.contact_id, role: g.role, status: 'REVOKED' },
      owner,
      rev(g),
    ),
  );
  assert.equal(
    (await req('/portal/updates?project_id=' + second.id, 'GET', undefined, clientA)).status,
    404,
  );
  assert.equal(good(await req('/portal/updates', 'GET', undefined, clientA)).total, 0);
  const f = JSON.parse(await readFile('.local/phase7/browser.json', 'utf8'));
  f.client = { email: clientA.email, principal: clientA.contact.id };
  await writeFile('.local/phase7/browser.json', JSON.stringify(f));
});

test('new category defaults, self CAS, prospective suppression/no backfill, socket privacy and live revocation', async () => {
  const user = contributor,
    preferences = good(await user.browser.request('/api/v1/me/notification-preferences'));
  assert.equal(preferences.discussions_documents, true);
  assert.equal(preferences.client_updates, true);
  const saved = good(
    await user.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: true, reviews: true, discussions_documents: false, client_updates: false },
      rev(preferences),
    ),
  );
  const suppressed = good(
    await req(
      base() + '/discussions',
      'POST',
      { title: 'Suppressed', body: 'Internal only' },
      owner,
      key(),
    ),
    201,
  );
  await until(
    async () =>
      (
        await admin.query(
          "SELECT 1 FROM public.consumer_receipt r JOIN public.tenant_event e ON e.id=r.event_id WHERE e.target_id=$1 AND r.handler='notifications-v6'",
          [suppressed.id],
        )
      ).rowCount,
  );
  const notices = () =>
    req('/notifications?category=discussions_documents', 'GET', undefined, user);
  assert.ok(!good(await notices()).items.some((n) => n.resource_id === suppressed.id));
  good(
    await user.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: true, reviews: true, discussions_documents: true, client_updates: true },
      rev(saved),
    ),
  );
  assert.ok(!good(await notices()).items.some((n) => n.resource_id === suppressed.id));
  const socket = io('https://localhost:8443', {
    transports: ['websocket'],
    ca: await readFile('.local/tls/localhost.pem'),
    extraHeaders: {
      Origin: 'https://localhost:8443',
      Cookie: [...user.browser.cookies].map(([k, v]) => k + '=' + v).join('; '),
    },
    auth: {
      organization_id: t.organizationId,
      principal_id: headers(user)['X-Organization-Principal'],
      capacity: 'INTERNAL',
      project_id: project.id,
    },
  });
  try {
    await new Promise((r, j) => {
      socket.once('connect', r);
      socket.once('connect_error', j);
    });
    const hints = [];
    socket.on('state.changed', (h) => hints.push(h));
    const d = good(
      await req(
        '/documents',
        'POST',
        { project_id: project.id, title: 'Socket document', content: text('No body on socket') },
        owner,
        key(),
      ),
      201,
    );
    await until(async () => good(await notices()).items.some((n) => n.resource_id === d.id));
    await until(async () => hints.length);
    assert.ok(hints.every((h) => Object.keys(h).sort().join(',') === 'event_id,project_id'));
    assert.ok(!JSON.stringify(hints).includes('No body'));
    const disconnected = new Promise((r) => socket.once('disconnect', r));
    good(
      await req(
        base() + `/members/${user.pm.id}`,
        'PATCH',
        { membership_id: user.pm.membership_id, role: 'CONTRIBUTOR', status: 'INACTIVE' },
        owner,
        rev(user.pm),
      ),
    );
    await disconnected;
    assert.equal(good(await notices()).total, 0);
    assert.equal((await req(base() + `/documents/${d.id}`, 'GET', undefined, user)).status, 404);
  } finally {
    socket.disconnect();
  }
});

test('shared review milestones disappear on exact share revocation and cannot disclose internal conversion details', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8')),
    b = new Browser();
  await b.login(f.approver2.email);
  const root = `/api/v1/organizations/${f.org}`,
    h = { 'X-Organization-Principal': f.approver2.id };
  const feed = good(await b.request(root + '/portal/updates', 'GET', undefined, h));
  const milestone = feed.items.find((x) => x.kind === 'REVIEW' && x.status === 'APPROVED');
  assert.ok(milestone);
  assert.ok(milestone.version_number > 0);
  assert.ok(!JSON.stringify(feed).includes('source_feedback_thread_id'));
  const internal = new Browser();
  await internal.login(f.owner.email);
  const ih = { 'X-Organization-Principal': f.principal };
  const cycle = good(
    await internal.request(
      root + `/projects/${milestone.project_id}/reviews/${milestone.review_id}`,
      'GET',
      undefined,
      ih,
    ),
  );
  const share = (
    await admin.query(
      'SELECT * FROM public.version_share WHERE organization_id=$1 AND version_id=$2',
      [f.org, cycle.version_id],
    )
  ).rows[0];
  good(
    await internal.request(
      root + `/projects/${milestone.project_id}/versions/${cycle.version_id}/share`,
      'PATCH',
      { status: 'REVOKED' },
      { ...ih, ...rev(share) },
    ),
  );
  assert.ok(
    !good(await b.request(root + '/portal/updates', 'GET', undefined, h)).items.some(
      (x) => x.id === milestone.id,
    ),
  );
  good(
    await internal.request(
      root + `/projects/${milestone.project_id}/versions/${cycle.version_id}/share`,
      'PATCH',
      { status: 'ACTIVE' },
      { ...ih, ...rev({ revision: share.revision + 1 }) },
    ),
  );
});

test('Manager publication, client-update preferences, withdrawal hints and portal/session revocation use current authority', async () => {
  const a = await account(),
    m = await join(owner, t, a);
  a.headers = m.headers;
  good(
    await req(base() + '/members', 'POST', {
      membership_id: m.principal.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    }),
    201,
  );
  const f = JSON.parse(await readFile('.local/phase7/browser.json', 'utf8')),
    external = {
      browser: new Browser(),
      headers: { 'X-Organization-Principal': f.client.principal },
    };
  await external.browser.login(f.client.email);
  let pref = good(await external.browser.request('/api/v1/me/notification-preferences'));
  pref = good(
    await external.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: true, reviews: true, discussions_documents: true, client_updates: false },
      rev(pref),
    ),
  );
  const u = good(
    await req(base() + '/updates', 'POST', { body: 'Manager-published update' }, a, key()),
    201,
  );
  await until(
    async () =>
      (
        await admin.query(
          "SELECT 1 FROM public.consumer_receipt r JOIN public.tenant_event e ON e.id=r.event_id WHERE e.target_id=$1 AND r.handler='notifications-v6'",
          [u.id],
        )
      ).rowCount,
  );
  assert.ok(
    !good(
      await req('/portal/notifications?category=client_updates', 'GET', undefined, external),
    ).items.some((n) => n.resource_id === u.id),
  );
  good(
    await external.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: true, reviews: true, discussions_documents: true, client_updates: true },
      rev(pref),
    ),
  );
  const notice = good(
    await req(base() + '/updates', 'POST', { body: 'Notified client update' }, a, key()),
    201,
  );
  await until(async () =>
    good(
      await req('/portal/notifications?category=client_updates', 'GET', undefined, external),
    ).items.some((n) => n.resource_id === notice.id),
  );
  assert.equal(
    (await req(`/projects/${second.id}/updates`, 'POST', { body: 'Denied' }, a, key())).status,
    404,
  );
  const p = good(await req(base()));
  good(
    await req(
      base(),
      'PATCH',
      {
        name: p.name,
        client_id: p.client_id,
        description: p.description,
        status: p.status,
        due_at: p.due_at,
        portal_enabled: false,
      },
      owner,
      rev(p),
    ),
  );
  assert.equal(
    (await req('/portal/updates?project_id=' + project.id, 'GET', undefined, external)).status,
    404,
  );
  assert.equal(
    good(await req('/portal/notifications?category=client_updates', 'GET', undefined, external))
      .total,
    0,
  );
  const current = good(await req(base()));
  good(
    await req(
      base(),
      'PATCH',
      {
        name: current.name,
        client_id: current.client_id,
        description: current.description,
        status: current.status,
        due_at: current.due_at,
        portal_enabled: true,
      },
      owner,
      rev(current),
    ),
  );
  good(await external.browser.request('/api/v1/identity/logout', 'POST', {}));
  assert.equal((await req('/portal/updates', 'GET', undefined, external)).status, 401);
});

test('restricted SQL preserves tenant/project ancestry, positive revisions, append-only activity/audit and lease boundaries', async () => {
  const c = await api.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    for (const [sql, values] of [
      [
        'INSERT INTO public.discussion_reply(organization_id,project_id,discussion_id,author_id,body) VALUES($1,$2,$3,$4,$5)',
        [t.organizationId, second.id, topic.id, owner.user.id, 'Cross-project'],
      ],
      [
        'UPDATE public.document SET project_id=$2,revision=revision+1 WHERE id=$1',
        [doc.id, second.id],
      ],
      [
        'UPDATE public.audit_event SET action=$1 WHERE organization_id=$2',
        ['tamper', t.organizationId],
      ],
      ['DELETE FROM public.project_activity WHERE organization_id=$1', [t.organizationId]],
    ]) {
      await c.query('SAVEPOINT negative');
      await assert.rejects(c.query(sql, values), (e) =>
        ['23503', '23514', '42501'].includes(e.code),
      );
      await c.query('ROLLBACK TO SAVEPOINT negative');
    }
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  const env = Object.fromEntries(
    (await readFile('.local/phase2-worker.env', 'utf8'))
      .trim()
      .split('\n')
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1).trim()];
      }),
  );
  const worker = new Pool({ connectionString: env.PRODUCT_WORKER_URL });
  try {
    await assert.rejects(
      worker.query('SELECT public.materialize_notifications($1,$2)', [
        crypto.randomUUID(),
        crypto.randomUUID(),
      ]),
      (e) => e.code === '42501',
    );
    await assert.rejects(worker.query('SELECT * FROM public.document'), (e) => e.code === '42501');
  } finally {
    await worker.end();
  }
});

test('Phase 6 assignment recipient binding remains correct alongside the new expansion categories', async () => {
  const pm = good(
    await req(base() + '/members', 'POST', {
      membership_id: t.principal.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    }),
    201,
  );
  const body = {
    title: 'Expansion assignment regression',
    description: 'Synthetic',
    milestone_id: null,
    assignee_id: pm.id,
    priority: 'NORMAL',
    status: 'TODO',
    due_at: null,
    position: 0,
  };
  const task = good(await req(base() + '/tasks', 'POST', body), 201);
  await until(async () =>
    good(await req('/notifications?category=assignments')).items.some(
      (n) => n.resource_id === task.id,
    ),
  );
  good(
    await req(
      base() + `/tasks/${task.id}`,
      'PATCH',
      { ...body, status: 'CANCELLED' },
      owner,
      rev(task),
    ),
  );
});
