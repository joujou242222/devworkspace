import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { request } from '../../scripts/http.mjs';
import {
  createExperimentDatabase,
  registerEmailProof,
} from '../../packages/database/dist/index.js';
import {
  origin,
  password,
  post,
  account,
  register,
  session,
  cookieOf,
  proofUrl,
  verificationPath,
} from '../helpers/experiment.mjs';

process.loadEnvFile('.env.local');
const db = createExperimentDatabase(process.env.DATABASE_URL);
const requireAuth = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { createEmailVerificationToken } = await import(
  pathToFileURL(requireAuth.resolve('better-auth/api')).href
);
let secondApi;
const port = 3002;

function secondRequest(path, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: 'localhost:8443',
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: data, json: () => JSON.parse(data) }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Second API timeout')));
    if (body) req.write(body);
    req.end();
  });
}
before(async () => {
  // Never interrupt a process occupying this experiment's second loopback port.
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  secondApi = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../apps/api/dist/main.js', import.meta.url))],
    {
      env: { ...process.env, API_PORT: String(port), BIND_HOST: '127.0.0.1' },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await secondRequest('/api/v1/health/ready')).status === 200) return;
    } catch {}
    if (secondApi.exitCode !== null) throw new Error('Second isolated API exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Second isolated API failed readiness');
});
after(async () => {
  if (secondApi && secondApi.exitCode === null) secondApi.kill();
  await db.$disconnect();
});

async function sensitive(cookie) {
  return post('/api/auth/v01-sensitive', {}, cookie);
}
async function resetProof(a) {
  assert.equal(
    (
      await post('/api/auth/request-password-reset', {
        email: a.email,
        redirectTo: origin + '/experiment',
      })
    ).status,
    200,
  );
  return (await proofUrl('reset', a.email)).pathname.split('/').at(-1);
}

test('verified-only login rejects signup identity until real proof consumption', async () => {
  const a = await register();
  assert.ok(cookieOf(a.response) === '', 'Unverified signup must not issue a session cookie');
  assert.equal((await post('/api/auth/sign-in/email', { email: a.email, password })).status, 403);
  assert.equal(await db.session.count({ where: { userId: a.userId } }), 0);
  const url = await proofUrl('verify', a.email);
  assert.equal((await request(verificationPath(url))).status, 200);
  assert.equal((await db.user.findUnique({ where: { id: a.userId } })).emailVerified, true);
  assert.equal((await post('/api/auth/sign-in/email', { email: a.email, password })).status, 200);
  assert.notEqual((await request(verificationPath(url))).status, 200);
  assert.notEqual(
    (await request(verificationPath(url).replace('/verify-email?', '/verify-email/?'))).status,
    200,
  );
});

test('expired database email proof cannot verify identity', async () => {
  const a = await register();
  const url = await proofUrl('verify', a.email);
  await db.$executeRaw`UPDATE v01_email_proof SET "expiresAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE "userId"=${a.userId}`;
  assert.notEqual((await request(verificationPath(url))).status, 200);
  assert.equal((await db.user.findUnique({ where: { id: a.userId } })).emailVerified, false);
});

test('Better Auth rejects its own expired signed verification JWT even with an active receipt', async () => {
  const a = await register();
  // Use the library's signer, not custom cryptography or a public test bypass.
  const token = await createEmailVerificationToken(
    process.env.BETTER_AUTH_SECRET,
    a.email,
    undefined,
    -10,
  );
  await registerEmailProof(db, token, a.userId);
  assert.notEqual(
    (await request('/api/auth/verify-email?token=' + encodeURIComponent(token))).status,
    200,
  );
  assert.equal((await db.user.findUnique({ where: { id: a.userId } })).emailVerified, false);
});

