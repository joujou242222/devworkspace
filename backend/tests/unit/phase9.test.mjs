import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareObjectInventory, parseVersionPage } from '../../scripts/phase9-reconcile.mjs';

test('private S3 version inventory parses exact identities and paginates safely', () => {
  const page = parseVersionPage(`
    <ListVersionsResult>
      <Version><Key>asset-a</Key><VersionId>v1</VersionId><IsLatest>false</IsLatest><LastModified>2026-10-19T11:00:00.000Z</LastModified><Size>12</Size></Version>
      <DeleteMarker><Key>asset-b</Key><VersionId>v0</VersionId></DeleteMarker>
      <IsTruncated>true</IsTruncated><NextKeyMarker>asset-a</NextKeyMarker><NextVersionIdMarker>v1</NextVersionIdMarker>
    </ListVersionsResult>`);
  assert.deepEqual(page.versions, [
    {
      key: 'asset-a',
      version: 'v1',
      size: 12,
      latest: false,
      lastModified: '2026-10-19T11:00:00.000Z',
    },
  ]);
  assert.deepEqual(page.deleteMarkers, [{ key: 'asset-b', version: 'v0' }]);
  assert.equal(page.truncated, true);
  assert.equal(page.nextKeyMarker, 'asset-a');
  assert.equal(page.nextVersionMarker, 'v1');
  assert.throws(() =>
    parseVersionPage('<ListVersionsResult><Version><Key>x</Key></Version></ListVersionsResult>'),
  );
});

test('canonical reconciliation matches pinned key plus version and detects missing or changed bytes', () => {
  const references = [
    { key: 'asset-a', version: 'v2', digest: 'sha256-a', size: 10 },
    { key: 'asset-a', version: 'v2', digest: 'sha256-a', size: 10 },
    { key: 'asset-b', version: 'v4', digest: 'sha256-b', size: null },
  ];
  const actual = [
    { key: 'asset-a', version: 'v1', digest: 'sha256-old', size: 9 },
    { key: 'asset-a', version: 'v2', digest: 'sha256-a', size: 10 },
    { key: 'orphan-c', version: 'v1', digest: 'sha256-c', size: 1 },
  ];
  const comparison = compareObjectInventory(references, actual);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(comparison).filter(([key]) => key !== 'unreferencedKeySamples'),
    ),
    {
      references: 2,
      matched: 1,
      missing: 1,
      mismatched: 0,
      conflictingReferences: 0,
      unreferencedVersions: 2,
      unreferencedKeys: 1,
    },
  );
  assert.equal(comparison.unreferencedKeySamples.length, 1);
  assert.match(comparison.unreferencedKeySamples[0], /^[a-f0-9]{16}$/);
  assert.equal(
    compareObjectInventory(
      [{ key: 'asset-a', version: 'v2', digest: 'wrong', size: 10 }],
      [actual[1]],
    ).mismatched,
    1,
  );
  assert.equal(
    compareObjectInventory(
      [
        { key: 'asset-a', version: 'v2', digest: 'sha256-a', size: 10 },
        { key: 'asset-a', version: 'v2', digest: 'sha256-other', size: 10 },
      ],
      [actual[1]],
    ).conflictingReferences,
    1,
  );
});
