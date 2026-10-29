import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export const artifact = {
  url: 'https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-18.4.0-beta.17.tgz',
  sha512:
    'AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==',
  binaryVersion: '18.4',
  packagingVersion: '18.4.0-beta.17',
};
export async function portableBin() {
  if (process.platform !== 'win32')
    throw new Error(
      'Use the Compose PostgreSQL service on other platforms; this optional portable helper is Windows-only.',
    );
  await mkdir('.local/vendor', { recursive: true });
  const archive = resolve('.local/vendor/postgres-runtime.tgz');
  try {
    await access(archive);
  } catch {
    const response = await fetch(artifact.url);
    if (!response.ok) throw new Error('Portable PostgreSQL download failed');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  }
  if (
    createHash('sha512')
      .update(await readFile(archive))
      .digest('base64') !== artifact.sha512
  )
    throw new Error('Portable binary artifact integrity mismatch');
  const destination = resolve('.local/vendor/postgres-runtime');
  await mkdir(destination, { recursive: true });
  const list = spawnSync('tar', ['-tf', archive], { encoding: 'utf8', windowsHide: true });
  if (list.status !== 0) throw new Error('Cannot inspect PostgreSQL archive');
  for (const entry of list.stdout.split(/\r?\n/).filter(Boolean)) {
    if (entry.startsWith('/') || entry.includes('..') || /^[A-Za-z]:/.test(entry))
      throw new Error('Unsafe archive entry');
  }
  for (const candidate of ['package/native/bin', 'package/bin']) {
    const bin = resolve(destination, candidate);
    try {
      await access(resolve(bin, 'postgres.exe'));
      const version = spawnSync(resolve(bin, 'postgres.exe'), ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (!version.stdout.includes('18.4')) throw new Error('Unexpected PostgreSQL binary version');
      return bin;
    } catch (error) {
      if (error.message === 'Unexpected PostgreSQL binary version') throw error;
    }
  }
  const extract = spawnSync('tar', ['-xf', archive, '-C', destination], { windowsHide: true });
  if (extract.status !== 0) throw new Error('Cannot unpack PostgreSQL artifact');
  // Published platform artifact contains the standard native PostgreSQL distribution.
  const candidates = ['package/native/bin', 'package/bin'];
  for (const candidate of candidates) {
    const bin = resolve(destination, candidate);
    try {
      await access(resolve(bin, 'postgres.exe'));
      const version = spawnSync(resolve(bin, 'postgres.exe'), ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (!version.stdout.includes('18.4')) throw new Error('Unexpected PostgreSQL binary version');
      await writeFile('.local/postgres-artifact.json', JSON.stringify(artifact, null, 2));
      return bin;
    } catch (error) {
      if (error.message === 'Unexpected PostgreSQL binary version') throw error;
    }
  }
  throw new Error('PostgreSQL executable not found in the verified artifact');
}
