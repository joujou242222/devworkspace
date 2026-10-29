import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  freshSessionMiddleware,
} from 'better-auth/api';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  touchExperimentSession,
  registerEmailProof,
  consumeEmailProof,
  type ExperimentDatabase,
} from '@devworkspace/database';
import type { FoundationConfig } from '@devworkspace/server';
export function createExperimentAuth(config: FoundationConfig, database: ExperimentDatabase) {
  async function capture(kind: string, url: string, email: string) {
    const directory = resolve(process.env.WORKSPACE_ROOT ?? process.cwd(), '.local');
    await mkdir(directory, { recursive: true });
    await appendFile(
      resolve(directory, 'experiment-mail.jsonl'),
      JSON.stringify({ kind, url, email }) + '\n',
      { mode: 0o600 },
    );
  }
  return betterAuth({
    appName: 'DevWorkspace V01 experiment',
    baseURL: config.APP_ORIGIN,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET!,
    database: prismaAdapter(database, { provider: 'postgresql', transaction: true }),
    trustedOrigins: [config.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ url, user }) => capture('reset', url, user.email),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 86400,
      sendVerificationEmail: async ({ url, token, user }) => {
        await registerEmailProof(database, token, user.id);
        await capture('verify', url, user.email);
      },
    },
    session: {
      expiresIn: 28800,
      disableSessionRefresh: true,
      freshAge: 600,
      cookieCache: { enabled: false },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Runs for library HTTP endpoints and server-side auth.api calls (SSR,
        // Nest guard and Socket.IO). Better Auth verifies the cookie signature;
        // this gate only restricts its existing server-side session row.
        const sessionToken = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (sessionToken) await touchExperimentSession(database, sessionToken);
        if (ctx.path === '/verify-email') {
          const token = ctx.query?.token;
          if (typeof token !== 'string' || !(await consumeEmailProof(database, token))) {
            throw new APIError('UNAUTHORIZED', {
              code: 'INVALID_OR_USED_PROOF',
              message: 'Verification proof unavailable',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email' || !ctx.context.newSession) return;
        const oldToken = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        const fresh = ctx.context.newSession;
        if (oldToken && oldToken !== fresh.session.token) {
          const old = await ctx.context.internalAdapter.findSession(oldToken);
          if (old?.user.id === fresh.user.id)
            await ctx.context.internalAdapter.deleteSession(oldToken);
        }
      }),
    },
    plugins: [
      {
        id: 'v01-recent-auth-probe',
        endpoints: {
          v01Sensitive: createAuthEndpoint(
            '/v01-sensitive',
            { method: 'POST', use: [freshSessionMiddleware] },
            async (ctx) => ctx.json({ allowed: true }),
          ),
        },
      },
    ],
    // Disable only Better Auth's automatic __Secure- name prefix. Every cookie
    // remains Secure; the session uses an explicit browser-enforced __Host- name.
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      cookies: {
        session_token: {
          name: '__Host-devworkspace-v01.session_token',
          attributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
        },
      },
    },
  });
}
export type ExperimentAuth = ReturnType<typeof createExperimentAuth>;
