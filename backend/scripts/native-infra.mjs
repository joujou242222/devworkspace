import { readFile, writeFile, mkdir, open, unlink, rename, readdir } from 'node:fs/promises';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { ps, diskGuard, windowsEnv } from './setup-native.mjs';
import { registeredVolumes } from './native-readiness.mjs';

const requireWorker = createRequire(resolve('apps/worker/package.json'));
export const Redis = requireWorker('ioredis');
const requireServer = createRequire(resolve('packages/server/package.json'));
const { Pool: PostgresPool } = requireServer('pg');
const root = resolve('.');
const local = resolve('.local/native');
export const ports = {
  redis: [6379],
  storage: [9333, 19333, 8080, 18080, 8888, 18888, 9000, 19000],
  mailpit: [1025, 8025],
};
const pause = (ms) => new Promise((yes) => setTimeout(yes, ms));
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export async function credentials() {
  return json(resolve(local, 'credentials.json'));
}
function pgOwner() {
  return json('.local/pg-owner.json');
}
async function pg(action) {
  const owner = await pgOwner();
  if (owner.root !== root || owner.data !== resolve('.local/pg') || owner.port !== 55432)
    throw new Error('Unowned PostgreSQL');
  const binary = resolve(owner.bin, 'pg_ctl.exe');
  const isRunning = () => {
    try {
      execFileSync(binary, ['status', '-D', owner.data], { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  };
  const accepting = async () => {
    let connectionString;
    try {
      const config = Object.fromEntries(
        (await readFile('.local/phase2-api.env', 'utf8'))
          .trim()
          .split('\n')
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
      const candidate = new URL(config.PRODUCT_API_URL);
      if (
        candidate.protocol !== 'postgresql:' ||
        candidate.hostname !== '127.0.0.1' ||
        candidate.port !== String(owner.port) ||
        candidate.pathname !== '/devworkspace_phase2' ||
        candidate.username !== 'dw2_api'
      )
        return false;
      connectionString = config.PRODUCT_API_URL;
    } catch {
      try {
        const env = Object.fromEntries(
          (await readFile('.env.local', 'utf8'))
            .trim()
            .split('\n')
            .map((line) => {
              const at = line.indexOf('=');
              return [line.slice(0, at), line.slice(at + 1)];
            }),
        );
        if (!env.POSTGRES_USER || !env.POSTGRES_PASSWORD) return false;
        connectionString = new URL(
          `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${owner.port}/${encodeURIComponent(env.POSTGRES_DB || 'postgres')}`,
        ).href;
      } catch {
        return false;
      }
    }
    const pool = new PostgresPool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 1200,
      query_timeout: 1200,
      statement_timeout: 1200,
      application_name: 'devworkspace-native-readiness',
    });
    try {
      const result = await pool.query('SELECT 1 AS ready');
      return result.rows[0]?.ready === 1;
    } catch {
      return false;
    } finally {
      await pool.end();
    }
  };
  const diagnostics = async (cause) => {
    let contents = '';
    try {
      contents = await readFile('.local/logs/postgres.log', 'utf8');
    } catch {}
    const recentEvents = contents
      .split(/\r?\n/)
      .filter((line) =>
        /LOG:.*(?:starting|ready|shutdown|recovery|checkpoint|redo|database system)/i.test(line),
      )
      .slice(-8)
      .map((line) => line.slice(0, 240));
    return {
      errorCode: cause?.code ?? 'POSTGRES_LIFECYCLE',
      processRunning: isRunning(),
      acceptingConnections: await accepting(),
      recentServerEvents: recentEvents,
    };
  };
  const waitFor = async (predicate, milliseconds) => {
    const start = performance.now();
    while (performance.now() - start < milliseconds) {
      if (await predicate()) return Math.round(performance.now() - start);
      await pause(250);
    }
    return null;
  };
  const running = isRunning();
  if (action === 'status') {
    if (!running || !(await accepting()))
      throw new Error(
        'Owned PostgreSQL is not accepting connections: ' + JSON.stringify(await diagnostics()),
      );
    return { state: 'ready', alreadyRunning: true };
  }
  if (action === 'start') {
    const startedAt = performance.now();
    let waitTimedOut = false;
    if (!running) {
      try {
        execFileSync(
          binary,
          [
            'start',
            '-D',
            owner.data,
            '-l',
            resolve('.local/logs/postgres.log'),
            '-o',
            '-h 127.0.0.1 -p ' + owner.port,
            '-w',
            '-t',
            '45',
          ],
          { windowsHide: true, stdio: 'ignore', timeout: 55000 },
        );
      } catch (error) {
        waitTimedOut = true;
        if (!isRunning())
          throw new Error(
            'Owned PostgreSQL startup failed: ' + JSON.stringify(await diagnostics(error)),
          );
      }
    }
    const readinessMs = await waitFor(accepting, 30000);
    if (readinessMs === null)
      throw new Error(
        'Owned PostgreSQL did not become ready: ' + JSON.stringify(await diagnostics()),
      );
    return {
      state: 'ready',
      started: !running,
      pgCtlWaitTimedOut: waitTimedOut,
      readinessMs: Math.round(performance.now() - startedAt),
    };
  }
  if (action === 'stop') {
    const startedAt = performance.now();
    let waitTimedOut = false;
    if (running) {
      try {
        execFileSync(binary, ['stop', '-D', owner.data, '-m', 'fast', '-w', '-t', '90'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 100000,
        });
      } catch (error) {
        waitTimedOut = true;
        if (isRunning())
          throw new Error(
            'Owned PostgreSQL shutdown failed; no forced stop used: ' +
              JSON.stringify(await diagnostics(error)),
          );
      }
    }
    const stoppedMs = await waitFor(async () => !isRunning() && !(await accepting()), 15000);
    if (stoppedMs === null)
      throw new Error(
        'Owned PostgreSQL did not finish graceful shutdown: ' + JSON.stringify(await diagnostics()),
      );
    return {
      state: 'stopped',
      stopped: running,
      pgCtlWaitTimedOut: waitTimedOut,
      shutdownMs: Math.round(performance.now() - startedAt),
    };
  }
  throw new Error('Invalid PostgreSQL lifecycle action');
}
const recordPath = (name) => resolve(local, name + '-process.json');
function processAction(action, record) {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      resolve('scripts/native-process.ps1'),
      '-Action',
      action,
      '-Record',
      record,
    ],
    {
      encoding: 'utf8',
      stdio: action === 'inspect' ? 'pipe' : 'ignore',
      windowsHide: true,
      env: windowsEnv,
      timeout: 45000,
    },
  );
  return output?.trim() ?? '';
}
async function running(name) {
  try {
    await readFile(recordPath(name));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return processAction('inspect', recordPath(name)) === 'true';
}
async function free(port) {
  await new Promise((yes, no) => {
    const server = net.createServer();
    server.once('error', () => no(new Error('Port occupied: ' + port + '; no process stopped')));
    server.listen(port, '127.0.0.1', () => server.close(yes));
  });
}
export async function readiness() {
  const secret = await credentials();
  const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    password: secret.redisPassword,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    if ((await redis.ping()) !== 'PONG') throw new Error('Redis not ready');
    for (const url of [
      'http://127.0.0.1:9333/cluster/status',
      'http://127.0.0.1:8888/',
      'http://127.0.0.1:8025/readyz',
    ]) {
      let headers;
      if (new URL(url).port === '8888') {
        try {
          const security = await readFile(resolve(local, 'storage/security.toml'), 'utf8');
          const key = /\[jwt\.filer_signing\.read\]\s*key = "([a-f0-9]{64})"/.exec(security)?.[1];
          if (!key) throw new Error('Unrecognized filer read authentication configuration');
          const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
          const payload =
            encode({ alg: 'HS256', typ: 'JWT' }) +
            '.' +
            encode({ exp: Math.floor(Date.now() / 1000) + 30 });
          headers = {
            Authorization:
              'Bearer ' +
              payload +
              '.' +
              createHmac('sha256', key).update(payload).digest('base64url'),
          };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Not ready: ' + new URL(url).port);
    }
    const s3 = await fetch('http://127.0.0.1:9000/', { signal: AbortSignal.timeout(3000) });
    if (s3.status !== 403) throw new Error('S3 anonymous access not denied');
    const topology = await fetch('http://127.0.0.1:9333/dir/status', {
      signal: AbortSignal.timeout(3000),
    });
    const files = (await readdir(resolve(local, 'storage'))).filter((file) =>
      file.endsWith('.dat'),
    );
    if (!topology.ok || !registeredVolumes(await topology.json(), files))
      throw new Error('Storage volume registration is not ready');
  } finally {
    redis.disconnect();
  }
}
export async function bindings() {
  const records = await Promise.all(Object.keys(ports).map((name) => json(recordPath(name))));
  const ids = records.map((record) => record.pid);
  const result = JSON.parse(
    ps(
      `@((Get-NetTCPConnection -State Listen | Where-Object {$_.OwningProcess -in @(${ids.join(',')})}) | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`,
    ),
  );
  const entries = Array.isArray(result) ? result : [result];
  if (!entries.length || entries.some((item) => item.LocalAddress !== '127.0.0.1'))
    throw new Error('Non-loopback native listener detected');
  if (entries.some((item) => !Object.values(ports).flat().includes(item.LocalPort)))
    throw new Error('Unexpected native listener detected');
  for (const [name, required] of Object.entries(ports)) {
    const record = records.find((record) => record.name === name);
    for (const port of required)
      if (!entries.some((entry) => entry.LocalPort === port && entry.OwningProcess === record.pid))
        throw new Error('Missing owned port: ' + name + '/' + port);
  }
  return entries;
}
async function up() {
  const startedAt = performance.now();
  await diskGuard();
  const tools = await json('.local/native/artifacts.json');
  for (const tool of Object.values(tools))
    if (
      createHash('sha256')
        .update(await readFile(tool.binary))
        .digest('hex') !== tool.binarySha256
    )
      throw new Error('Native executable changed');
  let secret;
  try {
    secret = await credentials();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secret = { redisPassword: randomBytes(32).toString('hex') };
    await writeFile(resolve(local, 'credentials.json'), JSON.stringify(secret), { mode: 0o600 });
  }
  for (const name of ['redis', 'storage', 'mailpit'])
    await mkdir(resolve(local, name), { recursive: true });
  await writeFile(
    resolve(local, 'storage/master.toml'),
    await readFile('infra/native-master.toml'),
  );
  const envFile = await readFile('.env.local', 'utf8');
  const redisUrl = 'redis://:' + secret.redisPassword + '@127.0.0.1:6379';
  const existingRedis = envFile.match(/^REDIS_URL=(.*)$/m);
  if (existingRedis && existingRedis[1].trim() !== redisUrl)
    throw new Error('Existing REDIS_URL differs; refusing to overwrite unrelated configuration');
  if (!existingRedis)
    await writeFile('.env.local', envFile.trimEnd() + '\nREDIS_URL=' + redisUrl + '\n', {
      mode: 0o600,
    });
  const redisConfig = resolve(local, 'redis/memurai.conf');
  await writeFile(
    redisConfig,
    [
      'bind 127.0.0.1',
      'port 6379',
      'protected-mode yes',
      'requirepass ' + secret.redisPassword,
      'dir "' + resolve(local, 'redis').replaceAll('\\', '/') + '"',
      'appendonly yes',
      'appendfsync always',
      'save ""',
      'maxmemory 256mb',
      'maxmemory-policy noeviction',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  const specs = {
    redis: { binary: tools.memurai.binary, args: [redisConfig] },
    storage: {
      binary: tools.seaweedfs.binary,
      args: [
        'server',
        '-dir=' + resolve(local, 'storage'),
        '-ip=127.0.0.1',
        '-ip.bind=127.0.0.1',
        '-master.port=9333',
        '-master.volumeSizeLimitMB=32',
        '-volume.max=16',
        '-volume.preStopSeconds=1',
        '-volume.port=8080',
        '-filer',
        '-filer.port=8888',
        '-s3',
        '-s3.port=9000',
        '-s3.port.iceberg=0',
        '-s3.port.lance=0',
        '-s3.config=' + resolve('.local/s3-identities.json'),
      ],
    },
    mailpit: {
      binary: tools.mailpit.binary,
      args: [
        '--listen',
        '127.0.0.1:8025',
        '--smtp',
        '127.0.0.1:1025',
        '--database',
        resolve(local, 'mailpit/messages.sqlite'),
        '--disable-version-check',
        '--max',
        '0',
        '--allowed-hosts',
        '127.0.0.1,localhost',
      ],
    },
  };
  const started = [];
  try {
    for (const [name, spec] of Object.entries(specs)) {
      if (await running(name)) continue;
      for (const port of ports[name]) await free(port);
      const stamp = Date.now();
      const record = {
        root,
        name,
        ...spec,
        cwd: resolve(local, name),
        stdout: resolve('.local/logs', 'native-' + name + '-' + stamp + '.out.log'),
        stderr: resolve('.local/logs', 'native-' + name + '-' + stamp + '.err.log'),
      };
      await writeFile(recordPath(name), JSON.stringify(record, null, 2));
      processAction('start', recordPath(name));
      started.push(name);
    }
    const servicesStartedAt = performance.now();
    for (let attempt = 0; ; attempt++) {
      try {
        await readiness();
        break;
      } catch (error) {
        if (attempt >= 45) throw error;
        await pause(1000);
      }
    }
    const addresses = await bindings();
    const nativeServicesReadyMs = Math.round(performance.now() - servicesStartedAt);
    const postgres = await pg('start');
    await writeFile(resolve(local, 'bindings.json'), JSON.stringify(addresses, null, 2));
    console.log(
      JSON.stringify({
        event: 'native.infrastructure.ready',
        totalMs: Math.round(performance.now() - startedAt),
        nativeServicesReadyMs,
        postgres,
        listeners: addresses.length,
        loopbackOnly: true,
      }),
    );
  } catch (error) {
    for (const name of started.reverse()) {
      try {
        await stopOne(name);
      } catch {
        console.error('Manual inspection needed for owned ' + name + '; no force used');
      }
    }
    throw error;
  }
}
async function stopOne(name) {
  if (!(await running(name))) return;
  if (name === 'redis') {
    const secret = await credentials();
    const redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      password: secret.redisPassword,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    });
    // SHUTDOWN can close/reset its own connection before returning a reply.
    // Actual process exit is verified independently below.
    redis.on('error', () => {});
    try {
      await redis.shutdown('SAVE');
    } catch (error) {
      if (!/closed|ECONNRESET/.test(error.message)) throw error;
    } finally {
      redis.disconnect();
    }
    for (let attempt = 0; await running(name); attempt++) {
      if (attempt > 20) throw new Error('Redis graceful shutdown timed out');
      await pause(250);
    }
  } else processAction('stop', recordPath(name));
}
async function down() {
  const startedAt = performance.now();
  for (const name of ['mailpit', 'storage', 'redis']) await stopOne(name);
  const postgres = await pg('stop');
  console.log(
    JSON.stringify({
      event: 'native.infrastructure.stopped',
      elapsedMs: Math.round(performance.now() - startedAt),
      postgres,
      dataRetained: true,
    }),
  );
}

async function releaseMutex(keeper) {
  if (!keeper || keeper.exitCode !== null) return;
  keeper.stdin.end();
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () => rejectExit(new Error('Native lifecycle mutex helper did not exit')),
      5000,
    );
    keeper.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
    keeper.once('error', (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
  });
}

async function holdMutex() {
  const keeper = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      resolve('scripts/native-lifecycle-mutex.ps1'),
      '-Root',
      root,
      '-ParentPid',
      String(process.pid),
    ],
    { env: windowsEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let errorOutput = '';
  keeper.stderr.setEncoding('utf8');
  keeper.stderr.on('data', (part) => {
    errorOutput = (errorOutput + part).slice(-2000);
  });
  keeper.stdout.setEncoding('utf8');
  try {
    const owner = await new Promise((resolveOwner, rejectOwner) => {
      let buffered = '';
      const timer = setTimeout(
        () => rejectOwner(new Error('Native lifecycle mutex acquisition timed out')),
        10000,
      );
      const finish = (error, value) => {
        clearTimeout(timer);
        error ? rejectOwner(error) : resolveOwner(value);
      };
      keeper.stdout.on('data', (part) => {
        buffered += part;
        const end = buffered.indexOf('\n');
        if (end < 0) return;
        const line = buffered.slice(0, end).trim();
        if (line === 'BUSY')
          return finish(new Error('Another native lifecycle command owns this project lock'));
        try {
          const value = JSON.parse(line);
          if (value.status !== 'LOCKED' || value.pid !== process.pid || !value.startedUTC)
            throw new Error('Unexpected native lifecycle mutex response');
          finish(null, value);
        } catch (error) {
          finish(error);
        }
      });
      keeper.once('error', (error) => finish(error));
      keeper.once('exit', (code) => {
        if (code !== 0)
          finish(
            new Error(
              'Native lifecycle mutex helper exited' +
                (errorOutput ? ': ' + errorOutput.trim() : ''),
            ),
          );
      });
    });
    return { keeper, owner };
  } catch (error) {
    await releaseMutex(keeper).catch(() => {});
    throw error;
  }
}

async function staleLockOwnerState(record) {
  const state = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      resolve('scripts/native-lifecycle-owner.ps1'),
      '-ProcessId',
      String(record.pid),
      '-StartedUTC',
      record.startedUTC,
    ],
    { env: windowsEnv, encoding: 'utf8', windowsHide: true, timeout: 5000 },
  ).trim();
  if (!['ACTIVE', 'MISSING', 'REUSED'].includes(state))
    throw new Error('Cannot verify the lifecycle lock owner; preserving the lock file');
  return state;
}

