import type { ConnectionOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

// Construct configuration only. Phase 1 registers no queue or job and makes no
// Redis connection; an online bootstrap is not evidence of queue readiness.
export function workerConnection(value = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379') {
  const url = new URL(value);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid REDIS_URL protocol');
  const options = {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    db: Number(url.pathname.slice(1) || 0),
    lazyConnect: true,
    maxRetriesPerRequest: null,
  } satisfies RedisOptions & ConnectionOptions;
  if (!Number.isInteger(options.db) || options.db < 0) throw new Error('Invalid Redis database');
  return options;
}
