import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
  ) {
    super(title);
  }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function sealMail(key: string, value: { to: string; subject: string; text: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openMail(
  key: string,
  envelope: string,
): { to: string; subject: string; text: string } {
  const bytes = Buffer.from(envelope, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
  );
}
export const sessionCookieName = '__Host-devworkspace.session_token';
export function cookieValue(header: string, name: string) {
  return (
    header
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
export function csrfToken(secret: string, nonce: string, cookie: string) {
  return createHmac('sha256', secret)
    .update(nonce + '\n' + cookieValue(cookie, sessionCookieName))
    .digest('hex');
}
export function verifyCsrf(secret: string, cookie: string, value: string) {
  const nonce = cookieValue(cookie, '__Host-devworkspace.csrf');
  if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(csrfToken(secret, nonce, cookie)), Buffer.from(value));
}
