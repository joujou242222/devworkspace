import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '5199', 10);
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp'
};

function resolveDistPath(urlPath) {
  let clean = urlPath.split('?')[0];
  if (clean === '/') clean = '/index.html';

  let filePath = path.join(DIST_DIR, clean);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }

  // Try appending .html (clean URLs: /workspace/dashboard -> /workspace/dashboard.html)
  let htmlPath = path.join(DIST_DIR, clean + '.html');
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
    return htmlPath;
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // 1. Proxy /api requests to backend
  if (url.startsWith('/api/') || url === '/api') {
    try {
      const targetUrl = new URL(url, BACKEND_URL);
      const headers = { ...req.headers };
      delete headers['host']; // let node set the target host

      // Forward request to backend
      const proxyReq = http.request(targetUrl, {
        method: req.method,
        headers: headers
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('API Proxy error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'BAD_GATEWAY', message: 'Backend unreachable' }));
        }
      });

      req.pipe(proxyReq);
      return;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PROXY_CONFIG_ERROR', message: e.message }));
      return;
    }
  }

  // 2. Serve static files from dist
  const filePath = resolveDistPath(url);
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 3. Fallback 404
  const notFoundPath = path.join(DIST_DIR, '404.html');
  if (fs.existsSync(notFoundPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFoundPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[DevWorkspace Production Server] listening on http://0.0.0.0:${PORT}`);
  console.log(`  Proxying /api/* -> ${BACKEND_URL}`);
  console.log(`  Serving static assets from ${DIST_DIR}`);
});
