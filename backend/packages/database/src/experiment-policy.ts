import { createHash } from 'node:crypto';
import type { ExperimentDatabase } from './index.js';

/** Server-authoritative policy around Better Auth's existing session row.
 * Prisma's default timestamp columns represent UTC without a timezone. Convert
 * the database clock explicitly; this cluster's timezone is Africa/Cairo.
 */
export async function touchExperimentSession(database: ExperimentDatabase, token: string) {
  const rows = await database.$queryRaw<{ id: string }[]>`
    UPDATE v01_session AS s SET "lastActivityAt" = (statement_timestamp() AT TIME ZONE 'UTC')
    WHERE s.token = ${token}
      AND s."expiresAt" > (statement_timestamp() AT TIME ZONE 'UTC')
      AND s."createdAt" > (statement_timestamp() AT TIME ZONE 'UTC') - interval '8 hours'
      AND s."lastActivityAt" > (statement_timestamp() AT TIME ZONE 'UTC') - interval '30 minutes'
      AND EXISTS (SELECT 1 FROM v01_user AS u WHERE u.id = s."userId" AND u."emailVerified")
    RETURNING s.id`;
  if (rows.length) return true;
  // An expired/revoked cookie never recreates or revives a session.
  await database.session.deleteMany({ where: { token } });
  return false;
}

export function emailProofDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerEmailProof(
  database: ExperimentDatabase,
  token: string,
  userId: string,
) {
  const digest = emailProofDigest(token);
  await database.$executeRaw`
    INSERT INTO v01_email_proof (digest, "userId", "expiresAt")
    VALUES (${digest}, ${userId}, (statement_timestamp() AT TIME ZONE 'UTC') + interval '24 hours')
    ON CONFLICT (digest) DO NOTHING`;
}

export async function consumeEmailProof(database: ExperimentDatabase, token: string) {
  const digest = emailProofDigest(token);
  const rows = await database.$queryRaw<{ digest: string }[]>`
    UPDATE v01_email_proof SET "consumedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
    WHERE digest = ${digest} AND "consumedAt" IS NULL
      AND "expiresAt" > (statement_timestamp() AT TIME ZONE 'UTC')
    RETURNING digest`;
  return rows.length === 1;
}
