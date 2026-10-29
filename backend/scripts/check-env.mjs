import assert from 'node:assert/strict';
import { loadFoundationConfig } from '../packages/server/dist/index.js';
const defaults = loadFoundationConfig({});
assert.equal(defaults.EXPERIMENT_AUTH_ENABLED, 'false');
assert.throws(() => loadFoundationConfig({ APP_ORIGIN: 'http://example.com' }));
assert.throws(() =>
  loadFoundationConfig({ EXPERIMENT_AUTH_ENABLED: 'true', BETTER_AUTH_SECRET: 'short' }),
);
if (process.env.NODE_ENV) loadFoundationConfig();
console.log('Environment defaults and invalid configuration rejection verified');
