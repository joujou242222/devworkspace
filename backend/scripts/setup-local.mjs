import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = process.cwd();
await mkdir('.local/tls', { recursive: true });
await mkdir('.local/logs', { recursive: true });
let exists = true;
try {
  await access('.env.local');
} catch {
  exists = false;
}
if (!exists) {
  const values = {
    NODE_ENV: 'development',
    APP_ORIGIN: 'https://localhost:8443',
    BIND_HOST: '127.0.0.1',
    API_PORT: '3001',
    WEB_PORT: '3000',
    API_INTERNAL_URL: 'http://127.0.0.1:3001',
    WEB_INTERNAL_URL: 'http://127.0.0.1:3000',
    S3_INTERNAL_URL: 'http://127.0.0.1:9000',
    EXPERIMENT_AUTH_ENABLED: 'false',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    POSTGRES_USER: 'p1_owner',
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    POSTGRES_DB: 'devworkspace_v01',
    WORKSPACE_ROOT: root.replaceAll('\\', '/'),
    S3_ACCESS_KEY: randomBytes(12).toString('hex'),
    S3_SECRET_KEY: randomBytes(24).toString('hex'),
  };
  await writeFile(
    '.env.local',
    Object.entries(values)
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
}
process.loadEnvFile('.env.local');
try {
  await access('.local/tls/localhost.pem');
} catch {
  const config =
    '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n';
  await writeFile('.local/tls/openssl.cnf', config);
  const binary =
    process.env.OPENSSL_BIN ??
    (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const result = spawnSync(
    binary,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '30',
      '-keyout',
      resolve('.local/tls/localhost-key.pem'),
      '-out',
      resolve('.local/tls/localhost.pem'),
      '-config',
      resolve('.local/tls/openssl.cnf'),
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (result.status !== 0)
    throw new Error(
      'Project-local TLS creation failed; provide an existing OpenSSL executable via OPENSSL_BIN. No system software was installed.',
    );
}
const certificate = new X509Certificate(await readFile('.local/tls/localhost.pem'));
if (!certificate.checkHost('localhost')) throw new Error('Invalid TLS hostname');
await writeFile(
  '.local/s3-identities.json',
  JSON.stringify(
    {
      identities: [
        {
          name: 'phase1-local-candidate',
          credentials: [
            { accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY },
          ],
          actions: ['Admin'],
        },
      ],
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  'Project-local secrets and localhost TLS ready; no trust store was modified. S3 candidate credentials are local experiment admin only, not a production file policy.',
);
