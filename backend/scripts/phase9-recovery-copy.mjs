import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function assertOwnedChild(path, ownedRoot = '.local/phase9') {
  const root = resolve(ownedRoot);
  const full = resolve(path);
  const rel = relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new Error('Recovery path must be a child of the owned recovery directory');
  return full;
}

export async function fileInventory(base) {
  const rootPath = resolve(base);
  const entries = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Refusing a symlink in a recovery data directory');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of createReadStream(path)) {
          hash.update(chunk);
          bytes += chunk.length;
        }
        entries.push({
          path: relative(rootPath, path).split(sep).join('/'),
          bytes,
          sha256: hash.digest('hex'),
        });
      } else throw new Error('Unexpected filesystem entry in a recovery data directory');
    }
  };
  await visit(rootPath);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function copyVerified(
  source,
  destination,
  expected,
  label,
  ownedRoot = '.local/phase9',
) {
  const target = assertOwnedChild(destination, ownedRoot);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  const copied = await fileInventory(target);
  if (JSON.stringify(expected) !== JSON.stringify(copied))
    throw new Error(`${label} checksum or file inventory did not match`);
  return copied;
}
