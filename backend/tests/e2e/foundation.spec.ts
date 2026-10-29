import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('real browser foundation/API request and server-side session forwarding', async ({
  page,
  context,
}) => {
  const email = 'browser-' + Date.now() + '@example.test';
  const password = 'Disposable-browser-pass-123!';
  const created = await context.request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost:8443' },
    data: { name: 'V01 browser', email, password },
  });
  expect(created.ok()).toBeTruthy();
  const lines = (await readFile('.local/experiment-mail.jsonl', 'utf8')).trim().split('\n');
  const proof = lines
    .map((line) => JSON.parse(line))
    .find((item) => item.kind === 'verify' && item.email === email);
  expect(!!proof).toBe(true);
  const url = new URL(proof.url);
  url.searchParams.delete('callbackURL');
  const verified = await context.request.get(url.pathname + url.search);
  expect(verified.ok()).toBe(true);
  const login = await context.request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost:8443' },
    data: { email, password },
  });
  expect(login.ok()).toBe(true);
  await page.goto('/foundation');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Phase 1 foundation');
  await page.getByRole('button', { name: 'Check API' }).click();
  await expect(page.getByRole('status')).toHaveText('API ok — phase 1');
  await page.goto('/experiment');
  await expect(page.getByTestId('server-session')).toHaveText('Authenticated experiment session');
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name.includes('session_token'));
  expect(session?.secure).toBe(true);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(session?.path).toBe('/');
  await page.getByRole('button', { name: 'Sign out of experiment' }).click();
  await expect(page.getByRole('status')).toContainText('Signed out');
  await page.reload();
  await expect(page.getByTestId('server-session')).toHaveText(
    'No authenticated experiment session',
  );
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in to experiment' }).click();
  await expect(page.getByRole('status')).toContainText('Signed in');
  await page.reload();
  await expect(page.getByTestId('server-session')).toHaveText('Authenticated experiment session');
});
