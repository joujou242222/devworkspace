import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { Pool } from 'pg';
import { sealMail, openMail, sendLocalMail } from '../../packages/server/dist/index.js';
import { Browser, admin, account, register, mail, runtime, password } from './helpers.mjs';
let child;
const port = 3003;
async function secondary(path, options = {}) {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    json: () => JSON.parse(body),
    headers: { 'set-cookie': response.headers.getSetCookie() },
  };
}
before(async () => {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    USERPROFILE: process.env.USERPROFILE,
    ...runtime,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    API_PORT: String(port),
    BIND_HOST: '127.0.0.1',
    EXPERIMENT_AUTH_ENABLED: 'false',
  };
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 200; i++) {
    try {
      if ((await secondary('/api/v1/health/ready')).status === 200) return;
    } catch {}
    if (child.exitCode !== null) throw new Error('Secondary product API exited');
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Secondary API readiness timed out');
});
after(async () => {
  if (child && child.exitCode === null) child.kill();
  await admin.end();
});
test('T01: proofs have one winner across independent Nest API processes; throttling is shared and persistent', async () => {
  const a = await register();
  let token = (await mail(a.email, 'Verify your DevWorkspace email')).searchParams.get('token');
  const clients = [new Browser(), new Browser(secondary), new Browser(), new Browser(secondary)];
  let results = await Promise.all(
    clients.map((b) => b.request('/api/v1/identity/verify', 'POST', { token })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  await a.browser.login(a.email);
  await a.browser.request('/api/v1/identity/recovery', 'POST', { email: a.email });
  token = (await mail(a.email, 'Reset your DevWorkspace password')).searchParams.get('token');
  results = await Promise.all(
    clients.map((b) =>
      b.request('/api/v1/identity/reset', 'POST', { token, newPassword: password + 'race' }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await a.browser.request('/api/v1/me')).status, 401);
  const absent = 'absent-' + crypto.randomUUID() + '@example.test';
  const statuses = [];
  for (let i = 0; i < 13; i++)
    statuses.push(
      (await clients[i % 2].request('/api/v1/identity/recovery', 'POST', { email: absent })).status,
    );
  assert.equal(statuses.filter((s) => s === 202).length, 12);
  assert.equal(statuses.at(-1), 429);
});
test('T22/T23: encrypted durable mail, actual SMTP outage, lease expiry/reclaim, duplicate receipt and scope denial', async () => {
  const a = await account();
  const creds = JSON.parse(await readFile('.local/phase2-credentials.json', 'utf8'));
  const endpoint = (role) => {
    const u = new URL(runtime.PRODUCT_API_URL);
    u.username = 'dw2_' + role;
    u.password = creds[role];
    return u.href;
  };
  const consumer = new Pool({ connectionString: endpoint('worker') });
  const dispatcher = new Pool({ connectionString: endpoint('dispatch') });
  const id = crypto.randomUUID(),
    lease = crypto.randomUUID();
  const text = 'synthetic nonsecret mail ' + crypto.randomUUID();
  const envelope = sealMail(runtime.PRODUCT_MAIL_KEY, {
    to: a.email,
    subject: 'Phase 2 worker retry',
    text,
  });
  assert.ok(!envelope.includes(text));
  try {
    const tx = await admin.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('INSERT INTO identity_mail(id,"userId",kind,envelope) VALUES($1,$2,$3,$4)', [
        id,
        a.user.id,
        'verify',
        envelope,
      ]);
      await tx.query(
        "UPDATE delivery SET lease=$2,lease_until=now()+interval '1 minute',attempts=1 WHERE event_id=$1",
        [id, lease],
      );
      await tx.query('COMMIT');
    } finally {
      tx.release();
    }
    const load = await consumer.query('SELECT public.load_mail($1,$2,$3) AS envelope', [
      'identity',
      id,
      lease,
    ]);
    assert.equal(openMail(runtime.PRODUCT_MAIL_KEY, load.rows[0].envelope).text, text);
    await assert.rejects(
      consumer.query('SELECT public.load_mail($1,$2,$3)', ['tenant', id, lease]),
    );
    await assert.rejects(consumer.query('SELECT * FROM identity_user'));
    await assert.rejects(sendLocalMail(openMail(runtime.PRODUCT_MAIL_KEY, envelope), 1));
    assert.equal(
      (
        await consumer.query('SELECT public.finish_event($1,$2,$3,false) AS changed', [
          'identity',
          id,
          lease,
        ])
      ).rows[0].changed,
      true,
    );
    const state = (
      await admin.query('SELECT completed_at,error_code FROM delivery WHERE event_id=$1', [id])
    ).rows[0];
    assert.equal(state.completed_at, null);
    assert.equal(state.error_code, 'DELIVERY_FAILED');
    // Simulate an enqueued job lost before consumption: the PostgreSQL lease expires.
    await admin.query(
      "UPDATE delivery SET lease_until=now()-interval '1 second',available_at=now()-interval '1 second' WHERE event_id=$1",
      [id],
    );
    const claim = await dispatcher.query('SELECT * FROM public.claim_events()');
    const row = claim.rows.find((r) => r.event_id === id);
    assert.ok(row);
    assert.notEqual(row.lease, lease);
    await assert.rejects(
      consumer.query('SELECT public.load_mail($1,$2,$3)', ['identity', id, lease]),
    );
    await sendLocalMail(openMail(runtime.PRODUCT_MAIL_KEY, envelope));
    assert.equal(
      (
        await consumer.query('SELECT public.finish_event($1,$2,$3,true) AS changed', [
          'identity',
          id,
          row.lease,
        ])
      ).rows[0].changed,
      true,
    );
    assert.equal(
      (
        await consumer.query('SELECT public.finish_event($1,$2,$3,true) AS changed', [
          'identity',
          id,
          row.lease,
        ])
      ).rows[0].changed,
      false,
    );
    assert.equal(
      (await admin.query('SELECT count(*) FROM consumer_receipt WHERE event_id=$1', [id])).rows[0]
        .count,
      '1',
    );
    assert.equal(
      (await dispatcher.query('SELECT public.retry_failed($1,$2) AS retried', ['identity', id]))
        .rows[0].retried,
      false,
      'Completed effects cannot be replayed',
    );
    const failed = crypto.randomUUID();
    const fixture = await admin.connect();
    try {
      await fixture.query('BEGIN');
      await fixture.query(
        'INSERT INTO identity_event(id,user_id,kind,target_id) VALUES($1,$2,$3,$2)',
        [failed, a.user.id, 'security'],
      );
      await fixture.query(
        "UPDATE delivery SET attempts=8,available_at=now()+interval '1 day' WHERE event_id=$1",
        [failed],
      );
      await fixture.query('COMMIT');
    } finally {
      fixture.release();
    }
    assert.equal(
      (await dispatcher.query('SELECT public.retry_failed($1,$2) AS retried', ['identity', failed]))
        .rows[0].retried,
      true,
    );
    assert.equal(
      (await dispatcher.query('SELECT public.retry_failed($1,$2) AS retried', ['identity', failed]))
        .rows[0].retried,
      false,
    );
    assert.equal(
      (await admin.query('SELECT count(*) FROM dispatch_audit WHERE event_id=$1', [failed])).rows[0]
        .count,
      '1',
    );
  } finally {
    await consumer.end();
    await dispatcher.end();
  }
});
