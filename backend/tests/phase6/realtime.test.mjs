import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { io } from 'socket.io-client';
import { Browser, admin, runtime } from '../phase2/helpers.mjs';
import { Redis, credentials } from '../../scripts/native-infra.mjs';
let f, owner, contact, child;
const port = 3004,
  origin = 'https://localhost:8443';
const good = (r, n = 200) => {
  assert.equal(r.status, n, r.body);
  return r.json();
};
const cookies = (b) => Array.from(b.cookies, ([k, v]) => k + '=' + v).join('; ');
const req = (p, m = 'GET', b, h = {}) =>
  owner.request(`/api/v1/organizations/${f.org}` + p, m, b, {
    'X-Organization-Principal': f.principal,
    ...h,
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(browser, context, options = {}) {
  const socket = io('http://127.0.0.1:' + port, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookies(browser), Origin: origin },
    auth: context,
    reconnection: false,
    autoConnect: false,
    ...options,
  });
  try {
    await new Promise((yes, no) => {
      socket.once('connect', yes);
      socket.once('connect_error', no);
      socket.connect();
      setTimeout(() => no(new Error('Socket handshake timeout')), 4000).unref();
    });
    return socket;
  } catch (e) {
    socket.disconnect();
    throw e;
  }
}
const internal = () => ({
  organization_id: f.org,
  principal_id: f.principal,
  capacity: 'INTERNAL',
  project_id: f.project,
});
const external = () => ({
  organization_id: f.org,
  principal_id: f.contactPrincipal,
  capacity: 'CLIENT',
  project_id: f.project,
});
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      USERPROFILE: process.env.USERPROFILE,
      ...runtime,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      REDIS_URL: process.env.REDIS_URL,
      API_PORT: String(port),
      BIND_HOST: '127.0.0.1',
      EXPERIMENT_AUTH_ENABLED: 'false',
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok) return;
    } catch {}
    assert.equal(child.exitCode, null);
    await pause(100);
  }
  assert.fail('Independent API not ready');
}
before(async () => {
  await new Promise((yes, no) => {
    const s = net.createServer();
    s.once('error', no);
    s.listen(port, '127.0.0.1', () => s.close(yes));
  });
  f = JSON.parse(await readFile('.local/phase6-browser-fixture.json', 'utf8'));
  owner = new Browser();
  contact = new Browser();
  await owner.login(f.owner);
  await contact.login(f.contact);
  await start();
});
after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  await admin.end();
});
const disconnected = (socket) =>
  Promise.race([
    new Promise((r) => socket.once('disconnect', r)),
    new Promise((_, no) => setTimeout(() => no(new Error('Revoked socket retained')), 4000)),
  ]);

test('independent gateway rejects hostile/forged/expired/cross-tenant and cross-capacity handshakes', async () => {
  await assert.rejects(
    connect(owner, internal(), {
      extraHeaders: { Cookie: cookies(owner), Origin: 'https://hostile.example' },
    }),
  );
  await assert.rejects(
    connect(owner, internal(), {
      extraHeaders: { Cookie: '__Host-dw.session=forged', Origin: origin },
    }),
  );
  await assert.rejects(connect(owner, { ...internal(), organization_id: crypto.randomUUID() }));
  await assert.rejects(connect(contact, { ...external(), capacity: 'INTERNAL' }));
  const expiring = new Browser();
  await expiring.login(f.owner);
  const sessions = good(await expiring.request('/api/v1/me/sessions'));
  const sid = sessions.items.find((s) => s.current).id;
  await admin.query(
    'UPDATE public.identity_session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',
    [sid],
  );
  await assert.rejects(connect(expiring, internal()));
});

test('main-process grant revocation evicts a client on a separate API and prevents reconnect/notification reads', async () => {
  const socket = await connect(contact, external());
  const grant = good(await req('/projects/' + f.project + '/grants')).items.find(
    (g) => g.contact_id === f.contactPrincipal,
  );
  assert.ok(grant);
  try {
    const gone = disconnected(socket);
    good(
      await req(
        '/projects/' + f.project + '/grants/' + grant.id,
        'PATCH',
        { contact_id: grant.contact_id, role: grant.role, status: 'REVOKED' },
        { 'If-Match': `"${grant.revision}"` },
      ),
    );
    await gone;
    await assert.rejects(connect(contact, external()));
    const n = good(
      await contact.request(
        `/api/v1/organizations/${f.org}/portal/notifications`,
        'GET',
        undefined,
        { 'X-Organization-Principal': f.contactPrincipal },
      ),
    );
    assert.equal(n.total, 0);
    assert.equal(n.unread, 0);
  } finally {
    socket.disconnect();
    const current = good(await req('/projects/' + f.project + '/grants/' + grant.id));
    good(
      await req(
        '/projects/' + f.project + '/grants/' + grant.id,
        'PATCH',
        { contact_id: grant.contact_id, role: grant.role, status: 'ACTIVE' },
        { 'If-Match': `"${current.revision}"` },
      ),
    );
  }
});

