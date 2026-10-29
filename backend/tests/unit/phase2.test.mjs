import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csrfToken,
  verifyCsrf,
  sealMail,
  openMail,
  productConfig,
} from '../../packages/server/dist/index.js';
test('product API configuration rejects migration/worker credentials and swapped database roles', () => {
  const env = {
    PRODUCT_API_URL: 'postgresql://dw2_api:fixture@127.0.0.1:55432/devworkspace_phase2',
    PRODUCT_IDENTITY_URL: 'postgresql://dw2_identity:fixture@127.0.0.1:55432/devworkspace_phase2',
    PRODUCT_MAIL_KEY: 'a'.repeat(64),
    BETTER_AUTH_SECRET: 'test-only-secret'.repeat(4),
  };
  assert.equal(productConfig(env).PRODUCT_API_URL, env.PRODUCT_API_URL);
  for (const key of ['POSTGRES_PASSWORD', 'DATABASE_URL', 'PRODUCT_WORKER_URL'])
    assert.throws(() => productConfig({ ...env, [key]: 'must-not-be-inherited' }));
  assert.throws(() => productConfig({ ...env, PRODUCT_API_URL: env.PRODUCT_IDENTITY_URL }));
});
test('CSRF proof is bound to host cookie nonce and current session, including login rotation', () => {
  const secret = 'test-only-secret'.repeat(4),
    nonce = 'a'.repeat(64);
  const cookies = `__Host-devworkspace.csrf=${nonce}; __Host-devworkspace.session_token=old-session`;
  const proof = csrfToken(secret, nonce, cookies);
  assert.equal(verifyCsrf(secret, cookies, proof), true);
  assert.equal(verifyCsrf(secret, cookies.replace('old-session', 'new-session'), proof), false);
  assert.equal(verifyCsrf(secret, cookies.replace(nonce, 'b'.repeat(64)), proof), false);
  assert.equal(verifyCsrf(secret, '', proof), false);
  assert.equal(verifyCsrf(secret, cookies, 'invalid'), false);
});
test('Mail capabilities require the correct key and authenticated ciphertext', () => {
  const key = 'a'.repeat(64),
    mail = { to: 'synthetic@example.test', subject: 'Verify email', text: 'synthetic capability' };
  const envelope = sealMail(key, mail);
  assert.ok(!envelope.includes(mail.text));
  assert.deepEqual(openMail(key, envelope), mail);
  assert.throws(() => openMail('b'.repeat(64), envelope));
  const tampered = Buffer.from(envelope, 'base64url');
  tampered[30] ^= 1;
  assert.throws(() => openMail(key, tampered.toString('base64url')));
});
