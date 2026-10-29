import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registeredVolumes } from '../../scripts/native-readiness.mjs';
test('storage HTTP readiness cannot pass before all retained volumes register', () => {
  assert.equal(registeredVolumes({ Topology: { DataCenters: [] } }, ['persist_35.dat']), false);
  const topology = (ids) => ({
    Topology: {
      DataCenters: [{ Racks: [{ DataNodes: [{ Url: '127.0.0.1:8080', VolumeIds: ids }] }] }],
    },
  });
  assert.equal(registeredVolumes(topology('3-4 19-25 31'), ['persist_35.dat']), false);
  assert.equal(registeredVolumes(topology('3-4 19-25 31 35'), ['3.dat', 'persist_35.dat']), true);
  assert.equal(registeredVolumes(topology(''), []), true);
});
