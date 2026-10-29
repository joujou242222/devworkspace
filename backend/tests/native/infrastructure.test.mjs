import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { Redis, credentials, bindings } from '../../scripts/native-infra.mjs';
import { s3, sendMail } from './protocols.mjs';
process.loadEnvFile('.env.local');
const workerRequire = createRequire(resolve('apps/worker/package.json'));
const { Queue, Worker, QueueEvents } = workerRequire('bullmq');
const { redisPassword } = await credentials();
const connection = {
  host: '127.0.0.1',
  port: 6379,
  password: redisPassword,
  maxRetriesPerRequest: null,
};
const redis = () => new Redis({ ...connection, maxRetriesPerRequest: 1 });

test('native PostgreSQL uses the retained cluster and real SQL transaction', async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const result = await db.query(
      'SELECT version(), host(inet_server_addr()) AS addr, inet_server_port() AS port',
    );
    assert.match(result.rows[0].version, /PostgreSQL 18\.4/);
    assert.equal(result.rows[0].addr, '127.0.0.1');
    assert.equal(result.rows[0].port, 55432);
    await db.query('BEGIN');
    await db.query('CREATE TEMP TABLE native_probe(value integer) ON COMMIT DROP');
    await db.query('INSERT INTO native_probe VALUES (42)');
    assert.equal((await db.query('SELECT value FROM native_probe')).rows[0].value, 42);
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
});
test('Redis requires credentials and supports the pinned queue command surface', async () => {
  const anonymous = new Redis({ host: '127.0.0.1', port: 6379, retryStrategy: () => null });
  anonymous.on('error', () => {});
  const client = redis();
  try {
    await assert.rejects(anonymous.ping(), /NOAUTH/);
    assert.equal(await client.ping(), 'PONG');
    assert.equal(await client.eval('return 42', 0), 42);
    assert.equal((await client.config('GET', 'maxmemory-policy'))[1], 'noeviction');
    assert.equal((await client.config('GET', 'appendonly'))[1], 'yes');
  } finally {
    anonymous.disconnect();
    await client.quit();
  }
});
test(
  'BullMQ real producer/worker processes immediate, retried and delayed jobs',
  { timeout: 45000 },
  async () => {
    const name = 'native-' + randomUUID();
    const queue = new Queue(name, { connection });
    const events = new QueueEvents(name, { connection });
    const worker = new Worker(
      name,
      async (job) => {
        if (job.name === 'retry' && job.attemptsMade === 0)
          throw new Error('Disposable retry probe');
        return { value: job.data.value * 2 };
      },
      { connection },
    );
    const errors = [];
    worker.on('error', (error) => errors.push(error));
    try {
      await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]);
      const one = await queue.add('immediate', { value: 21 });
      assert.deepEqual(await one.waitUntilFinished(events, 15000), { value: 42 });
      const retry = await queue.add(
        'retry',
        { value: 7 },
        { attempts: 2, backoff: { type: 'fixed', delay: 100 } },
      );
      assert.deepEqual(await retry.waitUntilFinished(events, 15000), { value: 14 });
      assert.equal((await queue.getJob(retry.id)).attemptsMade, 2);
      const before = Date.now();
      const delayed = await queue.add('delay', { value: 3 }, { delay: 300 });
      assert.deepEqual(await delayed.waitUntilFinished(events, 15000), { value: 6 });
      assert.ok(Date.now() - before >= 250);
      assert.equal(errors.length, 0);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate();
      await queue.close();
    }
  },
);
test('authenticated S3 roundtrip, wrong credentials and anonymous reads denied', async () => {
  const bucket = 'native-' + randomUUID();
  const path = '/' + bucket + '/probe.txt';
  try {
    assert.equal((await s3('PUT', '/' + bucket)).status, 200);
    assert.equal((await s3('PUT', path, 'private-native-probe')).status, 200);
    const response = await s3('GET', path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'private-native-probe');
    assert.equal((await s3('GET', path, '', false)).status, 403);
    const key = process.env.S3_SECRET_KEY;
    try {
      process.env.S3_SECRET_KEY = 'invalid-test-key';
      assert.equal((await s3('GET', path)).status, 403);
    } finally {
      process.env.S3_SECRET_KEY = key;
    }
    assert.equal((await s3('DELETE', path)).status, 204);
    assert.equal((await s3('GET', path)).status, 404);
  } finally {
    await s3('DELETE', path);
    await s3('DELETE', '/' + bucket);
  }
});
test('SMTP delivers a real message to Mailpit API', async () => {
  const subject = 'native-' + randomUUID();
  await sendMail(subject);
  const messages = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
  const message = messages.messages.find((item) => item.Subject === subject);
  assert.ok(message);
  assert.equal(message.To[0].Address, 'sink@example.test');
  const detail = await (await fetch('http://127.0.0.1:8025/api/v1/message/' + message.ID)).json();
  assert.match(detail.Text, /Disposable Phase 1 SMTP integration/);
});
test('native interfaces are all explicitly loopback-bound', async () => {
  const actual = await bindings();
  assert.ok(actual.length >= 11);
  await writeFile('.local/native/test-bindings.json', JSON.stringify(actual, null, 2));
});
test(
  'owned real queue/S3/mail fixtures survive service shutdown and restart',
  { timeout: 120000 },
  async () => {
    const { execFileSync } = await import('node:child_process');
    const pgState = async () => {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      try {
        await db.connect();
        return (
          await db.query(
            "SELECT current_setting('data_directory') AS directory, (SELECT count(*)::text FROM v01_user) AS users",
          )
        ).rows[0];
      } finally {
        await db.end();
      }
    };
    const beforePg = await pgState();
    assert.equal(
      beforePg.directory.replaceAll('\\', '/').toLowerCase(),
      resolve('.local/pg').replaceAll('\\', '/').toLowerCase(),
    );
    const id = randomUUID();
    const bucket = 'persist-' + id;
    const key = 'native-persist:' + id;
    const queueName = 'persist-' + id;
    let client = redis();
    let queue = new Queue(queueName, { connection });
    let worker;
    let events;
    try {
      await client.set(key, id);
      await queue.add('persist', { value: id });
      await queue.close();
      queue = null;
      assert.equal((await s3('PUT', '/' + bucket)).status, 200);
      assert.equal((await s3('PUT', '/' + bucket + '/persist.txt', id)).status, 200);
      await sendMail('persist-' + id);
      await client.quit();
      execFileSync(process.execPath, ['scripts/native-infra.mjs', 'restart'], {
        windowsHide: true,
        stdio: 'inherit',
        timeout: 90000,
      });
      assert.deepEqual(await pgState(), beforePg);
      client = redis();
      assert.equal(await client.get(key), id);
      const response = await s3('GET', '/' + bucket + '/persist.txt');
      assert.equal(await response.text(), id);
      const messages = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
      assert.ok(messages.messages.some((message) => message.Subject === 'persist-' + id));
      queue = new Queue(queueName, { connection });
      events = new QueueEvents(queueName, { connection });
      await events.waitUntilReady();
      const jobs = await queue.getWaiting();
      assert.equal(jobs.length, 1);
      worker = new Worker(queueName, async (job) => job.data.value, { connection });
      assert.equal(await jobs[0].waitUntilFinished(events, 15000), id);
      await writeFile(
        '.local/native/persistence-result.json',
        JSON.stringify(
          {
            postgresRetained: true,
            redisAOF: true,
            queuedJob: true,
            s3Object: true,
            smtpMessage: true,
            gracefulRestart: true,
            bindings: await bindings(),
          },
          null,
          2,
        ),
      );
    } finally {
      if (worker) await worker.close();
      if (events) await events.close();
      if (queue) {
        try {
          await queue.obliterate();
        } finally {
          await queue.close();
        }
      }
      if (client.status !== 'end') {
        await client.del(key);
        await client.quit();
      }
      await s3('DELETE', '/' + bucket + '/persist.txt');
      await s3('DELETE', '/' + bucket);
    }
  },
);
