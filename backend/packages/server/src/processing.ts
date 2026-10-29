import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm, lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PrivateStorage } from './storage.js';
const execute = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface ProcessingIntent {
  id: string;
  staging_key: string;
  expected_size: number;
  expected_digest: string;
  mime: string;
  media?: boolean;
  canonical_prefix?: string;
}
interface ToolInventory {
  root: string;
  scannerDirectory: string;
  database: string;
  node: string;
  files: { path: string; sha256: string }[];
}
export interface SandboxResult {
  ExitCode: number;
  TimedOut: boolean;
  AppContainer: boolean;
  Elevated: boolean;
  Capabilities: number;
  ProcessId: number;
  ResourceLimit?: string | null;
}
export async function runSandbox(request: {
  executable: string;
  arguments: string[];
  directory: string;
  timeoutMs: number;
  memoryMiB: number;
}): Promise<SandboxResult> {
  const requestPath = resolve('.local/processing', 'request-' + randomUUID() + '.json');
  await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
  try {
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    const { stdout } = await execute(
      join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-File',
        resolve('scripts/processing-sandbox.ps1'),
        '-Action',
        'run',
        '-RequestFile',
        requestPath,
      ],
      {
        windowsHide: true,
        timeout: request.timeoutMs + 15000,
        maxBuffer: 65536,
        env: {
          SystemRoot: windows,
          WINDIR: windows,
          USERPROFILE: process.env.USERPROFILE,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          PATH: windows + '\\System32',
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
          PSModulePath: windows + '\\System32\\WindowsPowerShell\\v1.0\\Modules',
        },
      },
    );
    const result = JSON.parse(stdout.trim()) as SandboxResult;
    if (
      result.AppContainer !== true ||
      result.Elevated !== false ||
      result.Capabilities !== 0 ||
      !Number.isInteger(result.ExitCode)
    )
      throw new Error('Invalid sandbox attestation');
    return result;
  } finally {
    await rm(requestPath, { force: true });
  }
}
export async function verifyProcessingTools(): Promise<ToolInventory> {
  const inventory = JSON.parse(
    await readFile('.local/processing/tool-inventory.json', 'utf8'),
  ) as ToolInventory;
  const tools = resolve('.local/processing/tools');
  if (inventory.root !== resolve('.'))
    throw new Error('Processor inventory belongs to another workspace');
  for (const file of inventory.files) {
    const path = await realpath(file.path);
    if (!path.startsWith(tools + '\\') || hash(await readFile(path)) !== file.sha256)
      throw new Error('Processor tool integrity failed');
  }
  return inventory;
}
async function boundedBytes(response: Response, max: number) {
  if (!response.ok || !response.body) throw new Error('Storage source unavailable');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error('Storage byte limit exceeded');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
/** Idempotent create-only publication: a retry verifies existing bytes; it never replaces them. */
export async function publishObject(storage: PrivateStorage, key: string, bytes: Uint8Array) {
  const result = await storage.request('PUT', 'dw-canonical', key, bytes, {
    'if-none-match': '*',
    'x-amz-checksum-sha256': Buffer.from(hash(bytes), 'hex').toString('base64'),
  });
  if (![200, 412].includes(result.status)) throw new Error('Canonical publication failed');
  const identity =
    result.status === 200 ? result : await storage.request('HEAD', 'dw-canonical', key);
  const storageVersion = identity.headers.get('x-amz-version-id');
  if (!storageVersion) throw new Error('Canonical storage version missing');
  const canonical = await boundedBytes(
    await storage.request('GET', 'dw-canonical', key, undefined, {}, { versionId: storageVersion }),
    bytes.length,
  );
  if (canonical.length !== bytes.length || hash(canonical) !== hash(bytes))
    throw new Error('Canonical identity verification failed');
  return storageVersion;
}
export async function processPrivateFile(
  storage: PrivateStorage,
  intent: ProcessingIntent,
  record: (step: string, outcome: string, tool: string) => Promise<void> = async () => {},
) {
  const prefix = intent.media ? intent.canonical_prefix : '';
  if (intent.media && !['logo/', 'profile/'].includes(prefix ?? ''))
    throw new Error('Invalid processing purpose');
  const inventory = await verifyProcessingTools();
  await record('TOOLS', 'VERIFIED', hash(Buffer.from(JSON.stringify(inventory.files))));
  const workRoot = resolve('.local/processing/work');
  // The dedicated profile is reused only after the previous tenant's temporary
  // content is gone. The worker holds a database-wide processing lock across
  // this check and cleanup. Crash residue requires operator recovery, fail closed.
  if ((await readdir(workRoot)).length)
    throw new Error('Processing work requires isolated recovery');
  const directory = join(workRoot, randomUUID());
  await mkdir(directory, { recursive: false });
  try {
    const bytes = await boundedBytes(
      await storage.request('GET', 'dw-staging', intent.staging_key),
      intent.media ? 2 * 1024 * 1024 : 25 * 1024 * 1024,
    );
    if (bytes.length !== intent.expected_size || hash(bytes) !== intent.expected_digest)
      return { status: 'REJECTED', error_code: 'INTEGRITY_MISMATCH' };
    await record('INTEGRITY', 'VERIFIED', intent.expected_digest);
    await writeFile(join(directory, 'input.bin'), bytes);
    await writeFile(
      join(directory, 'input.json'),
      JSON.stringify({
        size: bytes.length,
        digest: intent.expected_digest,
        mime: intent.mime,
        media: intent.media ?? false,
      }),
    );
    const log = join(directory, 'scan.log');
    await record('SCAN', 'STARTED', 'clamav-1.4.6');
    const scanned = await runSandbox({
      executable: join(inventory.scannerDirectory, 'clamscan.exe'),
      arguments: [
        '--database=' + inventory.database,
        '--official-db-only=yes',
        '--fail-if-cvd-older-than=2',
        '--tempdir=' + directory,
        '--log=' + log,
        '--max-scantime=0',
        '--max-filesize=26M',
        '--max-scansize=100M',
        '--max-recursion=16',
        '--max-files=1000',
        '--alert-exceeds-max=yes',
        join(directory, 'input.bin'),
      ],
      directory,
      timeoutMs: 90000,
      memoryMiB: 1536,
    });
    if (scanned.TimedOut || ![0, 1].includes(scanned.ExitCode))
      return { status: 'FAILED', error_code: 'SCANNER_UNAVAILABLE' };
    if (scanned.ExitCode === 1)
      return { status: 'REJECTED', error_code: 'UNSAFE_OR_EXCESSIVE_CONTENT' };
    const scanReport = await readFile(log, 'utf8');
    if (
      !/Scanned files:\s+1\b/.test(scanReport) ||
      !/Infected files:\s+0\b/.test(scanReport) ||
      /warning|error|skipped|excluded/i.test(scanReport)
    )
      return { status: 'FAILED', error_code: 'INCOMPLETE_SCAN' };
    await record('SCAN', 'VERIFIED', 'clamav-1.4.6');
    await record('RENDER', 'STARTED', 'sharp-0.35.5/pdfjs-6.4.299');
    const rendered = await runSandbox({
      executable: inventory.node,
      arguments: [
        '--preserve-symlinks',
        '--preserve-symlinks-main',
        '--max-old-space-size=384',
        resolve('.local/processing/tools/renderer/process.mjs'),
      ],
      directory,
      timeoutMs: 60000,
      memoryMiB: 768,
    });
    if (rendered.TimedOut) return { status: 'FAILED', error_code: 'PROCESSOR_TIMEOUT' };
    const resultPath = join(directory, 'result.json');
    const resultStat = await lstat(resultPath);
    if (!resultStat.isFile() || resultStat.size > 65536)
      throw new Error('Invalid processor report');
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    if (rendered.ExitCode !== 0 || result.status !== 'READY')
      return {
        status: result.status === 'REJECTED' ? 'REJECTED' : 'FAILED',
        error_code:
          result.status === 'REJECTED' ? 'INVALID_OR_EXCESSIVE_CONTENT' : 'PROCESSOR_FAILED',
      };
    if (
      result.digest !== intent.expected_digest ||
      result.size !== intent.expected_size ||
      result.mime !== intent.mime ||
      !Array.isArray(result.previews) ||
      result.previews.length < 1 ||
      result.previews.length > 100 ||
      hash(await readFile(join(directory, 'input.bin'))) !== intent.expected_digest
    )
      throw new Error('Invalid processor identity');
    const canonicalKey = prefix + 'original/' + intent.id;
    await record('RENDER', 'VERIFIED', String(result.tool_version));
    await record('PUBLISH', 'STARTED', 's3-pinned-version');
    const previews = [];
    for (let index = 0; index < result.previews.length; index++) {
      const p = result.previews[index];
      const expected = 'page-' + (index + 1) + '.png';
      if (
        p.filename !== expected ||
        p.page !== index + 1 ||
        !Number.isInteger(p.width) ||
        !Number.isInteger(p.height) ||
        p.width < 1 ||
        p.height < 1 ||
        p.width * p.height > 4000000
      )
        throw new Error('Invalid preview geometry');
      const path = join(directory, expected);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid preview object');
      const data = await readFile(path);
      if (
        hash(data) !== p.digest ||
        !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Invalid preview identity');
      const key = prefix + 'preview/' + intent.id + '/' + p.page;
      const version = await publishObject(storage, key, data);
      previews.push({
        key,
        storage_version: version,
        page: p.page,
        digest: p.digest,
        width: p.width,
        height: p.height,
      });
    }
    // Object creation and SQL completion are deliberately separate. Retried jobs
    // use these same keys and verify their identities after an interrupted commit.
    const storageVersion = await publishObject(storage, canonicalKey, bytes);
    await record('PUBLISH', 'VERIFIED', 's3-pinned-version');
    return {
      status: 'READY',
      digest: intent.expected_digest,
      size: bytes.length,
      mime: intent.mime,
      width: result.width,
      height: result.height,
      pages: result.pages,
      tool_version: 'clamav-1.4.6/' + result.tool_version,
      canonical_key: canonicalKey,
      storage_version: storageVersion,
      previews,
    };
  } finally {
    // Only this newly-created UUID job directory, after job handles have closed.
    if (directory.startsWith(workRoot + '\\') && (await lstat(directory)).isDirectory())
      await rm(directory, { recursive: true });
  }
}
