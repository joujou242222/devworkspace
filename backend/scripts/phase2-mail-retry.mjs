import { TenantDatabase } from '../packages/database/dist/index.js';
const [lane, event] = process.argv.slice(2);
if (!['identity', 'tenant'].includes(lane) || !/^[a-f0-9-]{36}$/.test(event ?? ''))
  throw new Error('Usage: pnpm phase2:mail-retry identity|tenant <event-uuid>');
const db = new TenantDatabase(process.env.PRODUCT_DISPATCH_URL, 1);
try {
  const { rows } = await db.pool.query('SELECT public.retry_failed($1,$2) AS retried', [
    lane,
    event,
  ]);
  console.log({ retried: rows[0].retried });
} finally {
  await db.close();
}
