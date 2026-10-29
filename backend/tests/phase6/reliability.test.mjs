import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { Browser, admin, runtime, account, mail } from '../phase2/helpers.mjs';
import { Redis, credentials } from '../../scripts/native-infra.mjs';
const requireWorker = createRequire(resolve('apps/worker/package.json'));
const { Queue } = requireWorker('bullmq');
let f, browser, worker, dispatcher, workerEnv;
const good = (r, n = 200) => {
  assert.equal(r.status, n, r.body);
  return r.json();
};
const wait = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('Recovery condition did not complete');
};
const req = (p, m = 'GET', b, h = {}) =>
  browser.request(`/api/v1/organizations/${f.org}` + p, m, b, {
    'X-Organization-Principal': f.principal,
    ...h,
  });
before(async () => {
  f = JSON.parse(await readFile('.local/phase6-browser-fixture.json', 'utf8'));
  browser = new Browser();
  await browser.login(f.owner);
  workerEnv = Object.fromEntries(
    (await readFile('.local/phase2-worker.env', 'utf8'))
      .trim()
      .split('\n')
      .map((l) => {
        const at = l.indexOf('=');
        return [l.slice(0, at), l.slice(at + 1)];
      }),
  );
  worker = new Pool({ connectionString: workerEnv.PRODUCT_WORKER_URL });
  dispatcher = new Pool({ connectionString: workerEnv.PRODUCT_DISPATCH_URL });
});
after(async () => {
  await worker?.end();
  await dispatcher?.end();
  await admin.end();
});
async function patch(title) {
  const row = good(await req(`/projects/${f.project}/tasks/${f.task}`));
  return good(
    await req(
      `/projects/${f.project}/tasks/${f.task}`,
      'PATCH',
      {
        title,
        description: row.description,
        priority: row.priority,
        status: row.status,
        milestone_id: row.milestone_id,
        assignee_id: f.ownerPm,
        due_at: row.due_at,
        position: row.position,
      },
      { 'If-Match': `"${row.revision}"` },
    ),
  );
}
async function heldEvent(seconds = 60) {
  const lease = crypto.randomUUID();
  await admin.query(
    `CREATE FUNCTION public.phase6_hold_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lane='tenant' AND EXISTS(SELECT 1 FROM public.tenant_event WHERE id=NEW.event_id AND organization_id='${f.org}' AND target_id='${f.task}' AND action='tasks.updated') THEN NEW.lease:='${lease}'; NEW.lease_until:=clock_timestamp()+make_interval(secs=>${seconds}); NEW.attempts:=1; END IF; RETURN NEW; END $$; CREATE TRIGGER phase6_hold_event BEFORE INSERT ON public.delivery FOR EACH ROW EXECUTE FUNCTION public.phase6_hold_event()`,
  );
  try {
    await patch('Real held Phase6 task ' + crypto.randomUUID());
  } finally {
    await admin.query(
      'DROP TRIGGER phase6_hold_event ON public.delivery; DROP FUNCTION public.phase6_hold_event()',
    );
  }
  const e = (
    await admin.query("SELECT event_id FROM public.delivery WHERE lane='tenant' AND lease=$1", [
      lease,
    ])
  ).rows[0];
  assert.ok(e);
  return { event_id: e.event_id, lease, lane: 'tenant' };
}
const consume = (e) =>
  worker.query('SELECT public.materialize_notifications($1,$2) result', [e.event_id, e.lease]);
const finish = (e) =>
  worker.query("SELECT public.finish_event('tenant',$1,$2,true) ok", [e.event_id, e.lease]);
const facts = async (e) =>
  (
    await admin.query(
      "SELECT d.completed_at,(SELECT count(*)::int FROM public.notification n WHERE n.event_id=d.event_id) notifications,(SELECT count(*)::int FROM public.consumer_receipt r WHERE r.event_id=d.event_id AND r.handler='notifications-v6') receipts FROM public.delivery d WHERE d.lane='tenant' AND d.event_id=$1",
      [e.event_id],
    )
  ).rows[0];

test('concurrent/out-of-order materialization is idempotent and cannot acknowledge a missing durable receipt', async () => {
  const a = await heldEvent(),
    b = await heldEvent();
  await assert.rejects(finish(a), (e) => e.code === '23514');
  const results = await Promise.all([consume(b), consume(b)]);
  assert.deepEqual(results.map((r) => r.rows[0].result.replay).sort(), [false, true]);
  await consume(a);
  await finish(b);
  await finish(a);
  assert.equal((await facts(a)).notifications, 1);
  assert.equal((await facts(b)).notifications, 1);
  assert.equal((await facts(a)).receipts, 1);
  assert.equal((await finish(a)).rows[0].ok, false);
  await assert.rejects(
    worker.query('SELECT public.materialize_notifications($1,$2)', [
      a.event_id,
      crypto.randomUUID(),
    ]),
    (e) => e.code === '42501',
  );
});

