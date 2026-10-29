import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrivateStorage } from '../packages/server/dist/storage.js';

const decodeXml = (value) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));

const tag = (xml, name) => {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = xml.indexOf(open);
  if (start < 0) return '';
  const valueStart = start + open.length;
  const end = xml.indexOf(close, valueStart);
  return end < 0 ? '' : decodeXml(xml.slice(valueStart, end));
};

const blocks = (xml, name) =>
  xml
    .split(`<${name}>`)
    .slice(1)
    .map((part) => part.split(`</${name}>`, 1)[0]);

export function parseVersionPage(xml) {
  const versions = blocks(xml, 'Version').map((block) => ({
    key: tag(block, 'Key'),
    version: tag(block, 'VersionId'),
    size: Number(tag(block, 'Size')),
    latest: tag(block, 'IsLatest') === 'true',
    lastModified: tag(block, 'LastModified') || null,
  }));
  const deleteMarkers = blocks(xml, 'DeleteMarker').map((block) => ({
    key: tag(block, 'Key'),
    version: tag(block, 'VersionId'),
  }));
  if (
    versions.some(
      (entry) =>
        !entry.key || !entry.version || !Number.isSafeInteger(entry.size) || entry.size < 0,
    ) ||
    deleteMarkers.some((entry) => !entry.key || !entry.version)
  )
    throw new Error('S3 returned an incomplete version listing');
  return {
    versions,
    deleteMarkers,
    truncated: tag(xml, 'IsTruncated') === 'true',
    nextKeyMarker: tag(xml, 'NextKeyMarker'),
    nextVersionMarker: tag(xml, 'NextVersionIdMarker'),
  };
}

export function compareObjectInventory(references, objects) {
  const observed = new Map(objects.map((entry) => [`${entry.key}\0${entry.version}`, entry]));
  const unique = new Map();
  const conflictingReferences = [];
  for (const reference of references) {
    const identity = `${reference.key}\0${reference.version}`;
    const existing = unique.get(identity);
    if (
      existing &&
      (existing.digest !== reference.digest ||
        (existing.size !== null &&
          reference.size !== null &&
          Number(existing.size) !== Number(reference.size)))
    )
      conflictingReferences.push(identity);
    else unique.set(identity, reference);
  }
  const missing = [];
  const mismatched = [];
  for (const [identity, expected] of unique) {
    const actual = observed.get(identity);
    if (!actual) {
      missing.push(identity);
      continue;
    }
    if (
      actual.digest !== expected.digest ||
      (expected.size !== null && Number(actual.size) !== Number(expected.size))
    )
      mismatched.push(identity);
  }
  const pinnedKeys = new Set([...unique.values()].map((entry) => entry.key));
  const unreferencedVersions = objects.filter(
    (entry) => !unique.has(`${entry.key}\0${entry.version}`),
  );
  const unreferencedKeys = new Set(
    unreferencedVersions.filter((entry) => !pinnedKeys.has(entry.key)).map((entry) => entry.key),
  );
  return {
    references: unique.size,
    matched: unique.size - missing.length - mismatched.length,
    missing: missing.length,
    mismatched: mismatched.length,
    conflictingReferences: conflictingReferences.length,
    unreferencedVersions: unreferencedVersions.length,
    unreferencedKeys: unreferencedKeys.size,
    unreferencedKeySamples: [...unreferencedKeys]
      .slice(0, 20)
      .map((key) => createHash('sha256').update(key).digest('hex').slice(0, 16)),
  };
}

async function listAllVersions(storage, bucket) {
  const versions = [];
  const deleteMarkers = [];
  let keyMarker;
  let versionMarker;
  for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
    const parameters = { versions: '', 'max-keys': '1000' };
    if (keyMarker) parameters['key-marker'] = keyMarker;
    if (versionMarker) parameters['version-id-marker'] = versionMarker;
    const response = await storage.request('GET', bucket, '', undefined, {}, parameters);
    if (response.status !== 200)
      throw new Error(`Cannot list private ${bucket} storage versions (HTTP ${response.status})`);
    const page = parseVersionPage(await response.text());
    versions.push(...page.versions);
    deleteMarkers.push(...page.deleteMarkers);
    if (!page.truncated) return { versions, deleteMarkers };
    if (!page.nextKeyMarker || !page.nextVersionMarker)
      throw new Error(`Incomplete pagination markers for private ${bucket} storage`);
    keyMarker = page.nextKeyMarker;
    versionMarker = page.nextVersionMarker;
  }
  throw new Error(`Private ${bucket} version listing exceeded its bounded page count`);
}

async function readVersions(storage, bucket, listed) {
  const read = [];
  let bytes = 0;
  let failures = 0;
  for (const entry of listed.versions) {
    const response = await storage.request(
      'GET',
      bucket,
      entry.key,
      undefined,
      {},
      {
        versionId: entry.version,
      },
    );
    if (response.status !== 200) {
      failures++;
      continue;
    }
    const body = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(body).digest('hex');
    bytes += body.length;
    read.push({ ...entry, digest, actualSize: body.length });
  }
  return { objects: read, bytes, failures };
}

