import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { parseVersionPage } from './phase9-reconcile.mjs';
import { PrivateStorage } from '../packages/server/dist/storage.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const safeId = (label, value) => `${label}-${digest(value).slice(0, 12)}`;

async function listVersions(storage, bucket) {
  const versions = [];
  let keyMarker;
  let versionMarker;
  for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
    const query = { versions: '', 'max-keys': '1000' };
    if (keyMarker) query['key-marker'] = keyMarker;
    if (versionMarker) query['version-id-marker'] = versionMarker;
    const response = await storage.request('GET', bucket, '', undefined, {}, query);
    if (response.status !== 200) throw new Error('Private version inventory unavailable');
    const page = parseVersionPage(await response.text());
    versions.push(...page.versions);
    if (!page.truncated) return versions;
    if (!page.nextKeyMarker || !page.nextVersionMarker)
      throw new Error('Private version inventory pagination incomplete');
    keyMarker = page.nextKeyMarker;
    versionMarker = page.nextVersionMarker;
  }
  throw new Error('Private version inventory exceeded its page limit');
}

function objectIdentity(key) {
  const parts = key.split('/');
  const scope = ['logo', 'profile'].includes(parts[0]) ? parts[0] : 'project';
  const start = scope === 'project' ? 0 : 1;
  const kind =
    parts[start] === 'original' ? 'original' : parts[start] === 'preview' ? 'preview' : 'other';
  const candidate = kind === 'preview' ? parts[start + 1] : parts[start + 1];
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    candidate ?? '',
  )
    ? candidate.toLowerCase()
    : null;
  return { scope, kind, uuid };
}

export function classifyUnreferencedObject({
  sameKeyReference,
  olderThanPinned,
  upload,
  job,
  steps,
  audit,
}) {
  if (sameKeyReference)
    return olderThanPinned
      ? 'older-unpinned-version-of-database-referenced-key'
      : 'unreferenced-version-of-database-referenced-key';
  if (upload?.status === 'READY') return 'inconsistent-ready-upload-without-asset-reference';
  if (job?.activeLease || ['ISSUED', 'UPLOADED', 'PROCESSING'].includes(upload?.status))
    return 'active-or-pending-upload-or-job';
  const published = steps.some((step) => step.step === 'PUBLISH' && step.outcome === 'VERIFIED');
  if (published && upload?.status === 'FAILED' && Number(upload.attempts) < 5)
    return 'published-object-with-retryable-failed-finalization';
  if (published && upload) return 'published-object-with-unsuccessful-or-unresolved-finalization';
  if (!upload && !job && steps.length === 0 && audit.length === 0)
    return 'no-provenance-in-inspected-application-tables';
  return 'unresolved-application-history';
}

export function sanitizeObjectVersion(entry, contentDigest) {
  return {
    objectId: safeId('OBJ', `${entry.key}\0${entry.version}`),
    keyId: safeId('KEY', entry.key),
    versionId: safeId('VER', entry.version),
    scope: entry.identity.scope,
    objectKind: entry.identity.kind,
    creationTime: entry.lastModified,
    size: entry.actualSize,
    contentDigest: contentDigest.slice(0, 16),
    latestForKey: entry.latest,
  };
}

async function queryRows(client, sql, values = []) {
  return (await client.query(sql, values)).rows;
}

async function readVersion(storage, bucket, entry, maxBytes) {
  const response = await storage.request(
    'GET',
    bucket,
    entry.key,
    undefined,
    {},
    { versionId: entry.version },
  );
  if (response.status !== 200) return { failure: true };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Read-only object inspection size bound exceeded');
  return { failure: false, bytes, digest: digest(bytes) };
}