async function acquireLifecycleLock() {
  const mutex = await holdMutex();
  const lockPath = resolve(local, 'lifecycle.lock');
  const token = randomBytes(24).toString('hex');
  const record = {
    format: 1,
    root,
    name: 'native-infra-lifecycle',
    pid: mutex.owner.pid,
    startedUTC: mutex.owner.startedUTC,
    token,
  };
  try {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(record, null, 2) + '\n');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let prior;
      try {
        prior = JSON.parse(await readFile(lockPath, 'utf8'));
      } catch {
        throw new Error(
          'Unrecognized stale lifecycle lock at .local/native/lifecycle.lock; inspect it manually, no file was changed',
        );
      }
      if (
        prior.format !== 1 ||
        prior.root !== root ||
        prior.name !== 'native-infra-lifecycle' ||
        !Number.isSafeInteger(prior.pid) ||
        typeof prior.startedUTC !== 'string' ||
        typeof prior.token !== 'string'
      )
        throw new Error(
          'Lifecycle lock ownership cannot be verified; preserving it for manual inspection',
        );
      const state = await staleLockOwnerState(prior);
      if (state === 'ACTIVE')
        throw new Error(
          `Lifecycle lock owner PID ${prior.pid} is still active; no process was stopped`,
        );
      const current = JSON.parse(await readFile(lockPath, 'utf8'));
      if (current.token !== prior.token || current.pid !== prior.pid)
        throw new Error(
          'Lifecycle lock changed during stale-owner inspection; no file was changed',
        );
      const stalePath = resolve(
        local,
        `lifecycle.lock.stale-${Date.now()}-${prior.pid}-${randomBytes(4).toString('hex')}.json`,
      );
      await rename(lockPath, stalePath);
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(record, null, 2) + '\n');
      } finally {
        await handle.close();
      }
      console.log(`Recovered verified stale lifecycle marker to ${stalePath}`);
    }
    return { ...mutex, lockPath, record };
  } catch (error) {
    await releaseMutex(mutex.keeper).catch(() => {});
    throw error;
  }
}

async function releaseLifecycleLock(lock) {
  try {
    const current = JSON.parse(await readFile(lock.lockPath, 'utf8'));
    if (current.token !== lock.record.token || current.pid !== lock.record.pid)
      throw new Error('Lifecycle lock ownership changed; preserving the current lock marker');
    await unlink(lock.lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    await releaseMutex(lock.keeper);
  }
}

if (process.argv[1] === resolve('scripts/native-infra.mjs')) {
  await mkdir(local, { recursive: true });
  const lock = await acquireLifecycleLock();
  try {
    const command = process.argv[2];
    if (command === 'up') await up();
    else if (command === 'down') await down();
    else if (command === 'restart') {
      await down();
      await up();
    } else if (command === 'status') {
      const postgres = await pg('status');
      const readinessStarted = performance.now();
      await readiness();
      console.log(
        JSON.stringify(
          {
            event: 'native.infrastructure.ready',
            readinessMs: Math.round(performance.now() - readinessStarted),
            postgres,
            listeners: await bindings(),
          },
          null,
          2,
        ),
      );
    } else throw new Error('Usage: native-infra.mjs up|down|restart|status');
  } finally {
    await releaseLifecycleLock(lock);
  }
}
