import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { account, tenant, join, admin, runtime, mail } from '../phase2/helpers.mjs';
let owner,
  other,
  manager,
  contributor,
  viewer,
  external,
  t,
  b,
  m,
  c,
  v,
  client,
  client2,
  project,
  project2,
  foreign,
  pm,
  pc,
  pv,
  milestone,
  task,
  item;
const clientBody = (name) => ({ name, description: 'Synthetic Phase 3', status: 'ACTIVE' });
const projectBody = (client_id, name) => ({
  client_id,
  name,
  description: 'Synthetic Phase 3 project',
  status: 'ACTIVE',
  portal_enabled: true,
  due_at: null,
});
const taskBody = (title, extra = {}) => ({
  title,
  description: 'Synthetic task',
  milestone_id: null,
  assignee_id: null,
  priority: 'NORMAL',
  status: 'TODO',
  due_at: null,
  position: 0,
  ...extra,
});
const header = (h, row) => ({ ...h, 'If-Match': `"${row.revision}"` });
async function req(a, path, method = 'GET', body, h = t.headers) {
  return a.browser.request(t.path + path, method, body, h);
}
async function create(path, body) {
  const r = await req(owner, path, 'POST', body);
  assert.equal(r.status, 201, JSON.stringify(r.json()));
  return r.json();
}
async function update(path, row, body, a = owner, h = t.headers) {
  const r = await req(a, path, 'PATCH', body, header(h, row));
  assert.equal(r.status, 200, JSON.stringify(r.json()));
  return r.json();
}
async function race(work) {
  const gate = await admin.connect();
  await gate.query('BEGIN');
  await gate.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [t.organizationId]);
  const pending = work();
  try {
    let waiting = false;
    for (let n = 0; n < 300; n++) {
      const r = await admin.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='dw2_api' AND wait_event_type='Lock' AND query LIKE '%public.organization%'",
      );
      if (r.rows[0].n >= 2) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      waiting,
      'Both independent API transactions must be waiting on the held organization lock',
    );
  } finally {
    await gate.query('COMMIT');
    gate.release();
  }
  return pending;
}
const projectPath = () => '/projects/' + project.id;
const taskPath = () => projectPath() + '/tasks/' + task.id;
before(async () => {
  owner = await account();
  t = await tenant(owner, 'Phase 3 primary');
  other = await account();
  b = await tenant(other, 'Phase 3 foreign');
  manager = await account();
  m = await join(owner, t, manager);
  contributor = await account();
  c = await join(owner, t, contributor);
  viewer = await account();
  v = await join(owner, t, viewer);
  external = await account();
  client = await create('/clients', clientBody('Core client'));
  client2 = await create('/clients', clientBody('Private second client'));
  project = await create('/projects', projectBody(client.id, 'Core project'));
  project2 = await create('/projects', projectBody(client2.id, 'Private second project'));
  const fc = await other.browser.request(
    b.path + '/clients',
    'POST',
    clientBody('Foreign'),
    b.headers,
  );
  assert.equal(fc.status, 201);
  const fp = await other.browser.request(
    b.path + '/projects',
    'POST',
    projectBody(fc.json().id, 'Foreign'),
    b.headers,
  );
  assert.equal(fp.status, 201);
  foreign = fp.json();
  pm = await create(projectPath() + '/members', {
    membership_id: m.principal.id,
    role: 'MANAGER',
    status: 'ACTIVE',
  });
  pc = await create(projectPath() + '/members', {
    membership_id: c.principal.id,
    role: 'CONTRIBUTOR',
    status: 'ACTIVE',
  });
  pv = await create(projectPath() + '/members', {
    membership_id: v.principal.id,
    role: 'VIEWER',
    status: 'ACTIVE',
  });
  milestone = await create(projectPath() + '/milestones', {
    title: 'First milestone',
    due_at: null,
    position: 1,
    status: 'OPEN',
  });
  task = await create(
    projectPath() + '/tasks',
    taskBody('Assigned task', {
      milestone_id: milestone.id,
      assignee_id: pc.id,
      priority: 'HIGH',
      due_at: '2026-01-01T00:00:00Z',
    }),
  );
  item = await create(taskPath() + '/checklist', {
    label: 'Inspect source',
    position: 1,
    completed: false,
  });
});
after(async () => {
  await admin.end();
});
test('client/contact persistence, scoped summaries and archival conflict', async () => {
  const contact = await create('/clients/' + client.id + '/contacts', {
    name: 'Client user',
    email: external.email,
    status: 'ACTIVE',
  });
  assert.equal((await req(owner, '/clients/' + client.id + '/contacts')).json().total, 1);
  assert.equal(
    (await req(contributor, '/clients/' + client.id + '/contacts', 'GET', undefined, c.headers))
      .status,
    404,
  );
  assert.equal(
    (await req(manager, '/clients/' + client.id + '/contacts', 'GET', undefined, m.headers)).status,
    200,
  );
  assert.equal(
    (await req(owner, '/clients/' + client2.id + '/contacts/' + contact.id)).status,
    404,
  );
  assert.equal(
    (
      await req(
        owner,
        '/clients/' + client.id,
        'PATCH',
        { ...clientBody('Core client'), status: 'ARCHIVED' },
        header(t.headers, client),
      )
    ).status,
    409,
  );
  assert.equal((await req(contributor, '/clients', 'GET', undefined, c.headers)).json().total, 1);
});
test('organization/project isolation is applied before search, counts and nested reads', async () => {
  for (const path of [
    '/projects/' + project2.id,
    '/projects/' + project2.id + '/tasks',
    '/projects/' + foreign.id,
    '/projects/' + project2.id + '/tasks/' + task.id + '/history',
  ])
    assert.equal((await req(contributor, path, 'GET', undefined, c.headers)).status, 404);
  const list = (await req(contributor, '/projects?q=Private', 'GET', undefined, c.headers)).json();
  assert.equal(list.total, 0);
  assert.equal((await req(contributor, '/dashboard', 'GET', undefined, c.headers)).json().total, 1);
  assert.equal(
    (
      await req(owner, projectPath(), 'GET', undefined, {
        ...t.headers,
        'X-Organization-Principal': b.principal.id,
      })
    ).status,
    404,
  );
});
test('Manager manages assigned work without organization-wide project/client authority', async () => {
  assert.equal(
    (await req(manager, '/clients', 'POST', clientBody('Forbidden'), m.headers)).status,
    403,
  );
  assert.equal(
    (await req(manager, '/projects', 'POST', projectBody(client.id, 'Forbidden'), m.headers))
      .status,
    403,
  );
  const r = await req(
    manager,
    projectPath() + '/tasks',
    'POST',
    taskBody('Manager task'),
    m.headers,
  );
  assert.equal(r.status, 201);
  assert.equal(
    (await req(manager, '/projects/' + project2.id, 'GET', undefined, m.headers)).status,
    404,
  );
});
test('only the assigned Contributor changes work state; overposting and Viewer writes fail', async () => {
  assert.equal(
    (await req(viewer, taskPath(), 'PATCH', { status: 'DONE' }, header(v.headers, task))).status,
    403,
  );
  assert.equal(
    (
      await req(
        contributor,
        taskPath(),
        'PATCH',
        { status: 'DONE', priority: 'URGENT' },
        header(c.headers, task),
      )
    ).status,
    400,
  );
  task = await update(taskPath(), task, { status: 'IN_PROGRESS' }, contributor, c.headers);
  assert.equal(
    (await req(contributor, taskPath(), 'PATCH', { status: 'CANCELLED' }, header(c.headers, task)))
      .status,
    400,
  );
  assert.equal(
    (
      await req(
        contributor,
        taskPath() + '/checklist/' + item.id,
        'PATCH',
        { completed: true },
        header(c.headers, item),
      )
    ).status,
    200,
  );
  item = (await req(owner, taskPath() + '/checklist/' + item.id)).json();
  assert.ok(item.completed_at);
  assert.equal(item.completed_by, contributor.user.id);
  assert.equal((await req(owner, taskPath())).json().status, 'IN_PROGRESS');
});
test('checklist revisions race with exactly one winner and preserve completion metadata', async () => {
  const results = await race(() =>
    Promise.all(
      [true, false].map((completed) =>
        req(
          contributor,
          taskPath() + '/checklist/' + item.id,
          'PATCH',
          { completed },
          header(c.headers, item),
        ),
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
  item = (await req(owner, taskPath() + '/checklist/' + item.id)).json();
  assert.equal(Boolean(item.completed_at), item.completed);
  assert.equal(
    (await req(owner, projectPath() + '/tasks/' + crypto.randomUUID() + '/checklist/' + item.id))
      .status,
    404,
  );
});
test('internal comment threads/replies and append-only actor history survive reload', async () => {
  const root = await req(
    contributor,
    taskPath() + '/comments',
    'POST',
    { body: 'Internal source discussion', thread_id: null },
    c.headers,
  );
  assert.equal(root.status, 201);
  assert.equal(
    (
      await req(
        manager,
        taskPath() + '/comments',
        'POST',
        { body: 'Reply', thread_id: root.json().id },
        m.headers,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await req(
        viewer,
        taskPath() + '/comments',
        'POST',
        { body: 'Forbidden', thread_id: null },
        v.headers,
      )
    ).status,
    403,
  );
  const comments = (await req(viewer, taskPath() + '/comments', 'GET', undefined, v.headers)).json()
    .items;
  assert.equal(comments.length, 2);
  assert.equal(comments[0].author_id, contributor.user.id);
  const history = (await req(owner, taskPath() + '/history')).json().items;
  assert.ok(history.some((h) => h.kind === 'comment.created'));
  assert.ok(history.some((h) => h.kind === 'tasks.updated'));
});
test('same-project milestone and eligible assignee ancestry is enforced', async () => {
  const wrong = await create('/projects/' + project2.id + '/milestones', {
    title: 'Wrong project',
    due_at: null,
    position: 0,
    status: 'OPEN',
  });
  for (const extra of [
    { milestone_id: wrong.id },
    { assignee_id: pv.id },
    { assignee_id: b.principal.id },
    { assignee_id: foreign.id },
  ])
    assert.ok(
      [404, 409].includes(
        (await req(owner, projectPath() + '/tasks', 'POST', taskBody('Bad ancestry', extra)))
          .status,
      ),
    );
  assert.equal(
    (
      await req(owner, projectPath() + '/tasks', 'POST', {
        ...taskBody('Forged'),
        organization_id: b.organizationId,
      })
    ).status,
    400,
  );
});
test('status/priority/assignee/milestone/deadline filters and My Tasks reconcile', async () => {
  const q = `?priority=HIGH&status=IN_PROGRESS&assignee_id=${pc.id}&milestone_id=${milestone.id}&due_to=2026-10-16T00:00:00Z`;
  const result = (
    await req(contributor, projectPath() + '/tasks' + q, 'GET', undefined, c.headers)
  ).json();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, task.id);
  assert.equal(
    (
      await req(contributor, '/my-tasks?project_id=' + project.id, 'GET', undefined, c.headers)
    ).json().total,
    1,
  );
  assert.equal((await req(viewer, '/my-tasks', 'GET', undefined, v.headers)).json().total, 0);
  assert.equal((await req(owner, projectPath() + '/tasks?limit=1')).json().items.length, 1);
  const summary = (await req(owner, projectPath())).json().summary;
  assert.ok(summary.overdue >= 1);
  assert.equal(summary.done, 0);
  assert.equal(
    (
      await req(
        owner,
        projectPath() + '/tasks?due_from=2027-01-01T00:00:00Z&due_to=2026-01-01T00:00:00Z',
      )
    ).status,
    400,
  );
});
test('explicit milestone completion rejects unfinished tasks and reopening work reopens milestone', async () => {
  assert.equal(
    (
      await req(
        owner,
        projectPath() + '/milestones/' + milestone.id,
        'PATCH',
        { title: milestone.title, due_at: null, position: 1, status: 'COMPLETED' },
        header(t.headers, milestone),
      )
    ).status,
    409,
  );
  task = await update(taskPath(), task, { status: 'DONE' }, contributor, c.headers);
  milestone = await update(projectPath() + '/milestones/' + milestone.id, milestone, {
    title: milestone.title,
    due_at: null,
    position: 1,
    status: 'COMPLETED',
  });
  task = await update(taskPath(), task, { status: 'TODO' }, contributor, c.headers);
  milestone = (await req(owner, projectPath() + '/milestones/' + milestone.id)).json();
  assert.equal(milestone.status, 'OPEN');
});
test('task CAS race and role revocation atomically clear active assignment', async () => {
  const results = await race(() =>
    Promise.all(
      ['IN_PROGRESS', 'BLOCKED'].map((status) =>
        req(contributor, taskPath(), 'PATCH', { status }, header(c.headers, task)),
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
  pc = await update(projectPath() + '/members/' + pc.id, pc, {
    membership_id: c.principal.id,
    role: 'VIEWER',
    status: 'ACTIVE',
  });
  task = (await req(owner, taskPath())).json();
  assert.equal(task.assignee_id, null);
  assert.equal(
    (await req(contributor, taskPath(), 'PATCH', { status: 'DONE' }, header(c.headers, task)))
      .status,
    403,
  );
  assert.equal((await req(contributor, '/my-tasks', 'GET', undefined, c.headers)).json().total, 0);
  pc = await update(projectPath() + '/members/' + pc.id, pc, {
    membership_id: c.principal.id,
    role: 'CONTRIBUTOR',
    status: 'ACTIVE',
  });
});
test('project completion, reopen and archive preserve history and block writes', async () => {
  const p = await create('/projects', projectBody(client.id, 'Lifecycle project'));
  let current = await update('/projects/' + p.id, p, {
    ...projectBody(client.id, p.name),
    status: 'COMPLETED',
  });
  assert.equal(
    (await req(owner, '/projects/' + p.id + '/tasks', 'POST', taskBody('Forbidden completed')))
      .status,
    409,
  );
  current = await update('/projects/' + p.id, current, {
    ...projectBody(client.id, p.name),
    status: 'ACTIVE',
  });
  current = await update('/projects/' + p.id, current, {
    ...projectBody(client.id, p.name),
    status: 'ARCHIVED',
  });
  assert.equal(
    (
      await req(owner, '/projects/' + p.id + '/milestones', 'POST', {
        title: 'Forbidden archived',
        due_at: null,
        position: 0,
        status: 'OPEN',
      })
    ).status,
    409,
  );
  assert.equal((await req(owner, '/projects/' + p.id)).status, 200);
  assert.equal(
    (
      await req(
        owner,
        '/projects/' + p.id,
        'PATCH',
        projectBody(client.id, p.name),
        header(t.headers, current),
      )
    ).status,
    409,
  );
});
test('client invitation accepts exact contact/project scope without creating internal membership', async () => {
  const contact = (await req(owner, '/clients/' + client.id + '/contacts')).json().items[0];
  const r = await req(owner, `/clients/${client.id}/contacts/${contact.id}/invitations`, 'POST', {
    project_id: project.id,
    role: 'REVIEWER',
  });
  assert.equal(r.status, 201);
  const link = await mail(external.email, 'DevWorkspace client invitation');
  const token = link.searchParams.get('token');
  const keys = [crypto.randomUUID(), crypto.randomUUID()];
  const inspect = await external.browser.request('/api/v1/invitations/inspect', 'POST', { token });
  assert.equal(inspect.status, 200);
  assert.equal(inspect.json().capacity, 'CLIENT');
  const results = await Promise.all(
    keys.map((k) =>
      external.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': k },
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const key = keys[results.findIndex((r) => r.status === 200)];
  // Privilege transition revokes the previous session in the existing identity trigger.
  await external.browser.login(external.email);
  assert.equal((await external.browser.request('/api/v1/me/principals')).json().items.length, 0);
  const cp = (await external.browser.request('/api/v1/me/client-principals')).json().items[0];
  assert.equal(cp.id, contact.id);
  const h = { 'X-Organization-Principal': cp.id };
  const grants = (
    await external.browser.request(t.path + '/client-access', 'GET', undefined, h)
  ).json().items;
  assert.deepEqual(
    grants.map((p) => p.id),
    [project.id],
  );
  for (const suffix of ['/projects/' + project.id + '/tasks', '/clients', '/team'])
    assert.equal(
      (await external.browser.request(t.path + suffix, 'GET', undefined, h)).status,
      404,
    );
  const g = (await req(owner, projectPath() + '/grants')).json().items[0];
  await update(projectPath() + '/grants/' + g.id, g, {
    contact_id: contact.id,
    role: 'REVIEWER',
    status: 'REVOKED',
  });
  assert.equal(
    (await external.browser.request(t.path + '/client-access', 'GET', undefined, h)).json().items
      .length,
    0,
  );
  assert.equal(
    (
      await external.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token },
        { 'Idempotency-Key': key },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(owner, projectPath() + '/grants', 'POST', {
        contact_id: crypto.randomUUID(),
        role: 'APPROVER',
        status: 'ACTIVE',
      })
    ).status,
    404,
  );
});
test('restricted runtime SQL has forced RLS, composite FKs, append-only history and rollback', async () => {
  const pool = new Pool({ connectionString: runtime.PRODUCT_API_URL, max: 1 });
  const tx = await pool.connect();
  try {
    const flags = (
      await tx.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    ).rows[0];
    assert.equal(flags.rolsuper, false);
    assert.equal(flags.rolbypassrls, false);
    assert.equal((await tx.query('SELECT * FROM public.task')).rowCount, 0);
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    await assert.rejects(
      tx.query('UPDATE public.task_history SET kind=$1 WHERE organization_id=$2', [
        'forged',
        t.organizationId,
      ]),
      (e) => e.code === '42501',
    );
    await tx.query('ROLLBACK');
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    await assert.rejects(
      tx.query(
        'INSERT INTO public.task(organization_id,project_id,title,milestone_id) VALUES($1,$2,$3,$4)',
        [t.organizationId, project.id, 'Invalid foreign milestone', crypto.randomUUID()],
      ),
      (e) => e.code === '23503',
    );
    await tx.query('ROLLBACK');
    assert.equal((await tx.query('SELECT * FROM public.task')).rowCount, 0);
  } finally {
    tx.release();
    await pool.end();
  }
});
test('audit persistence failure rolls back task, history and transactional event', async () => {
  await admin.query(
    "CREATE FUNCTION public.phase3_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='core.changed' AND NEW.organization_id='" +
      t.organizationId +
      "'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$",
  );
  await admin.query(
    'CREATE TRIGGER phase3_test_fault BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.phase3_test_fault()',
  );
  const title = 'Atomic rollback ' + crypto.randomUUID();
  try {
    assert.equal((await req(owner, projectPath() + '/tasks', 'POST', taskBody(title))).status, 503);
    assert.equal(
      (await req(owner, projectPath() + '/tasks?q=' + encodeURIComponent(title))).json().total,
      0,
    );
  } finally {
    await admin.query('DROP TRIGGER phase3_test_fault ON public.audit_event');
    await admin.query('DROP FUNCTION public.phase3_test_fault()');
  }
});

test('same-client explicit grants reject another client and contact revocation removes authority', async () => {
  const contact = await create('/clients/' + client2.id + '/contacts', {
    name: 'Other client contact',
    email: 'isolation-' + crypto.randomUUID() + '@example.test',
    status: 'ACTIVE',
  });
  assert.equal(
    (
      await req(
        manager,
        projectPath() + '/grants',
        'POST',
        { contact_id: contact.id, role: 'APPROVER', status: 'ACTIVE' },
        m.headers,
      )
    ).status,
    409,
  );
  const grant = await create('/projects/' + project2.id + '/grants', {
    contact_id: contact.id,
    role: 'VIEWER',
    status: 'ACTIVE',
  });
  await update('/clients/' + client2.id + '/contacts/' + contact.id, contact, {
    name: contact.name,
    email: contact.email,
    status: 'INACTIVE',
  });
  assert.equal(
    (await req(owner, '/projects/' + project2.id + '/grants/' + grant.id)).json().status,
    'REVOKED',
  );
});
test('external invitation expiry, revocation and immutable scope are enforced', async () => {
  const contact = await create('/clients/' + client2.id + '/contacts', {
    name: 'Expiry contact',
    email: 'expiry-' + crypto.randomUUID() + '@example.test',
    status: 'ACTIVE',
  });
  const invite = await req(
    owner,
    `/clients/${client2.id}/contacts/${contact.id}/invitations`,
    'POST',
    { project_id: project2.id, role: 'VIEWER' },
  );
  assert.equal(invite.status, 201);
  const link = await mail(contact.email, 'DevWorkspace client invitation');
  const token = link.searchParams.get('token');
  assert.equal(
    (await external.browser.request('/api/v1/invitations/inspect', 'POST', { token })).status,
    404,
  );
  const pool = new Pool({ connectionString: runtime.PRODUCT_API_URL });
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    await assert.rejects(
      tx.query(
        "UPDATE public.invitation SET project_role='APPROVER' WHERE organization_id=$1 AND id=$2",
        [t.organizationId, invite.json().id],
      ),
      (e) => e.code === '23514',
    );
    await tx.query('ROLLBACK');
  } finally {
    tx.release();
    await pool.end();
  }
  await admin.query(
    "UPDATE public.invitation SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [invite.json().id],
  );
  // A fresh uniquely addressed intended verified identity proves expiry, not merely wrong-identity denial.
  const intended = await account();
  const intendedContact = await create('/clients/' + client2.id + '/contacts', {
    name: 'Intended contact',
    email: intended.email,
    status: 'ACTIVE',
  });
  const pending = await req(
    owner,
    `/clients/${client2.id}/contacts/${intendedContact.id}/invitations`,
    'POST',
    { project_id: project2.id, role: 'VIEWER' },
  );
  assert.equal(pending.status, 201);
  const intendedLink = await mail(intended.email, 'DevWorkspace client invitation');
  const intendedToken = intendedLink.searchParams.get('token');
  await admin.query(
    "UPDATE public.invitation SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [pending.json().id],
  );
  assert.equal(
    (
      await intended.browser.request(
        '/api/v1/invitations/accept',
        'POST',
        { token: intendedToken },
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    404,
  );
  const revoked = await req(
    owner,
    '/invitations/' + pending.json().id,
    'DELETE',
    {},
    { 'X-Organization-Principal': t.principal.id, 'If-Match': '"1"' },
  );
  assert.equal(revoked.status, 200);
  assert.equal(
    (
      await intended.browser.request('/api/v1/invitations/inspect', 'POST', {
        token: intendedToken,
      })
    ).status,
    404,
  );
});
test('organization membership deactivation clears active project assignments and denies the old session', async () => {
  task = (await req(owner, taskPath())).json();
  task = await update(
    taskPath(),
    task,
    taskBody(task.title, { milestone_id: milestone.id, assignee_id: pc.id, status: 'IN_PROGRESS' }),
  );
  const member = (
    await admin.query('SELECT revision FROM public.membership WHERE id=$1', [c.principal.id])
  ).rows[0];
  const changed = await req(
    owner,
    '/team/' + c.principal.id,
    'PATCH',
    { role: 'MEMBER', status: 'INACTIVE' },
    header(t.headers, member),
  );
  assert.equal(changed.status, 200);
  assert.equal((await req(owner, taskPath())).json().assignee_id, null);
  assert.equal((await req(contributor, taskPath(), 'GET', undefined, c.headers)).status, 401);
  assert.ok(
    (await req(owner, taskPath() + '/history'))
      .json()
      .items.some((h) => h.kind === 'assignment.cleared'),
  );
});
test('real PostgreSQL serializes task reopen against milestone completion', async () => {
  const p = await create('/projects', projectBody(client.id, 'Race project'));
  const ms = await create('/projects/' + p.id + '/milestones', {
    title: 'Race milestone',
    due_at: null,
    position: 0,
    status: 'OPEN',
  });
  const work = await create(
    '/projects/' + p.id + '/tasks',
    taskBody('Race work', { milestone_id: ms.id, status: 'DONE' }),
  );
  const results = await race(() =>
    Promise.all([
      req(
        owner,
        '/projects/' + p.id + '/milestones/' + ms.id,
        'PATCH',
        { title: ms.title, due_at: null, position: 0, status: 'COMPLETED' },
        header(t.headers, ms),
      ),
      req(
        owner,
        '/projects/' + p.id + '/tasks/' + work.id,
        'PATCH',
        taskBody(work.title, { milestone_id: ms.id, status: 'IN_PROGRESS' }),
        header(t.headers, work),
      ),
    ]),
  );
  assert.equal(results[1].status, 200);
  assert.ok([200, 409, 412].includes(results[0].status));
  assert.equal(
    (await req(owner, '/projects/' + p.id + '/milestones/' + ms.id)).json().status,
    'OPEN',
  );
});

test('all Phase 3 migrations install on an empty validation database without changing retained databases', async () => {
  const { Client } = await import('pg');
  const { readFile, readdir } = await import('node:fs/promises');
  const name = 'devworkspace_p3_validation_' + crypto.randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE ${name} OWNER dw2_owner`);
  const u = new URL(runtime.PRODUCT_API_URL);
  u.username = process.env.POSTGRES_USER;
  u.password = process.env.POSTGRES_PASSWORD;
  u.pathname = '/' + name;
  const db = new Client({ connectionString: u.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE dw2_owner');
    const files = (await readdir('packages/database/prisma/product'))
      .filter((f) => /^\d{4}-.*\.sql$/.test(f))
      .sort();
    for (const file of files)
      await db.query(await readFile('packages/database/prisma/product/' + file, 'utf8'));
    await db.query('COMMIT');
    const r = await db.query(
      "SELECT count(*)::int n FROM pg_class WHERE relname IN ('client','client_contact','project','project_membership','client_project_access','milestone','task','task_checklist','task_comment','task_history') AND relforcerowsecurity",
    );
    assert.equal(r.rows[0].n, 10);
  } finally {
    await db.end();
  }
});

test('assignment versus participation downgrade has no ineligible active-task winner', async () => {
  const work = await create(projectPath() + '/tasks', taskBody('Assignment race'));
  const results = await race(() =>
    Promise.all([
      req(
        owner,
        projectPath() + '/tasks/' + work.id,
        'PATCH',
        taskBody(work.title, { assignee_id: pm.id }),
        header(t.headers, work),
      ),
      req(
        owner,
        projectPath() + '/members/' + pm.id,
        'PATCH',
        { membership_id: m.principal.id, role: 'VIEWER', status: 'ACTIVE' },
        header(t.headers, pm),
      ),
    ]),
  );
  assert.equal(results[1].status, 200);
  assert.ok([200, 409].includes(results[0].status));
  assert.equal((await req(owner, projectPath() + '/tasks/' + work.id)).json().assignee_id, null);
});
test('project completion versus new work has one consistent serialized outcome', async () => {
  const p = await create('/projects', projectBody(client.id, 'Project completion race'));
  const results = await race(() =>
    Promise.all([
      req(
        owner,
        '/projects/' + p.id,
        'PATCH',
        { ...projectBody(client.id, p.name), status: 'COMPLETED' },
        header(t.headers, p),
      ),
      req(owner, '/projects/' + p.id + '/tasks', 'POST', taskBody('Concurrent unfinished work')),
    ]),
  );
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)));
  const current = (await req(owner, '/projects/' + p.id)).json();
  assert.ok(current.status !== 'COMPLETED' || current.summary.total === current.summary.done);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
});
test('runtime composite client/project and task ancestry reject real foreign parents', async () => {
  const pool = new Pool({ connectionString: runtime.PRODUCT_API_URL, max: 1 });
  const tx = await pool.connect();
  const wrong = (
    await admin.query(
      'SELECT id FROM public.milestone WHERE organization_id=$1 AND project_id=$2 LIMIT 1',
      [t.organizationId, project2.id],
    )
  ).rows[0];
  const contact = (await req(owner, '/clients/' + client2.id + '/contacts')).json().items[0];
  try {
    for (const [sql, values] of [
      [
        'INSERT INTO public.task(organization_id,project_id,milestone_id,title) VALUES($1,$2,$3,$4)',
        [t.organizationId, project.id, wrong.id, 'Cross-project SQL'],
      ],
      [
        'INSERT INTO public.task_checklist(organization_id,project_id,task_id,label) VALUES($1,$2,$3,$4)',
        [t.organizationId, project2.id, task.id, 'Cross-task SQL'],
      ],
      [
        'INSERT INTO public.client_project_access(organization_id,project_id,client_id,contact_id,role) VALUES($1,$2,$3,$4,$5)',
        [t.organizationId, project.id, client.id, contact.id, 'VIEWER'],
      ],
    ]) {
      await tx.query('BEGIN');
      await tx.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
      await assert.rejects(tx.query(sql, values), (e) => e.code === '23503');
      await tx.query('ROLLBACK');
    }
    for (const table of [
      'client',
      'client_contact',
      'project',
      'project_membership',
      'client_project_access',
      'milestone',
      'task',
      'task_checklist',
      'task_comment',
      'task_history',
    ])
      assert.equal((await tx.query('SELECT * FROM public.' + table)).rowCount, 0);
  } finally {
    tx.release();
    await pool.end();
  }
});
test('outbox persistence failure rolls back domain/history/audit rather than leaving partial work', async () => {
  const name = 'Outbox rollback ' + crypto.randomUUID();
  await admin.query(
    "CREATE FUNCTION public.phase3_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='core.changed' AND NEW.organization_id='" +
      t.organizationId +
      "'::uuid THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$",
  );
  await admin.query(
    'CREATE TRIGGER phase3_outbox_fault BEFORE INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.phase3_outbox_fault()',
  );
  const before = (
    await admin.query(
      'SELECT (SELECT count(*)::int FROM public.task WHERE organization_id=$1) tasks,(SELECT count(*)::int FROM public.audit_event WHERE organization_id=$1) audits,(SELECT count(*)::int FROM public.task_history WHERE organization_id=$1) history',
      [t.organizationId],
    )
  ).rows[0];
  try {
    assert.equal((await req(owner, projectPath() + '/tasks', 'POST', taskBody(name))).status, 503);
    const after = (
      await admin.query(
        'SELECT (SELECT count(*)::int FROM public.task WHERE organization_id=$1) tasks,(SELECT count(*)::int FROM public.audit_event WHERE organization_id=$1) audits,(SELECT count(*)::int FROM public.task_history WHERE organization_id=$1) history',
        [t.organizationId],
      )
    ).rows[0];
    assert.deepEqual(after, before);
  } finally {
    await admin.query('DROP TRIGGER phase3_outbox_fault ON public.tenant_event');
    await admin.query('DROP FUNCTION public.phase3_outbox_fault()');
  }
});
test('HTTP verb and nesting boundaries cannot create or update through the wrong operation', async () => {
  assert.equal(
    (await req(owner, projectPath() + '/tasks', 'PATCH', taskBody('Wrong verb'))).status,
    404,
  );
  assert.equal(
    (await req(owner, taskPath(), 'POST', taskBody('Wrong verb'), header(t.headers, task))).status,
    404,
  );
  assert.equal(
    (await req(owner, projectPath() + '/members/' + pc.id + '/checklist/' + item.id)).status,
    404,
  );
});

test('checklist removal is revision-checked, persistent and recorded in task history', async () => {
  const row = await create(taskPath() + '/checklist', {
    label: 'Remove this item',
    position: 7,
    completed: false,
  });
  assert.equal(
    (
      await req(
        owner,
        taskPath() + '/checklist/' + row.id,
        'DELETE',
        {},
        { ...t.headers, 'If-Match': '"99"' },
      )
    ).status,
    412,
  );
  assert.equal(
    (await req(owner, taskPath() + '/checklist/' + row.id, 'DELETE', {}, header(t.headers, row)))
      .status,
    200,
  );
  assert.equal((await req(owner, taskPath() + '/checklist/' + row.id)).status, 404);
  assert.ok(
    (await req(owner, taskPath() + '/history'))
      .json()
      .items.some((h) => h.kind === 'checklist.removed' && h.fields.itemId === row.id),
  );
});

test('cancelled task creation cannot bypass assignee eligibility', async () => {
  assert.equal(
    (
      await req(
        owner,
        projectPath() + '/tasks',
        'POST',
        taskBody('Cancelled ineligible', { status: 'CANCELLED', assignee_id: pv.id }),
      )
    ).status,
    409,
  );
});

test('sensitive access audit captures the selected principal and previous/new role without private content', async () => {
  const result = await admin.query(
    "SELECT actor_id,metadata,request_id FROM public.audit_event WHERE organization_id=$1 AND target_id=$2 AND action='core.changed' ORDER BY created_at DESC LIMIT 1",
    [t.organizationId, pm.id],
  );
  const row = result.rows[0];
  assert.equal(row.actor_id, owner.user.id);
  assert.equal(row.metadata.principalId, t.principal.id);
  assert.equal(row.metadata.capacity, 'INTERNAL');
  assert.equal(row.metadata.previousRole, 'MANAGER');
  assert.equal(row.metadata.role, 'VIEWER');
  assert.ok(row.request_id);
  assert.equal(row.metadata.body, undefined);
});