test('effect/receipt fault rolls back all notification facts while committed domain state remains recoverable', async () => {
  for (const table of ['notification', 'consumer_receipt']) {
    const e = await heldEvent();
    await admin.query(
      `CREATE FUNCTION public.phase6_effect_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id='${e.event_id}' THEN RAISE EXCEPTION 'synthetic projection fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase6_effect_fault BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.phase6_effect_fault()`,
    );
    try {
      await assert.rejects(consume(e), (x) => x.code === 'P0001');
      assert.equal((await facts(e)).notifications, 0);
      assert.equal((await facts(e)).receipts, 0);
      assert.equal((await facts(e)).completed_at, null);
      assert.ok(
        good(await req(`/projects/${f.project}/tasks/${f.task}`)).title.startsWith(
          'Real held Phase6',
        ),
      );
    } finally {
      await admin.query(
        `DROP TRIGGER phase6_effect_fault ON public.${table}; DROP FUNCTION public.phase6_effect_fault()`,
      );
    }
    await consume(e);
    await finish(e);
    assert.equal((await facts(e)).notifications, 1);
  }
});

test('preference commit before delayed materialization suppresses an older event without later backfill', async () => {
  const e = await heldEvent();
  let pref = good(await browser.request('/api/v1/me/notification-preferences'));
  pref = good(
    await browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: false, reviews: true },
      { 'If-Match': `"${pref.revision}"` },
    ),
  );
  try {
    await consume(e);
    assert.equal((await facts(e)).notifications, 0);
  } finally {
    good(
      await browser.request(
        '/api/v1/me/notification-preferences',
        'PATCH',
        { assignments: true, reviews: true },
        { 'If-Match': `"${pref.revision}"` },
      ),
    );
  }
  await consume(e);
  await finish(e);
  assert.equal((await facts(e)).notifications, 0);
  assert.equal((await facts(e)).receipts, 1);
});

test('an independently running real worker killed mid-projection is recovered by natural lease expiry', async () => {
  const e = await heldEvent(10),
    name = 'dw-phase2-events-test-' + crypto.randomUUID(),
    label = 'phase6-child-' + crypto.randomUUID();
  const redis = new URL(process.env.REDIS_URL);
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    password: decodeURIComponent(redis.password),
    maxRetriesPerRequest: null,
  };
  const queue = new Queue(name, { connection });
  const workerUrl = new URL(workerEnv.PRODUCT_WORKER_URL);
  workerUrl.searchParams.set('application_name', label);
  const lock = await admin.connect();
  let child;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [f.org]);
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      USERPROFILE: process.env.USERPROFILE,
      ...workerEnv,
      PRODUCT_WORKER_URL: workerUrl.href,
      REDIS_URL: process.env.REDIS_URL,
      PHASE6_QUEUE: name,
    };
    child = spawn(process.execPath, ['tests/phase6/worker-child.mjs'], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((yes, no) => {
      child.stdout.once('data', yes);
      child.once('exit', () => no(new Error('Independent worker failed')));
      setTimeout(() => no(new Error('Worker startup timeout')), 5000).unref();
    });
    await queue.add('committed-event', e, { jobId: e.event_id + '-' + e.lease });
    await wait(
      async () =>
        (
          await admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query LIKE '%materialize_notifications%' AND wait_event_type='Lock'",
            [label],
          )
        ).rowCount,
    );
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
  } finally {
    if (child && child.exitCode === null) child.kill();
    await lock.query('COMMIT');
    lock.release();
    await queue.close();
  }
  await wait(async () => (await facts(e)).completed_at, 45000);
  assert.equal((await facts(e)).notifications, 1);
  assert.equal((await facts(e)).receipts, 1);
});

