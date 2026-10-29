import { Queue, Worker } from 'bullmq';
import { TenantDatabase } from '@devworkspace/database';
import { openMail, sendLocalMail } from '@devworkspace/server';
import { workerConnection } from './infrastructure.js';
import { Redis } from 'ioredis';
export async function startMailWorker(queueName = 'dw-phase2-events') {
  if (!/^dw-phase2-events(?:-test-[a-f0-9-]{36})?$/.test(queueName))
    throw new Error('Invalid event queue name');
  if (
    process.env.POSTGRES_PASSWORD ||
    process.env.POSTGRES_USER ||
    process.env.DATABASE_URL ||
    process.env.PRODUCT_IDENTITY_URL ||
    process.env.PRODUCT_API_URL
  )
    throw new Error('Product worker must not inherit migration or API credentials');
  if (
    !process.env.PRODUCT_DISPATCH_URL ||
    !process.env.PRODUCT_WORKER_URL ||
    !process.env.PRODUCT_MAIL_KEY
  )
    throw new Error('Missing restricted worker configuration');
  for (const [value, role] of [
    [process.env.PRODUCT_DISPATCH_URL, 'dw2_dispatch'],
    [process.env.PRODUCT_WORKER_URL, 'dw2_worker'],
  ] as const) {
    const u = new URL(value);
    if (
      u.username !== role ||
      u.protocol !== 'postgresql:' ||
      u.hostname !== '127.0.0.1' ||
      u.pathname !== '/devworkspace_phase2'
    )
      throw new Error('Restricted local worker role required');
  }
  if (!/^[a-f0-9]{64}$/.test(process.env.PRODUCT_MAIL_KEY))
    throw new Error('Invalid local mail key');
  const dispatcher = new TenantDatabase(process.env.PRODUCT_DISPATCH_URL, 2);
  const consumer = new TenantDatabase(process.env.PRODUCT_WORKER_URL, 2);
  const connection = workerConnection();
  const queue = new Queue(queueName, { connection });
  const hints = new Redis({
    ...workerConnection(),
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  hints.on('error', () => {});
  const worker = new Worker(
    queueName,
    async (job) => {
      const { lane, event_id, lease } = job.data as {
        lane: string;
        event_id: string;
        lease: string;
      };
      if (
        !['identity', 'tenant'].includes(lane) ||
        ![event_id, lease].every((x) => /^[a-f0-9-]{36}$/.test(x))
      )
        throw new Error('Invalid event reference');
      try {
        const { rows } = await consumer.pool.query<{ envelope: string | null }>(
          'SELECT public.load_mail($1,$2,$3) AS envelope',
          [lane, event_id, lease],
        );
        if (lane === 'tenant') {
          const result = await consumer.pool.query(
            'SELECT public.materialize_notifications($1,$2) hint',
            [event_id, lease],
          );
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              hints.publish('dw-notifications-v6', JSON.stringify(result.rows[0].hint)),
              new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Hint unavailable')), 500);
              }),
            ]);
          } catch {
            /* REST catch-up is authoritative. */
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
        if (rows[0]?.envelope)
          await sendLocalMail(openMail(process.env.PRODUCT_MAIL_KEY!, rows[0].envelope));
        await consumer.pool.query('SELECT public.finish_event($1,$2,$3,true)', [
          lane,
          event_id,
          lease,
        ]);
      } catch {
        await consumer.pool.query('SELECT public.finish_event($1,$2,$3,false)', [
          lane,
          event_id,
          lease,
        ]);
        throw new Error('Event delivery failed');
      }
    },
    { connection, concurrency: 2 },
  );
  worker.on('error', () => console.warn(JSON.stringify({ event: 'worker.transport.unavailable' })));
  queue.on('error', () => {});
  let busy = false;
  let stopping = false;
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const { rows } = await dispatcher.pool.query<{
        lane: string;
        event_id: string;
        lease: string;
      }>('SELECT * FROM public.claim_events()');
      for (const row of rows)
        await queue.add('committed-event', row, {
          jobId: row.event_id + '-' + row.lease,
          removeOnComplete: true,
          removeOnFail: 100,
        });
    } catch {
      console.warn(JSON.stringify({ event: 'outbox.poll.unavailable' }));
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  void tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (busy) await new Promise((resolve) => setTimeout(resolve, 25));
    await worker.close();
    await queue.close();
    hints.disconnect();
    await dispatcher.close();
    await consumer.close();
  };
}
