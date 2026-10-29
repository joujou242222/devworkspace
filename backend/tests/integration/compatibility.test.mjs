import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { request } from '../../scripts/http.mjs';
import { createExperimentDatabase } from '../../packages/database/dist/index.js';
import {
  origin,
  password,
  cookieOf,
  post,
  account,
  session,
  proofUrl,
} from '../helpers/experiment.mjs';
process.loadEnvFile('.env.local');
const db = createExperimentDatabase(process.env.DATABASE_URL);
after(() => db.$disconnect());
async function socketConnect(cookie, customOrigin = origin) {
  const ca = await readFile('.local/tls/localhost.pem');
  const socket = io(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Origin: customOrigin, Cookie: cookie },
    transportOptions: { websocket: { ca } },
  });
  return new Promise((yes, no) => {
    socket.once('connect', () => yes(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      no(error);
    });
  });
}
test('HTTPS liveness/readiness and versioned JSON route are real', async () => {
  assert.deepEqual((await request('/api/v1/health/live')).json(), {
    status: 'ok',
    service: 'api',
    phase: 1,
  });
  assert.equal((await request('/api/v1/health/ready')).json().postgres, 'connected');
  const echo = await post('/api/v1/experiment/echo', { nested: { value: 1 } });
  assert.equal(echo.status, 201);
  assert.deepEqual(echo.json(), { received: { nested: { value: 1 } } });
});
test('Prisma PostgreSQL persistence, host-only Secure cookie, absolute expiry and SSR forwarding', async () => {
  const a = await account();
  const header = a.response.headers['set-cookie'].find((value) => value.includes('session_token'));
  assert.ok(header.startsWith('__Host-'));
  assert.ok(/HttpOnly/i.test(header));
  assert.ok(/Secure/i.test(header));
  assert.ok(/SameSite=Lax/i.test(header));
  assert.ok(/Path=\//i.test(header));
  assert.ok(!/Domain=/i.test(header));
  assert.equal((await session(a.cookie)).user.id, a.userId);
  assert.equal((await request('/api/v1/experiment/session')).status, 401);
  const guarded = await request('/api/v1/experiment/session', { headers: { Cookie: a.cookie } });
  assert.equal(guarded.status, 200);
  assert.deepEqual(guarded.json(), { authenticated: true });
  const stored = await db.session.findFirst({ where: { userId: a.userId } });
  assert.ok(stored);
  const duration = stored.expiresAt.getTime() - stored.createdAt.getTime();
  assert.ok(duration >= 28795000 && duration <= 28805000);
  const page = await request('/experiment', { headers: { Cookie: a.cookie } });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('Authenticated experiment session'));
});
test('wrong and missing Origin cannot mutate cookie auth endpoints', async () => {
  const a = await account();
  assert.equal(
    (await post('/api/auth/sign-out', {}, a.cookie, 'https://attacker.invalid')).status,
    403,
  );
  assert.equal((await post('/api/auth/sign-out', {}, a.cookie, null)).status, 403);
  assert.ok(await session(a.cookie));
  assert.equal(
    (
      await post(
        '/api/auth/sign-in/email',
        { email: a.email, password },
        undefined,
        'https://attacker.invalid',
      )
    ).status,
    403,
  );
});
test('logout destroys server session and old cookie cannot replay', async () => {
  const a = await account();
  assert.equal((await post('/api/auth/sign-out', {}, a.cookie)).status, 200);
  assert.equal(await session(a.cookie), null);
  assert.equal(await db.session.count({ where: { userId: a.userId } }), 0);
});
test('server-side revocation and expiry reject otherwise valid session cookies', async () => {
  const a = await account();
  await db.session.deleteMany({ where: { userId: a.userId } });
  assert.equal(await session(a.cookie), null);
  const b = await account();
  await db.session.updateMany({
    where: { userId: b.userId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(await session(b.cookie), null);
});
test('Socket.IO validates Origin/session against database and rechecks after revocation', async () => {
  const a = await account();
  const socket = await socketConnect(a.cookie);
  try {
    const valid = await socket.timeout(3000).emitWithAck('experiment:identity');
    assert.deepEqual(valid, { authenticated: true });
    await db.session.deleteMany({ where: { userId: a.userId } });
    const revoked = await socket.timeout(3000).emitWithAck('experiment:identity');
    assert.deepEqual(revoked, { authenticated: false });
  } finally {
    socket.close();
  }
  await assert.rejects(() => socketConnect(''));
  await assert.rejects(() => socketConnect(a.cookie, 'https://attacker.invalid'));
});
test('recovery proof expires at configured interval, resets password once and revokes all sessions', async () => {
  const a = await account();
  const second = await post('/api/auth/sign-in/email', { email: a.email, password });
  assert.equal(second.status, 200);
  const response = await post('/api/auth/request-password-reset', {
    email: a.email,
    redirectTo: origin + '/experiment',
  });
  assert.equal(response.status, 200);
  const link = await proofUrl('reset', a.email);
  const token = link.pathname.split('/').at(-1);
  const records = await db.verification.findMany();
  assert.ok(
    records.some(
      (row) =>
        row.expiresAt.getTime() > Date.now() && row.expiresAt.getTime() <= Date.now() + 1805000,
    ),
  );
  const nextPassword = 'New-disposable-password-456!';
  assert.equal(
    (await post('/api/auth/reset-password', { token, newPassword: nextPassword })).status,
    200,
  );
  assert.equal(await session(a.cookie), null);
  assert.equal(await session(cookieOf(second)), null);
  assert.notEqual(
    (await post('/api/auth/reset-password', { token, newPassword: password })).status,
    200,
  );
  assert.equal(
    (await post('/api/auth/sign-in/email', { email: a.email, password: nextPassword })).status,
    200,
  );
  assert.notEqual(
    (await post('/api/auth/sign-in/email', { email: a.email, password })).status,
    200,
  );
});
test('staging/read/admin guards fail closed without claiming S3 guarantees', async () => {
  for (const path of ['/dw-staging/object', '/dw-canonical/object', '/storage-admin/'])
    assert.equal((await request(path)).status, 403);
  assert.equal(
    (
      await request('/dw-staging/object', {
        method: 'PUT',
        body: 'x',
        headers: { Origin: 'https://attacker.invalid', 'If-None-Match': '*' },
      })
    ).status,
    403,
  );
});