test('tampered verification JWT cannot verify identity even with an active receipt', async () => {
  const a = await register();
  const url = await proofUrl('verify', a.email);
  const token = url.searchParams.get('token');
  const parts = token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const tampered = parts.join('.');
  await registerEmailProof(db, tampered, a.userId);
  assert.notEqual(
    (await request('/api/auth/verify-email?token=' + encodeURIComponent(tampered))).status,
    200,
  );
  assert.equal((await db.user.findUnique({ where: { id: a.userId } })).emailVerified, false);
});

test('email verification has exactly one winner across two API processes (four race trials)', async () => {
  for (let trial = 0; trial < 4; trial++) {
    const a = await register();
    const url = await proofUrl('verify', a.email);
    const path = verificationPath(url);
    const responses = await Promise.all([
      request(path),
      secondRequest(path),
      request(path),
      secondRequest(path),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.ok(responses.every((response) => [200, 401].includes(response.status)));
    assert.equal((await db.user.findUnique({ where: { id: a.userId } })).emailVerified, true);
    assert.equal(
      await db.emailProof.count({ where: { userId: a.userId, consumedAt: { not: null } } }),
      1,
    );
    assert.notEqual((await secondRequest(path)).status, 200);
  }
});

test('activity refresh uses database time without changing absolute expiry', async () => {
  const a = await account();
  await db.$executeRaw`UPDATE v01_session SET "lastActivityAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '29 minutes' WHERE "userId"=${a.userId}`;
  const old = await db.session.findFirst({ where: { userId: a.userId } });
  assert.ok(await session(a.cookie));
  const refreshed = await db.session.findUnique({ where: { id: old.id } });
  assert.ok(refreshed.lastActivityAt > old.lastActivityAt);
  assert.equal(refreshed.expiresAt.getTime(), old.expiresAt.getTime());
  assert.equal(refreshed.createdAt.getTime(), old.createdAt.getTime());
  const across = await secondRequest('/api/auth/get-session', { cookie: a.cookie });
  assert.equal(across.status, 200);
  assert.ok(across.json()?.user);
});

test('31-minute idle session is deleted; spoofed clocks, stale cookies and SSR cannot revive it', async () => {
  const a = await account();
  await db.$executeRaw`UPDATE v01_session SET "lastActivityAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '31 minutes' WHERE "userId"=${a.userId}`;
  const response = await request('/api/auth/get-session?lastActivityAt=2099-01-01', {
    headers: { Cookie: a.cookie, 'X-Last-Activity': '2099-01-01' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.json(), null);
  assert.equal(await db.session.count({ where: { userId: a.userId } }), 0);
  assert.equal(await session(a.cookie), null);
  const page = await request('/experiment', { headers: { Cookie: a.cookie } });
  assert.ok(page.body.includes('No authenticated experiment session'));
  assert.equal((await sensitive(a.cookie)).status, 401);
  assert.equal(
    (await request('/api/v1/experiment/session', { headers: { Cookie: a.cookie } })).status,
    401,
  );
});

test('continuous activity cannot extend eight-hour maximum even if expiresAt is artificially later', async () => {
  const a = await account();
  await db.$executeRaw`UPDATE v01_session SET "createdAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '7 hours 59 minutes', "expiresAt"=(statement_timestamp() AT TIME ZONE 'UTC')+interval '1 minute' WHERE "userId"=${a.userId}`;
  const old = await db.session.findFirst({ where: { userId: a.userId } });
  assert.ok(await session(a.cookie));
  assert.equal(
    (await db.session.findUnique({ where: { id: old.id } })).expiresAt.getTime(),
    old.expiresAt.getTime(),
  );
  await db.$executeRaw`UPDATE v01_session SET "createdAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '8 hours 1 second', "expiresAt"=(statement_timestamp() AT TIME ZONE 'UTC')+interval '1 hour' WHERE id=${old.id}`;
  assert.equal(await session(a.cookie), null);
  assert.equal(await db.session.count({ where: { id: old.id } }), 0);
});

test('ten-minute recent-auth gate rejects old sessions; valid reauthentication rotates and revokes old identity', async () => {
  const a = await account();
  assert.equal((await sensitive(a.cookie)).status, 200);
  await db.$executeRaw`UPDATE v01_session SET "createdAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '9 minutes' WHERE "userId"=${a.userId}`;
  assert.equal((await sensitive(a.cookie)).status, 200);
  await db.$executeRaw`UPDATE v01_session SET "createdAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '10 minutes 1 second' WHERE "userId"=${a.userId}`;
  assert.equal((await sensitive(a.cookie)).status, 403);
  assert.ok(await session(a.cookie), 'Activity is valid but must not refresh authentication age');
  assert.equal((await sensitive(a.cookie)).status, 403);
  assert.notEqual(
    (
      await post(
        '/api/auth/sign-in/email',
        { email: a.email, password: 'Wrong-disposable-password' },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal((await sensitive(a.cookie)).status, 403);
  const login = await post('/api/auth/sign-in/email', { email: a.email, password }, a.cookie);
  assert.equal(login.status, 200);
  const fresh = cookieOf(login);
  assert.ok(fresh !== a.cookie, 'Reauthentication must rotate the cookie');
  assert.equal(await session(a.cookie), null);
  assert.equal((await sensitive(a.cookie)).status, 401);
  assert.equal((await sensitive(fresh)).status, 200);
  assert.equal((await post('/api/auth/sign-out', {}, fresh)).status, 200);
  assert.equal((await sensitive(fresh)).status, 401);
});

test('expired recovery proof leaves password and sessions unchanged', async () => {
  const a = await account();
  const token = await resetProof(a);
  const expired = await db.verification.updateMany({
    where: { identifier: 'reset-password:' + token },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(expired.count, 1);
  assert.notEqual(
    (await post('/api/auth/reset-password', { token, newPassword: 'Unused-disposable-pass-123!' }))
      .status,
    200,
  );
  assert.ok(await session(a.cookie));
  assert.equal((await post('/api/auth/sign-in/email', { email: a.email, password })).status, 200);
});

test('recovery has one winner across two API processes and revokes every prior session (four trials)', async () => {
  for (let trial = 0; trial < 4; trial++) {
    const a = await account();
    const other = await post('/api/auth/sign-in/email', { email: a.email, password });
    const token = await resetProof(a);
    const next = 'Disposable-race-password-' + trial + '-123!';
    const payload = { token, newPassword: next };
    const path = '/api/auth/reset-password';
    const responses = await Promise.all([
      post(path, payload),
      secondRequest(path, { method: 'POST', body: JSON.stringify(payload) }),
      post(path, payload),
      secondRequest(path, { method: 'POST', body: JSON.stringify(payload) }),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.ok(responses.every((response) => [200, 400].includes(response.status)));
    assert.equal(await session(a.cookie), null);
    assert.equal(await session(cookieOf(other)), null);
    assert.equal(
      await db.verification.count({ where: { identifier: 'reset-password:' + token } }),
      0,
    );
    assert.notEqual((await post(path, payload)).status, 200);
    assert.notEqual(
      (await post('/api/auth/sign-in/email', { email: a.email, password })).status,
      200,
    );
    assert.equal(
      (await post('/api/auth/sign-in/email', { email: a.email, password: next })).status,
      200,
    );
  }
});

test('Socket.IO rechecks server idle timeout on an already connected session', async () => {
  const a = await account();
  const ca = await readFile('.local/tls/localhost.pem');
  const socket = io(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Origin: origin, Cookie: a.cookie },
    transportOptions: { websocket: { ca } },
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    await db.$executeRaw`UPDATE v01_session SET "lastActivityAt"=(statement_timestamp() AT TIME ZONE 'UTC')-interval '31 minutes' WHERE "userId"=${a.userId}`;
    assert.deepEqual(await socket.timeout(3000).emitWithAck('experiment:identity'), {
      authenticated: false,
    });
    assert.equal(await session(a.cookie), null);
  } finally {
    socket.close();
  }
});
