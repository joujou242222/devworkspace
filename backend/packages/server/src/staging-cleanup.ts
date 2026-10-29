import type { TenantDatabase } from '@devworkspace/database';
import { PrivateStorage } from './storage.js';

/** Hold the authoritative upload row lock across exact-key deletion and audit commit.
 * A crash after deletion rolls back the tombstone: the next 404 safely completes it. */
export async function purgeExpiredStaging(pool: TenantDatabase['pool'], storage: PrivateStorage) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SET LOCAL lock_timeout='2s'");
    const { rows } = await tx.query('SELECT public.lock_staging_cleanup() AS candidate');
    const candidate = rows[0]?.candidate;
    if (!candidate) {
      await tx.query('COMMIT');
      return false;
    }
    if (
      !['project', 'logo', 'profile'].includes(candidate.scope) ||
      !/^[a-f0-9-]{36}$/.test(candidate.id) ||
      !/^[a-zA-Z0-9/_-]+$/.test(candidate.staging_key)
    )
      throw new Error('Invalid cleanup identity');
    const response = await storage.request('DELETE', 'dw-staging', candidate.staging_key);
    if (![200, 204, 404].includes(response.status)) throw new Error('Staging deletion unavailable');
    await tx.query('SELECT public.finish_staging_cleanup($1,$2)', [candidate.scope, candidate.id]);
    await tx.query('COMMIT');
    return true;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
