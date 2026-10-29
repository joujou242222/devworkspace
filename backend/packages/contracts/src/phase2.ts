import { z } from 'zod';
import type * as Generated from './client.generated.js';
import type { ApiOperations } from './client.generated.js';
import { coreSchemas, coreUpdateSchemas } from './phase3.js';
import { fileSchemas } from './phase4.js';
import { reviewSchemas } from './phase5.js';
import { notificationSchemas } from './phase6.js';
import { expansionSchemas } from './phase7.js';
import { operations } from './operations.js';
export const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const password = z.string().min(12).max(128);
export const token = z.string().min(16).max(4096);
export const uuid = z.uuid();
export const schemas = {
  ...expansionSchemas,
  ...notificationSchemas,
  ...reviewSchemas,
  ...fileSchemas,
  ...coreSchemas,
  ...coreUpdateSchemas,
  register: z.strictObject({ name: z.string().trim().min(1).max(100), email, password }),
  login: z.strictObject({ email, password }),
  email: z.strictObject({ email }),
  proof: z.strictObject({ token }),
  reset: z.strictObject({ token, newPassword: password }),
  profile: z.strictObject({ name: z.string().trim().min(1).max(100) }),
  password: z.strictObject({ currentPassword: password, newPassword: password }),
  organization: z.strictObject({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone'),
  }),
  invitation: z.strictObject({ email, role: z.enum(['ADMIN', 'MEMBER']) }),
  membership: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  }),
  transfer: z.strictObject({ membershipId: uuid }),
  empty: z.strictObject({}),
};
export type AccountDto = Generated.account;
export type PrincipalDto = Generated.principals['items'][number];
export type OrganizationDto = Generated.organization;
export type MemberDto = Generated.team['items'][number];
export type InvitationDto = Generated.invitations['items'][number];
export type SessionDto = Generated.sessions['items'][number];
export type ProblemDto = Generated.problem;
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** Versioned client transport: credentials stay on the application's origin. */
export async function apiRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  if (!path.startsWith('/api/v1/') || path.includes('://')) throw new Error('Invalid API path');
  headers = { ...headers };
  if (method !== 'GET') {
    const csrf = await fetch('/api/v1/identity/csrf', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!csrf.ok) throw new Error('Cannot establish a secure request. Try again.');
    headers['X-CSRF-Token'] = ((await csrf.json()) as { token: string }).token;
  }
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.ok && !response.headers.get('content-type')?.includes('json'))
    return (await response.blob()) as T;
  if (response.status === 401 && typeof window !== 'undefined')
    window.dispatchEvent(new Event('devworkspace:session-expired'));
  const value = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : { title: 'The service is unavailable. Retry when connected.' };
  if (!response.ok)
    throw new ApiRequestError((value as ProblemDto).title ?? 'Request failed', response.status);
  return value as T;
}
export async function callOperation<K extends keyof ApiOperations>(
  name: K,
  options: {
    body?: ApiOperations[K]['request'];
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiOperations[K]['response']> {
  const operation = operations.find((row) => row[0] === name)!;
  const path = ('/api/v1' + operation[2]).replace(/\{([^}]+)\}/g, (_, key: string) =>
    encodeURIComponent(options.params?.[key] ?? ''),
  );
  return apiRequest(path, operation[1].toUpperCase(), options.body, options.headers);
}
