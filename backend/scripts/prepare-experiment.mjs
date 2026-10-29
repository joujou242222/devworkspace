import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { portableBin } from './portable-postgres.mjs';
process.loadEnvFile('.env.local');
const root = process.cwd();
const data = resolve('.local/pg');
const marker = resolve('.local/pg-owner.json');
const bin = await portableBin();
await mkdir('.local/logs', { recursive: true });
const run = (name, args, extra = {}) => {
  const result = spawnSync(resolve(bin, name + '.exe'), args, {
    windowsHide: true,
    encoding: 'utf8',
    ...extra,
  });
  if (result.status !== 0) throw new Error(name + ' failed: ' + result.stderr);
  return result.stdout;
};
let existing = false;
try {
  await access(resolve(data, 'PG_VERSION'));
  existing = true;
} catch {}
if (existing) {
  const owner = JSON.parse(await readFile(marker, 'utf8'));
  if (owner.root !== root || owner.data !== data)
    throw new Error('Refusing to reuse an unowned PostgreSQL cluster');
} else {
  await writeFile('.local/pg-password', process.env.POSTGRES_PASSWORD, { mode: 0o600 });
  run('initdb', [
    '-D',
    data,
    '-U',
    process.env.POSTGRES_USER,
    '--auth=scram-sha-256',
    '--pwfile=' + resolve('.local/pg-password'),
    '--encoding=UTF8',
    '--locale=C',
  ]);
  await writeFile(marker, JSON.stringify({ root, data, bin, port: 55432 }));
}
const status = spawnSync(resolve(bin, 'pg_ctl.exe'), ['status', '-D', data], {
  windowsHide: true,
  stdio: 'ignore',
});
if (status.status !== 0)
  run(
    'pg_ctl',
    [
      'start',
      '-D',
      data,
      '-l',
      resolve('.local/logs/postgres.log'),
      '-o',
      '-h 127.0.0.1 -p 55432',
      '-w',
    ],
    { stdio: 'ignore', timeout: 30000 },
  );
const base =
  'postgresql://' +
  encodeURIComponent(process.env.POSTGRES_USER) +
  ':' +
  encodeURIComponent(process.env.POSTGRES_PASSWORD) +
  '@127.0.0.1:55432/';
const client = new Client({ connectionString: base + 'postgres' });
await client.connect();
const found = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [
  'devworkspace_v01',
]);
if (!found.rowCount) await client.query('CREATE DATABASE devworkspace_v01');
await client.end();
let env = await readFile('.env.local', 'utf8');
env = env.replace(/^EXPERIMENT_AUTH_ENABLED=.*$/m, 'EXPERIMENT_AUTH_ENABLED=true');
env = env.replace(/^DATABASE_URL=.*\n?/m, '') + 'DATABASE_URL=' + base + 'devworkspace_v01\n';
await writeFile('.env.local', env, { mode: 0o600 });
process.env.DATABASE_URL = base + 'devworkspace_v01';
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this helper via pnpm experiment:prepare');
const result = spawnSync(
  process.execPath,
  [pnpm, '--filter', '@devworkspace/database', 'experiment:push'],
  { env: process.env, stdio: 'inherit', windowsHide: true },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  'Isolated V01 database ready on loopback:55432. Only v01_* auth tables were created; no production identity/domain/RLS schema.',
);
