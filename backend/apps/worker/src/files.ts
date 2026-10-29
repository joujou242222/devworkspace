import { Queue, Worker } from 'bullmq';
import { TenantDatabase } from '@devworkspace/database';
import { PrivateStorage, processPrivateFile, purgeExpiredStaging } from '@devworkspace/server';
import { workerConnection } from './infrastructure.js';
export async function startFileWorker() {
  if (!process.env.FILE_STORAGE_ACCESS_KEY || !process.env.FILE_STORAGE_SECRET_KEY) return null;
  const dispatcher = new TenantDatabase(process.env.PRODUCT_DISPATCH_URL!, 1);
  const consumer = new TenantDatabase(process.env.PRODUCT_WORKER_URL!, 1);
  const storage = new PrivateStorage(
    process.env.FILE_STORAGE_ACCESS_KEY,
    process.env.FILE_STORAGE_SECRET_KEY,
  );
  const connection = workerConnection();
  const cleanup =
    process.env.CLEANUP_STORAGE_ACCESS_KEY && process.env.CLEANUP_STORAGE_SECRET_KEY
      ? new PrivateStorage(
          process.env.CLEANUP_STORAGE_ACCESS_KEY,
          process.env.CLEANUP_STORAGE_SECRET_KEY,
        )
      : null;
  const queue = new Queue('dw-private-file-processing', { connection });
  const worker = new Worker(
    'dw-private-file-processing',
    async (job) => {
      const { id, lease, scope } = job.data as { id: string; lease: string; scope: string };
      if (
        ![id, lease].every((x) => /^[a-f0-9-]{36}$/.test(x)) ||
        !['project', 'media'].includes(scope)
      )
        throw new Error('Invalid processing reference');
      const load = scope === 'project' ? 'load_file_job' : 'load_media_job';
      const finish = scope === 'project' ? 'finish_file_job' : 'finish_media_job';
      const processing = await consumer.pool.connect();
      try {
        await processing.query(
          "SELECT pg_advisory_lock(hashtext('devworkspace-private-processing'))",
        );
        const { rows } = await processing.query(`SELECT public.${load}($1,$2) AS intent`, [
          id,
          lease,
        ]);
        const record = async (step: string, outcome: string, tool: string) => {
          await processing.query('SELECT public.record_file_step($1,$2,$3,$4,$5,$6)', [
            id,
            lease,
            scope,
            step,
            outcome,
            tool,
          ]);
        };
        const result = await processPrivateFile(storage, rows[0].intent, record);
        await record('RESULT', result.status, 'phase4-processor');
        await processing.query(`SELECT public.${finish}($1,$2,$3,$4)`, [
          id,
          lease,
          result.status,
          result,
        ]);
      } catch {
        await processing.query(`SELECT public.${finish}($1,$2,$3,$4)`, [
          id,
          lease,
          'FAILED',
          { error_code: 'PROCESSING_UNAVAILABLE' },
        ]);
        throw new Error('Private processing unavailable');
      } finally {
        try {
          await processing.query(
            "SELECT pg_advisory_unlock(hashtext('devworkspace-private-processing'))",
          );
        } finally {
          processing.release();
        }
      }
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', () => console.warn(JSON.stringify({ event: 'file.transport.unavailable' })));
  queue.on('error', () => {});
  let busy = false,
    stopping = false;
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const counts = await queue.getJobCounts('wait', 'active', 'delayed');
      if (Object.values(counts).some((count) => count > 0)) return;
      const { rows } = await dispatcher.pool.query(
        "SELECT id,lease,'project' scope FROM public.claim_file_jobs() UNION ALL SELECT id,lease,'media' scope FROM public.claim_media_jobs()",
      );
      for (const row of rows)
        await queue.add('committed-upload', row, {
          jobId: row.id + '-' + row.lease,
          removeOnComplete: true,
          removeOnFail: 100,
        });
      if (cleanup) await purgeExpiredStaging(consumer.pool, cleanup);
    } catch {
      console.warn(JSON.stringify({ event: 'file.outbox.unavailable' }));
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  void tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 25));
    await worker.close();
    await queue.close();
    await dispatcher.close();
    await consumer.close();
  };
}
