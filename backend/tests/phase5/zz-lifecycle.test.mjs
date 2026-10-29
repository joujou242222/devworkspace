import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Browser, admin } from '../phase2/helpers.mjs';
import { image, hash } from '../phase4/fixtures.mjs';
import { request } from '../../scripts/http.mjs';
after(() => admin.end());

test('resource lifecycle cancels atomically, never reopens history, blocks completion and orders live withdrawal races', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const owner = new Browser(),
    approver = new Browser();
  await owner.login(f.owner.email);
  await approver.login(f.approver2.email);
  const root = `/api/v1/organizations/${f.org}`,
    headers = { 'X-Organization-Principal': f.principal };
  const good = (r, n = 201) => {
    assert.equal(r.status, n, r.body);
    return r.json();
  };
  const req = (p, m = 'GET', b, h = headers) => owner.request(root + p, m, b, h);
  const rev = (r) => ({
    ...headers,
    'If-Match': `"${r.revision}"`,
    'Idempotency-Key': crypto.randomUUID(),
  });
  const source = good(await req('/projects/' + f.project), 200);
  let project = good(
    await req('/projects', 'POST', {
      client_id: source.client_id,
      name: 'Phase5 lifecycle ' + crypto.randomUUID(),
      description: 'Synthetic lifecycle checks',
      status: 'ACTIVE',
      portal_enabled: true,
      due_at: null,
    }),
  );
  const base = '/projects/' + project.id;
  let grant = good(
    await req(base + '/grants', 'POST', {
      contact_id: f.approver2.id,
      role: 'APPROVER',
      status: 'ACTIVE',
    }),
  );
  async function cleanUpload() {
    const bytes = await image('png', '#908070');
    const upload = good(
      await req(base + '/uploads', 'POST', {
        name: 'lifecycle.png',
        purpose: 'DELIVERABLE',
        folder_id: null,
        size: bytes.length,
        digest: hash(bytes),
        mime: 'image/png',
      }),
    );
    const url = new URL(upload.capability.url);
    assert.equal(
      (
        await request(url.pathname + url.search, {
          method: 'PUT',
          body: bytes,
          headers: { ...upload.capability.headers, Origin: 'https://localhost:8443' },
        })
      ).status,
      200,
    );
    good(await req(base + '/uploads/' + upload.id + '/finalize', 'POST', {}), 200);
    for (let i = 0; i < 180; i++) {
      const s = good(await req(base + '/uploads/' + upload.id), 200);
      if (s.status === 'READY') break;
      assert.ok(!['FAILED', 'REJECTED'].includes(s.status));
      assert.ok(i < 179);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return upload;
  }
  const upload = await cleanUpload();
  let d = good(
    await req(base + '/deliverables', 'POST', {
      title: 'Lifecycle target',
      description: 'Synthetic',
      task_id: null,
      status: 'ACTIVE',
    }),
  );
  const v = good(
    await req(
      base + '/deliverables/' + d.id + '/versions',
      'POST',
      { asset_id: upload.id },
      rev(d),
    ),
  );
  let share = good(
    await req(
      base + '/versions/' + v.id + '/share',
      'PATCH',
      { status: 'ACTIVE' },
      { ...headers, 'If-Match': '"1"' },
    ),
    200,
  );
  const body = { version_id: v.id, digest: v.digest, approver_ids: [f.approver2.id], due_at: null };
  const open = async () =>
    good(
      await req(base + '/reviews', 'POST', body, {
        'Idempotency-Key': crypto.randomUUID(),
        ...headers,
      }),
    );
  const read = async (c) => good(await req(base + '/reviews/' + c.id), 200);
  const patchProject = async (changes) => {
    project = good(await req(base), 200);
    const { client_id, name, description, status, portal_enabled, due_at } = project;
    return req(
      base,
      'PATCH',
      { client_id, name, description, status, portal_enabled, due_at, ...changes },
      rev(project),
    );
  };
  assert.equal(
    (
      await req(
        base + '/reviews',
        'POST',
        { ...body, digest: '0'.repeat(64) },
        { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
    409,
  );
  let c = await open();
  assert.equal((await patchProject({ status: 'COMPLETED' })).status, 409);
  assert.equal(
    (
      await req(
        base + '/reviews/' + c.id + '/replace',
        'POST',
        { ...body, digest: '0'.repeat(64) },
        rev(c),
      )
    ).status,
    409,
  );
  assert.equal((await read(c)).status, 'OPEN');
  // Failure after cancellation must roll back both the resource and every review effect.
  await admin.query(
    `CREATE FUNCTION public.phase5_lifecycle_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id='${c.id}' AND NEW.kind='review.changed' THEN RAISE EXCEPTION 'synthetic lifecycle fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase5_lifecycle_fault BEFORE INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.phase5_lifecycle_fault()`,
  );
  try {
    assert.equal((await patchProject({ portal_enabled: false })).status, 503);
    assert.equal((await read(c)).status, 'OPEN');
    assert.equal(good(await req(base), 200).portal_enabled, true);
  } finally {
    await admin.query(
      'DROP TRIGGER phase5_lifecycle_fault ON public.tenant_event; DROP FUNCTION public.phase5_lifecycle_fault()',
    );
  }
  share = good(
    await req(base + '/versions/' + v.id + '/share', 'PATCH', { status: 'REVOKED' }, rev(share)),
    200,
  );
  assert.equal((await read(c)).status, 'CANCELLED');
  share = good(
    await req(base + '/versions/' + v.id + '/share', 'PATCH', { status: 'ACTIVE' }, rev(share)),
    200,
  );
  assert.equal((await read(c)).status, 'CANCELLED');
  c = await open();
  good(await patchProject({ portal_enabled: false }), 200);
  assert.equal((await read(c)).status, 'CANCELLED');
  assert.equal(
    (
      await req(base + '/reviews', 'POST', body, {
        ...headers,
        'Idempotency-Key': crypto.randomUUID(),
      })
    ).status,
    409,
  );
  good(await patchProject({ portal_enabled: true }), 200);
  assert.equal((await read(c)).status, 'CANCELLED');
  good(await patchProject({ status: 'COMPLETED' }), 200);
  good(await patchProject({ status: 'ACTIVE' }), 200);
  c = await open();
  d = good(await req(base + '/deliverables/' + d.id), 200);
  good(
    await req(
      base + '/deliverables/' + d.id,
      'PATCH',
      { title: d.title, description: d.description, task_id: d.task_id, status: 'ARCHIVED' },
      rev(d),
    ),
    200,
  );
  assert.equal((await read(c)).status, 'CANCELLED');
  // Each immutable version gets a separately processed asset.
  const upload2 = await cleanUpload();
  d = good(
    await req(base + '/deliverables', 'POST', {
      title: 'Race target',
      description: 'Synthetic',
      task_id: null,
      status: 'ACTIVE',
    }),
  );
  const v2 = good(
    await req(
      base + '/deliverables/' + d.id + '/versions',
      'POST',
      { asset_id: upload2.id },
      rev(d),
    ),
  );
  body.version_id = v2.id;
  body.digest = v2.digest;
  share = good(
    await req(
      base + '/versions/' + v2.id + '/share',
      'PATCH',
      { status: 'ACTIVE' },
      { ...headers, 'If-Match': '"1"' },
    ),
    200,
  );
  async function race(withdraw) {
    c = await open();
    const lock = await admin.connect();
    let pending;
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [f.org]);
    try {
      pending = Promise.all([
        withdraw(),
        approver.request(
          root + '/portal' + base + '/reviews/' + c.id + '/decisions',
          'POST',
          {
            version_id: v2.id,
            digest: v2.digest,
            decision: 'CHANGES_REQUESTED',
            reason: 'Concurrent withdrawal',
          },
          {
            'X-Organization-Principal': f.approver2.id,
            'If-Match': `"${c.revision}"`,
            'Idempotency-Key': crypto.randomUUID(),
          },
        ),
      ]);
      for (let i = 0; i < 500; i++) {
        const { rows } = await admin.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='dw2_api' AND wait_event_type='Lock' AND query LIKE '%public.organization%'",
        );
        if (rows[0].n >= 2) break;
        assert.ok(i < 499, 'both operations reach organization lock');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      await lock.query('COMMIT');
      lock.release();
    }
    const [a, b] = await pending;
    assert.equal(a.status, 200, a.body);
    assert.ok([201, 404, 409, 412].includes(b.status), b.body);
    const facts = (
      await admin.query(
        'SELECT status,(SELECT count(*)::int FROM public.review_decision d WHERE d.cycle_id=c.id) decisions FROM public.review_cycle c WHERE id=$1',
        [c.id],
      )
    ).rows[0];
    assert.ok(facts.decisions <= 1);
    assert.equal(facts.status === 'CHANGES_REQUESTED', facts.decisions === 1);
    return facts;
  }
  await race(() =>
    req(
      base + '/grants/' + grant.id,
      'PATCH',
      { contact_id: f.approver2.id, role: 'APPROVER', status: 'REVOKED' },
      rev(grant),
    ),
  );
  const denied = await approver.request(
    root + '/portal' + base + '/reviews/' + c.id,
    'GET',
    undefined,
    { 'X-Organization-Principal': f.approver2.id },
  );
  assert.equal(denied.status, 404);
  grant = good(await req(base + '/grants'), 200).items.find((g) => g.id === grant.id);
  good(
    await req(
      base + '/grants/' + grant.id,
      'PATCH',
      { contact_id: f.approver2.id, role: 'APPROVER', status: 'ACTIVE' },
      rev(grant),
    ),
    200,
  );
  c = await read(c);
  if (c.status === 'OPEN')
    good(await req(base + '/reviews/' + c.id + '/cancel', 'POST', {}, rev(c)));
  await race(() =>
    req(base + '/versions/' + v2.id + '/share', 'PATCH', { status: 'REVOKED' }, rev(share)),
  );
  share = good(await req(base + '/versions?limit=100'), 200).items.find((x) => x.id === v2.id);
  good(
    await req(
      base + '/versions/' + v2.id + '/share',
      'PATCH',
      { status: 'ACTIVE' },
      { ...headers, 'If-Match': `"${share.share_revision}"` },
    ),
    200,
  );
  await race(() => patchProject({ status: 'ARCHIVED' }));
  assert.ok(['CANCELLED', 'CHANGES_REQUESTED'].includes((await read(c)).status));
  const facts = (
    await admin.query('SELECT count(*)::int n FROM public.approval WHERE project_id=$1', [
      project.id,
    ])
  ).rows[0];
  assert.equal(facts.n, 0);
  assert.ok(
    (
      await admin.query(
        "SELECT 1 FROM public.audit_event WHERE organization_id=$1 AND metadata->>'reason' IN ('portal.disabled','share.revoked','deliverable.archived','project.archived')",
        [f.org],
      )
    ).rowCount >= 3,
  );
});

test('session revocation and exact-version decision serialize without a surviving revoked authority', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const pdf = JSON.parse(await readFile('.local/phase5-browser-pdf.json', 'utf8'));
  const owner = new Browser(),
    client = new Browser();
  await owner.login(f.owner.email);
  await client.login(f.approver2.email);
  const root = `/api/v1/organizations/${f.org}`,
    base = `/projects/${f.project}`,
    headers = { 'X-Organization-Principal': f.principal };
  const sessions = await client.request('/api/v1/me/sessions');
  assert.equal(sessions.status, 200);
  const session = sessions.json().items.find((s) => s.current);
  assert.ok(session);
  const cycle = (
    await owner.request(root + base + '/reviews/' + pdf.cycle, 'GET', undefined, headers)
  ).json();
  assert.equal(cycle.status, 'OPEN');
  const lock = await admin.connect();
  let pending;
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM public.identity_session WHERE id=$1 FOR UPDATE', [session.id]);
  try {
    pending = Promise.all([
      client.request('/api/v1/me/sessions/' + session.id, 'DELETE', {}),
      client.request(
        root + '/portal' + base + '/reviews/' + cycle.id + '/decisions',
        'POST',
        {
          version_id: pdf.version.id,
          digest: pdf.version.digest,
          decision: 'CHANGES_REQUESTED',
          reason: 'Concurrent own-session revocation',
        },
        {
          'X-Organization-Principal': f.approver2.id,
          'If-Match': `"${cycle.revision}"`,
          'Idempotency-Key': crypto.randomUUID(),
        },
      ),
    ]);
    for (let i = 0; i < 500; i++) {
      const { rows } = await admin.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE usename IN ('dw2_api','dw2_identity') AND wait_event_type='Lock'",
      );
      if (rows[0].n >= 2) break;
      assert.ok(i < 499, 'both live requests wait on session boundary');
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    await lock.query('COMMIT');
    lock.release();
  }
  const [revoke, decision] = await pending;
  assert.equal(revoke.status, 200, revoke.body);
  assert.ok([201, 401, 403].includes(decision.status), decision.body);
  assert.equal(
    (
      await client.request(root + '/portal' + base + '/reviews/' + cycle.id, 'GET', undefined, {
        'X-Organization-Principal': f.approver2.id,
      })
    ).status,
    401,
  );
  const final = (
    await owner.request(root + base + '/reviews/' + cycle.id, 'GET', undefined, headers)
  ).json();
  if (final.status !== 'OPEN') {
    const r = await owner.request(
      root + base + '/reviews',
      'POST',
      {
        version_id: pdf.version.id,
        digest: pdf.version.digest,
        approver_ids: [f.approver2.id],
        due_at: null,
      },
      { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    );
    assert.equal(r.status, 201, r.body);
    await writeFile(
      '.local/phase5-browser-pdf.json',
      JSON.stringify({ ...pdf, cycle: r.json().id }),
    );
  }
});
