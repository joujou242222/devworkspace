import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Browser, account, join, admin, runtime } from '../phase2/helpers.mjs';
import { Pool } from 'pg';
after(() => admin.end());
test('Manager/Contributor/Viewer separation, terminal conversion eligibility and client lifecycle ordering', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const pdf = JSON.parse(await readFile('.local/phase5-browser-pdf.json', 'utf8'));
  const browser = new Browser();
  await browser.login(f.owner.email);
  const owner = { browser, email: f.owner.email };
  const t = {
    path: '/api/v1/organizations/' + f.org,
    organizationId: f.org,
    headers: { 'X-Organization-Principal': f.principal },
  };
  const base = '/projects/' + f.project;
  const good = (r, n = 201) => {
    assert.equal(r.status, n, r.body);
    return r.json();
  };
  const req = (path, method = 'GET', body, a = owner, h = t.headers) =>
    a.browser.request(t.path + path, method, body, h);
  const h = (row, headers = t.headers) => ({
    ...headers,
    'If-Match': `"${row.revision}"`,
    'Idempotency-Key': crypto.randomUUID(),
  });
  const actors = [];
  for (const role of ['MANAGER', 'CONTRIBUTOR', 'VIEWER']) {
    const a = await account();
    const m = await join(owner, t, a);
    const pm = good(
      await req(base + '/members', 'POST', {
        membership_id: m.principal.id,
        role,
        status: 'ACTIVE',
      }),
    );
    actors.push({ ...a, pm, headers: m.headers, role });
  }
  const [manager, contributor, viewer] = actors;
  let c = good(await req(base + '/reviews/' + pdf.cycle), 200);
  if (c.status !== 'OPEN')
    c = good(
      await req(
        base + '/reviews',
        'POST',
        {
          version_id: pdf.version.id,
          digest: pdf.version.digest,
          approver_ids: [f.approver2.id],
          due_at: null,
        },
        manager,
        { ...manager.headers, 'Idempotency-Key': crypto.randomUUID() },
      ),
    );
  const path = base + '/reviews/' + c.id;
  const body = {
    version_id: pdf.version.id,
    digest: pdf.version.digest,
    visibility: 'CLIENT',
    body: 'Terminal source eligibility',
    annotation: null,
  };
  assert.equal((await req(path + '/feedback', 'POST', body, viewer, viewer.headers)).status, 403);
  const thread = good(
    await req(path + '/feedback', 'POST', body, contributor, contributor.headers),
  );
  const task = {
    title: 'Terminal converted task',
    description: 'Preserved exact source',
    priority: 'URGENT',
    status: 'TODO',
    milestone_id: null,
    assignee_id: contributor.pm.id,
    due_at: null,
    position: 0,
  };
  assert.equal(
    (
      await req(
        path + `/feedback/${thread.id}/task`,
        'POST',
        task,
        contributor,
        h(c, contributor.headers),
      )
    ).status,
    403,
  );
  assert.equal(
    (await req(path + '/cancel', 'POST', {}, contributor, h(c, contributor.headers))).status,
    403,
  );
  good(await req(path + '/cancel', 'POST', {}, manager, h(c, manager.headers)));
  assert.equal(
    (await req(path + '/feedback', 'POST', body, contributor, contributor.headers)).status,
    409,
  );
  assert.equal(
    (
      await req(
        path + `/feedback/${thread.id}/task`,
        'POST',
        { ...task, assignee_id: viewer.pm.id },
        manager,
        h(c, manager.headers),
      )
    ).status,
    409,
  );
  const converted = good(
    await req(path + `/feedback/${thread.id}/task`, 'POST', task, manager, h(c, manager.headers)),
  );
  assert.equal(converted.assignee_id, contributor.pm.id);
  assert.equal(converted.source_feedback_thread_id, thread.id);
  const taskDetail = good(
    await req(base + '/tasks/' + converted.id, 'GET', undefined, manager, manager.headers),
    200,
  );
  assert.equal(taskDetail.source_feedback_thread_id, thread.id);
  assert.equal(taskDetail.source_review_id, c.id);
  good(
    await req(
      path + `/feedback/${thread.id}/resolution`,
      'POST',
      { state: 'RESOLVED', note: 'Internal terminal resolution' },
      contributor,
      contributor.headers,
    ),
  );
  const before = (
    await admin.query('SELECT count(*)::int n FROM public.review_cycle WHERE organization_id=$1', [
      f.org,
    ])
  ).rows[0].n;
  for (const approver_ids of [[f.viewer.id], [crypto.randomUUID()]])
    assert.equal(
      (
        await req(
          base + '/reviews',
          'POST',
          { version_id: pdf.version.id, digest: pdf.version.digest, approver_ids, due_at: null },
          manager,
          { ...manager.headers, 'Idempotency-Key': crypto.randomUUID() },
        )
      ).status,
      409,
    );
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int n FROM public.review_cycle WHERE organization_id=$1',
        [f.org],
      )
    ).rows[0].n,
    before,
  );
  c = good(
    await req(
      base + '/reviews',
      'POST',
      {
        version_id: pdf.version.id,
        digest: pdf.version.digest,
        approver_ids: [f.approver2.id],
        due_at: null,
      },
      manager,
      { ...manager.headers, 'Idempotency-Key': crypto.randomUUID() },
    ),
  );
  // Restore a current exact PDF target for the subsequent real browser journey.
  await writeFile('.local/phase5-browser-pdf.json', JSON.stringify({ ...pdf, cycle: c.id }));
  const approver = { browser: new Browser() };
  await approver.browser.login(f.approver2.email);
  const clientHeaders = { 'X-Organization-Principal': f.approver2.id };
  let project = good(await req(base), 200);
  const pbody = {
    client_id: project.client_id,
    name: project.name,
    description: project.description,
    status: project.status,
    due_at: project.due_at,
    portal_enabled: false,
  };
  const lock = await admin.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [f.org]);
  let pending;
  try {
    pending = Promise.all([
      req(base, 'PATCH', pbody, manager, h(project, manager.headers)),
      req(
        '/portal' + base + '/reviews/' + c.id + '/decisions',
        'POST',
        {
          version_id: pdf.version.id,
          digest: pdf.version.digest,
          decision: 'CHANGES_REQUESTED',
          reason: 'Concurrent portal withdrawal',
        },
        approver,
        h(c, clientHeaders),
      ),
    ]);
    for (let i = 0; i < 500; i++) {
      const n = (
        await admin.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='dw2_api' AND wait_event_type='Lock' AND query LIKE '%public.organization%'",
        )
      ).rows[0].n;
      if (n >= 2) break;
      if (i === 499) assert.fail('Both live operations must wait at the authorization boundary');
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    await lock.query('COMMIT');
    lock.release();
  }
  const results = await pending;
  assert.equal(results[0].status, 200);
  assert.ok([201, 404].includes(results[1].status));
  assert.equal(
    (await req('/portal' + base + '/reviews/' + c.id, 'GET', undefined, approver, clientHeaders))
      .status,
    404,
  );
  assert.equal((await req('/logo', 'GET', undefined, approver, clientHeaders)).status, 404);
  project = good(await req(base), 200);
  good(
    await req(
      base,
      'PATCH',
      { ...pbody, portal_enabled: true },
      manager,
      h(project, manager.headers),
    ),
    200,
  );
  const final = good(await req(base + '/reviews/' + c.id), 200);
  if (final.status !== 'OPEN') {
    c = good(
      await req(
        base + '/reviews',
        'POST',
        {
          version_id: pdf.version.id,
          digest: pdf.version.digest,
          approver_ids: [f.approver2.id],
          due_at: null,
        },
        manager,
        { ...manager.headers, 'Idempotency-Key': crypto.randomUUID() },
      ),
    );
    await writeFile('.local/phase5-browser-pdf.json', JSON.stringify({ ...pdf, cycle: c.id }));
  }
  const membership = (
    await admin.query(
      'SELECT count(*)::int n FROM public.membership m JOIN public.client_contact x ON x.user_id=m.user_id AND x.organization_id=m.organization_id WHERE x.organization_id=$1 AND x.id=$2',
      [f.org, f.approver2.id],
    )
  ).rows[0].n;
  assert.equal(membership, 0);
});
test('restricted SQL rejects frozen roster mutation, unknown annotation type and immutable feedback source changes', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const pdf = JSON.parse(await readFile('.local/phase5-browser-pdf.json', 'utf8'));
  const db = new Pool({ connectionString: runtime.PRODUCT_API_URL, max: 1 });
  const tx = await db.connect();
  async function rejected(sql, args, expected) {
    await tx.query('BEGIN');
    try {
      await tx.query("SELECT set_config('app.organization_id',$1,true)", [f.org]);
      await assert.rejects(tx.query(sql, args), expected);
    } finally {
      await tx.query('ROLLBACK');
    }
  }
  try {
    const user = (
      await admin.query('SELECT user_id FROM public.membership WHERE id=$1', [f.principal])
    ).rows[0].user_id;
    const preview = (
      await admin.query(
        'SELECT width,height FROM public.file_preview WHERE asset_id=$1 AND page=2',
        [pdf.version.asset_id],
      )
    ).rows[0];
    await rejected(
      "INSERT INTO public.feedback_thread(organization_id,project_id,cycle_id,version_id,actor_id,principal_id,capacity,visibility,body,annotation,digest,source_width,source_height) VALUES($1,$2,$3,$4,$5,$6,'INTERNAL','CLIENT','SQL malformed discriminator',$7,$8,$9,$10)",
      [
        f.org,
        f.project,
        pdf.cycle,
        pdf.version.id,
        user,
        f.principal,
        { type: null, page: 2, x: 0.2, y: 0.3 },
        pdf.version.digest,
        preview.width,
        preview.height,
      ],
      (e) => e.code === '23514',
    );
    await rejected(
      'INSERT INTO public.review_participant(organization_id,project_id,cycle_id,contact_id,grant_id,role) SELECT organization_id,project_id,cycle_id,contact_id,grant_id,role FROM public.review_participant WHERE organization_id=$1 AND cycle_id=$2 LIMIT 1',
      [f.org, pdf.cycle],
      (e) => e.code === '23514' && e.message.includes('frozen'),
    );
    const task = (
      await admin.query(
        'SELECT id FROM public.task WHERE organization_id=$1 AND source_feedback_thread_id IS NOT NULL LIMIT 1',
        [f.org],
      )
    ).rows[0];
    assert.ok(task);
    await rejected(
      'UPDATE public.task SET source_feedback_thread_id=NULL WHERE organization_id=$1 AND id=$2',
      [f.org, task.id],
      (e) => e.code === '23514',
    );
  } finally {
    tx.release();
    await db.end();
  }
});
test('Managers can revoke security-blocked shares and version badges retain their exact review target', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const browser = new Browser();
  await browser.login(f.owner.email);
  const client = new Browser();
  await client.login(f.viewer.email);
  const root = `/api/v1/organizations/${f.org}/projects/${f.project}`;
  const headers = { 'X-Organization-Principal': f.principal };
  const versions = async () => {
    const r = await browser.request(root + '/versions?limit=100', 'GET', undefined, headers);
    assert.equal(r.status, 200);
    return r.json().items;
  };
  const original = (await versions()).find((v) => v.id === f.version.id);
  assert.ok(original.review_id);
  const cycle = await browser.request(
    root + '/reviews/' + original.review_id,
    'GET',
    undefined,
    headers,
  );
  assert.equal(cycle.json().version_id, original.id);
  assert.equal(cycle.json().status, original.review_status);
  await admin.query(
    "UPDATE public.file_access SET status='BLOCKED',revision=revision+1 WHERE asset_id=$1",
    [f.version.asset_id],
  );
  try {
    const r = await browser.request(
      root + '/versions/' + f.version.id + '/share',
      'PATCH',
      { status: 'REVOKED' },
      { ...headers, 'If-Match': `"${original.share_revision}"` },
    );
    assert.equal(r.status, 200, r.body);
    assert.equal(
      (
        await client.request(
          root.replace('/projects/', '/portal/projects/') +
            '/versions/' +
            f.version.id +
            '/download',
          'GET',
          undefined,
          { 'X-Organization-Principal': f.viewer.id },
        )
      ).status,
      404,
    );
  } finally {
    await admin.query(
      "UPDATE public.file_access SET status='AVAILABLE',revision=revision+1 WHERE asset_id=$1",
      [f.version.asset_id],
    );
    if (original.share_status === 'ACTIVE') {
      const current = (await versions()).find((v) => v.id === f.version.id);
      const r = await browser.request(
        root + '/versions/' + f.version.id + '/share',
        'PATCH',
        { status: 'ACTIVE' },
        { ...headers, 'If-Match': `"${current.share_revision}"` },
      );
      assert.equal(r.status, 200, r.body);
    }
  }
});
