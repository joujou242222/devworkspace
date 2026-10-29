import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// Project-local configuration only. Existing storage credentials and data are retained.
const directory = resolve('.local/native/storage');
await access(directory);
const file = resolve(directory, 'security.toml');
let present;
try {
  present = await readFile(file, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (present) {
  if (!present.startsWith('# DevWorkspace Phase 4 private storage\n'))
    throw new Error('Unrecognized storage security configuration; refusing replacement');
} else {
  const sections = [
    'jwt.signing',
    'jwt.signing.read',
    'jwt.filer_signing',
    'jwt.filer_signing.read',
  ];
  const content =
    '# DevWorkspace Phase 4 private storage\n' +
    sections
      .map(
        (section) =>
          `[${section}]\nkey = "${randomBytes(32).toString('hex')}"\nexpires_after_seconds = 60\n`,
      )
      .join('\n');
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
}
const identityPath = resolve('.local/s3-identities.json');
const identities = JSON.parse(await readFile(identityPath, 'utf8'));
const credentialPath = resolve('.local/phase4-storage-credentials.json');
let credentials;
try {
  credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = {};
  for (const role of ['api', 'worker'])
    credentials[role] = {
      accessKey: 'DW4' + role.toUpperCase() + randomBytes(12).toString('hex'),
      secretKey: randomBytes(32).toString('hex'),
    };
  await writeFile(credentialPath, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
}
if (!credentials.cleanup) {
  credentials.cleanup = {
    accessKey: 'DW4CLEANUP' + randomBytes(12).toString('hex'),
    secretKey: randomBytes(32).toString('hex'),
  };
  await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
}
for (const [role, actions] of [
  ['api', ['Write:dw-staging', 'Read:dw-staging', 'Read:dw-canonical']],
  ['worker', ['Read:dw-staging', 'Read:dw-canonical', 'Write:dw-canonical']],
  ['cleanup', ['Write:dw-staging']],
]) {
  const name = 'phase4-files-' + role;
  const expected = { name, credentials: [credentials[role]], actions };
  const existing = identities.identities.find((x) => x.name === name);
  if (existing && JSON.stringify(existing) !== JSON.stringify(expected)) {
    const initial = {
      name,
      credentials: [credentials[role]],
      actions:
        role === 'api'
          ? ['Write:dw-staging', 'Read:dw-canonical']
          : ['Read:dw-staging', 'Read:dw-canonical', 'Write:dw-canonical'],
    };
    const previousWorker = {
      name,
      credentials: [credentials[role]],
      actions: [
        'Read:dw-staging',
        'Read:dw-canonical',
        'Write:dw-canonical',
        'PutObjectLegalHold:dw-canonical',
      ],
    };
    if (
      JSON.stringify(existing) !== JSON.stringify(initial) &&
      !(role === 'worker' && JSON.stringify(existing) === JSON.stringify(previousWorker))
    )
      throw new Error('Existing scoped identity differs; refusing replacement');
    existing.actions = actions;
  }
  if (!existing) identities.identities.push(expected);
  await writeFile(
    resolve('.local/phase4-' + role + '.env'),
    (role === 'cleanup' ? 'CLEANUP_STORAGE_ACCESS_KEY=' : 'FILE_STORAGE_ACCESS_KEY=') +
      credentials[role].accessKey +
      (role === 'cleanup' ? '\nCLEANUP_STORAGE_SECRET_KEY=' : '\nFILE_STORAGE_SECRET_KEY=') +
      credentials[role].secretKey +
      '\n',
    { mode: 0o600 },
  );
}
await writeFile(
  resolve('.local/phase4-worker.env'),
  (await readFile(resolve('.local/phase4-worker.env'), 'utf8')) +
    (await readFile(resolve('.local/phase4-cleanup.env'), 'utf8')),
  { mode: 0o600 },
);
await writeFile(identityPath, JSON.stringify(identities, null, 2), { mode: 0o600 });
console.log(
  'Project-local filer/volume authentication and separate bucket-scoped API/worker identities prepared; owned storage restart required. Existing identities/data retained. No credential values emitted.',
);
