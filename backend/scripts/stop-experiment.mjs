import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const owner = JSON.parse(await readFile('.local/pg-owner.json', 'utf8'));
if (owner.root !== process.cwd() || owner.data !== resolve('.local/pg'))
  throw new Error('Refusing to stop an unowned cluster');
const result = spawnSync(
  resolve(owner.bin, 'pg_ctl.exe'),
  ['stop', '-D', owner.data, '-m', 'fast', '-w'],
  { stdio: 'inherit', windowsHide: true },
);
process.exitCode = result.status ?? 1;
