import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated-product/client.js';
import { Pool, type PoolClient } from 'pg';
export function createIdentityDatabase(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 6, options: '-c timezone=UTC' }),
  });
}
export function createTenantPrisma(url: string, max = 6): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max, options: '-c timezone=UTC' }),
  });
}
export type IdentityDatabase = PrismaClient;
export type SqlTransaction = Pick<PoolClient, 'query'>;
export class TenantDatabase {
  readonly pool: Pool;
  constructor(url: string, max = 6) {
    this.pool = new Pool({ connectionString: url, max, options: '-c timezone=UTC' });
    this.pool.on('error', (error: NodeJS.ErrnoException) => {
      const code =
        typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
          ? error.code
          : 'CONNECTION_FAILURE';
      console.warn(JSON.stringify({ event: 'database.pool.client_error', code }));
    });
  }
  async transaction<T>(
    organizationId: string,
    work: (tx: SqlTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
