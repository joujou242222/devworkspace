// Test-only SigV4/SMTP probes; no application authentication or storage code.
import { createHash, createHmac } from 'node:crypto';
import net from 'node:net';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
export async function s3(method, path, body = '', authenticated = true) {
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const digest = sha(body);
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [
    method,
    path,
    '',
    `host:127.0.0.1:9000\nx-amz-content-sha256:${digest}\nx-amz-date:${date}\n`,
    signed,
    digest,
  ].join('\n');
  const scope = day + '/us-east-1/s3/aws4_request';
  const key = hmac(
    hmac(hmac(hmac('AWS4' + process.env.S3_SECRET_KEY, day), 'us-east-1'), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', key)
    .update('AWS4-HMAC-SHA256\n' + date + '\n' + scope + '\n' + sha(canonical))
    .digest('hex');
  const headers = authenticated
    ? {
        'x-amz-content-sha256': digest,
        'x-amz-date': date,
        Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      }
    : {};
  return fetch('http://127.0.0.1:9000' + path, {
    method,
    headers,
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(10000),
  });
}
export async function sendMail(subject) {
  const socket = net.createConnection({ host: '127.0.0.1', port: 1025 });
  let buffer = '';
  const replies = [];
  let pending;
  let failed;
  socket.setTimeout(10000, () => socket.destroy(new Error('SMTP timeout')));
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0, 3));
        if (pending) {
          const next = pending;
          pending = null;
          next.resolve(code);
        } else replies.push(code);
      }
    }
  });
  socket.on('error', (error) => {
    failed = error;
    if (pending) {
      pending.reject(error);
      pending = null;
    }
  });
  const reply = () =>
    failed
      ? Promise.reject(failed)
      : replies.length
        ? Promise.resolve(replies.shift())
        : new Promise((resolve, reject) => {
            pending = { resolve, reject };
          });
  const expect = async (code) => {
    if ((await reply()) !== code) throw new Error('Unexpected SMTP response');
  };
  try {
    await expect(220);
    for (const [line, code] of [
      ['EHLO localhost', 250],
      ['MAIL FROM:<native@example.test>', 250],
      ['RCPT TO:<sink@example.test>', 250],
      ['DATA', 354],
    ]) {
      socket.write(line + '\r\n');
      await expect(code);
    }
    socket.write(
      `From: native@example.test\r\nTo: sink@example.test\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.test>\r\n\r\nDisposable Phase 1 SMTP integration.\r\n.\r\n`,
    );
    await expect(250);
    socket.write('QUIT\r\n');
    await expect(221);
  } finally {
    socket.end();
    socket.destroy();
  }
}
