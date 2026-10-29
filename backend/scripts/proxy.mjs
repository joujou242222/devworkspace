import https from 'node:https';
import httpProxy from 'http-proxy';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = 'https://localhost:8443';
const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
const web = process.env.WEB_INTERNAL_URL ?? 'http://127.0.0.1:3000';
const storage = process.env.S3_INTERNAL_URL ?? 'http://127.0.0.1:9000';
const proxy = httpProxy.createProxyServer({ changeOrigin: false, xfwd: false });
proxy.on('error', (_error, _request, response) => {
  if ('writeHead' in response && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Foundation upstream unavailable');
  } else response.destroy();
});
const directory = resolve(process.env.WORKSPACE_ROOT ?? process.cwd(), '.local/tls');
const server = https.createServer(
  {
    key: await readFile(resolve(directory, 'localhost-key.pem')),
    cert: await readFile(resolve(directory, 'localhost.pem')),
  },
  (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== 'localhost:8443') {
      response.writeHead(421);
      response.end();
      return;
    }
    const path = (request.url ?? '/').split('?')[0];
    if (path.startsWith('/dw-staging')) {
      const query = new URL(request.url, origin).searchParams;
      if (
        request.method !== 'PUT' ||
        request.headers.origin !== origin ||
        !/^\/dw-staging\/[A-Za-z0-9/_-]+$/.test(path) ||
        !query.has('X-Amz-Signature') ||
        request.headers['if-none-match'] !== '*'
      ) {
        response.writeHead(403);
        response.end('Staging request denied');
        return;
      }
      const size = Number(request.headers['content-length']);
      if (!Number.isSafeInteger(size) || size < 1 || size > 25 * 1024 * 1024) {
        response.writeHead(413);
        response.end();
        return;
      }
      delete request.headers.cookie;
      let received = 0;
      request.on('data', (chunk) => {
        received += chunk.length;
        if (received > 25 * 1024 * 1024) request.destroy();
      });
      proxy.web(request, response, { target: storage });
      return;
    }
    if (/^\/(dw-canonical|storage-admin|s3-admin)(\/|$)/.test(path)) {
      response.writeHead(403);
      response.end();
      return;
    }
    proxy.web(request, response, {
      target: path.startsWith('/api/') || path.startsWith('/socket.io/') ? api : web,
    });
  },
);
server.on('upgrade', (request, socket, head) => {
  if (
    request.headers.host !== 'localhost:8443' ||
    request.headers.origin !== origin ||
    !(request.url ?? '').startsWith('/socket.io/')
  ) {
    socket.destroy();
    return;
  }
  proxy.ws(request, socket, head, { target: api });
});
server.listen(8443, process.env.PROXY_BIND_HOST ?? '127.0.0.1', () =>
  console.log(
    JSON.stringify({ event: 'proxy.bootstrap.ready', origin, storageGuarantees: 'V03 not proven' }),
  ),
);
function stop() {
  proxy.close();
  server.close(() => process.exit(0));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
