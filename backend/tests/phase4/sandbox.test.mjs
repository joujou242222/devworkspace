import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import net from 'node:net';
import dgram from 'node:dgram';
import {
  processPrivateFile,
  runSandbox,
  verifyProcessingTools,
} from '../../packages/server/dist/processing.js';
import { image, pdf, hash, marker } from './fixtures.mjs';
const root = resolve('.local/processing/work');
const inventory = await verifyProcessingTools();
const profile = JSON.parse(
  (await readFile('.local/processing/sandbox.json', 'utf8')).replace(/^\uFEFF/, ''),
);
async function job(work) {
  const dir = join(root, randomUUID());
  await mkdir(dir);
  try {
    return await work(dir);
  } finally {
    assert.ok(dir.startsWith(root + '\\'));
    await rm(dir, { recursive: true });
  }
}
async function render(dir, bytes, mime, media = false) {
  await writeFile(join(dir, 'input.bin'), bytes);
  await writeFile(
    join(dir, 'input.json'),
    JSON.stringify({ size: bytes.length, digest: hash(bytes), mime, media }),
  );
  const process = await runSandbox({
    executable: inventory.node,
    arguments: [
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--max-old-space-size=384',
      resolve('.local/processing/tools/renderer/process.mjs'),
    ],
    directory: dir,
    timeoutMs: 60000,
    memoryMiB: 768,
  });
  return { process, result: JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) };
}
test('AppContainer token, credential-free environment, secrets/filesystem denial and real TCP/UDP network isolation', async () =>
  job(async (directory) => {
    let tcpCount = 0,
      udpCount = 0;
    const tcp = net.createServer((s) => {
      tcpCount++;
      s.end();
    });
    const udp = dgram.createSocket('udp4');
    udp.on('message', () => udpCount++);
    const canary = resolve('.local/phase4-canary-' + randomUUID());
    await writeFile(canary, 'protected synthetic canary');
    try {
      await new Promise((r, reject) => {
        tcp.once('error', reject);
        tcp.listen(0, '127.0.0.1', r);
      });
      const port = tcp.address().port;
      await new Promise((r, reject) => {
        udp.once('error', reject);
        udp.bind(0, '127.0.0.1', r);
      });
      const udpPort = udp.address().port;
      const positive = net.createConnection({ host: '127.0.0.1', port });
      positive.setTimeout(5000, () => positive.destroy(new Error('outside TCP control timeout')));
      await new Promise((r, j) => {
        positive.on('connect', r);
        positive.on('error', j);
      });
      positive.destroy();
      await new Promise((r, reject) =>
        udp.send(Buffer.from('outside control'), udpPort, '127.0.0.1', (error) =>
          error ? reject(error) : r(),
        ),
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(tcpCount, 1);
      assert.equal(udpCount, 1);
      tcpCount = udpCount = 0;
      const output = join(directory, 'isolation.json');
      const probe = resolve('.local/processing/tools/sandbox-probe.cjs');
      const process = await runSandbox({
        executable: inventory.node,
        arguments: [
          '--preserve-symlinks',
          '--preserve-symlinks-main',
          probe,
          output,
          resolve('.env.local'),
          canary,
          probe,
          profile.profileDirectory,
          String(port),
          String(udpPort),
        ],
        directory,
        timeoutMs: 15000,
        memoryMiB: 512,
      });
      assert.equal(process.ExitCode, 0);
      assert.equal(process.AppContainer, true);
      assert.equal(process.Elevated, false);
      assert.equal(process.Capabilities, 0);
      const results = JSON.parse(await readFile(output, 'utf8'));
      assert.deepEqual(results.environment, [
        'LOCALAPPDATA',
        'PATH',
        'SystemRoot',
        'TEMP',
        'TMP',
        'WINDIR',
      ]);
      for (const [name, code] of Object.entries(results.files))
        assert.ok(['EACCES', 'EPERM'].includes(code), name + ' must be denied: ' + code);
      for (const name of ['internet', 'privateNetwork'])
        assert.ok(['EACCES', 'EPERM'].includes(results.network[name]), name);
      assert.ok(
        ['EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNREFUSED'].includes(results.network.loopback),
      );
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(tcpCount, 0);
      assert.equal(udpCount, 0);
      assert.equal(await readFile(canary, 'utf8'), 'protected synthetic canary');
    } finally {
      tcp.close();
      udp.close();
      await rm(canary);
    }
  }));
test('timeout kills the restricted job and does not leave a running child', async () =>
  job(async (directory) => {
    const result = await runSandbox({
      executable: inventory.node,
      arguments: ['-e', 'setInterval(()=>{},1000)'],
      directory,
      timeoutMs: 500,
      memoryMiB: 512,
    });
    assert.equal(result.TimedOut, true);
    assert.equal(result.ExitCode, 124);
    assert.throws(() => process.kill(result.ProcessId, 0));
    await assert.rejects(readFile(join(directory, 'result.json')), { code: 'ENOENT' });
  }));

test('missing tools and unavailable or expired signatures fail closed, then pinned tools recover', async () =>
  job(async (directory) => {
    const clean = join(directory, 'clean.png');
    await writeFile(clean, await image());
    const missingRoot = join(
      inventory.root,
      '.local',
      'processing',
      'tools',
      'missing-' + randomUUID(),
    );

    for (const executable of ['clamscan.exe', 'node.exe']) {
      await assert.rejects(
        runSandbox({
          executable: join(missingRoot, executable),
          arguments: ['--version'],
          directory,
          timeoutMs: 5000,
          memoryMiB: 512,
        }),
      );
    }

    const unavailableDatabase = join(directory, 'unavailable-signatures');
    const unavailableLog = join(directory, 'unavailable-signatures.log');
    const scanner = join(inventory.scannerDirectory, 'clamscan.exe');
    const unavailable = await runSandbox({
      executable: scanner,
      arguments: [
        '--database=' + unavailableDatabase,
        '--official-db-only=yes',
        '--fail-if-cvd-older-than=2',
        '--tempdir=' + directory,
        '--log=' + unavailableLog,
        '--max-scantime=0',
        clean,
      ],
      directory,
      timeoutMs: 30000,
      memoryMiB: 1536,
    });
    assert.notEqual(unavailable.ExitCode, 0);

    const expiredDatabase = join(directory, 'expired-signed-database');
    await mkdir(expiredDatabase);
    await copyFile(
      join(inventory.root, '.local', 'processing', 'tools', 'database', 'bytecode.cvd'),
      join(expiredDatabase, 'bytecode.cvd'),
    );
    const expiredLog = join(directory, 'expired-signatures.log');
    const expired = await runSandbox({
      executable: scanner,
      arguments: [
        '--database=' + expiredDatabase,
        '--official-db-only=yes',
        '--fail-if-cvd-older-than=2',
        '--tempdir=' + directory,
        '--log=' + expiredLog,
        '--max-scantime=0',
        clean,
      ],
      directory,
      timeoutMs: 30000,
      memoryMiB: 1536,
    });
    assert.equal(expired.ExitCode, 2, await readFile(expiredLog, 'utf8'));
    assert.match(await readFile(expiredLog, 'utf8'), /Virus database is older than 2 days/i);

    const recoveredLog = join(directory, 'recovered-signatures.log');
    const recovered = await runSandbox({
      executable: scanner,
      arguments: [
        '--database=' + inventory.database,
        '--official-db-only=yes',
        '--fail-if-cvd-older-than=2',
        '--tempdir=' + directory,
        '--log=' + recoveredLog,
        '--max-scantime=0',
        clean,
      ],
      directory,
      timeoutMs: 90000,
      memoryMiB: 1536,
    });
    assert.equal(recovered.ExitCode, 0, await readFile(recoveredLog, 'utf8'));
    const report = await readFile(recoveredLog, 'utf8');
    assert.match(report, /Scanned files:\s+1\b/);
    assert.match(report, /Infected files:\s+0\b/);
  }));

test('processing refuses synthetic crash residue before reading staging or publishing output', async () => {
  const entriesBefore = await readdir(root);
  assert.deepEqual(
    entriesBefore,
    [],
    'pre-existing processor residue must be reviewed, not altered',
  );
  const residue = join(root, 'phase9-residue-' + randomUUID());
  await mkdir(residue);
  await writeFile(join(residue, 'interrupted.marker'), 'synthetic interrupted job');
  let storageCalls = 0;
  const storage = {
    async request() {
      storageCalls++;
      throw new Error('storage must not be contacted while residue exists');
    },
  };

  try {
    await assert.rejects(
      processPrivateFile(storage, {
        id: randomUUID(),
        staging_key: 'synthetic/unread',
        expected_size: 1,
        expected_digest: '0'.repeat(64),
        mime: 'image/png',
      }),
      /Processing work requires isolated recovery/,
    );
    assert.equal(storageCalls, 0);
    assert.equal(
      await readFile(join(residue, 'interrupted.marker'), 'utf8'),
      'synthetic interrupted job',
    );
  } finally {
    assert.ok(residue.startsWith(root + '\\'));
    await rm(residue, { recursive: true });
  }
  assert.deepEqual(await readdir(root), entriesBefore);
});
test('Windows job memory limit denies an allocation beyond its process budget', async () =>
  job(async (directory) => {
    const result = await runSandbox({
      executable: inventory.node,
      arguments: ['-e', 'Buffer.alloc(1024*1024*1024,1)'],
      directory,
      timeoutMs: 10000,
      memoryMiB: 128,
    });
    assert.notEqual(result.ExitCode, 0);
    assert.equal(result.TimedOut, false);
  }));
test('monitored processing disk budget terminates excessive temporary output', async () =>
  job(async (directory) => {
    const result = await runSandbox({
      executable: inventory.node,
      arguments: [
        '--eval',
        "const fs=require('node:fs');fs.writeFileSync('excess.bin',Buffer.alloc(260*1024*1024));setInterval(()=>{},1000)",
      ],
      directory,
      timeoutMs: 10000,
      memoryMiB: 768,
    });
    assert.equal(result.TimedOut, false);
    assert.equal(result.ResourceLimit, 'DISK_BUDGET');
    assert.equal(result.ExitCode, 125);
  }));
test('real ClamAV accepts clean bytes and detects an isolated harmless signature with official CVDs loaded', async () =>
  job(async (directory) => {
    const clean = join(directory, 'clean.bin');
    await writeFile(clean, await image());
    const marked = join(directory, 'marked.bin');
    const markedBytes = await image('png', '#992211', 32, 32);
    await writeFile(marked, markedBytes);
    const signature = join(directory, 'harmless.hdb');
    await writeFile(
      signature,
      createHash('md5').update(markedBytes).digest('hex') +
        ':' +
        markedBytes.length +
        ':DevWorkspace.Phase4.HarmlessProbe\n',
    );
    for (const [file, expected] of [
      [clean, 0],
      [marked, 1],
    ]) {
      const log = join(directory, randomUUID() + '.log');
      const result = await runSandbox({
        executable: join(inventory.scannerDirectory, 'clamscan.exe'),
        arguments: [
          '--database=' + inventory.database,
          '--database=' + signature,
          '--tempdir=' + directory,
          '--log=' + log,
          '--max-scantime=0',
          // ClamAV 1.4.6's freshness option skips directly supplied non-CVD
          // signature files. Production uses official CVDs with that guard;
          // this detection probe supplements those CVDs with a harmless hash.
          file,
        ],
        directory,
        timeoutMs: 90000,
        memoryMiB: 1536,
      });
      assert.equal(result.TimedOut, false);
      const report = await readFile(log, 'utf8');
      assert.equal(result.ExitCode, expected, report);
      assert.match(report, /Scanned files:\s+1\b/);
      if (expected === 1) assert.match(report, /DevWorkspace\.Phase4\.HarmlessProbe/);
    }
  }));
test('PNG and JPEG decode to private normalized PNG previews inside the AppContainer', async () =>
  job(async (directory) => {
    for (const format of ['png', 'jpeg']) {
      const bytes = await image(format);
      const { process, result } = await render(directory, bytes, 'image/' + format);
      assert.equal(process.ExitCode, 0);
      assert.equal(result.status, 'READY');
      assert.equal(result.digest, hash(bytes));
      assert.equal(result.width, 8);
      assert.equal(result.height, 6);
      const preview = await readFile(join(directory, result.previews[0].filename));
      assert.equal(hash(preview), result.previews[0].digest);
      assert.deepEqual([...preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  }));
test('PDF renderer validates page counts, produces real raster pages and rejects active/over-limit documents', async () =>
  job(async (directory) => {
    for (const [bytes, status] of [
      [pdf(1), 'READY'],
      [pdf(101), 'REJECTED'],
      [pdf(1, true), 'REJECTED'],
    ]) {
      const { result } = await render(directory, bytes, 'application/pdf');
      assert.equal(result.status, status);
      if (status === 'READY') {
        assert.equal(result.pages, 1);
        assert.equal(result.previews.length, 1);
        assert.ok((await readFile(join(directory, 'page-1.png'))).length > 100);
      }
    }
  }));
test('forged MIME, malformed bytes and decompression dimensions never produce a ready result', async () =>
  job(async (directory) => {
    for (const [bytes, mime] of [
      [Buffer.from('<script>not an image</script>'), 'image/png'],
      [await image('jpeg'), 'image/png'],
      [Buffer.from('%PDF-1.7\ninvalid'), 'application/pdf'],
      [await image('png', '#ffffff', 10001, 4000), 'image/png'],
    ]) {
      const { result } = await render(directory, bytes, mime);
      assert.notEqual(result.status, 'READY');
    }
  }));
