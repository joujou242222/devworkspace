import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { schemas, uuid, coreQuery } from '@devworkspace/contracts';
import { createProductIdentity } from './identity.js';
import { ClientAccess } from './client-access.js';
import { CoreDomain } from './core.js';
import { Files } from './files.js';
import { Reviews } from './reviews.js';
import { Notifications } from './notifications.js';
import { Expansion } from './expansion.js';
import { PrivateStorage } from './storage.js';
import { Media } from './media.js';
import { Organizations } from './organizations.js';
import { Problem, digest, csrfToken, cookieValue, verifyCsrf } from './security.js';
export interface ProductRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
}
export interface ProductResponse {
  status: number;
  body: unknown;
  cookies?: string[];
  headers?: Record<string, string>;
}
export function productConfig(env: NodeJS.ProcessEnv) {
  if (
    env.POSTGRES_PASSWORD ||
    env.POSTGRES_USER ||
    env.DATABASE_URL ||
    env.PRODUCT_WORKER_URL ||
    env.PRODUCT_DISPATCH_URL
  )
    throw new Error('Product API must not inherit migration or worker credentials');
  const shape = z.object({
    PRODUCT_API_URL: z.url(),
    PRODUCT_IDENTITY_URL: z.url(),
    PRODUCT_MAIL_KEY: z.string().regex(/^[a-f0-9]{64}$/),
    BETTER_AUTH_SECRET: z.string().min(32),
  });
  const result = shape.safeParse(env);
  if (!result.success)
    throw new Error(
      'Invalid Phase 2 configuration: ' +
        result.error.issues.map((x) => x.path.join('.')).join(','),
    );
  for (const [key, value] of Object.entries(result.data))
    if (key.endsWith('_URL')) {
      const u = new URL(value);
      if (
        u.username !== (key === 'PRODUCT_API_URL' ? 'dw2_api' : 'dw2_identity') ||
        u.protocol !== 'postgresql:' ||
        u.hostname !== '127.0.0.1' ||
        u.pathname !== '/devworkspace_phase2'
      )
        throw new Error('Restricted product role required');
    }
  return result.data;
}
export class ProductApplication {
  private denialBudget = { until: 0, count: 0 };
  readonly identity;
  readonly organizations;
  readonly files;
  readonly media;
  readonly origin = 'https://localhost:8443';
  readonly config;
  readonly notifications;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = productConfig(env);
    this.identity = createProductIdentity(
      this.config.PRODUCT_IDENTITY_URL,
      this.config.BETTER_AUTH_SECRET,
      this.config.PRODUCT_MAIL_KEY,
      this.origin,
    );
    this.organizations = new Organizations(
      this.config.PRODUCT_API_URL,
      this.config.PRODUCT_MAIL_KEY,
      this.origin,
    );
    this.files =
      env.FILE_STORAGE_ACCESS_KEY && env.FILE_STORAGE_SECRET_KEY
        ? new Files(
            this.organizations,
            new PrivateStorage(env.FILE_STORAGE_ACCESS_KEY, env.FILE_STORAGE_SECRET_KEY),
          )
        : null;
    this.media = this.files
      ? new Media(this.organizations, this.files.storage, this.config.PRODUCT_IDENTITY_URL)
      : null;
    this.notifications = new Notifications(new Reviews(this.organizations, this.files));
  }
  async close() {
    if (this.media) await this.media.identity.close();
    await this.identity.database.$disconnect();
    await this.organizations.database.close();
  }
  async handle(request: ProductRequest): Promise<ProductResponse> {
    const requestId = randomUUID();
    try {
      return await this.execute(request, requestId);
    } catch (error) {
      let problem: Problem;
      if (error instanceof Problem) problem = error;
      else if (error instanceof z.ZodError)
        problem = new Problem(400, 'INVALID_INPUT', 'Check the submitted fields');
      else {
        const e = error as { code?: string; statusCode?: number };
        if (e.code === 'P0412')
          problem = new Problem(
            412,
            'STALE_REVISION',
            'Preferences changed. Reload before saving.',
          );
        else if (e.code === '28000')
          problem = new Problem(401, 'SESSION_REQUIRED', 'Sign in to continue');
        else if (e.code === '42501') problem = new Problem(403, 'FORBIDDEN', 'Access denied');
        else if (['23505', '23514', '23503', '40001', '40P01'].includes(e.code ?? ''))
          problem = new Problem(
            409,
            'CONFLICT',
            'The operation conflicts with current state. Reload and try again.',
          );
        else if (e.statusCode && e.statusCode < 500)
          problem = new Problem(e.statusCode, 'AUTH_FAILED', 'Authentication or proof unavailable');
        else {
          console.warn(
            JSON.stringify({ event: 'request.failed', requestId, code: e.code ?? 'INTERNAL' }),
          );
          problem = new Problem(503, 'UNAVAILABLE', 'Service unavailable. Try again.');
        }
      }
      if ([401, 403, 404, 429].includes(problem.status)) {
        if (Date.now() > this.denialBudget.until)
          this.denialBudget = { until: Date.now() + 60000, count: 0 };
        if (this.denialBudget.count++ < 50)
          console.warn(
            JSON.stringify({
              event: 'security.denied',
              requestId,
              status: problem.status,
              code: problem.code,
            }),
          );
      }
      return {
        status: problem.status,
        headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId },
        body: {
          type: 'urn:devworkspace:problem:' + problem.code,
          title: problem.message,
          status: problem.status,
          code: problem.code,
          requestId,
        },
      };
    }
  }
  async execute(r: ProductRequest, rid: string): Promise<ProductResponse> {
    const path = r.path.split('?')[0]!.replace(/^\/api\/v1/, '');
    const parsed = new URL(r.path, this.origin);
    const method = r.method;
    const cookie = r.headers.cookie ?? '';
    const headers = new Headers({ cookie, origin: this.origin });
    const ok = (body: unknown, status = 200): ProductResponse => ({
      body,
      status,
      headers: { 'X-Request-Id': rid },
    });
    if (method === 'GET' && path === '/identity/csrf') {
      const old = cookieValue(cookie, '__Host-devworkspace.csrf');
      const nonce = /^[a-f0-9]{64}$/.test(old) ? old : randomBytes(32).toString('hex');
      return {
        status: 200,
        body: { token: csrfToken(this.config.BETTER_AUTH_SECRET, nonce, cookie) },
        cookies: [`__Host-devworkspace.csrf=${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax`],
      };
    }
    if (!['GET', 'HEAD'].includes(method)) {
      if (
        r.headers.origin !== this.origin ||
        !verifyCsrf(this.config.BETTER_AUTH_SECRET, cookie, r.headers['x-csrf-token'] ?? '')
      )
        throw new Problem(
          403,
          'CSRF_FAILED',
          'Secure request check failed. Refresh and try again.',
        );
    }
    const parse = <T extends keyof typeof schemas>(key: T) =>
      schemas[key].parse(r.body) as z.output<(typeof schemas)[T]>;
    const key = () =>
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,128}$/)
        .parse(r.headers['idempotency-key']);
    const revision = () => {
      const match = /^"([1-9][0-9]*)"$/.exec(r.headers['if-match'] ?? '');
      if (!match || !Number.isSafeInteger(Number(match[1])))
        throw new Problem(428, 'PRECONDITION_REQUIRED', 'Reload this form before saving');
      return Number(match[1]);
    };
    const limit = async (lane: string, identity = '') => {
      for (const value of ['ip:' + r.ip, ...(identity ? ['identity:' + identity] : [])]) {
        const { rows } = await this.organizations.database.pool.query<{ allowed: boolean }>(
          'SELECT public.abuse($1,$2) AS allowed',
          [digest(lane + ':' + value), value.startsWith('ip:') ? 100 : 12],
        );
        if (!rows[0]?.allowed)
          throw new Problem(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.');
      }
    };
    const library = async (work: () => Promise<Response>) => {
      const response = await this.identity.atomic(work);
      if (!response.ok)
        throw new Problem(
          response.status >= 500 ? 503 : response.status,
          'AUTH_FAILED',
          'Authentication or proof unavailable',
        );
      return { ...ok({ status: 'ok' }), cookies: response.headers.getSetCookie() };
    };
    if (method === 'POST' && path === '/identity/register') {
      const body = parse('register');
      await limit('register', body.email);
      const response = await this.identity.atomic(() =>
        this.identity.auth.api.signUpEmail({ body, headers, asResponse: true }),
      );
      if (!response.ok)
        throw new Problem(503, 'UNAVAILABLE', 'Cannot register right now. Try again.');
      return ok(
        { status: 'pending', message: 'If eligible, check your email to verify your account.' },
        202,
      );
    }
    if (method === 'POST' && path === '/identity/login') {
      const body = parse('login');
      await limit('login', body.email);
      return library(() => this.identity.auth.api.signInEmail({ body, headers, asResponse: true }));
    }
    if (method === 'POST' && ['/identity/recovery', '/identity/resend'].includes(path)) {
      const body = parse('email');
      await limit(path, body.email);
      const response = await this.identity.atomic(() =>
        path.endsWith('recovery')
          ? this.identity.auth.api.requestPasswordReset({
              body: { email: body.email },
              headers,
              asResponse: true,
            })
          : this.identity.auth.api.sendVerificationEmail({
              body: { email: body.email },
              headers,
              asResponse: true,
            }),
      );
      if (response.status >= 500)
        throw new Problem(503, 'UNAVAILABLE', 'Cannot send mail right now. Try again.');
      return ok({ status: 'pending', message: 'If eligible, check your email.' }, 202);
    }
    if (method === 'POST' && path === '/identity/verify') {
      const body = parse('proof');
      await limit('verify');
      return library(() =>
        this.identity.auth.api.verifyEmail({
          query: { token: body.token },
          headers,
          asResponse: true,
        }),
      );
    }
    if (method === 'POST' && path === '/identity/reset') {
      const body = parse('reset');
      await limit('reset');
      return library(() =>
        this.identity.auth.api.resetPassword({ body, headers, asResponse: true }),
      );
    }
    // No raw library handler is mounted; GET proof links only render a form.
    if (path.startsWith('/identity/library'))
      throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
    const user = await this.identity.session(headers);
    if (path === '/me/notification-preferences')
      return ok(await this.notifications.preferences(user, method, r.body, revision));
    if (method === 'POST' && path === '/identity/logout') {
      parse('empty');
      return library(() => this.identity.auth.api.signOut({ headers, asResponse: true }));
    }
    if (method === 'GET' && path === '/me') {
      const account = await this.identity.database.user.findUniqueOrThrow({
        where: { id: user.user.id },
        select: { id: true, name: true, email: true, revision: true },
      });
      return { ...ok(account), headers: { ETag: `"${account.revision}"` } };
    }
    if (method === 'PATCH' && path === '/me') {
      const body = parse('profile');
      const result = await this.identity.database.user.updateMany({
        where: { id: user.user.id, revision: revision(), active: true },
        data: { name: body.name, revision: { increment: 1 } },
      });
      if (!result.count)
        throw new Problem(412, 'STALE_REVISION', 'Account changed. Reload before saving.');
      return ok({ status: 'ok' });
    }
    if (method === 'GET' && path === '/me/sessions') {
      const cursor = z
        .string()
        .max(128)
        .parse(parsed.searchParams.get('cursor') ?? '');
      const rows = await this.identity.database.session.findMany({
        where: {
          userId: user.user.id,
          expiresAt: { gt: new Date() },
          lastActivityAt: { gt: new Date(Date.now() - 1800000) },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, createdAt: true, expiresAt: true },
        orderBy: { id: 'asc' },
        take: 51,
      });
      return ok({
        items: rows.slice(0, 50).map((s) => ({ ...s, current: s.id === user.session.id })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      });
    }
    const sessionMatch = /^\/me\/sessions\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && sessionMatch) {
      parse('empty');
      const id = z.string().min(1).max(128).parse(sessionMatch[1]);
      const result = await this.identity.database.session.deleteMany({
        where: { id, userId: user.user.id },
      });
      if (!result.count) throw new Problem(404, 'NOT_FOUND', 'Session unavailable');
      return ok({ status: 'ok', signInRequired: id === user.session.id });
    }
    if (method === 'POST' && path === '/me/password') {
      const body = parse('password');
      this.organizations.recent(user);
      return library(() =>
        this.identity.auth.api.changePassword({
          body: { ...body, revokeOtherSessions: true },
          headers,
          asResponse: true,
        }),
      );
    }
    if (method === 'GET' && path === '/me/principals') {
      const cursor = z
        .string()
        .max(36)
        .parse(parsed.searchParams.get('cursor') ?? '');
      if (cursor) uuid.parse(cursor);
      return ok(await this.organizations.principals(user, cursor));
    }
    if (method === 'GET' && path === '/me/client-principals')
      return ok(
        await new ClientAccess(this.organizations).principals(
          user,
          parsed.searchParams.get('cursor') ?? '',
        ),
      );
    if (method === 'POST' && path === '/organizations') {
      const body = parse('organization');
      return ok(await this.organizations.onboarding(user, body, key(), rid), 201);
    }
    if (method === 'POST' && ['/invitations/inspect', '/invitations/accept'].includes(path)) {
      const body = parse('proof');
      await limit('invitation', user.user.id);
      return ok(
        await this.organizations.invitation(
          user,
          body.token,
          path.endsWith('accept') ? key() : null,
          rid,
        ),
      );
    }
    if (this.media && /^\/me\/image(\/|$)/.test(path))
      return this.media.own(user, (tx) =>
        this.media!.execute(
          tx,
          user,
          'profile',
          user.user.id,
          path.slice('/me/image'.length),
          method,
          r.body,
          revision,
          rid,
        ),
      );
    const org = /^\/organizations\/([^/]+)(.*)$/.exec(path);
    if (!org) throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
    const orgId = uuid.parse(org[1]);
    const sub = org[2];
    const principal = uuid.parse(r.headers['x-organization-principal']);
    const expansion = new Expansion(this.notifications.reviews);
    if (expansion.supports(sub!))
      return ok(
        await expansion.execute(
          user,
          orgId,
          principal,
          sub!,
          method,
          r.body,
          revision,
          rid,
          parsed.searchParams,
          r.headers['idempotency-key'],
        ),
        method === 'POST' && !sub!.endsWith('/archive') && !sub!.endsWith('/withdraw') ? 201 : 200,
      );
    if (/^\/(?:portal\/)?notifications(?:\/|$)/.test(sub!))
      return ok(
        await this.notifications.execute(
          user,
          orgId,
          principal,
          sub!,
          method,
          r.body,
          parsed.searchParams,
        ),
      );
    if (this.media && /^\/logo(\/|$)/.test(sub!))
      return this.media.branding(user, orgId, principal, method !== 'GET', (tx) =>
        this.media!.execute(
          tx,
          user,
          'logo',
          orgId,
          sub!.slice('/logo'.length),
          method,
          r.body,
          revision,
          rid,
        ),
      );
    const clientAccess = new ClientAccess(this.organizations);
    if (sub === '/client-access' && method === 'GET')
      return ok(
        await clientAccess.read(user, orgId, principal, parsed.searchParams.get('cursor') ?? ''),
      );
    const clientInvitations = /^\/clients\/([^/]+)\/invitations$/.exec(sub!);
    if (clientInvitations && method === 'GET') {
      const q = coreQuery.parse(Object.fromEntries(parsed.searchParams));
      return this.organizations.scoped(user, orgId, principal, true, async (tx) =>
        ok(
          await clientAccess.invitations(
            tx,
            orgId,
            uuid.parse(clientInvitations[1]),
            q.page,
            q.limit,
          ),
        ),
      );
    }
    const clientInvite = /^\/clients\/([^/]+)\/contacts\/([^/]+)\/invitations$/.exec(sub!);
    if (clientInvite && method === 'POST') {
      await limit('invite', user.user.id);
      return this.organizations.scoped(user, orgId, principal, true, async (tx, actor) =>
        ok(
          await clientAccess.invite(
            tx,
            user,
            orgId,
            actor.id,
            uuid.parse(clientInvite[1]),
            uuid.parse(clientInvite[2]),
            r.body,
            rid,
          ),
          201,
        ),
      );
    }
    const core = new CoreDomain(this.organizations);
    const reviews = new Reviews(this.organizations, this.files);
    if (reviews.supports(sub!)) {
      const client = sub!.startsWith('/portal');
      if (method === 'POST' && sub!.endsWith('/decisions'))
        await limit('review-decision', user.user.id);
      return reviews.scoped(user, orgId, principal, client, (tx, actor) =>
        reviews.execute(
          tx,
          user,
          orgId,
          actor,
          sub!,
          method,
          r.body,
          revision,
          rid,
          parsed.searchParams,
          r.headers['idempotency-key'],
          r.headers.range,
        ),
      );
    }
    if (this.files?.supports(sub!)) {
      return this.organizations.scoped(user, orgId, principal, false, async (tx, actor) =>
        this.files!.execute(
          tx,
          user,
          orgId,
          actor,
          sub!,
          method,
          r.body,
          revision,
          rid,
          parsed.searchParams,
          r.headers.range,
        ),
      );
    }
    if (core.supports(sub!)) {
      return this.organizations.scoped(user, orgId, principal, false, async (tx, actor) =>
        ok(
          await core.execute(
            tx,
            user,
            orgId,
            actor,
            sub!,
            method,
            r.body,
            revision,
            rid,
            parsed.searchParams,
          ),
          method === 'POST' ? 201 : 200,
        ),
      );
    }
    const admin = sub !== '' || method !== 'GET';
    if (sub === '/invitations' && method === 'POST') await limit('invite', user.user.id);
    const answer = await this.organizations.scoped(
      user,
      orgId,
      principal,
      admin,
      async (tx, actor) => {
        if (sub === '' && method === 'GET') {
          const dto = await this.organizations.settings(tx, orgId);
          return { ...ok(dto), headers: { ETag: `"${dto.revision}"` } };
        }
        if (sub === '' && method === 'PATCH')
          return ok(
            await this.organizations.update(
              tx,
              user,
              orgId,
              parse('organization'),
              revision(),
              rid,
            ),
          );
        const cursor = z
          .string()
          .max(36)
          .parse(parsed.searchParams.get('cursor') ?? '');
        if (cursor) uuid.parse(cursor);
        if (sub === '/team' && method === 'GET')
          return ok(await this.organizations.team(tx, orgId, cursor));
        const member = /^\/team\/([^/]+)$/.exec(sub!);
        if (member && method === 'PATCH')
          return ok(
            await this.organizations.changeMember(
              tx,
              user,
              orgId,
              actor,
              uuid.parse(member[1]),
              parse('membership'),
              revision(),
              rid,
            ),
          );
        if (sub === '/ownership' && method === 'POST')
          return ok(
            await this.organizations.transfer(
              tx,
              user,
              orgId,
              actor,
              parse('transfer').membershipId,
              rid,
            ),
          );
        if (sub === '/invitations' && method === 'GET')
          return ok(await this.organizations.invitations(tx, orgId, cursor));
        if (sub === '/invitations' && method === 'POST') {
          return ok(
            await this.organizations.invite(tx, user, orgId, actor, parse('invitation'), rid),
            201,
          );
        }
        const invite = /^\/invitations\/([^/]+)$/.exec(sub!);
        if (invite && method === 'DELETE') {
          parse('empty');
          return ok(
            await this.organizations.revoke(
              tx,
              user,
              orgId,
              uuid.parse(invite[1]),
              revision(),
              rid,
            ),
          );
        }
        throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
      },
    );
    return answer;
  }
}