test('session revocation on the main API evicts an independently connected socket and reconnect cannot refresh expired authority', async () => {
  const actor = new Browser();
  await actor.login(f.owner);
  const socket = await connect(actor, internal());
  try {
    const current = good(await actor.request('/api/v1/me/sessions')).items.find((s) => s.current);
    const gone = disconnected(socket);
    good(await actor.request('/api/v1/me/sessions/' + current.id, 'DELETE', {}));
    await gone;
    await assert.rejects(connect(actor, internal()));
  } finally {
    socket.disconnect();
  }
});

test('worker Redis fanout reaches an independently running authorized gateway with minimal invalidations', async () => {
  const socket = await connect(owner, internal());
  const notices = [],
    states = [];
  socket.on('notifications.changed', (x) => notices.push(x));
  socket.on('state.changed', (x) => states.push(x));
  try {
    const task = good(
      await req('/projects/' + f.project + '/tasks', 'POST', {
        title: 'Independent fanout',
        description: '',
        priority: 'NORMAL',
        status: 'TODO',
        milestone_id: null,
        assignee_id: f.ownerPm,
        due_at: null,
        position: 0,
      }),
      201,
    );
    const event = (
      await admin.query(
        'SELECT id FROM public.tenant_event WHERE organization_id=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 1',
        [f.org, task.id],
      )
    ).rows[0].id;
    // Each hint follows its own authorization query; receipt of one does not mean both arrived.
    for (
      let i = 0;
      i < 100 &&
      (!notices.some((x) => x.event_id === event) || !states.some((x) => x.event_id === event));
      i++
    )
      await pause(100);
    assert.deepEqual(
      notices.find((x) => x.event_id === event),
      { event_id: event },
    );
    assert.deepEqual(
      states.find((x) => x.event_id === event),
      { project_id: f.project, event_id: event },
    );
  } finally {
    socket.disconnect();
  }
});

test('unavailable notification policy fails closed before emission, and restart recovers missed events through REST', async () => {
  const socket = await connect(owner, internal());
  await admin.query('REVOKE SELECT ON public.project FROM dw2_communications');
  let event;
  try {
    const gone = disconnected(socket);
    const body = {
      title: 'Policy outage assignment',
      description: '',
      priority: 'NORMAL',
      status: 'TODO',
      milestone_id: null,
      assignee_id: f.ownerPm,
      due_at: null,
      position: 0,
    };
    const task = good(await req('/projects/' + f.project + '/tasks', 'POST', body), 201);
    event = (
      await admin.query(
        'SELECT id FROM public.tenant_event WHERE organization_id=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 1',
        [f.org, task.id],
      )
    ).rows[0].id;
    assert.equal((await req('/notifications')).status, 403);
    // Pub/sub is expendable. Explicitly inject a late valid hint to exercise emission authorization.
    const secret = await credentials();
    const publisher = new Redis({
      host: '127.0.0.1',
      port: 6379,
      password: secret.redisPassword,
      maxRetriesPerRequest: 1,
    });
    try {
      await publisher.publish(
        'dw-notifications-v6',
        JSON.stringify({ organization_id: f.org, event_id: event }),
      );
    } finally {
      publisher.disconnect();
    }
    await gone;
    assert.equal((await req('/notifications')).status, 403);
  } finally {
    socket.disconnect();
    await admin.query('GRANT SELECT ON public.project TO dw2_communications');
  }
  // Stop only this test-owned API process; no persisted notification depends on its socket state.
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
  await start();
  const again = await connect(owner, internal());
  try {
    assert.deepEqual(await again.timeout(3000).emitWithAck('sync', null), { status: 'ok' });
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/organizations/${f.org}/notifications?limit=100`,
      { headers: { Cookie: cookies(owner), 'X-Organization-Principal': f.principal } },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.items.some((n) => n.event_id === event));
  } finally {
    again.disconnect();
  }
});