test('lost accepted queue work plus real Redis shutdown/restart is recovered from PostgreSQL without domain rollback', async () => {
  const e = await heldEvent(4),
    name = 'dw-phase2-events-test-' + crypto.randomUUID();
  const marker = JSON.parse(
    (await readFile('.local/native/redis-process.json', 'utf8')).replace(/^\uFEFF/, ''),
  );
  assert.equal(marker.root, resolve('.'));
  assert.equal(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/native-process.ps1',
        '-Action',
        'inspect',
        '-Record',
        '.local/native/redis-process.json',
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim(),
    'true',
  );
  const secrets = await credentials(),
    connection = {
      host: '127.0.0.1',
      port: 6379,
      password: secrets.redisPassword,
      maxRetriesPerRequest: 1,
    };
  const queue = new Queue(name, { connection });
  const client = new Redis({ ...connection, retryStrategy: () => null });
  client.on('error', () => {});
  try {
    const job = await queue.add('committed-event', e, { jobId: e.event_id + '-' + e.lease });
    assert.ok(await queue.getJob(job.id));
    await job.remove();
    try {
      await client.shutdown('SAVE');
    } catch (x) {
      assert.match(x.message, /closed|ECONNRESET/);
    }
    await patch('Committed during real Redis outage');
    assert.equal(
      good(await req(`/projects/${f.project}/tasks/${f.task}`)).title,
      'Committed during real Redis outage',
    );
  } finally {
    client.disconnect();
    await queue.close();
    execFileSync(process.execPath, ['scripts/native-infra.mjs', 'up'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 60000,
    });
  }
  await wait(async () => (await facts(e)).completed_at, 45000);
  assert.equal((await facts(e)).notifications, 1);
  await wait(async () => {
    const r = await admin.query(
      'SELECT d.completed_at FROM public.tenant_event e JOIN public.delivery d ON d.event_id=e.id WHERE e.organization_id=$1 AND e.target_id=$2 ORDER BY e.created_at DESC LIMIT 1',
      [f.org, f.task],
    );
    return r.rows[0].completed_at;
  }, 45000);
});

test('exhausted attempts are content-free, visible, audited and replayed through the restricted operator path', async () => {
  const e = await heldEvent();
  await admin.query(
    "UPDATE public.delivery SET attempts=8,lease_until=now()-interval '1 second',available_at=now()+interval '5 minutes',error_code='DELIVERY_FAILED' WHERE lane='tenant' AND event_id=$1",
    [e.event_id],
  );
  const details = (await worker.query('SELECT * FROM public.delivery_details(100)')).rows;
  assert.equal(details.find((r) => r.event_id === e.event_id).state, 'EXHAUSTED');
  assert.ok(details.every((r) => !('target_id' in r) && !('envelope' in r)));
  assert.equal(
    (await dispatcher.query("SELECT public.retry_failed('tenant',$1) retried", [e.event_id]))
      .rows[0].retried,
    true,
  );
  await wait(async () => (await facts(e)).completed_at);
  assert.equal((await facts(e)).notifications, 1);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.dispatch_audit WHERE event_id=$1 AND action='retry_exhausted'",
        [e.event_id],
      )
    ).rows[0].n,
    1,
  );
});

test('actual SMTP process outage preserves materialization receipts and retries mandatory invitation mail despite disabled categories', async () => {
  const recipient = await account();
  let pref = good(await recipient.browser.request('/api/v1/me/notification-preferences'));
  good(
    await recipient.browser.request(
      '/api/v1/me/notification-preferences',
      'PATCH',
      { assignments: false, reviews: false },
      { 'If-Match': `"${pref.revision}"` },
    ),
  );
  let event;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/native-process.ps1',
        '-Action',
        'stop',
        '-Record',
        '.local/native/mailpit-process.json',
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 45000 },
    );
    const invite = good(
      await req('/invitations', 'POST', { email: recipient.email, role: 'MEMBER' }),
      201,
    );
    event = (
      await admin.query(
        "SELECT id FROM public.tenant_event WHERE organization_id=$1 AND kind='invitation.created' AND target_id=$2 ORDER BY created_at DESC LIMIT 1",
        [f.org, invite.id],
      )
    ).rows[0].id;
    const state = await wait(async () => {
      const r = (
        await admin.query(
          "SELECT attempts,error_code,completed_at,available_at>now() delayed FROM public.delivery WHERE lane='tenant' AND event_id=$1",
          [event],
        )
      ).rows[0];
      return r.error_code ? r : false;
    });
    assert.equal(state.completed_at, null);
    assert.equal(state.error_code, 'DELIVERY_FAILED');
    assert.ok(state.attempts >= 1 && state.attempts <= 8);
    assert.equal(state.delayed, true);
    assert.equal((await facts({ event_id: event })).receipts, 1);
  } finally {
    execFileSync(process.execPath, ['scripts/native-infra.mjs', 'up'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 60000,
    });
  }
  await wait(async () => (await facts({ event_id: event })).completed_at, 30000);
  await mail(recipient.email, 'DevWorkspace team invitation');
  assert.equal((await facts({ event_id: event })).notifications, 0);
});
