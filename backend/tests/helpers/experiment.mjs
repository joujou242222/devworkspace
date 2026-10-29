import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from '../../scripts/http.mjs';

export const origin = 'https://localhost:8443';
export const password = 'Disposable-integration-123!';
export const cookieOf = (response) =>
  (response.headers['set-cookie'] ?? []).map((line) => line.split(';')[0]).join('; ');
export async function post(path, body, cookie, customOrigin = origin) {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      ...(customOrigin ? { Origin: customOrigin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}
export async function proofUrl(kind, email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const lines = (await readFile('.local/experiment-mail.jsonl', 'utf8')).trim().split('\n');
    const entry = lines
      .map((line) => JSON.parse(line))
      .filter((item) => item.kind === kind && item.email === email)
      .at(-1);
    if (entry) return new URL(entry.url);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Expected a correlated disposable proof; token contents omitted');
}
export function verificationPath(url) {
  // No redirect on these assertions: a redirect could otherwise hide an error.
  return url.pathname + '?token=' + encodeURIComponent(url.searchParams.get('token'));
}
export async function register() {
  const email = 'v01-' + crypto.randomUUID() + '@example.test';
  const response = await post('/api/auth/sign-up/email', {
    name: 'V01 isolated test',
    email,
    password,
  });
  assert.equal(response.status, 200);
  return { email, userId: response.json().user.id, response };
}
export async function account() {
  const a = await register();
  const proof = await proofUrl('verify', a.email);
  assert.equal((await request(verificationPath(proof))).status, 200);
  const response = await post('/api/auth/sign-in/email', { email: a.email, password });
  assert.equal(response.status, 200);
  return { ...a, cookie: cookieOf(response), response };
}
export async function session(cookie) {
  const response = await request('/api/auth/get-session', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const value = response.json();
  // A failed assertion must not print a reusable cookie/session token.
  return value ? { user: { id: value.user?.id }, session: { id: value.session?.id } } : null;
}
