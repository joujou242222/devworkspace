import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  classifyUnreferencedObject,
  sanitizeObjectVersion,
} from '../../scripts/phase9-closure-inspect.mjs';
import { copyVerified, fileInventory } from '../../scripts/phase9-recovery-copy.mjs';

test('provenance classification keeps historical and retryable versions unsafe', () => {
  assert.equal(
    classifyUnreferencedObject({
      sameKeyReference: true,
      olderThanPinned: true,
      upload: null,
      job: null,
      steps: [],
      audit: [],
    }),
    'older-unpinned-version-of-database-referenced-key',
  );
  assert.equal(
    classifyUnreferencedObject({
      sameKeyReference: false,
      olderThanPinned: false,
      upload: { status: 'FAILED', attempts: 2 },
      job: { activeLease: false },
      steps: [{ step: 'PUBLISH', outcome: 'VERIFIED' }],
      audit: [],
    }),
    'published-object-with-retryable-failed-finalization',
  );
});

test('no database provenance remains an unresolved candidate, never deletion-safe', () => {
  const classification = classifyUnreferencedObject({
    sameKeyReference: false,
    olderThanPinned: false,
    upload: null,
    job: null,
    steps: [],
    audit: [],
  });
  const sanitized = sanitizeObjectVersion(
    {
      key: 'original/9d3d4cb3-5cc2-4f29-8b63-e11bce88f78c',
      version: 'private-version-token',
      identity: { scope: 'project', kind: 'original' },
      lastModified: '2026-10-19T11:00:00.000Z',
      actualSize: 12,
      latest: true,
    },
    'a'.repeat(64),
  );
  assert.equal(classification, 'no-provenance-in-inspected-application-tables');
  assert.equal(sanitized.size, 12);
  assert.equal(sanitized.contentDigest, 'a'.repeat(16));
  assert(!JSON.stringify(sanitized).includes('private-version-token'));
  assert(!JSON.stringify(sanitized).includes('9d3d4cb3'));
});

test('recovery copy refuses an interrupted destination and a repeated successful destination', async () => {
  const ownedRoot = resolve('.local/phase9');
  const fixture = resolve(ownedRoot, 'copy-fixture-' + randomUUID());
  const source = join(fixture, 'source');
  const partial = join(fixture, 'interrupted-copy');
  const complete = join(fixture, 'complete-copy');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'manifest-synthetic.txt'), 'synthetic recovery fixture');
  const expected = await fileInventory(source);

  try {
    await mkdir(partial);
    await writeFile(join(partial, 'partial.marker'), 'retain interrupted destination');
    await assert.rejects(
      copyVerified(source, partial, expected, 'Synthetic interrupted copy', ownedRoot),
    );
    assert.equal(
      await readFile(join(partial, 'partial.marker'), 'utf8'),
      'retain interrupted destination',
    );
    assert.deepEqual(await fileInventory(partial), [
      {
        path: 'partial.marker',
        bytes: Buffer.byteLength('retain interrupted destination'),
        sha256: expectedHash('retain interrupted destination'),
      },
    ]);

    assert.deepEqual(
      await copyVerified(source, complete, expected, 'Synthetic recovery', ownedRoot),
      expected,
    );
    await assert.rejects(
      copyVerified(source, complete, expected, 'Synthetic repeated recovery', ownedRoot),
    );
    assert.deepEqual(await fileInventory(complete), expected);
  } finally {
    assert.ok(fixture.startsWith(ownedRoot + '\\'));
    await rm(fixture, { recursive: true });
  }
});

function expectedHash(value) {
  return createHash('sha256').update(value).digest('hex');
}
