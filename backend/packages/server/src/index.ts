import { z } from 'zod';
const common = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.literal('https://localhost:8443').default('https://localhost:8443'),
  BIND_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  EXPERIMENT_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
});
export function loadFoundationConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = common.safeParse(env);
  if (!parsed.success)
    throw new Error(
      'Invalid foundation configuration: ' +
        parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  const value = parsed.data;
  if (
    value.EXPERIMENT_AUTH_ENABLED === 'true' &&
    (!value.DATABASE_URL?.startsWith('postgresql://') || !value.BETTER_AUTH_SECRET)
  )
    throw new Error(
      'Experiment requires PostgreSQL DATABASE_URL and BETTER_AUTH_SECRET (at least 32 characters)',
    );
  if (value.NODE_ENV === 'production' && value.EXPERIMENT_AUTH_ENABLED === 'true')
    throw new Error('The compatibility experiment is forbidden in production');
  return value;
}
export type FoundationConfig = ReturnType<typeof loadFoundationConfig>;
export {
  ProductApplication,
  productConfig,
  type ProductRequest,
  type ProductResponse,
} from './product.js';
export { openMail, sealMail, verifyCsrf, csrfToken, Problem } from './security.js';
export { sendLocalMail } from './smtp.js';
export { PrivateStorage } from './storage.js';
export { purgeExpiredStaging } from './staging-cleanup.js';
export {
  processPrivateFile,
  verifyProcessingTools,
  runSandbox,
  publishObject,
} from './processing.js';
