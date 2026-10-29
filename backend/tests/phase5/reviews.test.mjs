import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { account, tenant, mail, admin, runtime } from '../phase2/helpers.mjs';
import { request } from '../../scripts/http.mjs';
import { image, pdf, hash } from '../phase4/fixtures.mjs';
let owner,
  t,
  client,
  project,
  otherProject,
  approver,
  approver2,
  reviewer,
  viewer,
  version1,
  version2,
  pdfVersion,
  cycle;
const runtimeDb = new Pool({ connectionString: runtime.PRODUCT_API_URL });
const good = (r, n = 201) => {
  assert.equal(r.status, n, r.body);
  return r.json();
};
const base = () => `/projects/${project.id}`;
const req = (p, method = 'GET', body, a = owner, h = t.headers) =>
  a.browser.request(t.path + p, method, body, h);
const rev = (row, key = crypto.randomUUID(), h = t.headers) => ({
  ...h,
  'If-Match': `"${row.revision}"`,
  'Idempotency-Key': key,
});
const taskBody = (title) => ({
  title,
  description: 'From real version feedback',
  priority: 'HIGH',
  status: 'TODO',
  milestone_id: null,
  assignee_id: null,
  due_at: null,
  position: 0,
});
const openBody = (v) => ({
  version_id: v.id,
  digest: v.digest,
  approver_ids: [approver.id, approver2.id],
  due_at: null,
});
const decision = (c, v, value = 'APPROVED') => ({
  version_id: v.id,
  digest: v.digest,
  decision: value,
  reason: value === 'APPROVED' ? '' : 'Please revise',
});
const cp = (c) => base() + '/reviews/' + c.id;
const portal = (c) => '/portal' + cp(c);
async function create(path, body) {
  return good(await req(path, 'POST', body));
}
async function invite(role) {
  const a = await account();
  const c = await create(`/clients/${client.id}/contacts`, {
    name: role,
    email: a.email,
    status: 'ACTIVE',
  });
  good(
    await req(`/clients/${client.id}/contacts/${c.id}/invitations`, 'POST', {
      project_id: project.id,
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
  const grant = good(await req(base() + '/grants'), 200).items.find((g) => g.contact_id === c.id);
  return { ...a, id: c.id, grant, headers: { 'X-Organization-Principal': c.id } };
}
async function upload(bytes, mime) {
  const u = await create(base() + '/uploads', {
    name: mime === 'application/pdf' ? 'phase5.pdf' : 'phase5.png',
    purpose: 'DELIVERABLE',
    folder_id: null,
    size: bytes.length,
    digest: hash(bytes),
    mime,
  });
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
  for (let i = 0; i < 180; i++) {
    const r = good(await req(base() + '/uploads/' + u.id), 200);
    if (r.status === 'READY') return u.id;
    if (['FAILED', 'REJECTED'].includes(r.status))
      throw new Error('Processing failed ' + r.error_code);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Processing timeout');
}
async function newVersion(bytes, mime = 'image/png', deliverable) {
  const asset = await upload(bytes, mime);
  const d =
    deliverable ??
    (await create(base() + '/deliverables', {
      title: 'Phase 5 exact version',
      description: 'Synthetic',
      task_id: null,
      status: 'ACTIVE',
    }));
  const v = good(
    await req(base() + '/deliverables/' + d.id + '/versions', 'POST', { asset_id: asset }, owner, {
      'If-Match': `"${d.revision}"`,
      ...t.headers,
    }),
  );
  good(
    await req(base() + '/versions/' + v.id + '/share', 'PATCH', { status: 'ACTIVE' }, owner, {
      'If-Match': '"1"',
      ...t.headers,
    }),
    200,
  );
  return { ...v, deliverable_id: d.id };
}
async function open(v) {
  return good(
    await req(base() + '/reviews', 'POST', openBody(v), owner, {
      'Idempotency-Key': crypto.randomUUID(),
      ...t.headers,
    }),
  );
}
async function feedback(c, v, annotation = null, visibility = 'CLIENT', a = reviewer) {
  return good(
    await req(
      (a === owner ? '' : '/portal') + cp(c) + '/feedback',
      'POST',
      {
        version_id: v.id,
        digest: v.digest,
        body: 'Please adjust this exact version',
        visibility,
        annotation,
      },
      a,
      a === owner ? t.headers : a.headers,
    ),
  );
}
async function race(work) {
  const lock = await admin.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [t.organizationId]);
  let pending;
  try {
    pending = work();
    for (let i = 0; i < 500; i++) {
      const n = await admin.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='dw2_api' AND wait_event_type='Lock' AND query LIKE '%public.organization%'",
      );
      if (n.rows[0].n >= 2) break;
      if (i === 499) assert.fail('Both requests must wait on the held organization lock');
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    await lock.query('COMMIT');
    lock.release();
  }
  return pending;
}
before(async () => {
  owner = await account();
  t = await tenant(owner, 'Phase 5 verification');
  client = await create('/clients', {
    name: 'Review client',
    description: 'Synthetic',
    status: 'ACTIVE',
  });
  const body = {
    client_id: client.id,
    name: 'Review project',
    description: 'Client curated summary',
    status: 'ACTIVE',
    portal_enabled: true,
    due_at: null,
  };
  project = await create('/projects', body);
  otherProject = await create('/projects', { ...body, name: 'Ungrant same client' });
  approver = await invite('APPROVER');
  approver2 = await invite('APPROVER');
  reviewer = await invite('REVIEWER');
  viewer = await invite('VIEWER');
  version1 = await newVersion(await image('png', '#112233', 80, 60));
  cycle = await open(version1);
  await writeFile(
    '.local/phase5-browser-fixture.json',
    JSON.stringify({
      owner: { email: owner.email },
      approver: { email: approver.email, id: approver.id },
      approver2: { email: approver2.email, id: approver2.id },
      reviewer: { email: reviewer.email, id: reviewer.id },
      viewer: { email: viewer.email, id: viewer.id },
      org: t.organizationId,
      project: project.id,
      cycle: cycle.id,
      version: version1,
      principal: t.principal.id,
    }),
  );
});
after(async () => {
  await runtimeDb.end();
  await admin.end();
});
test('review exact target and frozen roster, explicit sharing and portal project isolation', async () => {
  const c = good(await req(cp(cycle)), 200);
  assert.equal(c.version_id, version1.id);
  assert.equal(c.policy, 'ANY_ONE');
  assert.equal(c.participants.length, 2);
  assert.equal(
    good(await req('/portal', 'GET', undefined, approver, approver.headers), 200).items.length,
    1,
  );
  assert.equal(
    (
      await req(
        '/portal/projects/' + otherProject.id + '/reviews',
        'GET',
        undefined,
        approver,
        approver.headers,
      )
    ).status,
    404,
  );
  assert.equal((await req('/portal', 'GET', undefined, owner, t.headers)).status, 404);
  assert.equal((await req(cp(cycle), 'GET', undefined, approver, approver.headers)).status, 404);
});
test('real image pins, visibility, replies, resolution and client conversion metadata exclusion', async () => {
  const f = await feedback(cycle, version1, { type: 'IMAGE_PIN', x: 0.25, y: 0.75 });
  await feedback(cycle, version1, null, 'INTERNAL', owner);
  good(
    await req(
      portal(cycle) + `/feedback/${f.id}/replies`,
      'POST',
      { body: 'Client reply' },
      reviewer,
      reviewer.headers,
    ),
  );
  good(
    await req(cp(cycle) + `/feedback/${f.id}/resolution`, 'POST', {
      state: 'RESOLVED',
      note: 'Private resolution note',
    }),
  );
  const external = good(
    await req(portal(cycle) + '/feedback', 'GET', undefined, viewer, viewer.headers),
    200,
  ).items;
  assert.equal(external.length, 1);
  assert.equal(external[0].source_width, 80);
  assert.equal(external[0].source_height, 60);
  assert.equal(external[0].annotation.x, 0.25);
  assert.equal(external[0].replies.length, 1);
  assert.ok(!JSON.stringify(external).includes('Private resolution'));
  for (const key of ['task_id', 'resolution_history', 'converted'])
    assert.ok(!Object.hasOwn(external[0], key));
  assert.equal(
    (
      await req(
        portal(cycle) + '/feedback',
        'POST',
        {
          version_id: version1.id,
          digest: version1.digest,
          body: 'Denied',
          visibility: 'CLIENT',
          annotation: null,
        },
        viewer,
        viewer.headers,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        portal(cycle) + '/feedback',
        'POST',
        {
          version_id: version1.id,
          digest: version1.digest,
          body: 'Denied',
          visibility: 'INTERNAL',
          annotation: null,
        },
        reviewer,
        reviewer.headers,
      )
    ).status,
    403,
  );
});
test('malformed geometry, wrong page/type/version/digest and cross-project ancestry fail closed', async () => {
  const b = {
    version_id: version1.id,
    digest: version1.digest,
    visibility: 'CLIENT',
    body: 'invalid',
  };
  for (const annotation of [
    { type: 'IMAGE_PIN', x: -0.1, y: 0.5 },
    { type: 'IMAGE_PIN', x: 0.1, y: 1.5 },
    { type: 'IMAGE_PIN', x: 'NaN', y: 0.5 },
    { type: 'PDF_POINT', page: 2, x: 0.5, y: 0.5 },
    { type: 'IMAGE_PIN', x: 0.5, y: 0.5, page: 1 },
  ])
    assert.equal(
      (
        await req(
          portal(cycle) + '/feedback',
          'POST',
          { ...b, annotation },
          reviewer,
          reviewer.headers,
        )
      ).status,
      400,
    );
  for (const extra of [{ version_id: crypto.randomUUID() }, { digest: '0'.repeat(64) }])
    assert.equal(
      (
        await req(
          portal(cycle) + '/feedback',
          'POST',
          { ...b, annotation: null, ...extra },
          reviewer,
          reviewer.headers,
        )
      ).status,
      409,
    );
  assert.equal((await req(`/projects/${otherProject.id}/reviews/${cycle.id}`)).status, 404);
});
test('N+1 preparation and share leave N open; unauthorized/stale/wrong-version decisions denied', async () => {
  const d = good(await req(base() + '/deliverables/' + version1.deliverable_id), 200);
  version2 = await newVersion(await image('png', '#223344', 80, 60), 'image/png', d);
  assert.equal(good(await req(cp(cycle)), 200).status, 'OPEN');
  assert.equal(good(await req(cp(cycle)), 200).version_id, version1.id);
  assert.equal(
    (await req(portal(cycle) + '/decisions', 'POST', decision(cycle, version1), owner, rev(cycle)))
      .status,
    404,
  );
  assert.equal(
    (
      await req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version1),
        reviewer,
        rev(cycle, crypto.randomUUID(), reviewer.headers),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version2),
        approver,
        rev(cycle, crypto.randomUUID(), approver.headers),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version1),
        approver,
        rev({ ...cycle, revision: 99 }, crypto.randomUUID(), approver.headers),
      )
    ).status,
    412,
  );
});
test('concurrent feedback conversion has one source/task, replay safety and internal-only linkage', async () => {
  const f = good(await req(cp(cycle) + '/feedback'), 200).items.find(
    (f) => f.visibility === 'CLIENT',
  );
  const path = cp(cycle) + `/feedback/${f.id}/task`;
  const body = taskBody('Converted exact source');
  const key = crypto.randomUUID();
  const otherKey = crypto.randomUUID();
  const results = await race(() =>
    Promise.all([
      req(path, 'POST', body, owner, rev(cycle, key)),
      req(path, 'POST', body, owner, rev(cycle, otherKey)),
    ]),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winnerKey = results[0].status === 201 ? key : otherKey;
  const replay = good(await req(path, 'POST', body, owner, rev(cycle, winnerKey)));
  const task = await admin.query(
    'SELECT * FROM public.task WHERE organization_id=$1 AND source_feedback_thread_id=$2',
    [t.organizationId, f.id],
  );
  assert.equal(task.rowCount, 1);
  assert.equal(replay.id, task.rows[0].id);
  assert.equal(task.rows[0].project_id, project.id);
  assert.equal(
    (await req(path, 'POST', { ...body, title: 'Changed payload' }, owner, rev(cycle, winnerKey)))
      .status,
    409,
  );
  assert.equal(
    (
      await req(
        '/portal' + path,
        'POST',
        body,
        reviewer,
        rev(cycle, crypto.randomUUID(), reviewer.headers),
      )
    ).status,
    403,
  );
  assert.ok(
    !JSON.stringify(
      good(
        await req(portal(cycle) + '/feedback', 'GET', undefined, reviewer, reviewer.headers),
        200,
      ),
    ).includes(task.rows[0].id),
  );
});
test('explicit replacement atomic target, linked history and same-key replay', async () => {
  const key = crypto.randomUUID(),
    body = openBody(version2);
  const replacement = good(await req(cp(cycle) + '/replace', 'POST', body, owner, rev(cycle, key)));
  assert.equal(replacement.replaces_cycle_id, cycle.id);
  assert.equal(replacement.version_id, version2.id);
  assert.equal(good(await req(cp(cycle)), 200).status, 'SUPERSEDED');
  assert.equal(
    good(await req(cp(cycle) + '/replace', 'POST', body, owner, rev(cycle, key))).id,
    replacement.id,
  );
  assert.equal(
    (
      await req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version1),
        approver,
        rev(cycle, crypto.randomUUID(), approver.headers),
      )
    ).status,
    412,
  );
  cycle = replacement;
});
test('two concurrent named Approvers yield one terminal decision, approval iff approved, replay/finality', async () => {
  const key = crypto.randomUUID();
  const results = await race(() =>
    Promise.all([
      req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version2),
        approver,
        rev(cycle, key, approver.headers),
      ),
      req(
        portal(cycle) + '/decisions',
        'POST',
        decision(cycle, version2, 'CHANGES_REQUESTED'),
        approver2,
        rev(cycle, crypto.randomUUID(), approver2.headers),
      ),
    ]),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.some((r) => [409, 412].includes(r.status)));
  const facts = (
    await admin.query(
      'SELECT c.status,(SELECT count(*)::int FROM public.review_decision d WHERE d.cycle_id=c.id) decisions,(SELECT count(*)::int FROM public.approval a WHERE a.cycle_id=c.id) approvals FROM public.review_cycle c WHERE c.id=$1',
      [cycle.id],
    )
  ).rows[0];
  assert.equal(facts.decisions, 1);
  assert.equal(facts.approvals, facts.status === 'APPROVED' ? 1 : 0);
  if (results[0].status === 201) {
    assert.equal(
      (
        await req(
          portal(cycle) + '/decisions',
          'POST',
          decision(cycle, version2),
          approver,
          rev(cycle, key, approver.headers),
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await req(
          portal(cycle) + '/decisions',
          'POST',
          { ...decision(cycle, version2), reason: 'changed' },
          approver,
          rev(cycle, key, approver.headers),
        )
      ).status,
      409,
    );
  }
  assert.equal(
    (await req(cp(cycle) + '/replace', 'POST', openBody(version1), owner, rev(cycle))).status,
    412,
  );
});
test('real PDF page 2 preview metadata and persistent geometry, wrong page rejected', async () => {
  pdfVersion = await newVersion(pdf(2, false, 200, 300), 'application/pdf');
  const c = await open(pdfVersion);
  const f = await feedback(c, pdfVersion, { type: 'PDF_POINT', page: 2, x: 0.4, y: 0.6 });
  const threads = good(
    await req(portal(c) + '/feedback', 'GET', undefined, reviewer, reviewer.headers),
    200,
  ).items;
  assert.equal(threads[0].id, f.id);
  assert.equal(threads[0].annotation.page, 2);
  assert.ok(threads[0].source_width > 0);
  assert.equal(
    (
      await req(
        portal(c) + '/feedback',
        'POST',
        {
          version_id: pdfVersion.id,
          digest: pdfVersion.digest,
          visibility: 'CLIENT',
          body: 'Wrong page',
          annotation: { type: 'PDF_POINT', page: 3, x: 0.5, y: 0.5 },
        },
        reviewer,
        reviewer.headers,
      )
    ).status,
    400,
  );
  await writeFile(
    '.local/phase5-browser-pdf.json',
    JSON.stringify({ cycle: c.id, version: pdfVersion }),
  );
});
test('replacement versus decision concurrency permits one winner and retains exact source', async () => {
  const a = await newVersion(await image());
  const d = good(await req(base() + '/deliverables/' + a.deliverable_id), 200);
  const b = await newVersion(await image('png', '#776655'), 'image/png', d);
  const c = await open(a);
  const r = await race(() =>
    Promise.all([
      req(cp(c) + '/replace', 'POST', openBody(b), owner, rev(c)),
      req(
        portal(c) + '/decisions',
        'POST',
        decision(c, a),
        approver,
        rev(c, crypto.randomUUID(), approver.headers),
      ),
    ]),
  );
  assert.equal(r.filter((x) => x.status === 201).length, 1);
  assert.ok(r.some((x) => [409, 412].includes(x.status)));
  const old = good(await req(cp(c)), 200);
  assert.ok(['SUPERSEDED', 'APPROVED'].includes(old.status));
  assert.equal(old.version_id, a.id);
  assert.equal(
    (
      await admin.query('SELECT count(*)::int n FROM public.review_decision WHERE version_id=$1', [
        b.id,
      ])
    ).rows[0].n,
    0,
  );
});
test('audit insertion failure rolls back conversion and source history', async () => {
  const c = await open(pdfVersion).catch(() => null);
  const target =
    c ??
    good(await req(base() + '/reviews?status=OPEN'), 200).items.find(
      (c) => c.version_id === pdfVersion.id,
    );
  const f = await feedback(target, pdfVersion);
  const path = cp(target) + `/feedback/${f.id}/task`;
  await admin.query(
    `CREATE FUNCTION public.phase5_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${t.organizationId}'::uuid AND NEW.metadata->>'action'='feedback.converted' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase5_audit_fault BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.phase5_audit_fault()`,
  );
  try {
    assert.equal((await req(path, 'POST', taskBody('Rollback'), owner, rev(target))).status, 503);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM public.task WHERE source_feedback_thread_id=$1',
          [f.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER phase5_audit_fault ON public.audit_event; DROP FUNCTION public.phase5_audit_fault()',
    );
  }
  good(await req(path, 'POST', taskBody('Retry after rollback'), owner, rev(target)));
});
test('forced RLS, append-only history and source uniqueness on restricted runtime', async () => {
  const tables = [
    'version_share',
    'review_cycle',
    'review_participant',
    'review_decision',
    'approval',
    'feedback_thread',
    'feedback_reply',
    'feedback_resolution',
  ];
  for (const table of tables) {
    assert.equal((await runtimeDb.query(`SELECT * FROM public.${table}`)).rowCount, 0);
    const r = (
      await admin.query(
        'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
        ['public.' + table],
      )
    ).rows[0];
    assert.ok(r.relrowsecurity && r.relforcerowsecurity);
  }
  const conn = await runtimeDb.connect();
  try {
    await conn.query('BEGIN');
    await conn.query("SELECT set_config('app.organization_id',$1,true)", [t.organizationId]);
    await assert.rejects(conn.query('UPDATE public.review_decision SET reason=$1', ['overwrite']));
    await conn.query('ROLLBACK');
  } finally {
    conn.release();
  }
});
test('live share, grant and portal revocation immediately deny reads and receipt replay', async () => {
  const p = portal(cycle);
  const grant = approver.grant;
  good(
    await req(
      base() + '/grants/' + grant.id,
      'PATCH',
      { contact_id: approver.id, role: 'APPROVER', status: 'REVOKED' },
      owner,
      { 'If-Match': `"${grant.revision}"`, ...t.headers },
    ),
    200,
  );
  assert.equal((await req(p, 'GET', undefined, approver, approver.headers)).status, 404);
  assert.equal(
    (
      await req(
        p + '/decisions',
        'POST',
        decision(cycle, version2),
        approver,
        rev(cycle, crypto.randomUUID(), approver.headers),
      )
    ).status,
    404,
  );
  good(
    await req(
      base() + '/versions/' + version2.id + '/share',
      'PATCH',
      { status: 'REVOKED' },
      owner,
      { 'If-Match': '"1"', ...t.headers },
    ),
    200,
  );
  assert.equal((await req(p, 'GET', undefined, reviewer, reviewer.headers)).status, 404);
});

