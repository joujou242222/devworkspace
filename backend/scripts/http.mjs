import https from 'node:https';
import { readFile } from 'node:fs/promises';
export async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const ca = await readFile('.local/tls/localhost.pem');
  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://localhost:8443' + path,
      {
        method,
        ca,
        family: 4,
        headers: {
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: data,
            json: () => JSON.parse(data),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    if (body) req.write(body);
    req.end();
  });
}
