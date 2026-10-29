import { createApi } from './app.js';
const { app, config } = await createApi();
await app.listen(config.API_PORT, config.BIND_HOST);
console.log(
  JSON.stringify({
    event: 'api.bootstrap.ready',
    phase: process.env.PRODUCT_ENABLED === 'true' ? 2 : 1,
    host: config.BIND_HOST,
    port: config.API_PORT,
    experiment: config.EXPERIMENT_AUTH_ENABLED === 'true',
  }),
);
