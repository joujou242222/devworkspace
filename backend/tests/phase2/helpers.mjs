import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { request } from '../../scripts/http.mjs';
import { assertContract } from './contracts.mjs';
export const origin = 'https://localhost:8443';
export const password = 'Disposable-phase2-password-123!';
process.loadEnvFile('.env.local');
export const runtime = Object.fromEntries(
  (await readFile('.local/phase2-api.env', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const u = new URL('postgresql://127.0.0.1:55432/devworkspace_phase2');
u.username = process.env.POSTGRES_USER;
u.password = process.env.POSTGRES_PASSWORD;
export const admin = new Pool({ connectionString: u.href, max: 4 });
export class Browser {
  constructor(transport = request) {
    this.transport = transport;
  }
  cookies = new Map();
  async request(path, method = 'GET', body, headers = {}) {
    const cookie = () => Array.from(this.cookies, ([k, v]) => k + '=' + v).join('; ');
    const absorb = (response) => {
      for (const line of response.headers['set-cookie'] ?? []) {
        const at = line.indexOf('=');
        this.cookies.set(line.slice(0, at), line.slice(at + 1).split(';')[0]);
      }
    };
    if (method !== 'GET') {
      const c = await this.transport('/api/v1/identity/csrf', { headers: { Cookie: cookie() } });
      absorb(c);
      headers = { 'X-CSRF-Token': c.json().token, ...headers };
    }
    const response = await this.transport(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Origin: origin, Cookie: cookie(), ...headers },
    });
    absorb(response);
    assertContract(path, method, response);
    return response;
  }
  async login(email, pw = password) {
    const r = await this.request('/api/v1/identity/login', 'POST', { email, password: pw });
    if (r.status !== 200) throw new Error('Synthetic login failed: ' + r.status);
    this.email = email;
    return r;
  }
  async me() {
    const r = await this.request('/api/v1/me');
    if (r.status !== 200) throw new Error('Expected own account: ' + r.status);
    return r.json();
  }
}
export async function mail(email, subject) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await (await fetch('http://127.0.0.1:8025/api/v1/messages?limit=1000')).json();
    const m = result.messages.find(
      (m) => m.Subject === subject && m.To.some((to) => to.Address === email),
    );
    if (m) {
      const detail = await (await fetch('http://127.0.0.1:8025/api/v1/message/' + m.ID)).json();
      const link = detail.Text.match(/https:\/\/localhost:8443\/\S+/)?.[0];
      if (link) return new URL(link);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Expected correlated local SMTP delivery (proof omitted)');
}
export async function register() {
  const browser = new Browser();
  const email = 'p2-' + crypto.randomUUID() + '@example.test';
  const r = await browser.request('/api/v1/identity/register', 'POST', {
    name: 'Synthetic Phase 2',
    email,
    password,
  });
  if (r.status !== 202) throw new Error('Registration failed: ' + r.status);
  return { browser, email };
}
export async function account() {
  const a = await register();
  const link = await mail(a.email, 'Verify your DevWorkspace email');
  const r = await a.browser.request('/api/v1/identity/verify', 'POST', {
    token: link.searchParams.get('token'),
  });
  if (r.status !== 200) throw new Error('Verification failed: ' + r.status);
  await a.browser.login(a.email);
  a.user = await a.browser.me();
  return a;
}
export async function tenant(a, name = 'Synthetic Phase 2 organization') {
  const key = crypto.randomUUID();
  const body = { name, description: 'Synthetic test', timezone: 'Africa/Cairo' };
  const r = await a.browser.request('/api/v1/organizations', 'POST', body, {
    'Idempotency-Key': key,
  });
  if (r.status !== 201) throw new Error('Onboarding failed: ' + r.status);
  await a.browser.login(a.email);
  const ps = (await a.browser.request('/api/v1/me/principals')).json().items;
  const organizationId = r.json().organizationId;
  const principal = ps.find((p) => p.organizationId === organizationId);
  if (!principal) throw new Error('Principal missing');
  return {
    organizationId,
    principal,
    key,
    body,
    headers: { 'X-Organization-Principal': principal.id },
    path: '/api/v1/organizations/' + organizationId,
  };
}
export async function join(owner, t, invitee, role = 'MEMBER') {
  const r = await owner.browser.request(
    t.path + '/invitations',
    'POST',
    { email: invitee.email, role },
    t.headers,
  );
  if (r.status !== 201) throw new Error('Invite failed: ' + r.status);
  const link = await mail(invitee.email, 'DevWorkspace team invitation');
  const token = link.searchParams.get('token');
  const key = crypto.randomUUID();
  const result = await invitee.browser.request(
    '/api/v1/invitations/accept',
    'POST',
    { token },
    { 'Idempotency-Key': key },
  );
  if (result.status !== 200) throw new Error('Acceptance failed: ' + result.status);
  await invitee.browser.login(invitee.email);
  const principal = (await invitee.browser.request('/api/v1/me/principals'))
    .json()
    .items.find((p) => p.organizationId === t.organizationId);
  return {
    principal,
    headers: { 'X-Organization-Principal': principal.id },
    token,
    key,
    invitationId: r.json().id,
  };
}
