import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadFoundationConfig } from '@devworkspace/server';
import { workerConnection } from './infrastructure.js';
import { startMailWorker } from './mail.js';
import { startFileWorker } from './files.js';
@Module({})
class WorkerModule {}
const config = loadFoundationConfig();
workerConnection();
const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
const stopMail = process.env.PRODUCT_ENABLED === 'true' ? await startMailWorker() : null;
const stopFiles = stopMail ? await startFileWorker() : null;
app.enableShutdownHooks();
console.log(
  JSON.stringify({
    event: 'worker.bootstrap.ready',
    phase: stopFiles ? 4 : stopMail ? 2 : 1,
    mode: stopFiles
      ? 'identity-tenant-and-private-files'
      : stopMail
        ? 'identity-tenant-outbox'
        : 'bootstrap-only',
    jobsRegistered: stopFiles ? 2 : stopMail ? 1 : 0,
    infrastructureChecks: 'not-performed',
    origin: config.APP_ORIGIN,
  }),
);
const keepAlive = setInterval(() => {}, 60_000);
async function stop() {
  clearInterval(keepAlive);
  if (stopMail) await stopMail();
  if (stopFiles) await stopFiles();
  await app.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
