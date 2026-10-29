import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import YAML from 'yaml';
const config = YAML.parse(await readFile('infra/compose.yaml', 'utf8'));
assert.equal(config.networks.foundation.internal, true);
for (const [name, service] of Object.entries(config.services)) {
  if (name !== 'proxy')
    assert.equal(service.ports, undefined, 'Private service published: ' + name);
  else assert.deepEqual(service.ports, ['127.0.0.1:8443:8443']);
  if (service.image) assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
}
console.log(
  'Compose YAML parsed: private services, internal network, loopback-only proxy and image digests verified statically; Docker runtime NOT verified',
);
