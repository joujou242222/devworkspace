import { startMailWorker } from '../../apps/worker/dist/mail.js';
const stop = await startMailWorker(process.env.PHASE6_QUEUE);
console.log('phase6.worker.ready');
const timer = setInterval(() => {}, 1000);
process.once('SIGTERM', async () => {
  clearInterval(timer);
  await stop();
  process.exit(0);
});
