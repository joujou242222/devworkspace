import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const state = JSON.parse(await readFile('.local/processes.json', 'utf8'));
if (state.root !== resolve('.') || !Number.isSafeInteger(state.parent))
  throw new Error('Unowned process record');
const expected = {
  api: 'apps/api/dist/main.js',
  worker: 'apps/worker/dist/main.js',
  web: 'next/dist/bin/next',
  proxy: 'scripts/proxy.mjs',
};
if (process.platform === 'win32') {
  const records = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
  const processes = Array.isArray(records) ? records : [records];
  const parent = processes.find((item) => item.ProcessId === state.parent);
  if (parent && !parent.CommandLine.includes('scripts/dev.mjs'))
    throw new Error('Parent PID was reused');
  for (const child of state.children) {
    if (!expected[child.name] || !Number.isSafeInteger(child.pid))
      throw new Error('Invalid child record');
    const current = processes.find((item) => item.ProcessId === child.pid);
    if (
      current &&
      (current.ParentProcessId !== state.parent ||
        !current.CommandLine.replaceAll('\\', '/').includes(expected[child.name]))
    )
      throw new Error('Child PID was reused: refusing to stop');
  }
  if (parent) process.kill(state.parent);
  for (const child of state.children)
    try {
      process.kill(child.pid);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
} else {
  process.kill(state.parent, 'SIGTERM');
}
console.log(
  'Stopped only the recorded, ownership-checked foundation processes; PostgreSQL remains separately managed.',
);
