import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join as pathJoin } from 'node:path';
import https from 'node:https';
import { Pool } from 'pg';
import { account, tenant, join, admin, runtime } from '../phase2/helpers.mjs';
import { request } from '../../scripts/http.mjs';
import {
  PrivateStorage,
  purgeExpiredStaging,
  publishObject,
  processPrivateFile,
} from '../../packages/server/dist/index.js';
import { image, hash, pdf } from './fixtures.mjs';
let owner, foreign, viewer, contributor, t, v, c, project, folder, ready, second, deliverable;
const workerEnv = Object.fromEntries(
  (await readFile('.local/phase2-worker.env', 'utf8'))
    .trim()
    .split('\n')
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);
const worker = new Pool({ connectionString: workerEnv.PRODUCT_WORKER_URL });
const creds = JSON.parse(await readFile('.local/phase4-storage-credentials.json', 'utf8'));
const writer = new PrivateStorage(creds.worker.accessKey, creds.worker.secretKey);
const apiStorage = new PrivateStorage(creds.api.accessKey, creds.api.secretKey);
const cleanup = new PrivateStorage(creds.cleanup.accessKey, creds.cleanup.secretKey);
const base = () => '/projects/' + project.id;
const req = (path, method = 'GET', body, a = owner, h = t.headers) =>
  a.browser.request(t.path + path, method, body, h);