const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function main() {
  process.loadEnvFile('.env.local');
  const pgPort = Number(process.env.PHASE9_PG_PORT ?? 55432);
  if (![55432, 55433].includes(pgPort))
    throw new Error(
      'Phase 9 inspection is limited to the owned or isolated restore PostgreSQL port',
    );
  for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'])
    if (!process.env[key])
      throw new Error(`Required private local credential is unavailable: ${key}`);

  const pool = new Pool({
    host: '127.0.0.1',
    port: pgPort,
    database: 'devworkspace_phase2',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: 'devworkspace-phase9-readonly-reconcile',
  });
  const storage = new PrivateStorage(process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout='30000'");
    const references = (
      await client.query(`
        SELECT canonical_key AS key,storage_version AS version,digest,byte_size AS size,'file' AS kind
          FROM public.file_asset
        UNION ALL
        SELECT object_key,storage_version,digest,NULL::bigint,'preview'
          FROM public.file_preview
        UNION ALL
        SELECT canonical_key,storage_version,digest,byte_size,'logo'
          FROM public.logo_asset
        UNION ALL
        SELECT preview_key,preview_version,preview_digest,NULL::bigint,'logo-preview'
          FROM public.logo_asset
        UNION ALL
        SELECT canonical_key,storage_version,digest,byte_size,'profile'
          FROM public.profile_asset
        UNION ALL
        SELECT preview_key,preview_version,preview_digest,NULL::bigint,'profile-preview'
          FROM public.profile_asset
      `)
    ).rows;
    const stagingReferences = (
      await client.query(`
        SELECT staging_key AS key,status,expires_at FROM public.project_upload
        UNION ALL
        SELECT staging_key,status,expires_at FROM public.logo_upload
        UNION ALL
        SELECT staging_key,status,expires_at FROM public.profile_upload
      `)
    ).rows;
    const cleanupKeys = new Set(
      (await client.query('SELECT staging_key AS key FROM public.staging_cleanup')).rows.map(
        (row) => row.key,
      ),
    );
    const [canonicalListed, stagingListed] = await Promise.all([
      listAllVersions(storage, 'dw-canonical'),
      listAllVersions(storage, 'dw-staging'),
    ]);
    const [canonicalRead, stagingRead] = await Promise.all([
      readVersions(storage, 'dw-canonical', canonicalListed),
      readVersions(storage, 'dw-staging', stagingListed),
    ]);
    const canonical = compareObjectInventory(references, canonicalRead.objects);
    const latestStaging = stagingRead.objects.filter((entry) => entry.latest);
    const stagingByKey = new Map(stagingReferences.map((entry) => [entry.key, entry]));
    const unknownStaging = latestStaging.filter((entry) => !stagingByKey.has(entry.key));
    const cleanedStagingPresent = latestStaging.filter((entry) => cleanupKeys.has(entry.key));
    const staging = {
      versions: stagingListed.versions.length,
      deleteMarkers: stagingListed.deleteMarkers.length,
      keys: new Set(stagingListed.versions.map((entry) => entry.key)).size,
      bytesListed: stagingListed.versions.reduce((sum, entry) => sum + entry.size, 0),
      bytesRead: stagingRead.bytes,
      readFailures: stagingRead.failures,
      unknownKeys: unknownStaging.length,
      cleanupTombstonesStillPresent: cleanedStagingPresent.length,
      pendingOrExpiredIntents: latestStaging.filter((entry) => {
        const row = stagingByKey.get(entry.key);
        return (
          row &&
          (row.status === 'ISSUED' || row.status === 'UPLOADED' || row.status === 'PROCESSING')
        );
      }).length,
      unknownKeySamples: unknownStaging.slice(0, 20).map((entry) => fingerprint(entry.key)),
    };
    const dbCounts = (
      await client.query(`
        SELECT
          (SELECT count(*)::int FROM public.file_asset) AS assets,
          (SELECT count(*)::int FROM public.file_preview) AS previews,
          (SELECT count(*)::int FROM public.deliverable_version) AS deliverable_versions,
          (SELECT count(*)::int FROM public.review_cycle) AS review_cycles,
          (SELECT count(*)::int FROM public.review_decision) AS review_decisions,
          (SELECT count(*)::int FROM public.feedback_thread) AS feedback_threads,
          (SELECT count(*)::int FROM public.audit_event) AS audit_events,
          (SELECT count(*)::int FROM public.tenant_event) AS outbox_events,
          (SELECT count(*)::int FROM public.notification) AS notifications,
          (SELECT count(*)::int FROM migration_meta.phase2_migration) AS applied_migrations,
          (SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) AS unvalidated_constraints
      `)
    ).rows[0];
    await client.query('COMMIT');
    const results = {
      status:
        canonical.missing ||
        canonical.mismatched ||
        canonical.conflictingReferences ||
        canonicalRead.failures ||
        stagingRead.failures
          ? 'FAIL'
          : unknownStaging.length || cleanedStagingPresent.length || canonical.unreferencedVersions
            ? 'REVIEW'
            : 'PASS',
      inspectedAt: new Date().toISOString(),
      databasePort: pgPort,
      database: dbCounts,
      canonical: {
        versions: canonicalListed.versions.length,
        deleteMarkers: canonicalListed.deleteMarkers.length,
        keys: new Set(canonicalListed.versions.map((entry) => entry.key)).size,
        bytesListed: canonicalListed.versions.reduce((sum, entry) => sum + entry.size, 0),
        bytesRead: canonicalRead.bytes,
        readFailures: canonicalRead.failures,
        ...canonical,
      },
      staging,
    };
    await mkdir('.local/phase9', { recursive: true });
    await writeFile(
      resolve('.local/phase9', `reconcile-${pgPort}.json`),
      JSON.stringify(results, null, 2) + '\n',
      { mode: 0o600 },
    );
    console.log(JSON.stringify(results));
    if (results.status === 'FAIL') process.exitCode = 2;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    throw new Error(`Read-only private-storage reconciliation failed: ${error.message}`);
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/phase9-reconcile.mjs'))
  await main();
