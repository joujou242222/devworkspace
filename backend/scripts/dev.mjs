import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';
import { request } from './http.mjs';
try {
  process.loadEnvFile('.env.local');
} catch {
  throw new Error('Run pnpm setup:local first');
}
for (const port of [3000, 3001, 8443])
  await new Promise((yes, no) => {
    const server = net.createServer();
    server.once('error', () =>
      no(new Error('Port ' + port + ' is occupied; no existing process was stopped')),
    );
    server.listen(port, '127.0.0.1', () => server.close(yes));
  });
await mkdir('.local/logs', { recursive: true });
const children = [];
let productApi = {},
  productWorker = {};
if (!process.argv.includes('--experiment')) {
  try {
    productApi = Object.fromEntries(
      (await readFile('.local/phase2-api.env', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    );
    productWorker = Object.fromEntries(
      (await readFile('.local/phase2-worker.env', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    );
    for (const [role, target] of [
      ['api', productApi],
      ['worker', productWorker],
    ]) {
      try {
        Object.assign(
          target,
          Object.fromEntries(
            (await readFile('.local/phase4-' + role + '.env', 'utf8'))
              .trim()
              .split('\n')
              .map((line) => {
                const at = line.indexOf('=');
                return [line.slice(0, at), line.slice(at + 1)];
              }),
          ),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
let stopping = false;
function start(name, args) {
  const stream = createWriteStream('.local/logs/' + name + '.log', { flags: 'a' });
  let runtimeEnv = { ...process.env };
  if (productApi.PRODUCT_ENABLED === 'true') {
    for (const key of Object.keys(runtimeEnv))
      if (
        /^(POSTGRES_|DATABASE_URL$|BETTER_AUTH_|S3_|REDIS_URL$|PRODUCT_|FILE_STORAGE_|CLEANUP_STORAGE_)/.test(
          key,
        )
      )
        delete runtimeEnv[key];
    runtimeEnv.EXPERIMENT_AUTH_ENABLED = 'false';
    if (name === 'api')
      Object.assign(runtimeEnv, productApi, {
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        REDIS_URL: process.env.REDIS_URL,
      });
    if (name === 'worker')
      Object.assign(runtimeEnv, productWorker, { REDIS_URL: process.env.REDIS_URL });
  }
  const child = spawn(process.execPath, args, {
    env: { ...runtimeEnv, ...(name === 'web' ? { NODE_ENV: 'production' } : {}) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  children.push({ name, pid: child.pid, child });
  child.once('exit', (code) => {
    if (!stopping) {
      console.error(name + ' exited early (' + code + '); inspect .local/logs/' + name + '.log');
      stop(1);
    }
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const entry of children) if (entry.child.exitCode === null) entry.child.kill();
  setTimeout(() => process.exit(code), 1000);
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
start('api', ['apps/api/dist/main.js']);
start('worker', ['apps/worker/dist/main.js']);
start('web', [
  'apps/web/node_modules/next/dist/bin/next',
  'start',
  'apps/web',
  '--hostname',
  '127.0.0.1',
  '--port',
  '3000',
]);
start('proxy', ['scripts/proxy.mjs']);
await writeFile(
  '.local/processes.json',
  JSON.stringify(
    {
      root: resolve('.'),
      parent: process.pid,
      children: children.map(({ name, pid }) => ({ name, pid })),
    },
    null,
    2,
  ),
);
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const health = await request('/api/v1/health/ready');
    const web = await request('/');
    if (health.status === 200 && web.status === 200) {
      console.log(
        JSON.stringify({
          event: 'foundation.stack.ready',
          origin: 'https://localhost:8443',
          api: health.json(),
          workerEvidence: (await readFile('.local/logs/worker.log', 'utf8')).includes(
            'worker.bootstrap.ready',
          ),
          productionFeatures:
            productApi.PRODUCT_ENABLED === 'true'
              ? productApi.FILE_STORAGE_ACCESS_KEY
                ? 'phase6-notifications-and-private-files'
                : 'phase6-notifications'
              : false,
        }),
      );
      break;
    }
  } catch {}
  if (attempt === 89) {
    console.error('Startup timed out; inspect project-local logs');
    stop(1);
  }
  await new Promise((yes) => setTimeout(yes, 1000));
}
