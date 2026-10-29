import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { compareObjectInventory, parseVersionPage } from './phase9-reconcile.mjs';
import { registeredVolumes } from './native-readiness.mjs';
import { PrivateStorage } from '../packages/server/dist/storage.js';
import { assertOwnedChild, copyVerified, fileInventory } from './phase9-recovery-copy.mjs';

const root = resolve('.');
const local = resolve('.local/phase9');
const pgOwnerPath = resolve('.local/pg-owner.json');
const requireServer = createRequire(resolve('packages/server/package.json'));
const { Pool } = requireServer('pg');
const pause = (milliseconds) =>
  new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

async function directoryBytes(base) {
  const visit = async (current) => {
    let total = 0;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Refusing a symlink in a recovery data directory');
      if (entry.isDirectory()) total += await visit(path);
      else if (entry.isFile()) total += (await stat(path)).size;
      else throw new Error('Unexpected filesystem entry in a recovery data directory');
    }
    return total;
  };
  return visit(resolve(base));
}

function diskFree() {
  const script = [
    "$items=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:' OR DeviceID='D:'\" | Select-Object DeviceID,FreeSpace",
    '$items | ConvertTo-Json -Compress',
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  const parsed = JSON.parse(output);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return Object.fromEntries(records.map((entry) => [entry.DeviceID, Number(entry.FreeSpace)]));
}

function assertCapacity(requiredDBytes, phase) {
  const free = diskFree();
  const cMinimum = 1 * 1024 ** 3;
  const dReserve = 512 * 1024 ** 2;
  if (free['C:'] < cMinimum || free['D:'] < requiredDBytes + dReserve)
    throw new Error(
      `${phase} stopped before copying: insufficient disk headroom (C ${Math.floor(free['C:'] / 1024 ** 3)} GiB free; D ${Math.floor(free['D:'] / 1024 ** 3)} GiB free; D requires ${Math.ceil((requiredDBytes + dReserve) / 1024 ** 3)} GiB including reserve)`,
    );
  return {
    cFreeBytes: free['C:'],
    dFreeBytes: free['D:'],
    requiredDBytes,
    dReserveBytes: dReserve,
  };
}

async function assertAppStopped() {
  const recordPath = resolve('.local/processes.json');
  let processes;
  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    processes = output.trim() ? JSON.parse(output) : [];
  } catch (error) {
    throw new Error('Cannot verify owned application process state: ' + error.message);
  }
  const list = processes ? (Array.isArray(processes) ? processes : [processes]) : [];
  let state;
  try {
    state = JSON.parse(await readFile(recordPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (state) {
    if (state.root !== root)
      throw new Error('Application process record belongs to another checkout');
    const pids = new Set(
      [state.parent, ...(state.children ?? []).map((entry) => entry.pid)].filter(Number.isInteger),
    );
    const active = list.filter(
      (entry) =>
        pids.has(entry.ProcessId) &&
        String(entry.CommandLine ?? '')
          .toLowerCase()
          .includes(root.toLowerCase()),
    );
    if (active.length)
      throw new Error(
        'Owned application processes are still present; stop them with pnpm dev:stop before recovery',
      );
  }
  for (const port of [3000, 3001, 8443]) {
    const server = net.createServer();
    try {
      await new Promise((yes, no) => {
        server.once('error', no);
        server.listen(port, '127.0.0.1', () => server.close(yes));
      });
    } catch {
      if (server.listening) await new Promise((yes) => server.close(yes));
      throw new Error(`Application port ${port} is occupied; no process was stopped`);
    }
  }
}

function adminPool(port) {
  process.loadEnvFile('.env.local');
  if (!process.env.POSTGRES_USER || !process.env.POSTGRES_PASSWORD)
    throw new Error('Private PostgreSQL operator credentials are unavailable');
  return new Pool({
    host: '127.0.0.1',
    port,
    database: 'devworkspace_phase2',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: 'devworkspace-phase9-recovery-verify',
  });
}

async function databaseInventory(port) {
  const pool = adminPool(port);
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout='30000'");
      const nonIdle = await client.query(`
        SELECT count(*)::int count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND state IN ('active','idle in transaction','idle in transaction (aborted)')
      `);
      const tables = (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      const tableRows = {};
      for (const table of tables) {
        const count = await client.query(
          `SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`,
        );
        tableRows[table] = count.rows[0].count;
      }
      const migrations = (
        await client.query('SELECT name,digest FROM migration_meta.phase2_migration ORDER BY name')
      ).rows;
      const databaseNames = (
        await client.query(
          'SELECT datname FROM pg_database WHERE datistemplate=false AND datallowconn ORDER BY datname',
        )
      ).rows.map((row) => row.datname);
      const policies = (
        await client.query(`
          SELECT count(*)::int total,
                 count(*) FILTER(WHERE relrowsecurity)::int enabled,
                 count(*) FILTER(WHERE relforcerowsecurity)::int forced
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'
        `)
      ).rows[0];
      const unvalidatedConstraints = (
        await client.query(
          "SELECT count(*)::int count FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated",
        )
      ).rows[0].count;
      const schemaEvents = (
        await client.query(`
          SELECT (SELECT count(*)::int FROM public.audit_event) audit_events,
                 (SELECT count(*)::int FROM public.tenant_event) tenant_events,
                 (SELECT count(*)::int FROM public.consumer_receipt) consumer_receipts,
                 (SELECT count(*)::int FROM public.notification) notifications,
                 (SELECT count(*)::int FROM public.review_cycle) review_cycles,
                 (SELECT count(*)::int FROM public.review_decision) review_decisions,
                 (SELECT count(*)::int FROM public.feedback_thread) feedback_threads,
                 (SELECT count(*)::int FROM public.deliverable_version) deliverable_versions
        `)
      ).rows[0];
      await client.query('COMMIT');
      const localMigrations = [];
      for (const file of await readdir('packages/database/prisma/product')) {
        if (!/^\d{4}-.+\.sql$/.test(file)) continue;
        localMigrations.push({
          name: file,
          digest: digest(await readFile(resolve('packages/database/prisma/product', file))),
        });
      }
      localMigrations.sort((a, b) => a.name.localeCompare(b.name));
      const migrationMatched =
        migrations.length === localMigrations.length &&
        migrations.every(
          (entry, index) =>
            entry.name === localMigrations[index].name &&
            entry.digest === localMigrations[index].digest,
        );
      if (!migrationMatched)
        throw new Error('Applied migration digests do not match the source files');
      if (Number(nonIdle.rows[0].count) !== 0)
        throw new Error(
          'An active or open product transaction prevents a consistent recovery boundary',
        );
      return {
        database: 'devworkspace_phase2',
        databaseNames,
        publicTableCount: tables.length,
        tableRows,
        migrationCount: migrations.length,
        migrationMatched,
        migrations,
        rowSecurity: policies,
        unvalidatedConstraints,
        keyRecordCounts: schemaEvents,
        activeProductTransactions: Number(nonIdle.rows[0].count),
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function runNodeScript(script, args = [], options = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 120000,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function reconcile(port) {
  const output = runNodeScript('scripts/phase9-reconcile.mjs', [], {
    env: { ...process.env, PHASE9_PG_PORT: String(port) },
    timeout: 120000,
  });
  return JSON.parse(output.trim());
}

function reconcileCore(result) {
  return {
    database: result.database,
    canonical: result.canonical,
    staging: result.staging,
  };
}

function runNative(action) {
  return runNodeScript('scripts/native-infra.mjs', [action], { timeout: 180000 });
}

async function assertPortClosed(port) {
  await new Promise((yes, no) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      no(new Error(`Owned service port ${port} is still accepting connections`));
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') yes();
      else no(error);
    });
  });
}

async function snapshot() {
  await assertAppStopped();
  await mkdir(local, { recursive: true });
  const initialDb = await databaseInventory(55432);
  const initialReconcile = await reconcile(55432);
  if (initialReconcile.status === 'FAIL')
    throw new Error('Storage reference verification failed; no backup was started');
  const pgSource = resolve('.local/pg');
  const storageSource = resolve('.local/native/storage');
  const pgInfo = await stat(pgSource);
  const storageInfo = await stat(storageSource);
  if (!pgInfo.isDirectory() || !storageInfo.isDirectory())
    throw new Error('Owned PostgreSQL or SeaweedFS data directory is missing');
  const pgBytes = await directoryBytes(pgSource);
  const storageBytes = await directoryBytes(storageSource);
  const totalSourceBytes = pgBytes + storageBytes;
  const preflightCapacity = assertCapacity(
    Math.ceil(totalSourceBytes * 2.2),
    'backup plus isolated restore',
  );
  const name = `snapshot-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}`;
  const destination = assertOwnedChild(resolve(local, name));
  await mkdir(destination, { recursive: false });
  let nativeDownAttempted = false;
  let snapshotResult;
  let snapshotCapacity = preflightCapacity;
  let restartOutput = '';
  try {
    nativeDownAttempted = true;
    const downOutput = runNative('down');
    for (const port of [55432, 9333, 8080, 8888, 9000, 6379, 1025, 8025])
      await assertPortClosed(port);
    try {
      await stat(resolve(pgSource, 'postmaster.pid'));
      throw new Error(
        'PostgreSQL left a live/stale postmaster.pid; preserving both directories for inspection',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const quiescedAt = new Date().toISOString();
    const pgFiles = await fileInventory(pgSource);
    const storageFiles = await fileInventory(storageSource);
    const quiescedPgBytes = pgFiles.reduce((sum, entry) => sum + entry.bytes, 0);
    const quiescedStorageBytes = storageFiles.reduce((sum, entry) => sum + entry.bytes, 0);
    const quiescedTotalBytes = quiescedPgBytes + quiescedStorageBytes;
    snapshotCapacity = assertCapacity(
      Math.ceil(quiescedTotalBytes * 2.2),
      'backup plus isolated restore',
    );
    const copiedPg = await copyVerified(
      pgSource,
      resolve(destination, 'postgres'),
      pgFiles,
      'PostgreSQL backup',
    );
    const copiedStorage = await copyVerified(
      storageSource,
      resolve(destination, 'seaweed'),
      storageFiles,
      'SeaweedFS backup',
    );
    snapshotResult = {
      format: 1,
      root,
      name,
      createdAt: new Date().toISOString(),
      quiescedAt,
      consistencyBoundary:
        'Owned API, worker, proxy, PostgreSQL and SeaweedFS stopped; retained native files were copied while no application writer could run.',
      atomicCrossStoreSnapshot: false,
      database: initialDb,
      sourceReconciliation: initialReconcile,
      sizes: {
        postgresBytes: quiescedPgBytes,
        seaweedBytes: quiescedStorageBytes,
        totalBytes: quiescedTotalBytes,
      },
      capacity: snapshotCapacity,
      shutdownEvidence: downOutput.trim(),
      files: { postgres: copiedPg, seaweed: copiedStorage },
    };
    await writeFile(
      resolve(destination, 'snapshot-manifest.json'),
      JSON.stringify(snapshotResult, null, 2) + '\n',
      { mode: 0o600 },
    );
  } finally {
    if (nativeDownAttempted) restartOutput = runNative('up');
  }
  const finalDb = await databaseInventory(55432);
  const finalReconcile = await reconcile(55432);
  if (JSON.stringify(finalDb) !== JSON.stringify(initialDb))
    throw new Error('Original database contents changed across the quiesced snapshot lifecycle');
  if (
    JSON.stringify(reconcileCore(finalReconcile)) !==
    JSON.stringify(reconcileCore(initialReconcile))
  )
    throw new Error('Original storage references changed across the quiesced snapshot lifecycle');
  const summary = {
    status: 'PASS',
    snapshot: name,
    consistencyBoundary: snapshotResult.quiescedAt,
    atomicCrossStoreSnapshot: false,
    sourceBytes: snapshotResult.sizes,
    diskHeadroomBytes: {
      cFreeBytesBefore: snapshotCapacity.cFreeBytes,
      dFreeBytesBefore: snapshotCapacity.dFreeBytes,
      dFreeBytesBeforeShutdown: preflightCapacity.dFreeBytes,
      requiredDBytesForSnapshotAndRestore: capacity.requiredDBytes,
    },
    postgres: {
      databases: initialDb.databaseNames.length,
      publicTables: initialDb.publicTableCount,
      migrations: initialDb.migrationCount,
      allTableCountsMatched: true,
      migrationDigestsMatched: initialDb.migrationMatched,
    },
    originalServicesRestored: true,
    restartEvidence: restartOutput.trim(),
    canonicalInventory: initialReconcile.canonical,
    stagingInventory: initialReconcile.staging,
  };
  console.log(JSON.stringify(summary));
}

function processAction(action, recordPath) {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      resolve('scripts/native-process.ps1'),
      '-Action',
      action,
      '-Record',
      recordPath,
    ],
    {
      encoding: 'utf8',
      stdio: action === 'inspect' ? 'pipe' : 'ignore',
      windowsHide: true,
      timeout: 45000,
      env: process.env,
    },
  );
  return typeof output === 'string' ? output.trim() : '';
}

async function startStorageClone(storagePath, recordPath) {
  const templatePath = resolve('.local/native/storage-process.json');
  const template = JSON.parse((await readFile(templatePath, 'utf8')).replace(/^\uFEFF/, ''));
  const artifacts = JSON.parse(await readFile('.local/native/artifacts.json', 'utf8'));
  if (
    template.root !== root ||
    template.name !== 'storage' ||
    template.binary !== artifacts.seaweedfs.binary
  )
    throw new Error('Owned SeaweedFS launch record or binary inventory changed');
  const args = template.args.map((arg) => {
    if (arg.startsWith('-dir=')) return '-dir=' + storagePath;
    if (arg.startsWith('-master.port=')) return '-master.port=9333';
    if (arg.startsWith('-volume.port=')) return '-volume.port=8080';
    if (arg.startsWith('-filer.port=')) return '-filer.port=8888';
    if (arg.startsWith('-s3.port=')) return '-s3.port=9000';
    return arg;
  });
  const record = {
    root,
    name: 'phase9-storage-restore-probe',
    binary: template.binary,
    args,
    cwd: storagePath,
    stdout: resolve(dirname(storagePath), 'seaweed-restore.out.log'),
    stderr: resolve(dirname(storagePath), 'seaweed-restore.err.log'),
  };
  await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  processAction('start', recordPath);
}

async function waitStorageClone(storagePath) {
  const security = await readFile(resolve(storagePath, 'security.toml'), 'utf8');
  const key = /\[jwt\.filer_signing\.read\]\s*key = "([a-f0-9]{64})"/.exec(security)?.[1];
  if (!key) throw new Error('Restored SeaweedFS read-signing key is unavailable');
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload =
    encode({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    encode({ exp: Math.floor(Date.now() / 1000) + 30 });
  const auth = {
    Authorization:
      'Bearer ' + payload + '.' + createHmac('sha256', key).update(payload).digest('base64url'),
  };
  const volumeFiles = (await readdir(storagePath)).filter((file) => file.endsWith('.dat'));
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const [master, filer, topology, anonymous] = await Promise.all([
        fetch('http://127.0.0.1:9333/cluster/status', { signal: AbortSignal.timeout(1500) }),
        fetch('http://127.0.0.1:8888/', { headers: auth, signal: AbortSignal.timeout(1500) }),
        fetch('http://127.0.0.1:9333/dir/status', { signal: AbortSignal.timeout(1500) }),
        fetch('http://127.0.0.1:9000/', { signal: AbortSignal.timeout(1500) }),
      ]);
      if (
        master.ok &&
        filer.ok &&
        topology.ok &&
        anonymous.status === 403 &&
        registeredVolumes(await topology.json(), volumeFiles)
      )
        return;
    } catch {}
    await pause(1000);
  }
  throw new Error(
    'Isolated SeaweedFS restore did not become ready with all copied volumes registered',
  );
}

async function runCloneProbe() {
  const config = parseEnv(await readFile('.env.local', 'utf8'));
  const storage = new PrivateStorage(config.S3_ACCESS_KEY, config.S3_SECRET_KEY);
  const bucket = 'phase9-probe-' + randomBytes(8).toString('hex');
  const created = await storage.request('PUT', bucket);
  if (![200, 204].includes(created.status))
    throw new Error(`Disposable restore-probe bucket creation failed (HTTP ${created.status})`);
  const enabled = await storage.request(
    'PUT',
    bucket,
    '',
    Buffer.from('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'),
    {},
    { versioning: '' },
  );
  if (![200, 204].includes(enabled.status))
    throw new Error(
      `Disposable restore-probe versioning could not be enabled (HTTP ${enabled.status})`,
    );
  const versioning = await storage.request('GET', bucket, '', undefined, {}, { versioning: '' });
  if (versioning.status !== 200 || !(await versioning.text()).includes('<Status>Enabled</Status>'))
    throw new Error('Disposable restore-probe bucket did not retain versioning');

  const key = 'versioned-probe';
  const firstBody = Buffer.from('phase9-recovery-version-one');
  const secondBody = Buffer.from('phase9-recovery-version-two');
  const firstPut = await storage.request('PUT', bucket, key, firstBody);
  const secondPut = await storage.request('PUT', bucket, key, secondBody);
  if (![200, 201].includes(firstPut.status) || ![200, 201].includes(secondPut.status))
    throw new Error('Disposable versioned object creation failed');
  const listing = await storage.request('GET', bucket, '', undefined, {}, { versions: '' });
  if (listing.status !== 200) throw new Error('Disposable object version listing failed');
  const versions = parseVersionPage(await listing.text()).versions.filter(
    (entry) => entry.key === key,
  );
  const firstVersion =
    firstPut.headers.get('x-amz-version-id') ?? versions.find((entry) => !entry.latest)?.version;
  const secondVersion =
    secondPut.headers.get('x-amz-version-id') ?? versions.find((entry) => entry.latest)?.version;
  if (!firstVersion || !secondVersion || firstVersion === secondVersion)
    throw new Error('S3 did not preserve distinct version identities for the recovery probe');
  const [firstRead, secondRead, currentRead] = await Promise.all([
    storage.request('GET', bucket, key, undefined, {}, { versionId: firstVersion }),
    storage.request('GET', bucket, key, undefined, {}, { versionId: secondVersion }),
    storage.request('GET', bucket, key),
  ]);
  if (![firstRead.status, secondRead.status, currentRead.status].every((status) => status === 200))
    throw new Error('Exact-version restore probe could not read the requested object');
  const firstBytes = Buffer.from(await firstRead.arrayBuffer());
  const secondBytes = Buffer.from(await secondRead.arrayBuffer());
  const currentBytes = Buffer.from(await currentRead.arrayBuffer());
  if (
    !firstBytes.equals(firstBody) ||
    !secondBytes.equals(secondBody) ||
    !currentBytes.equals(secondBody) ||
    digest(firstBytes) === digest(secondBytes)
  )
    throw new Error('Exact-version bytes did not match their immutable payload checksums');
  const mismatch = compareObjectInventory(
    [{ key, version: firstVersion, digest: digest(firstBytes), size: firstBytes.length }],
    [{ key, version: secondVersion, digest: digest(secondBytes), size: secondBytes.length }],
  );
  if (mismatch.missing !== 1)
    throw new Error('Wrong version identity was not rejected by the reconciliation comparison');

  const missingKey = 'missing-probe';
  const disposableBody = Buffer.from('phase9-disposable-missing-object');
  const put = await storage.request('PUT', bucket, missingKey, disposableBody);
  if (![200, 201].includes(put.status))
    throw new Error('Disposable missing-object fixture could not be created');
  const remove = await storage.request('DELETE', bucket, missingKey);
  if (![200, 204].includes(remove.status))
    throw new Error(`Disposable missing-object removal failed (HTTP ${remove.status})`);
  const missing = await storage.request('GET', bucket, missingKey);
  if (missing.status !== 404)
    throw new Error(
      'Removed disposable object did not produce an explicit missing-object response',
    );
  return {
    bucket,
    versionedWrites: 2,
    exactVersionReads: 2,
    latestReadMatchesNewest: true,
    wrongPinnedVersionDetected: true,
    disposableMissingObjectDetected: true,
    disposableBucketRetainedInIsolatedRestore: true,
  };
}

function pgControl(bin, args, timeout) {
  execFileSync(resolve(bin, 'pg_ctl.exe'), args, {
    windowsHide: true,
    timeout,
    // A daemonized postgres.exe can inherit pg_ctl's pipes on Windows; ignoring
    // them lets the short-lived controller exit once startup has completed.
    stdio: 'ignore',
  });
  return true;
}

function pgIsRunning(bin, data) {
  try {
    execFileSync(resolve(bin, 'pg_ctl.exe'), ['status', '-D', data], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function restore(snapshotName) {
  await assertAppStopped();
  const snapshotPattern = /^snapshot-\d{4}-\d{2}-\d{2}T\d{9}Z$/;
  const name =
    snapshotName ??
    (await readdir(local))
      .filter((entry) => snapshotPattern.test(entry))
      .sort()
      .at(-1);
  if (!name || !snapshotPattern.test(name))
    throw new Error('Provide an existing Phase 9 snapshot name');
  const snapshotPath = assertOwnedChild(resolve(local, name));
  const manifest = JSON.parse(
    await readFile(resolve(snapshotPath, 'snapshot-manifest.json'), 'utf8'),
  );
  if (manifest.format !== 1 || manifest.root !== root || manifest.name !== name)
    throw new Error('Snapshot identity does not match this checkout');
  const restoreName = `restore-${name.slice('snapshot-'.length)}-${randomBytes(4).toString('hex')}`;
  const restorePath = assertOwnedChild(resolve(local, restoreName));
  const restoreStatePath = resolve(restorePath, 'restore-state.json');
  const sourceBytes = manifest.sizes.totalBytes;
  const capacity = assertCapacity(Math.ceil(sourceBytes * 1.1), 'isolated restoration');
  await mkdir(restorePath, { recursive: false });
  const restoreState = {
    format: 1,
    root,
    sourceSnapshot: name,
    state: 'COPYING',
    startedAt: new Date().toISOString(),
    capacity,
  };
  await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', { mode: 0o600 });
  await copyVerified(
    resolve(snapshotPath, 'postgres'),
    resolve(restorePath, 'postgres'),
    manifest.files.postgres,
    'Isolated PostgreSQL restoration',
  );
  await copyVerified(
    resolve(snapshotPath, 'seaweed'),
    resolve(restorePath, 'seaweed'),
    manifest.files.seaweed,
    'Isolated SeaweedFS restoration',
  );
  restoreState.state = 'COPY_VERIFIED';
  restoreState.copyVerifiedAt = new Date().toISOString();
  await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', { mode: 0o600 });

  const owner = JSON.parse(await readFile(pgOwnerPath, 'utf8'));
  if (owner.root !== root || owner.port !== 55432 || owner.data !== resolve('.local/pg'))
    throw new Error('PostgreSQL restore binary/source ownership record changed');
  const pgData = resolve(restorePath, 'postgres');
  const pgLog = resolve(restorePath, 'postgres-restore.log');
  const storageData = resolve(restorePath, 'seaweed');
  const storageRecord = resolve(restorePath, 'seaweed-process.json');
  let clonePgRunning = false;
  let cloneStorageRunning = false;
  let originalDownAttempted = false;
  let nativeRestartOutput = '';
  try {
    originalDownAttempted = true;
    const sourceShutdown = runNative('down');
    for (const port of [55432, 9333, 8080, 8888, 9000, 6379, 1025, 8025])
      await assertPortClosed(port);
    await assertPortClosed(55433);
    clonePgRunning = true;
    pgControl(
      owner.bin,
      ['start', '-D', pgData, '-l', pgLog, '-o', '-h 127.0.0.1 -p 55433', '-w', '-t', '45'],
      55000,
    );
    const pgStartOutput = 'pg_ctl returned successfully';
    clonePgRunning = true;
    const cloneDb = await databaseInventory(55433);
    if (
      JSON.stringify(cloneDb.databaseNames) !== JSON.stringify(manifest.database.databaseNames) ||
      JSON.stringify(cloneDb.tableRows) !== JSON.stringify(manifest.database.tableRows) ||
      JSON.stringify(cloneDb.migrations) !== JSON.stringify(manifest.database.migrations) ||
      JSON.stringify(cloneDb.keyRecordCounts) !==
        JSON.stringify(manifest.database.keyRecordCounts) ||
      cloneDb.rowSecurity.total !== manifest.database.rowSecurity.total ||
      cloneDb.rowSecurity.enabled !== manifest.database.rowSecurity.enabled ||
      cloneDb.rowSecurity.forced !== manifest.database.rowSecurity.forced ||
      cloneDb.unvalidatedConstraints !== 0 ||
      cloneDb.activeProductTransactions !== 0
    )
      throw new Error(
        'Restored PostgreSQL database, row counts, security flags, or migration ledger do not match the quiesced source',
      );
    await pgControl(owner.bin, ['stop', '-D', pgData, '-m', 'fast', '-w', '-t', '90'], 100000);
    clonePgRunning = false;
    await assertPortClosed(55433);
    clonePgRunning = true;
    pgControl(
      owner.bin,
      ['start', '-D', pgData, '-l', pgLog, '-o', '-h 127.0.0.1 -p 55433', '-w', '-t', '45'],
      55000,
    );
    const afterPgRestart = await databaseInventory(55433);
    if (
      JSON.stringify(afterPgRestart.tableRows) !== JSON.stringify(manifest.database.tableRows) ||
      JSON.stringify(afterPgRestart.migrations) !== JSON.stringify(manifest.database.migrations)
    )
      throw new Error('Restored PostgreSQL contents changed after an owned graceful restart');

    cloneStorageRunning = true;
    await startStorageClone(storageData, storageRecord);
    await waitStorageClone(storageData);
    const restoredReconcile = await reconcile(55433);
    if (
      restoredReconcile.status === 'FAIL' ||
      JSON.stringify(restoredReconcile.database) !==
        JSON.stringify(manifest.sourceReconciliation.database) ||
      JSON.stringify(restoredReconcile.canonical) !==
        JSON.stringify(manifest.sourceReconciliation.canonical) ||
      JSON.stringify(restoredReconcile.staging) !==
        JSON.stringify(manifest.sourceReconciliation.staging)
    )
      throw new Error(
        'Restored storage bytes/version identities or PostgreSQL reference inventory differ from the source snapshot',
      );

    const storageProbe = await runCloneProbe();
    processAction('stop', storageRecord);
    cloneStorageRunning = false;
    let outageDetected = false;
    try {
      await fetch('http://127.0.0.1:9000/', { signal: AbortSignal.timeout(700) });
    } catch {
      outageDetected = true;
    }
    if (!outageDetected)
      throw new Error('Restored storage process interruption was not observable');
    cloneStorageRunning = true;
    await startStorageClone(storageData, storageRecord);
    await waitStorageClone(storageData);
    const afterStorageRestart = await reconcile(55433);
    if (
      afterStorageRestart.status === 'FAIL' ||
      afterStorageRestart.canonical.missing !== restoredReconcile.canonical.missing ||
      afterStorageRestart.canonical.mismatched !== restoredReconcile.canonical.mismatched
    )
      throw new Error(
        'Restored storage did not recover the original exact-version reference set after restart',
      );
    processAction('stop', storageRecord);
    cloneStorageRunning = false;
    pgControl(owner.bin, ['stop', '-D', pgData, '-m', 'fast', '-w', '-t', '90'], 100000);
    clonePgRunning = false;

    restoreState.state = 'VERIFIED';
    restoreState.completedAt = new Date().toISOString();
    restoreState.sourceShutdownEvidence = sourceShutdown.trim();
    restoreState.postgres = {
      restoredDatabases: cloneDb.databaseNames.length,
      restoredTables: cloneDb.publicTableCount,
      allTableCountsMatched: true,
      migrationDigestsMatched: true,
      forcedRlsTables: cloneDb.rowSecurity.forced,
      unvalidatedConstraints: cloneDb.unvalidatedConstraints,
      gracefulRestartRetainedRows: true,
      startOutput: pgStartOutput,
    };
    restoreState.storage = {
      restoredCanonical: restoredReconcile.canonical,
      restoredStaging: restoredReconcile.staging,
      versionBytesVerified:
        restoredReconcile.canonical.bytesRead + restoredReconcile.staging.bytesRead,
      storageProbe,
      interruptedProcessRestartRecovered: true,
    };
    restoreState.canonicalOrphanPolicy =
      'Detected and retained; the probe does not delete canonical objects.';
    await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', {
      mode: 0o600,
    });
  } catch (error) {
    restoreState.state = 'FAILED';
    restoreState.failedAt = new Date().toISOString();
    restoreState.failure = String(error.message ?? error).slice(0, 500);
    try {
      await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', {
        mode: 0o600,
      });
    } catch {}
    throw error;
  } finally {
    if (clonePgRunning || pgIsRunning(owner.bin, pgData)) {
      try {
        pgControl(owner.bin, ['stop', '-D', pgData, '-m', 'fast', '-w', '-t', '90'], 100000);
      } catch (error) {
        if (pgIsRunning(owner.bin, pgData)) {
          restoreState.state = 'CLEANUP_REQUIRED';
          restoreState.cleanupError = String(error.message ?? error).slice(0, 400);
          await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', {
            mode: 0o600,
          });
          throw new Error(
            'Could not stop the isolated PostgreSQL process safely; inspect the recorded restore directory',
          );
        }
      }
      clonePgRunning = false;
    }
    if (cloneStorageRunning) {
      try {
        await stat(storageRecord);
      } catch (error) {
        if (error.code === 'ENOENT') cloneStorageRunning = false;
        else throw error;
      }
    }
    if (cloneStorageRunning) {
      try {
        processAction('stop', storageRecord);
      } catch (error) {
        let stillRunning = true;
        try {
          stillRunning = processAction('inspect', storageRecord) === 'true';
        } catch {}
        if (stillRunning) {
          restoreState.state = 'CLEANUP_REQUIRED';
          restoreState.cleanupError = String(error.message ?? error).slice(0, 400);
          await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', {
            mode: 0o600,
          });
          throw new Error(
            'Could not stop the isolated storage process safely; source services were left stopped to avoid port collision',
          );
        }
      }
      cloneStorageRunning = false;
    }
    if (originalDownAttempted) nativeRestartOutput = runNative('up');
  }

  const originalDb = await databaseInventory(55432);
  if (
    JSON.stringify(originalDb.databaseNames) !== JSON.stringify(manifest.database.databaseNames) ||
    JSON.stringify(originalDb.tableRows) !== JSON.stringify(manifest.database.tableRows) ||
    JSON.stringify(originalDb.migrations) !== JSON.stringify(manifest.database.migrations)
  )
    throw new Error('Original PostgreSQL contents changed during the isolated restore rehearsal');
  const originalReconcile = await reconcile(55432);
  if (
    JSON.stringify(originalReconcile.canonical) !==
      JSON.stringify(manifest.sourceReconciliation.canonical) ||
    JSON.stringify(originalReconcile.staging) !==
      JSON.stringify(manifest.sourceReconciliation.staging)
  )
    throw new Error(
      'Original SeaweedFS content or object versions changed during isolated restore rehearsal',
    );
  restoreState.originalDatabasePreserved = true;
  restoreState.originalStoragePreserved = true;
  restoreState.originalServicesRestored = true;
  restoreState.originalRestartEvidence = nativeRestartOutput.trim();
  await writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify({
      status: restoreState.state === 'VERIFIED' ? 'PASS' : 'FAIL',
      snapshot: name,
      isolatedRestore: restoreName,
      sourceBytes: manifest.sizes,
      restoreBytes: manifest.sizes,
      diskHeadroomBytes: {
        cFreeBytesBefore: capacity.cFreeBytes,
        dFreeBytesBefore: capacity.dFreeBytes,
        requiredDBytes: capacity.requiredDBytes,
      },
      database: restoreState.postgres,
      storage: restoreState.storage,
      originalServicesRestored: true,
      originalDataPreserved: true,
      evidence: resolve(restorePath, 'restore-state.json'),
    }),
  );
}

const command = process.argv[2];
if (command === 'snapshot') await snapshot();
else if (command === 'restore') await restore(process.argv[3]);
else if (command === 'preflight') {
  await assertAppStopped();
  const free = diskFree();
  console.log(
    JSON.stringify({
      status: 'PASS',
      applicationStopped: true,
      cFreeBytes: free['C:'],
      dFreeBytes: free['D:'],
    }),
  );
} else throw new Error('Usage: node scripts/phase9-recovery.mjs snapshot|restore [snapshot-name]');
