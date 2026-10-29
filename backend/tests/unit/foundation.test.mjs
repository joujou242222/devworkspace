import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFoundationConfig } from '../../packages/server/dist/index.js';
import { violationsFor } from '../../scripts/check-boundaries.mjs';
test('experiment cannot start without its database/secret or in production', () => {
  assert.throws(() => loadFoundationConfig({ EXPERIMENT_AUTH_ENABLED: 'true' }));
  assert.throws(() =>
    loadFoundationConfig({
      NODE_ENV: 'production',
      EXPERIMENT_AUTH_ENABLED: 'true',
      DATABASE_URL: 'postgresql://a:b@localhost/x',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }),
  );
});
test('web cannot import server/database through static, reexport, dynamic, require or relative escape', () => {
  for (const text of [
    "import x from '@devworkspace/database'",
    "export * from '@devworkspace/server'",
    "import('@devworkspace/server')",
    "require('@devworkspace/database')",
    "import x from '../../api/src/app.js'",
  ]) {
    assert.ok(violationsFor('web', 'apps/web/app/test.ts', text).length, text);
  }
});
test('contracts are browser-safe and dynamic import bypass is rejected', () => {
  assert.ok(
    violationsFor('contracts', 'packages/contracts/src/test.ts', "import('@devworkspace/server')")
      .length,
  );
  assert.ok(violationsFor('web', 'apps/web/app/test.ts', 'import(userInput)').length);
  assert.equal(
    violationsFor(
      'web',
      'apps/web/app/test.ts',
      "import type { FoundationHealth } from '@devworkspace/contracts'",
    ).length,
    0,
  );
});