test('two replacement commands and audit fault preserve one-open-cycle and linked-source uniqueness', async () => {
  // Use fresh synthetic targets and the remaining currently eligible Approver after revocation.
  const a = await newVersion(await image('png', '#334455'));
  const d = good(await req(base() + '/deliverables/' + a.deliverable_id), 200);
  const b = await newVersion(await image('png', '#445566'), 'image/png', d);
  const body = (v) => ({ ...openBody(v), approver_ids: [approver2.id] });
  const c = good(
    await req(base() + '/reviews', 'POST', body(a), owner, {
      ...t.headers,
      'Idempotency-Key': crypto.randomUUID(),
    }),
  );
  await admin.query(
    `CREATE FUNCTION public.phase5_replace_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${t.organizationId}'::uuid AND NEW.metadata->>'action'='review.replaced' THEN RAISE EXCEPTION 'synthetic replacement fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase5_replace_fault BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.phase5_replace_fault()`,
  );
  try {
    assert.equal((await req(cp(c) + '/replace', 'POST', body(b), owner, rev(c))).status, 503);
    assert.equal(good(await req(cp(c)), 200).status, 'OPEN');
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM public.review_cycle WHERE replaces_cycle_id=$1',
          [c.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER phase5_replace_fault ON public.audit_event; DROP FUNCTION public.phase5_replace_fault()',
    );
  }
  const r = await race(() =>
    Promise.all([
      req(cp(c) + '/replace', 'POST', body(b), owner, rev(c)),
      req(cp(c) + '/replace', 'POST', body(b), owner, rev(c)),
    ]),
  );
  assert.equal(r.filter((r) => r.status === 201).length, 1);
  assert.ok(r.some((r) => [409, 412].includes(r.status)));
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.review_cycle WHERE deliverable_id=$1 AND status='OPEN'",
        [a.deliverable_id],
      )
    ).rows[0].n,
    1,
  );
});
test('decision and concurrent N+1 preparation both commit with approval confined to N', async () => {
  const a = await newVersion(await image('png', '#556677'));
  const d = good(await req(base() + '/deliverables/' + a.deliverable_id), 200);
  const asset = await upload(await image('png', '#667788'), 'image/png');
  const c = good(
    await req(
      base() + '/reviews',
      'POST',
      { ...openBody(a), approver_ids: [approver2.id] },
      owner,
      { ...t.headers, 'Idempotency-Key': crypto.randomUUID() },
    ),
  );
  const r = await race(() =>
    Promise.all([
      req(
        base() + '/deliverables/' + d.id + '/versions',
        'POST',
        { asset_id: asset },
        owner,
        rev(d),
      ),
      req(
        portal(c) + '/decisions',
        'POST',
        decision(c, a),
        approver2,
        rev(c, crypto.randomUUID(), approver2.headers),
      ),
    ]),
  );
  for (const response of r) assert.equal(response.status, 201, response.body);
  assert.equal(
    (await admin.query('SELECT version_id FROM public.approval WHERE cycle_id=$1', [c.id])).rows[0]
      .version_id,
    a.id,
  );
  assert.equal(
    (
      await admin.query('SELECT count(*)::int n FROM public.approval WHERE version_id=$1', [
        r[0].json().id,
      ])
    ).rows[0].n,
    0,
  );
  const current = good(await req(cp(c)), 200);
  assert.equal(current.status, 'APPROVED');
  assert.equal(current.version_id, a.id);
});
test('portal exact-version binary reads, range, private source keys and live security blocking', async () => {
  async function binary(path, headers = {}) {
    const ca = await readFile('.local/tls/localhost.pem');
    return new Promise((resolve, reject) => {
      const r = https.get(
        'https://localhost:8443' + t.path + path,
        {
          ca,
          family: 4,
          headers: {
            Cookie: [...viewer.browser.cookies].map(([k, v]) => k + '=' + v).join('; '),
            ...viewer.headers,
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }),
          );
        },
      );
      r.on('error', reject);
    });
  }
  const path = '/portal' + base() + '/versions/' + version1.id + '/download';
  const bytes = await binary(path);
  assert.equal(bytes.status, 200);
  assert.equal(hash(bytes.bytes), version1.digest);
  assert.equal(bytes.headers['cache-control'], 'no-store');
  const partial = await binary(path, { Range: 'bytes=0-7' });
  assert.equal(partial.status, 206);
  assert.deepEqual(partial.bytes, bytes.bytes.subarray(0, 8));
  const metadata = good(
    await req('/portal' + base() + '/versions', 'GET', undefined, viewer, viewer.headers),
    200,
  );
  for (const field of ['canonical_key', 'storage_version', 'task_id', 'latest_version_id'])
    assert.ok(!JSON.stringify(metadata).includes('"' + field + '"'));
  await admin.query(
    "UPDATE public.file_access SET status='BLOCKED',revision=revision+1 WHERE asset_id=$1",
    [version1.asset_id],
  );
  try {
    assert.equal((await binary(path)).status, 404);
  } finally {
    await admin.query(
      "UPDATE public.file_access SET status='AVAILABLE',revision=revision+1 WHERE asset_id=$1",
      [version1.asset_id],
    );
  }
});
