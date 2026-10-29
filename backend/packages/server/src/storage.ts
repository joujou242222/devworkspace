import { createHash, createHmac } from 'node:crypto';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Uint8Array, value: string) =>
  createHmac('sha256', key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

/** Private path-style S3 transport. No environment fallback to administrator credentials. */
export class PrivateStorage {
  constructor(
    readonly accessKey: string,
    private readonly secretKey: string,
    readonly endpoint = 'http://127.0.0.1:9000',
  ) {
    if (!accessKey || !secretKey || endpoint !== 'http://127.0.0.1:9000')
      throw new Error('Explicit private local storage credentials required');
  }
  private signingKey(day: string) {
    return hmac(hmac(hmac(hmac('AWS4' + this.secretKey, day), 'us-east-1'), 's3'), 'aws4_request');
  }
  private path(bucket: string, key = '') {
    if (!/^[a-z0-9-]{3,63}$/.test(bucket) || (key && !/^[a-zA-Z0-9/_-]+$/.test(key)))
      throw new Error('Invalid server object identity');
    return '/' + bucket + (key ? '/' + key : '');
  }
  capability(
    key: string,
    size: number,
    mime: string,
    checksum: string,
    now = new Date(),
    expires = 300,
  ) {
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 25 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'application/pdf'].includes(mime) ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      !Number.isInteger(expires) ||
      expires < 1 ||
      expires > 300
    )
      throw new Error('Invalid upload capability parameters');
    const path = this.path('dw-staging', key);
    const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8);
    const scope = day + '/us-east-1/s3/aws4_request';
    const signedHeaders: Record<string, string> = {
      'content-length': String(size),
      'content-type': mime,
      host: 'localhost:8443',
      'if-none-match': '*',
      'x-amz-checksum-sha256': Buffer.from(checksum, 'hex').toString('base64'),
    };
    const names = Object.keys(signedHeaders).sort();
    const query = Object.entries({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': this.accessKey + '/' + scope,
      'X-Amz-Date': date,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': names.join(';'),
    })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => encode(k) + '=' + encode(v))
      .join('&');
    const canonical = [
      'PUT',
      path,
      query,
      names.map((n) => n + ':' + signedHeaders[n] + '\n').join(''),
      names.join(';'),
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const signature = createHmac('sha256', this.signingKey(day))
      .update('AWS4-HMAC-SHA256\n' + date + '\n' + scope + '\n' + hash(canonical))
      .digest('hex');
    const { host: _host, 'content-length': _length, ...headers } = signedHeaders;
    return {
      url: 'https://localhost:8443' + path + '?' + query + '&X-Amz-Signature=' + signature,
      headers,
      expiresAt: new Date(now.getTime() + expires * 1000).toISOString(),
    };
  }
  async request(
    method: string,
    bucket: string,
    key = '',
    body?: Uint8Array,
    extra: Record<string, string> = {},
    parameters: Record<string, string> = {},
  ) {
    const path = this.path(bucket, key);
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8);
    const payloadHash = hash(body ?? '');
    const headers: Record<string, string> = {
      host: new URL(this.endpoint).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      ...extra,
    };
    const names = Object.keys(headers).sort();
    const signed = names.join(';');
    const query = Object.entries(parameters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => encode(k) + '=' + encode(v))
      .join('&');
    const canonical = [
      method,
      path,
      query,
      names.map((n) => n + ':' + headers[n] + '\n').join(''),
      signed,
      payloadHash,
    ].join('\n');
    const scope = day + '/us-east-1/s3/aws4_request';
    const signature = createHmac('sha256', this.signingKey(day))
      .update('AWS4-HMAC-SHA256\n' + date + '\n' + scope + '\n' + hash(canonical))
      .digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
    return fetch(this.endpoint + path + (query ? '?' + query : ''), {
      method,
      headers,
      ...(body ? { body: Buffer.from(body) } : {}),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
  }
}