const good = (r, status) => {
  assert.equal(r.status, status, r.body);
  return r.json();
};
async function binary(path, a = owner, h = t.headers) {
  const ca = await readFile('.local/tls/localhost.pem');
  return new Promise((resolve, reject) => {
    const r = https.get(
      'https://localhost:8443' + path,
      {
        ca,
        family: 4,
        headers: {
          Origin: 'https://localhost:8443',
          Cookie: [...a.browser.cookies].map(([k, v]) => k + '=' + v).join('; '),
          ...h,
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
async function intent(
  bytes,
  path = base() + '/uploads',
  extra = { purpose: 'PROJECT_FILE', folder_id: null },
  mime = 'image/png',
) {
  return good(
    await req(path, 'POST', {
      name: mime === 'application/pdf' ? 'source.pdf' : 'source.png',
      size: bytes.length,
      digest: hash(bytes),
      mime,
      ...extra,
    }),
    201,
  );
}
async function put(u, bytes) {
  const url = new URL(u.capability.url);
  return request(url.pathname + url.search, {
    method: 'PUT',
    body: bytes,
    headers: { ...u.capability.headers, Origin: 'https://localhost:8443' },
  });
}
async function awaitReady(u, path = base() + '/uploads') {
  good(await req(path + '/' + u.id + '/finalize', 'POST', {}), 200);
  for (let i = 0; i < 180; i++) {
    const s = good(await req(path + '/' + u.id), 200);
    if (['READY', 'REJECTED', 'FAILED'].includes(s.status)) {
      assert.equal(s.status, 'READY', JSON.stringify(s));
      return s;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('processing timeout');
}
before(async () => {
  owner = await account();
  t = await tenant(owner, 'Phase 4 acceptance');
  foreign = await account();
  viewer = await account();
  v = await join(owner, t, viewer);
  contributor = await account();
  c = await join(owner, t, contributor);
  const client = good(
    await req('/clients', 'POST', {
      name: 'Files client',
      description: 'Synthetic',
      status: 'ACTIVE',
    }),
    201,
  );
  project = good(
    await req('/projects', 'POST', {
      client_id: client.id,
      name: 'Files project',
      description: 'Synthetic',
      status: 'ACTIVE',
      portal_enabled: false,
      due_at: null,
    }),
    201,
  );
  for (const [membership, role] of [
    [v, 'VIEWER'],
    [c, 'CONTRIBUTOR'],
  ])
    good(
      await req(base() + '/members', 'POST', {
        membership_id: membership.principal.id,
        role,
        status: 'ACTIVE',
      }),
      201,
    );
});
after(async () => {
  await worker.end();
  await admin.end();
});
test('folder CAS, strict input, duplicate names and contributor/viewer boundaries', async () => {
  folder = good(await req(base() + '/folders', 'POST', { name: 'Drafts', position: 1 }), 201);
  assert.equal(
    (await req(base() + '/folders', 'POST', { name: ' drafts ', position: 2 })).status,
    409,
  );
  assert.equal(
    (
      await req(
        base() + '/folders/' + folder.id,
        'PATCH',
        { name: 'Changed', position: 1 },
        owner,
        { ...t.headers, 'If-Match': '"99"' },
      )
    ).status,
    412,
  );
  for (const [a, h] of [
    [viewer, v.headers],
    [contributor, c.headers],
  ])
    assert.equal(
      (await req(base() + '/folders', 'POST', { name: 'Denied', position: 0 }, a, h)).status,
      403,
    );
  assert.equal(
    (await req(base() + '/folders', 'POST', { name: '../bad', position: 0 })).status,
    400,
  );
});
test('signed staging capability binds bytes/type/length and denies replay, tampering and anonymous reads', async () => {
  const bytes = await image();
  ready = await intent(bytes);
  assert.equal((await put(ready, bytes)).status, 200);
  assert.equal((await put(ready, bytes)).status, 412);
  const tampered = new URL(ready.capability.url);
  tampered.searchParams.set('X-Amz-Expires', '299');
  assert.equal(
    (
      await request(tampered.pathname + tampered.search, {
        method: 'PUT',
        body: bytes,
        headers: { ...ready.capability.headers, Origin: 'https://localhost:8443' },
      })
    ).status,
    403,
  );
  assert.notEqual(
    (
      await fetch(
        'http://127.0.0.1:9000/dw-staging/' + tampered.pathname.split('/').slice(2).join('/'),
      )
    ).status,
    200,
  );
  assert.equal((await fetch('http://127.0.0.1:8888/buckets/dw-staging')).status, 401);
  await awaitReady(ready);
  assert.equal((await req(base() + '/uploads/' + ready.id + '/finalize', 'POST', {})).status, 200);
  const steps = await admin.query(
    'SELECT step,outcome FROM public.file_processing_step WHERE project_job=$1',
    [ready.id],
  );
  for (const stage of ['TOOLS', 'INTEGRITY', 'SCAN', 'RENDER', 'PUBLISH'])
    assert.ok(steps.rows.some((s) => s.step === stage && s.outcome === 'VERIFIED'));
});
test('ready download/preview/range, tenant isolation, live permission denial and no public object key', async () => {
  const listing = good(await req(base() + '/files'), 200).items.find(
    (x) => x.asset_id === ready.id,
  );
  assert.ok(listing);
  assert.equal('canonical_key' in listing, false);
  const download = await binary(t.path + base() + '/assets/' + ready.id + '/download');
  assert.equal(download.status, 200);
  assert.equal(hash(download.bytes), ready.expected_digest);
  assert.equal(download.headers['cache-control'], 'no-store');
  assert.equal((await binary(t.path + base() + '/assets/' + ready.id + '/preview/1')).status, 200);
  const range = await binary(t.path + base() + '/assets/' + ready.id + '/download', owner, {
    ...t.headers,
    Range: 'bytes=0-7',
  });
  assert.equal(range.status, 206);
  assert.equal(range.bytes.length, 8);
  assert.notEqual(
    (await binary(t.path + base() + '/assets/' + ready.id + '/download', foreign)).status,
    200,
  );
  assert.equal(
    (await binary(t.path + base() + '/assets/' + ready.id + '/download', viewer, v.headers)).status,
    200,
  );
  assert.equal(
    (
      await req(
        base() + '/uploads',
        'POST',
        {
          name: 'x.png',
          size: 10,
          digest: '0'.repeat(64),
          mime: 'image/png',
          purpose: 'PROJECT_FILE',
          folder_id: null,
        },
        viewer,
        v.headers,
      )
    ).status,
    403,
  );
  await admin.query(
    "UPDATE public.file_access SET status='BLOCKED',revision=revision+1 WHERE asset_id=$1",
    [ready.id],
  );
  assert.equal((await binary(t.path + base() + '/assets/' + ready.id + '/download')).status, 404);
  await admin.query(
    "UPDATE public.file_access SET status='AVAILABLE',revision=revision+1 WHERE asset_id=$1",
    [ready.id],
  );
});
test('immutable version preparation is concurrent/idempotent and retains exact storage version bytes', async () => {
  deliverable = good(
    await req(base() + '/deliverables', 'POST', {
      title: 'Delivery',
      description: 'Synthetic',
      task_id: null,
      status: 'ACTIVE',
    }),
    201,
  );
  const versions = await Promise.all(
    [1, 2, 3].map(() =>
      req(base() + '/deliverables/' + deliverable.id + '/versions', 'POST', { asset_id: ready.id }),
    ),
  );
  for (const r of versions) good(r, 201);
  assert.equal(new Set(versions.map((r) => r.json().id)).size, 1);
  assert.equal(versions[0].json().version_number, 1);
  const a = (await admin.query('SELECT * FROM public.file_asset WHERE id=$1', [ready.id])).rows[0];
  const newer = Buffer.from('trusted test overwrite of latest pointer');
  const write = await writer.request('PUT', 'dw-canonical', a.canonical_key, newer);
  assert.equal(write.status, 200);
  assert.equal(
    hash((await binary(t.path + base() + '/assets/' + ready.id + '/download')).bytes),
    a.digest,
  );
  assert.equal(
    (
      await writer.request(
        'DELETE',
        'dw-canonical',
        a.canonical_key,
        undefined,
        {},
        { versionId: a.storage_version },
      )
    ).status,
    403,
  );
  assert.notEqual(
    (await apiStorage.request('PUT', 'dw-canonical', 'original/' + crypto.randomUUID(), newer))
      .status,
    200,
  );
  await assert.rejects(
    admin.query('UPDATE public.deliverable_version SET digest=$1 WHERE asset_id=$2', [
      '1'.repeat(64),
      ready.id,
    ]),
    /immutable/i,
  );
});
test('second PDF asset produces real previews and monotonically increasing immutable version', async () => {
  const bytes = pdf(2);
  second = await intent(
    bytes,
    base() + '/uploads',
    { purpose: 'DELIVERABLE', folder_id: null },
    'application/pdf',
  );
  assert.equal((await put(second, bytes)).status, 200);
  await awaitReady(second);
  const version = good(
    await req(base() + '/deliverables/' + deliverable.id + '/versions', 'POST', {
      asset_id: second.id,
    }),
    201,
  );
  assert.equal(version.version_number, 2);
  assert.equal(version.digest, hash(bytes));
  assert.equal((await binary(t.path + base() + '/assets/' + second.id + '/preview/2')).status, 200);
  assert.equal(
    good(await req(base() + '/deliverables/' + deliverable.id + '/versions'), 200).total,
    2,
  );
});
test('separate owner-scoped profile media stays unattached until explicit CAS attachment', async () => {
  const bytes = await image('jpeg');
  const u = good(
    await owner.browser.request('/api/v1/me/image/uploads', 'POST', {
      name: 'avatar.jpg',
      size: bytes.length,
      digest: hash(bytes),
      mime: 'image/jpeg',
    }),
    201,
  );
  assert.equal((await put(u, bytes)).status, 200);
  const path = '/api/v1/me/image/uploads/' + u.id;
  good(await owner.browser.request(path + '/finalize', 'POST', {}), 200);
  for (let i = 0; i < 180; i++) {
    const x = good(await owner.browser.request(path), 200);
    if (['READY', 'FAILED', 'REJECTED'].includes(x.status)) {
      assert.equal(x.status, 'READY');
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal((await foreign.browser.request(path)).status, 404);
  let pointer = good(await owner.browser.request('/api/v1/me/image'), 200);
  assert.equal(pointer.asset_id, null);
  pointer = good(
    await owner.browser.request(
      '/api/v1/me/image',
      'PATCH',
      { asset_id: u.id },
      { 'If-Match': '"' + pointer.revision + '"' },
    ),
    200,
  );
  assert.equal(pointer.asset_id, u.id);
  assert.equal((await binary('/api/v1/me/image/content')).status, 200);
  assert.equal(
    (
      await owner.browser.request(
        '/api/v1/me/image',
        'PATCH',
        { asset_id: null },
        { 'If-Match': '"1"' },
      )
    ).status,
    412,
  );
  good(
    await owner.browser.request(
      '/api/v1/me/image',
      'PATCH',
      { asset_id: null },
      { 'If-Match': '"' + pointer.revision + '"' },
    ),
    200,
  );
});
test('24-hour cleanup boundaries, rollback/retry, protected processing and duplicate workers', async () => {
  // Synthetic expired intents are inserted directly to avoid rewriting immutable expiry identities.
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const protectedId = ids[2];
  const seed = await admin.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(
      "CREATE FUNCTION public.phase4_cleanup_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.upload_id='" +
        ids[1] +
        "'::uuid THEN RAISE EXCEPTION 'synthetic cleanup interruption'; END IF; RETURN NEW; END $$",
    );
    await seed.query(
      'CREATE TRIGGER phase4_cleanup_fault BEFORE INSERT ON public.staging_cleanup FOR EACH ROW EXECUTE FUNCTION public.phase4_cleanup_fault()',
    );
    for (const [index, hours] of [23.9, 24, 25].entries()) {
      const id = ids[index];
      assert.equal(
        (
          await apiStorage.request('PUT', 'dw-staging', id + '/' + id, Buffer.from('x'), {
            'if-none-match': '*',
          })
        ).status,
        200,
      );
      await seed.query(
        "INSERT INTO public.project_upload(id,organization_id,project_id,initiator_id,purpose,name,staging_key,expected_size,expected_digest,mime,expires_at) VALUES($1,$2,$3,$4,'PROJECT_FILE','expired.png',$5,1,$6,'image/png',now()-$7::double precision*interval '1 hour')",
        [id, t.organizationId, project.id, owner.user.id, id + '/' + id, '0'.repeat(64), hours],
      );
    }
    await seed.query("UPDATE public.project_upload SET status='UPLOADED' WHERE id=$1", [
      protectedId,
    ]);
    await seed.query(
      "INSERT INTO public.file_job(id,organization_id,project_id,available_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [protectedId, t.organizationId, project.id],
    );
    // The candidate and failure hook become visible together, preventing the
    // live automatic cleanup worker from winning fixture setup.
    await seed.query('SAVEPOINT eligibility_probe');
    await seed.query('SET LOCAL ROLE dw2_worker');
    const picked = (await seed.query('SELECT public.lock_staging_cleanup() candidate')).rows[0]
      .candidate;
    assert.ok(picked);
    assert.notEqual(picked.id, ids[0]);
    assert.notEqual(picked.id, protectedId);
    await seed.query('ROLLBACK TO SAVEPOINT eligibility_probe');
    await seed.query('RESET ROLE');
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
  let interrupted = false;
  try {
    for (let n = 0; n < 100; n++) {
      try {
        if (!(await purgeExpiredStaging(worker, cleanup))) break;
      } catch (error) {
        assert.match(String(error), /synthetic cleanup interruption/);
        interrupted = true;
        break;
      }
    }
    assert.ok(interrupted, 'real remote deletion must reach the injected SQL commit failure');
    assert.equal(
      (await apiStorage.request('HEAD', 'dw-staging', ids[1] + '/' + ids[1])).status,
      404,
    );
    assert.equal(
      (await admin.query('SELECT 1 FROM public.staging_cleanup WHERE upload_id=$1', [ids[1]]))
        .rowCount,
      0,
    );
  } finally {
    await admin.query('DROP TRIGGER phase4_cleanup_fault ON public.staging_cleanup');
    await admin.query('DROP FUNCTION public.phase4_cleanup_fault()');
  }
  await Promise.all([purgeExpiredStaging(worker, cleanup), purgeExpiredStaging(worker, cleanup)]);
  for (let n = 0; n < 100; n++) {
    if (
      (await admin.query('SELECT 1 FROM public.staging_cleanup WHERE upload_id=$1', [ids[1]]))
        .rowCount
    )
      break;
    if (!(await purgeExpiredStaging(worker, cleanup))) break;
  }
  const boundary = (
    await admin.query(
      "SELECT interval '24 hours'-interval '1 microsecond'>=interval '24 hours' before, interval '24 hours'>=interval '24 hours' exact, interval '24 hours'+interval '1 microsecond'>=interval '24 hours' after",
    )
  ).rows[0];
  assert.deepEqual(boundary, { before: false, exact: true, after: true });
  const cleaned = await admin.query(
    'SELECT upload_id FROM public.staging_cleanup WHERE upload_id=ANY($1::uuid[])',
    [ids],
  );
  assert.ok(cleaned.rows.some((x) => x.upload_id === ids[1]));
  assert.ok(!cleaned.rows.some((x) => [ids[0], protectedId].includes(x.upload_id)));
  assert.equal((await apiStorage.request('HEAD', 'dw-staging', ids[1] + '/' + ids[1])).status, 404);
  for (const id of [ids[0], protectedId])
    assert.equal((await apiStorage.request('HEAD', 'dw-staging', id + '/' + id)).status, 200);
  assert.equal(
    (
      await cleanup.request(
        'DELETE',
        'dw-canonical',
        'original/' + (ready?.id ?? crypto.randomUUID()),
      )
    ).status,
    403,
  );
  assert.equal((await req(base() + '/uploads/' + ids[1] + '/finalize', 'POST', {})).status, 409);
});
test('same-project ancestry, pending quarantine and exact byte/type limits reject forged input', async () => {
  const client = good(
    await req('/clients', 'POST', {
      name: 'Other files client',
      description: 'Synthetic',
      status: 'ACTIVE',
    }),
    201,
  );
  const other = good(
    await req('/projects', 'POST', {
      client_id: client.id,
      name: 'Other files project',
      description: 'Synthetic',
      status: 'ACTIVE',
      portal_enabled: false,
      due_at: null,
    }),
    201,
  );
  const otherFolder = good(
    await req('/projects/' + other.id + '/folders', 'POST', {
      name: 'Foreign folder',
      position: 0,
    }),
    201,
  );
  const body = {
    name: 'boundary.png',
    size: 26214400,
    digest: '0'.repeat(64),
    mime: 'image/png',
    purpose: 'PROJECT_FILE',
    folder_id: null,
  };
  const pending = good(await req(base() + '/uploads', 'POST', body), 201);
  assert.equal((await binary(t.path + base() + '/assets/' + pending.id + '/download')).status, 404);
  assert.equal(
    (await req(base() + '/uploads/' + pending.id + '/finalize', 'POST', {})).status,
    409,
  );
  assert.equal((await req(base() + '/uploads', 'POST', { ...body, size: 26214401 })).status, 413);
  assert.equal(
    (await req(base() + '/uploads', 'POST', { ...body, mime: 'text/html' })).status,
    415,
  );
  assert.equal((await req(base() + '/uploads', 'POST', { ...body, size: 0 })).status, 400);
  assert.equal(
    (await req(base() + '/uploads', 'POST', { ...body, folder_id: otherFolder.id })).status,
    404,
  );
  assert.equal(
    (
      await req('/projects/' + other.id + '/deliverables/' + deliverable.id + '/versions', 'POST', {
        asset_id: second.id,
      })
    ).status,
    404,
  );
  const task = good(
    await req('/projects/' + other.id + '/tasks', 'POST', {
      title: 'Foreign task',
      description: '',
      milestone_id: null,
      assignee_id: null,
      priority: 'NORMAL',
      status: 'TODO',
      due_at: null,
      position: 0,
    }),
    201,
  );
  assert.equal(
    (
      await req(base() + '/deliverables', 'POST', {
        title: 'Wrong task',
        description: '',
        task_id: task.id,
        status: 'ACTIVE',
      })
    ).status,
    404,
  );
});
test('logo mutation requires an organization administrator and profile media cannot cross purpose', async () => {
  const bytes = await image();
  const logoPath = '/logo';
  assert.equal(
    (
      await req(
        logoPath + '/uploads',
        'POST',
        { name: 'logo.png', size: bytes.length, digest: hash(bytes), mime: 'image/png' },
        contributor,
        c.headers,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.browser.request('/api/v1/me/image/uploads', 'POST', {
        name: 'big.png',
        size: 2097153,
        digest: hash(bytes),
        mime: 'image/png',
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await owner.browser.request('/api/v1/me/image/uploads', 'POST', {
        name: 'no.pdf',
        size: bytes.length,
        digest: hash(bytes),
        mime: 'application/pdf',
      })
    ).status,
    415,
  );
  const u = await intent(bytes, logoPath + '/uploads', {});
  assert.equal((await put(u, bytes)).status, 200);
  await awaitReady(u, logoPath + '/uploads');
  let ref = good(await req('/logo'), 200);
  ref = good(
    await req('/logo', 'PATCH', { asset_id: u.id }, owner, {
      ...t.headers,
      'If-Match': '"' + ref.revision + '"',
    }),
    200,
  );
  assert.equal((await binary(t.path + '/logo/content')).status, 200);
  const self = good(await owner.browser.request('/api/v1/me/image'), 200);
  assert.equal(
    (
      await owner.browser.request(
        '/api/v1/me/image',
        'PATCH',
        { asset_id: u.id },
        { 'If-Match': '"' + self.revision + '"' },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req('/logo', 'PATCH', { asset_id: ready.id }, owner, {
        ...t.headers,
        'If-Match': '"' + ref.revision + '"',
      })
    ).status,
    404,
  );
  good(
    await req('/logo', 'PATCH', { asset_id: null }, owner, {
      ...t.headers,
      'If-Match': '"' + ref.revision + '"',
    }),
    200,
  );
});
test('malformed bytes fail closed without canonical assets or listings', async () => {
  const bytes = Buffer.from('<html><script>untrusted</script></html>');
  const u = await intent(bytes);
  assert.equal((await put(u, bytes)).status, 200);
  good(await req(base() + '/uploads/' + u.id + '/finalize', 'POST', {}), 200);
  let final;
  for (let i = 0; i < 120; i++) {
    final = good(await req(base() + '/uploads/' + u.id), 200);
    if (['REJECTED', 'FAILED', 'READY'].includes(final.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(['REJECTED', 'FAILED'].includes(final.status));
  assert.equal((await binary(t.path + base() + '/assets/' + u.id + '/download')).status, 404);
  assert.equal(
    (await admin.query('SELECT id FROM public.file_asset WHERE upload_id=$1', [u.id])).rowCount,
    0,
  );
});
test('folder audit/outbox failure rolls back the domain mutation', async () => {
  const name = 'Atomic folder ' + crypto.randomUUID();
  await admin.query(
    "CREATE FUNCTION public.phase4_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='" +
      t.organizationId +
      "'::uuid AND NEW.metadata->>'action'='folder.created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$",
  );
  await admin.query(
    'CREATE TRIGGER phase4_audit_fault BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.phase4_audit_fault()',
  );
  try {
    assert.equal((await req(base() + '/folders', 'POST', { name, position: 0 })).status, 503);
  } finally {
    await admin.query('DROP TRIGGER phase4_audit_fault ON public.audit_event');
    await admin.query('DROP FUNCTION public.phase4_audit_fault()');
  }
  assert.equal(
    (
      await admin.query(
        'SELECT id FROM public.project_folder WHERE organization_id=$1 AND name=$2',
        [t.organizationId, name],
      )
    ).rowCount,
    0,
  );
});
test('runtime RLS and narrow worker functions deny raw content tables and invalid lease proofs', async () => {
  await assert.rejects(worker.query('SELECT * FROM public.file_asset'), /permission denied/);
  await assert.rejects(
    worker.query('SELECT public.load_file_job($1,$2)', [ready.id, crypto.randomUUID()]),
    /invalid processing lease/,
  );
  const api = new Pool({ connectionString: runtime.PRODUCT_API_URL });
  try {
    assert.equal((await api.query('SELECT * FROM public.file_asset')).rowCount, 0);
    await assert.rejects(
      api.query('UPDATE public.deliverable_version SET digest=$1', ['f'.repeat(64)]),
      /permission denied/,
    );
  } finally {
    await api.end();
  }
  const rows = await admin.query(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('project_folder','project_upload','file_asset','file_access','file_preview','project_file','deliverable','deliverable_version','logo_upload','logo_asset','logo_access','logo_reference','profile_upload','profile_asset','profile_access','profile_reference','file_job','media_job','staging_cleanup','file_processing_step')",
  );
  assert.equal(rows.rowCount, 20);
  assert.ok(rows.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
});
test('live project participation revocation denies a previously authorized ready download', async () => {
  const member = good(await req(base() + '/members'), 200).items.find(
    (m) => m.membership_id === v.principal.id,
  );
  assert.ok(member);
  good(
    await req(
      base() + '/members/' + member.id,
      'PATCH',
      { membership_id: v.principal.id, role: 'VIEWER', status: 'INACTIVE' },
      owner,
      { ...t.headers, 'If-Match': '"' + member.revision + '"' },
    ),
    200,
  );
  assert.notEqual(
    (await binary(t.path + base() + '/assets/' + ready.id + '/download', viewer, v.headers)).status,
    200,
  );
});
test('all additive migrations install on a fresh validation database', async () => {
  const name = 'devworkspace_phase4_validation_' + crypto.randomUUID().replaceAll('-', '');
  await admin.query('CREATE DATABASE ' + name + ' OWNER dw2_owner');
  const url = new URL(runtime.PRODUCT_API_URL);
  url.username = process.env.POSTGRES_USER;
  url.password = process.env.POSTGRES_PASSWORD;
  url.pathname = '/' + name;
  const db = new Pool({ connectionString: url.href });
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('SET LOCAL ROLE dw2_owner');
    const { readdir } = await import('node:fs/promises');
    for (const file of (await readdir('packages/database/prisma/product'))
      .filter((n) => /^\d{4}.*\.sql$/.test(n))
      .sort())
      await tx.query(await readFile('packages/database/prisma/product/' + file, 'utf8'));
    await tx.query('COMMIT');
    assert.ok(
      (await tx.query("SELECT to_regclass('public.file_processing_step') name")).rows[0].name,
    );
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
    await db.end();
  }
});
test('interrupted canonical publication and duplicate leased loads converge without duplicate ready metadata', async () => {
  const key = 'original/' + crypto.randomUUID(),
    bytes = await image();
  const version = await publishObject(writer, key, bytes);
  assert.equal(await publishObject(writer, key, bytes), version);
  const id = crypto.randomUUID(),
    lease = crypto.randomUUID();
  await admin.query(
    "INSERT INTO public.project_upload(id,organization_id,project_id,initiator_id,purpose,name,staging_key,expected_size,expected_digest,mime,status) VALUES($1,$2,$3,$4,'DELIVERABLE','retry.png',$5,1,$6,'image/png','UPLOADED')",
    [id, t.organizationId, project.id, owner.user.id, id + '/' + id, '0'.repeat(64)],
  );
  await admin.query(
    "INSERT INTO public.file_job(id,organization_id,project_id,lease,lease_until,attempts,available_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes',1,now()+interval '1 hour')",
    [id, t.organizationId, project.id, lease],
  );
  const load = () => worker.query('SELECT public.load_file_job($1,$2) intent', [id, lease]);
  await load();
  await load();
  assert.equal(
    (await admin.query('SELECT attempts FROM public.project_upload WHERE id=$1', [id])).rows[0]
      .attempts,
    1,
  );
  assert.equal(
    (
      await worker.query("SELECT public.finish_file_job($1,$2,'FAILED',$3) finished", [
        id,
        lease,
        { error_code: 'SYNTHETIC_INTERRUPTION' },
      ])
    ).rows[0].finished,
    true,
  );
  assert.equal(
    (
      await worker.query("SELECT public.finish_file_job($1,$2,'FAILED',$3) finished", [
        id,
        lease,
        { error_code: 'SYNTHETIC_INTERRUPTION' },
      ])
    ).rows[0].finished,
    false,
  );
  assert.equal(
    (await admin.query('SELECT id FROM public.file_asset WHERE upload_id=$1', [id])).rowCount,
    0,
  );
});
test('cross-process processing lock and crash residue guard prevent a second tenant parser from starting', async () => {
  const lock = await worker.connect(),
    other = await worker.connect();
  const root = resolve('.local/processing/work'),
    directory = pathJoin(root, crypto.randomUUID());
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext('devworkspace-private-processing'))");
    assert.equal(
      (
        await other.query(
          "SELECT pg_try_advisory_lock(hashtext('devworkspace-private-processing')) acquired",
        )
      ).rows[0].acquired,
      false,
    );
    await mkdir(directory);
    await assert.rejects(
      processPrivateFile(writer, {
        id: crypto.randomUUID(),
        staging_key: crypto.randomUUID(),
        expected_size: 1,
        expected_digest: '0'.repeat(64),
        mime: 'image/png',
      }),
      /isolated recovery/,
    );
  } finally {
    assert.ok(directory.startsWith(root + '\\'));
    await rm(directory, { recursive: true, force: true });
    await lock.query("SELECT pg_advisory_unlock(hashtext('devworkspace-private-processing'))");
    lock.release();
    other.release();
  }
});
