import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(
  process.versions.node,
  manifest.engines.node,
  'Use the project-pinned Node.js version',
);
if (process.env.npm_config_user_agent)
  assert.ok(process.env.npm_config_user_agent.startsWith('pnpm/10.18.1 '), 'Use pnpm 10.18.1');
console.log('Runtime pins verified: Node ' + process.versions.node + ', pnpm 10.18.1');
