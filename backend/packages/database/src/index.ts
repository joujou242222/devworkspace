import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';
/** Isolated V01 storage only. No production domain schema is implemented. */
export function createExperimentDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
export type ExperimentDatabase = ReturnType<typeof createExperimentDatabase>;
export {
  createIdentityDatabase,
  createTenantPrisma,
  TenantDatabase,
  type IdentityDatabase,
  type SqlTransaction,
} from './product.js';
export {
  touchExperimentSession,
  registerEmailProof,
  consumeEmailProof,
} from './experiment-policy.js';
