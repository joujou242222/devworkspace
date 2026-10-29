import { readFile, writeFile, mkdir, cp, readdir, realpath, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { windowsEnv } from './setup-native.mjs';
const root = resolve('.local/processing');
const spec = JSON.parse(await readFile('infra/processing-tools.json', 'utf8'));
if (process.version !== 'v' + spec.node) throw new Error('Pinned Node required');
const archive = resolve('.local/vendor/clamav/official.zip');
if (
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex') !== spec.clamav.sha256
)
  throw new Error('Verified official ClamAV archive required');
const powershell = (args) =>
  execFileSync('powershell.exe', ['-NoProfile', ...args], {
    env: windowsEnv,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
powershell(['-File', 'scripts/processing-sandbox.ps1', '-Action', 'setup']);
const tools = join(root, 'tools');
const scanner = join(tools, 'scanner');
await mkdir(scanner, { recursive: true });
// Re-extract the hash-verified archive into its dedicated tool directory, so an
// earlier extraction is never treated as the provenance authority.
powershell([
  '-Command',
  `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${scanner.replaceAll("'", "''")}' -Force`,
]);
const scannerDirectory = join(scanner, 'clamav-1.4.6.win.x64');
for (const entry of await readdir(scannerDirectory, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    (entry.name === 'clamscan.exe' ||
      entry.name.endsWith('.dll') ||
      /license|copying/i.test(entry.name))
  )
    continue;
  const target = resolve(scannerDirectory, entry.name);
  if (!target.startsWith(resolve(root, 'tools/scanner') + '\\'))
    throw new Error('Tool cleanup path escaped');
  await rm(target, { recursive: entry.isDirectory(), force: false });
}
const database = join(tools, 'database');
await mkdir(database, { recursive: true });
for (const name of ['daily.cvd', 'main.cvd', 'bytecode.cvd'])
  await cp(join('.local/vendor/clamav/database', name), join(database, name));
await cp(process.execPath, join(tools, 'node.exe'));
await writeFile(join(tools, 'package.json'), '{"type":"commonjs"}\n');
const modules = join(tools, 'renderer/node_modules');
await mkdir(modules, { recursive: true });
const seen = new Set();
async function copyDependency(name, source) {
  const require = createRequire(join(source, 'package.json'));
  let entry;
  try {
    entry = require.resolve(name + '/package.json');
  } catch {
    try {
      entry = require.resolve(name);
    } catch {
      for (const candidate of require.resolve.paths(name) ?? []) {
        try {
          entry = await realpath(join(candidate, name, 'package.json'));
          break;
        } catch {}
      }
      if (!entry) return;
    }
  }
  let directory = dirname(await realpath(entry));
  let manifest;
  for (;;) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (candidate.name === name) {
        manifest = candidate;
        break;
      }
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Dependency provenance unresolved: ' + name);
    directory = parent;
  }
  const identity = name + '@' + manifest.version;
  if (seen.has(identity)) return;
  if ([...seen].some((x) => x.startsWith(name + '@')))
    throw new Error('Conflicting isolated dependency versions');
  seen.add(identity);
  if (spec[name] && spec[name] !== manifest.version)
    throw new Error('Unexpected processor version');
  await cp(directory, join(modules, name), {
    recursive: true,
    dereference: true,
    filter: (file) => !file.includes(join(directory, 'node_modules')),
  });
  for (const dependency of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  }))
    await copyDependency(dependency, directory);
}
for (const name of ['sharp', 'pdfjs-dist']) await copyDependency(name, resolve('packages/server'));
await writeFile(join(tools, 'renderer/package.json'), '{"type":"module"}\n');
for (const name of ['sandbox-probe.cjs']) await cp(join('scripts', name), join(tools, name));
await cp('scripts/file-processor.mjs', join(tools, 'renderer/process.mjs'));
await mkdir(join(tools, 'diagnostics'), { recursive: true });
await writeFile(
  join(tools, 'diagnostics/harmless.ndb'),
  'DevWorkspace.Phase4.HarmlessProbe:0:*:' +
    Buffer.from('DevWorkspacePhase4HarmlessScannerFixture7D217C1F').toString('hex') +
    '\n',
);
const inventory = [];
async function inventoryDirectory(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, file.name);
    if (file.isDirectory()) await inventoryDirectory(path);
    else
      inventory.push({
        path,
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      });
  }
}
await inventoryDirectory(tools);
// Retain the exact manifest behind each durable TOOLS digest when CVDs change.
const inventoryDigest = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
await mkdir(join(root, 'inventories'), { recursive: true });
const archiveManifest = join(root, 'inventories', inventoryDigest + '.json');
try {
  await writeFile(archiveManifest, JSON.stringify({ schema: 1, files: inventory }, null, 2), {
    flag: 'wx',
  });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const saved = JSON.parse(await readFile(archiveManifest, 'utf8'));
  if (createHash('sha256').update(JSON.stringify(saved.files)).digest('hex') !== inventoryDigest)
    throw new Error('Archived tool manifest integrity failed');
}
await writeFile(
  join(root, 'tool-inventory.json'),
  JSON.stringify(
    {
      schema: 1,
      root: resolve('.'),
      createdAt: new Date().toISOString(),
      scannerDirectory,
      database,
      node: join(tools, 'node.exe'),
      packages: [...seen],
      files: inventory,
    },
    null,
    2,
  ),
);
console.log(
  'Verified scanner, signatures, Node and isolated renderer dependencies prepared; ' +
    inventory.length +
    ' hashed files. No service, network capability or global PATH change.',
);
