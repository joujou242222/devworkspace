import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { getCurrentAdapter, runWithTransaction } from '@better-auth/core/context';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createIdentityDatabase, type IdentityDatabase } from '@devworkspace/database';
import { digest, sealMail, sessionCookieName, Problem } from './security.js';
export function createProductIdentity(
  url: string,
  secret: string,
  mailKey: string,
  origin: string,
) {
  const database: IdentityDatabase = createIdentityDatabase(url);
  const mutationState = new AsyncLocalStorage<{ mailFailure: boolean }>();
  async function durable(work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      const state = mutationState.getStore();
      if (state) state.mailFailure = true;
      throw error;
    }
  }
  async function mail(userId: string, kind: 'verify' | 'reset', email: string, token: string) {
    const adapter = await getCurrentAdapter((await auth.$context).adapter);
    const path = kind === 'verify' ? '/register' : '/reset-password';
    await adapter.create({
      model: 'identityMail',
      forceAllowId: true,
      data: {
        id: randomUUID(),
        userId,
        kind,
        envelope: sealMail(mailKey, {
          to: email,
          subject:
            kind === 'verify'
              ? 'Verify your DevWorkspace email'
              : 'Reset your DevWorkspace password',
          text: `${origin}${path}?token=${encodeURIComponent(token)}`,
        }),
        createdAt: new Date(),
      },
    });
  }
  const auth = betterAuth({
    appName: 'DevWorkspace',
    baseURL: origin,
    basePath: '/api/v1/identity/library',
    secret,
    database: prismaAdapter(database, { provider: 'postgresql', transaction: true }),
    trustedOrigins: [origin],
    logger: { disabled: true },
    verification: { storeIdentifier: 'hashed' },
    user: {
      additionalFields: {
        active: { type: 'boolean', defaultValue: true, input: false },
        revision: { type: 'number', defaultValue: 1, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, token }) =>
        durable(() => mail(user.id, 'reset', user.email, token)),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 86400,
      sendVerificationEmail: async ({ user, token }) =>
        durable(async () => {
          const adapter = await getCurrentAdapter((await auth.$context).adapter);
          const id = digest(token);
          if (
            !(await adapter.findOne({ model: 'emailProof', where: [{ field: 'id', value: id }] }))
          ) {
            await adapter.create({
              model: 'emailProof',
              forceAllowId: true,
              data: { id, userId: user.id, expiresAt: new Date(Date.now() + 86400000) },
            });
          }
          await mail(user.id, 'verify', user.email, token);
        }),
    },
    session: {
      expiresIn: 28800,
      disableSessionRefresh: true,
      freshAge: 600,
      cookieCache: { enabled: false },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (token) {
          const rows = await database.$queryRaw<
            { id: string }[]
          >`UPDATE identity_session s SET "lastActivityAt"=statement_timestamp()
          WHERE s.token=${token} AND s."expiresAt">statement_timestamp() AND s."createdAt">statement_timestamp()-interval '8 hours'
          AND s."lastActivityAt">statement_timestamp()-interval '30 minutes'
          AND EXISTS(SELECT 1 FROM identity_user u WHERE u.id=s."userId" AND u.active AND u."emailVerified") RETURNING s.id`;
          if (!rows.length) await database.session.deleteMany({ where: { token } });
        }
        if (ctx.path === '/verify-email') {
          const proof = ctx.query?.token;
          const rows =
            typeof proof === 'string'
              ? await database.$queryRaw<
                  { id: string }[]
                >`UPDATE identity_email_proof SET "consumedAt"=statement_timestamp() WHERE id=${digest(proof)} AND "consumedAt" IS NULL AND "expiresAt">statement_timestamp() RETURNING id`
              : [];
          if (rows.length !== 1)
            throw new APIError('UNAUTHORIZED', {
              message: 'Proof invalid, expired or already used',
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email' && ctx.context.newSession) {
          const fresh = ctx.context.newSession;
          const u = await database.user.findUnique({
            where: { id: fresh.user.id },
            select: { active: true },
          });
          if (!u?.active) {
            await database.session.deleteMany({ where: { userId: fresh.user.id } });
            throw new APIError('UNAUTHORIZED', { message: 'Authentication failed' });
          }
          const old = await ctx.getSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            ctx.context.secret,
          );
          if (old && old !== fresh.session.token)
            await database.session.deleteMany({ where: { token: old, userId: fresh.user.id } });
        }
      }),
    },
    plugins: [
      {
        id: 'durable-identity',
        schema: {
          emailProof: {
            fields: {
              userId: { type: 'string', required: true },
              expiresAt: { type: 'date', required: true },
              consumedAt: { type: 'date', required: false },
            },
          },
          identityMail: {
            fields: {
              userId: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              envelope: { type: 'string', required: true },
              createdAt: { type: 'date', required: true },
            },
          },
        },
      },
    ],
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      cookies: {
        session_token: {
          name: sessionCookieName,
          attributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
        },
      },
    },
  });
  /** Library transaction context includes credential/proof/mail/audit/outbox writes. */
  async function atomic<T>(work: () => Promise<T>): Promise<T> {
    const ctx = await auth.$context;
    // asResponse converts library exceptions into responses. Re-throw inside the
    // transaction so an error response cannot commit partial credentials/mail.
    class RollbackResponse extends Error {
      constructor(readonly response: T) {
        super('Library operation rolled back');
      }
    }
    try {
      return await mutationState.run({ mailFailure: false }, () =>
        runWithTransaction(ctx.adapter, async () => {
          const result = await work();
          if (mutationState.getStore()?.mailFailure)
            throw new Problem(503, 'MAIL_UNAVAILABLE', 'Cannot queue this message. Try again.');
          if (result instanceof Response && !result.ok) throw new RollbackResponse(result);
          return result;
        }),
      );
    } catch (error) {
      if (error instanceof RollbackResponse) return error.response;
      throw error;
    }
  }
  async function session(headers: Headers) {
    const result = await auth.api.getSession({ headers });
    if (!result) throw new Problem(401, 'SESSION_REQUIRED', 'Sign in to continue');
    return result;
  }
  return { auth, database, atomic, session };
}
export type ProductIdentity = ReturnType<typeof createProductIdentity>;
export type ActiveSession = Awaited<ReturnType<ProductIdentity['session']>>;
