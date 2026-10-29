import { TenantDatabase } from '../packages/database/dist/index.js';
const db = new TenantDatabase(process.env.PRODUCT_WORKER_URL, 1);
try {
  console.log((await db.pool.query('SELECT * FROM public.delivery_status()')).rows);
} finally {
  await db.close();
}