async function main() {
  process.loadEnvFile('.env.local');
  const port = Number(process.env.PHASE9_PG_PORT ?? 55432);
  if (port !== 55432)
    throw new Error('Closure inspection is limited to the retained source database');
  for (const name of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'])
    if (!process.env[name]) throw new Error(`Private local credential unavailable: ${name}`);

  const pool = new Pool({
    host: '127.0.0.1',
    port,
    database: 'devworkspace_phase2',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: 'devworkspace-phase9-readonly-closure-inspection',
  });
  const storage = new PrivateStorage(process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout='30000'");
    await client.query("SET LOCAL lock_timeout='1500ms'");

    const references = await queryRows(
      client,
      `SELECT canonical_key AS key,storage_version AS version,digest,byte_size AS size,'project' AS scope FROM public.file_asset
       UNION ALL SELECT object_key,storage_version,digest,NULL::bigint,'project' FROM public.file_preview
       UNION ALL SELECT canonical_key,storage_version,digest,byte_size,'logo' FROM public.logo_asset
       UNION ALL SELECT preview_key,preview_version,preview_digest,NULL::bigint,'logo' FROM public.logo_asset
       UNION ALL SELECT canonical_key,storage_version,digest,byte_size,'profile' FROM public.profile_asset
       UNION ALL SELECT preview_key,preview_version,preview_digest,NULL::bigint,'profile' FROM public.profile_asset`,
    );
    const canonicalInventory = await listVersions(storage, 'dw-canonical');
    const referenced = new Map(references.map((row) => [`${row.key}\0${row.version}`, row]));
    const byKey = new Map();
    for (const ref of references) {
      const list = byKey.get(ref.key) ?? [];
      list.push(ref);
      byKey.set(ref.key, list);
    }
    const canonicalOrphans = canonicalInventory.filter(
      (entry) => !referenced.has(`${entry.key}\0${entry.version}`),
    );
    const candidateIds = [
      ...new Set(canonicalOrphans.map((entry) => objectIdentity(entry.key).uuid).filter(Boolean)),
    ];
    const idParam = candidateIds;
    const uploads = await queryRows(
      client,
      `SELECT 'project' AS scope,u.id::text AS id,u.status,u.expires_at,u.created_at,u.updated_at,u.attempts,u.revision,u.expected_size,
              (j.id IS NOT NULL) AS job_exists,(j.lease IS NOT NULL) AS lease_present,j.lease_until,
              (j.lease_until>now()) AS active_lease,(j.started_lease IS NOT NULL) AS started_lease,
              j.attempts AS job_attempts,j.available_at,j.completed_at
         FROM public.project_upload u LEFT JOIN public.file_job j ON j.id=u.id WHERE u.id=ANY($1::uuid[])
       UNION ALL
       SELECT 'logo',u.id::text,u.status,u.expires_at,u.created_at,u.updated_at,u.attempts,u.revision,u.expected_size,
              (j.id IS NOT NULL),(j.lease IS NOT NULL),j.lease_until,(j.lease_until>now()),(j.started_lease IS NOT NULL),j.attempts,j.available_at,j.completed_at
         FROM public.logo_upload u LEFT JOIN public.media_job j ON j.id=u.id WHERE u.id=ANY($1::uuid[]) AND j.scope='logo'
       UNION ALL
       SELECT 'profile',u.id::text,u.status,u.expires_at,u.created_at,u.updated_at,u.attempts,u.revision,u.expected_size,
              (j.id IS NOT NULL),(j.lease IS NOT NULL),j.lease_until,(j.lease_until>now()),(j.started_lease IS NOT NULL),j.attempts,j.available_at,j.completed_at
         FROM public.profile_upload u LEFT JOIN public.media_job j ON j.id=u.id WHERE u.id=ANY($1::uuid[]) AND j.scope='profile'`,
      [idParam],
    );
    const uploadById = new Map(uploads.map((row) => [row.id, row]));
    const orphanKeys = canonicalOrphans.map((entry) => entry.key);
    const assetRows = await queryRows(
      client,
      `SELECT 'project' AS scope,id::text AS id,canonical_key,ready_at FROM public.file_asset
        WHERE id=ANY($1::uuid[]) OR canonical_key=ANY($2::text[])
       UNION ALL
       SELECT 'logo',id::text,canonical_key,ready_at FROM public.logo_asset
        WHERE id=ANY($1::uuid[]) OR canonical_key=ANY($2::text[]) OR preview_key=ANY($2::text[])
       UNION ALL
       SELECT 'profile',id::text,canonical_key,ready_at FROM public.profile_asset
        WHERE id=ANY($1::uuid[]) OR canonical_key=ANY($2::text[]) OR preview_key=ANY($2::text[])`,
      [idParam, orphanKeys],
    );
    const assetById = new Map(assetRows.map((row) => [row.id, row]));
    const previewRows = candidateIds.length
      ? await queryRows(
          client,
          'SELECT asset_id::text AS asset_id FROM public.file_preview WHERE asset_id=ANY($1::uuid[]) OR object_key=ANY($2::text[])',
          [idParam, orphanKeys],
        )
      : [];
    const deliverableRows = candidateIds.length
      ? await queryRows(
          client,
          'SELECT asset_id::text AS asset_id FROM public.deliverable_version WHERE asset_id=ANY($1::uuid[])',
          [idParam],
        )
      : [];
    const projectFileRows = candidateIds.length
      ? await queryRows(
          client,
          'SELECT asset_id::text AS asset_id,status FROM public.project_file WHERE asset_id=ANY($1::uuid[])',
          [idParam],
        )
      : [];
    const countBy = (rows, key) => {
      const result = new Map();
      for (const row of rows) result.set(row[key], (result.get(row[key]) ?? 0) + 1);
      return result;
    };
    const previewCountByAsset = countBy(previewRows, 'asset_id');
    const deliverableCountByAsset = countBy(deliverableRows, 'asset_id');
    const projectFileByAsset = new Map(projectFileRows.map((row) => [row.asset_id, row.status]));
    const steps = candidateIds.length
      ? await queryRows(
          client,
          `SELECT COALESCE(project_job,media_job)::text AS job_id,step,outcome,tool_identity,recorded_at
             FROM public.file_processing_step WHERE project_job=ANY($1::uuid[]) OR media_job=ANY($1::uuid[])
            ORDER BY recorded_at`,
          [idParam],
        )
      : [];
    const stepById = new Map();
    for (const row of steps) {
      const list = stepById.get(row.job_id) ?? [];
      list.push(row);
      stepById.set(row.job_id, list);
    }
    const audit = candidateIds.length
      ? await queryRows(
          client,
          `SELECT target_id AS job_id,action,metadata->>'outcome' AS outcome,created_at FROM public.audit_event WHERE target_id=ANY($1::text[])
           UNION ALL SELECT target_id,'tenant:'||kind,NULL,created_at FROM public.tenant_event WHERE target_id=ANY($1::text[])
           UNION ALL SELECT target_id,'identity:'||kind,NULL,created_at FROM public.identity_event WHERE target_id=ANY($1::text[])
           ORDER BY created_at`,
          [candidateIds],
        )
      : [];
    const auditById = new Map();
    for (const row of audit) {
      const list = auditById.get(row.job_id) ?? [];
      list.push(row);
      auditById.set(row.job_id, list);
    }

    const selectedObjects = [];
    let totalRead = 0;
    let readFailures = 0;
    const contentDigests = new Map();
    for (const entry of canonicalOrphans) {
      const read = await readVersion(storage, 'dw-canonical', entry, 10 * 1024 * 1024 - totalRead);
      if (read.failure) {
        readFailures++;
        continue;
      }
      totalRead += read.bytes.length;
      contentDigests.set(`${entry.key}\0${entry.version}`, read.digest);
      const identity = objectIdentity(entry.key);
      const sameKeyRefs = byKey.get(entry.key) ?? [];
      const pinnedVersions = canonicalInventory.filter((candidate) =>
        sameKeyRefs.some((ref) => ref.version === candidate.version && ref.key === candidate.key),
      );
      const pinnedTimestamps = pinnedVersions
        .map((candidate) => Date.parse(candidate.lastModified ?? ''))
        .filter(Number.isFinite);
      const upload = identity.uuid ? (uploadById.get(identity.uuid) ?? null) : null;
      const job = upload?.job_exists
        ? {
            exists: true,
            leasePresent: upload.lease_present,
            leaseUntil: upload.lease_until,
            activeLease: upload.active_lease,
            startedLease: upload.started_lease,
            attempts: upload.job_attempts,
            availableAt: upload.available_at,
            completedAt: upload.completed_at,
          }
        : null;
      const objectSteps = identity.uuid ? (stepById.get(identity.uuid) ?? []) : [];
      const objectAudit = identity.uuid ? (auditById.get(identity.uuid) ?? []) : [];
      const olderThanPinned =
        pinnedVersions.length > 0 &&
        pinnedVersions.every(
          (pinned) =>
            pinned.lastModified &&
            entry.lastModified &&
            Date.parse(entry.lastModified) < Date.parse(pinned.lastModified),
        );
      const newerThanPinned =
        pinnedVersions.length > 0 &&
        pinnedTimestamps.length === pinnedVersions.length &&
        entry.lastModified &&
        pinnedTimestamps.every((timestamp) => Date.parse(entry.lastModified) > timestamp);
      const classification = classifyUnreferencedObject({
        sameKeyReference: sameKeyRefs.length > 0,
        olderThanPinned,
        upload,
        job,
        steps: objectSteps,
        audit: objectAudit,
      });
      selectedObjects.push({
        ...sanitizeObjectVersion(
          { ...entry, identity, actualSize: read.bytes.length },
          read.digest,
        ),
        sameKeyHasDatabaseReference: sameKeyRefs.length > 0,
        olderThanPinnedDatabaseVersion: olderThanPinned,
        newerThanPinnedDatabaseVersion: Boolean(newerThanPinned),
        sameBytesAsDatabasePinnedVersion: sameKeyRefs.some((ref) => ref.digest === read.digest),
        sameKeyReferenceSources: [...new Set(sameKeyRefs.map((row) => row.scope))],
        candidateEntityId: identity.uuid ? safeId('ID', identity.uuid) : null,
        uploadRecordFound: Boolean(upload),
        asset:
          identity.uuid && assetById.has(identity.uuid)
            ? {
                scope: assetById.get(identity.uuid).scope,
                readyAt: assetById.get(identity.uuid).ready_at,
                projectFileStatus: projectFileByAsset.get(identity.uuid) ?? null,
                previewRows: previewCountByAsset.get(identity.uuid) ?? 0,
                deliverableVersions: deliverableCountByAsset.get(identity.uuid) ?? 0,
              }
            : null,
        upload: upload
          ? {
              scope: upload.scope,
              status: upload.status,
              createdAt: upload.created_at,
              updatedAt: upload.updated_at,
              expiresAt: upload.expires_at,
              expired: Date.parse(upload.expires_at) <= Date.now(),
              attempts: upload.attempts,
              revision: upload.revision,
              expectedSizeMatches: Number(upload.expected_size) === read.bytes.length,
            }
          : null,
        job,
        processingSteps: objectSteps.map((row) => ({
          step: row.step,
          outcome: row.outcome,
          at: row.recorded_at,
          toolId: safeId('TOOL', row.tool_identity),
        })),
        history: objectAudit.map((row) => ({
          action: row.action,
          outcome: row.outcome,
          at: row.created_at,
        })),
        classification,
        deletionSafe: false,
      });
    }

    const activeIntents = await queryRows(
      client,
      `SELECT 'project' AS scope,u.id::text AS id,u.staging_key,u.status,u.created_at,u.updated_at,u.expires_at,u.attempts,u.revision,u.expected_size,u.expected_digest,
              (j.id IS NOT NULL) AS job_exists,(j.lease IS NOT NULL) AS lease_present,j.lease_until,(j.lease_until>now()) AS active_lease,
              (j.started_lease IS NOT NULL) AS started_lease,j.attempts AS job_attempts,j.available_at,j.completed_at
         FROM public.project_upload u LEFT JOIN public.file_job j ON j.id=u.id WHERE u.status IN ('ISSUED','UPLOADED','PROCESSING')
       UNION ALL
       SELECT 'logo',u.id::text,u.staging_key,u.status,u.created_at,u.updated_at,u.expires_at,u.attempts,u.revision,u.expected_size,u.expected_digest,
              (j.id IS NOT NULL),(j.lease IS NOT NULL),j.lease_until,(j.lease_until>now()),(j.started_lease IS NOT NULL),j.attempts,j.available_at,j.completed_at
         FROM public.logo_upload u LEFT JOIN public.media_job j ON j.id=u.id AND j.scope='logo' WHERE u.status IN ('ISSUED','UPLOADED','PROCESSING')
       UNION ALL
       SELECT 'profile',u.id::text,u.staging_key,u.status,u.created_at,u.updated_at,u.expires_at,u.attempts,u.revision,u.expected_size,u.expected_digest,
              (j.id IS NOT NULL),(j.lease IS NOT NULL),j.lease_until,(j.lease_until>now()),(j.started_lease IS NOT NULL),j.attempts,j.available_at,j.completed_at
         FROM public.profile_upload u LEFT JOIN public.media_job j ON j.id=u.id AND j.scope='profile' WHERE u.status IN ('ISSUED','UPLOADED','PROCESSING')`,
    );
    const activeIntentIds = activeIntents.map((row) => row.id);
    const stagingStepRows = activeIntentIds.length
      ? await queryRows(
          client,
          `SELECT COALESCE(project_job,media_job)::text AS job_id,step,outcome,tool_identity,recorded_at
             FROM public.file_processing_step WHERE project_job=ANY($1::uuid[]) OR media_job=ANY($1::uuid[])
            ORDER BY recorded_at`,
          [activeIntentIds],
        )
      : [];
    const stagingStepsById = new Map();
    for (const row of stagingStepRows) {
      const list = stagingStepsById.get(row.job_id) ?? [];
      list.push(row);
      stagingStepsById.set(row.job_id, list);
    }
    const stagingCleanupRows = activeIntentIds.length
      ? await queryRows(
          client,
          'SELECT upload_id::text AS id,deleted_at FROM public.staging_cleanup WHERE upload_id=ANY($1::uuid[])',
          [activeIntentIds],
        )
      : [];
    const stagingCleanupById = new Map(stagingCleanupRows.map((row) => [row.id, row]));
    const stagingHistory = activeIntentIds.length
      ? await queryRows(
          client,
          `SELECT target_id AS job_id,action,metadata->>'outcome' AS outcome,created_at FROM public.audit_event WHERE target_id=ANY($1::text[])
           UNION ALL SELECT target_id,'tenant:'||kind,NULL,created_at FROM public.tenant_event WHERE target_id=ANY($1::text[])
           UNION ALL SELECT target_id,'identity:'||kind,NULL,created_at FROM public.identity_event WHERE target_id=ANY($1::text[])
           ORDER BY created_at`,
          [activeIntentIds],
        )
      : [];
    const stagingHistoryById = new Map();
    for (const row of stagingHistory) {
      const list = stagingHistoryById.get(row.job_id) ?? [];
      list.push(row);
      stagingHistoryById.set(row.job_id, list);
    }
    const stagingInventory = await listVersions(storage, 'dw-staging');
    const latestStaging = stagingInventory.filter((entry) => entry.latest);
    const staging = [];
    for (const intent of activeIntents) {
      const objects = latestStaging.filter((entry) => entry.key === intent.staging_key);
      const latest = objects[0] ?? null;
      let observed = null;
      if (latest) {
        const read = await readVersion(storage, 'dw-staging', latest, 25 * 1024 * 1024);
        observed = read.failure
          ? { present: true, readable: false }
          : {
              present: true,
              readable: true,
              versionId: safeId('VER', latest.version),
              createdAt: latest.lastModified,
              size: read.bytes.length,
              expectedSizeMatches: Number(intent.expected_size) === read.bytes.length,
              digestMatches: intent.expected_digest === read.digest,
              contentDigest: read.digest.slice(0, 16),
            };
      }
      const intentSteps = stagingStepsById.get(intent.id) ?? [];
      staging.push({
        intentId: safeId('DB', intent.id),
        stagingKeyId: safeId('STG', intent.staging_key),
        scope: intent.scope,
        status: intent.status,
        createdAt: intent.created_at,
        updatedAt: intent.updated_at,
        expiresAt: intent.expires_at,
        expired: Date.parse(intent.expires_at) <= Date.now(),
        attempts: intent.attempts,
        revision: intent.revision,
        job: intent.job_exists
          ? {
              exists: true,
              leasePresent: intent.lease_present,
              leaseUntil: intent.lease_until,
              activeLease: intent.active_lease,
              startedLease: intent.started_lease,
              attempts: intent.job_attempts,
              availableAt: intent.available_at,
              completedAt: intent.completed_at,
            }
          : null,
        latestStagingObject: observed ?? { present: false },
        latestProcessingOperations: intentSteps.slice(-8).map((row) => ({
          step: row.step,
          outcome: row.outcome,
          at: row.recorded_at,
          toolId: safeId('TOOL', row.tool_identity),
        })),
        recentHistory: (stagingHistoryById.get(intent.id) ?? []).slice(-8).map((row) => ({
          action: row.action,
          outcome: row.outcome,
          at: row.created_at,
        })),
        cleanupRecord: stagingCleanupById.has(intent.id)
          ? { recordedAt: stagingCleanupById.get(intent.id).deleted_at }
          : null,
        deletionSafe: false,
      });
    }

    await client.query('COMMIT');
    const report = {
      inspectedAt: new Date().toISOString(),
      databasePort: port,
      canonicalInventory: canonicalInventory.length,
      exactDatabaseReferences: references.length,
      unreferencedVersions: canonicalOrphans.length,
      unreferencedKeys: new Set(
        canonicalOrphans.filter((entry) => !byKey.get(entry.key)?.length).map((entry) => entry.key),
      ).size,
      activeDatabaseIntentCount: activeIntents.length,
      activeIntentWithStagingObjectCount: staging.filter(
        (intent) => intent.latestStagingObject.present,
      ).length,
      stagingVersions: stagingInventory.length,
      stagingKeys: new Set(stagingInventory.map((entry) => entry.key)).size,
      unreferencedReadFailures: readFailures,
      unreferencedBytesRead: totalRead,
      classificationCounts: Object.fromEntries(
        [...new Set(selectedObjects.map((row) => row.classification))].map((name) => [
          name,
          selectedObjects.filter((row) => row.classification === name).length,
        ]),
      ),
      objects: selectedObjects,
      activeStagingIntents: staging,
    };
    await mkdir('.local/phase9', { recursive: true });
    await writeFile(
      resolve('.local/phase9/closure-provenance.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'phase9.closure-inspection.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : null,
      }),
    );
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    throw new Error('Read-only Phase 9 provenance inspection failed; details suppressed');
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/phase9-closure-inspect.mjs'))
  await main();
