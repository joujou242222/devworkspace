import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import {
  schemas,
  operations,
  responseSchemas,
  inputJsonSchema,
} from '../packages/contracts/dist/index.js';
const schema = {
  openapi: '3.1.0',
  info: {
    title: 'DevWorkspace identity, tenancy and core work',
    version: '0.0.0',
    description:
      'Versioned product DTOs. Better Auth is server-only behind Identity; its raw handler is not mounted in product mode. Legacy /api/auth/* remains isolated experiment mode only.',
  },
  servers: [{ url: 'https://localhost:8443' }],
  paths: {
    '/api/v1/health/live': {
      get: {
        operationId: 'foundationLiveness',
        responses: {
          200: {
            description: 'API process is live',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'service', 'phase'],
                  properties: {
                    status: { const: 'ok' },
                    service: { const: 'api' },
                    phase: { type: 'integer', enum: [1, 2] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/health/ready': {
      get: {
        operationId: 'foundationReadiness',
        responses: {
          200: { description: 'Bootstrap readiness; dependency scope is explicit in response' },
          503: { description: 'Configured experiment database unavailable' },
        },
      },
    },
  },
};
schema.components = {
  securitySchemes: {
    sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-devworkspace.session_token' },
    csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
  },
  schemas: {
    ...responseSchemas,
    ...Object.fromEntries(
      Object.entries(schemas).map(([key, value]) => ['input_' + key, inputJsonSchema(value)]),
    ),
  },
};
for (const [operationId, method, path, input, output, status, policy] of operations) {
  const parameters = [];
  for (const match of path.matchAll(/\{([^}]+)\}/g))
    parameters.push({
      name: match[1],
      in: 'path',
      required: true,
      schema:
        match[1] === 'pageNumber'
          ? { type: 'integer', minimum: 1, maximum: 100 }
          : { type: 'string', ...(match[1] !== 'sessionId' ? { format: 'uuid' } : {}) },
    });
  if (path.startsWith('/organizations/'))
    parameters.push({
      name: 'X-Organization-Principal',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  if (
    output === 'binaryFile' &&
    ['/assets/', '/reviews/', '/versions/'].some((part) => path.includes(part))
  )
    parameters.push({
      name: 'Range',
      in: 'header',
      schema: { type: 'string', pattern: '^bytes=[0-9]+-[0-9]*$' },
    });
  if (
    method === 'patch' ||
    (method === 'delete' && path.startsWith('/organizations/')) ||
    [
      'accountUpdate',
      'organizationUpdate',
      'membershipUpdate',
      'invitationRevoke',
      'reviewReplace',
      'reviewCancel',
      'notificationPreferencesSave',
      'documentsSave',
      'documentsArchive',
      'discussionsArchive',
      'clientUpdatesWithdraw',
      'portalDecision',
    ].includes(operationId)
  )
    parameters.push({
      name: 'If-Match',
      in: 'header',
      required: true,
      schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
    });
  if (
    [
      'organizationCreate',
      'invitationAccept',
      'reviewOpen',
      'reviewReplace',
      'portalDecision',
      'reviewFeedbackTask',
      'documentsCreate',
      'discussionsCreate',
      'discussionRepliesCreate',
      'clientUpdatesCreate',
    ].includes(operationId)
  )
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: [
        'reviewOpen',
        'reviewReplace',
        'portalDecision',
        'reviewFeedbackTask',
        'documentsCreate',
        'discussionsCreate',
        'discussionRepliesCreate',
        'clientUpdatesCreate',
      ].includes(operationId)
        ? { type: 'string', format: 'uuid' }
        : { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
    });
  if (
    [
      'teamRead',
      'invitationsRead',
      'accountPrincipals',
      'accountSessions',
      'clientPrincipalsRead',
      'clientAccessRead',
    ].includes(operationId)
  )
    parameters.push({
      name: 'cursor',
      in: 'query',
      schema: { type: 'string', ...(operationId === 'accountSessions' ? {} : { format: 'uuid' }) },
    });
  if (
    method === 'get' &&
    (operationId === 'portalProjectOverview' ||
      [
        'corePage',
        'coreComments',
        'coreHistory',
        'candidates',
        'clientInvitations',
        'filePage',
        'reviewPage',
        'feedbackPage',
        'notificationPage',
      ].includes(output))
  ) {
    for (const [name, definition] of Object.entries(
      inputJsonSchema(
        (await import('../packages/contracts/dist/index.js'))[
          output === 'notificationPage'
            ? 'notificationQuery'
            : output === 'filePage'
              ? 'fileQuery'
              : operationId === 'portalProjectOverview' ||
                  ['reviewPage', 'feedbackPage'].includes(output)
                ? 'reviewQuery'
                : 'coreQuery'
        ],
      ).properties ?? {},
    )) {
      if (operationId === 'portalProjectOverview' && !['page', 'limit'].includes(name)) continue;
      parameters.push({ name, in: 'query', schema: definition });
    }
  }
  if (
    method === 'get' &&
    [
      'discussionPage',
      'replyPage',
      'documentPage',
      'updatePage',
      'activityPage',
      'auditPage',
      'clientFeedPage',
      'reportResult',
    ].includes(output)
  ) {
    const { expansionQuery } = await import('../packages/contracts/dist/index.js');
    for (const [name, definition] of Object.entries(
      inputJsonSchema(expansionQuery).properties ?? {},
    ))
      parameters.push({ name, in: 'query', schema: definition });
  }
  if (method !== 'get')
    parameters.push({
      name: 'Origin',
      in: 'header',
      required: true,
      schema: { const: 'https://localhost:8443' },
    });
  const security = {
    ...(policy !== 'public' ? { sessionCookie: [] } : {}),
    ...(method !== 'get' ? { csrf: [] } : {}),
  };
  schema.paths['/api/v1' + path] ??= {};
  schema.paths['/api/v1' + path][method] = {
    operationId,
    'x-policy': policy,
    security: Object.keys(security).length ? [security] : [],
    parameters,
    ...(input
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/input_' + input } },
            },
          },
        }
      : {}),
    responses: {
      ...(output === 'binaryFile' && path.includes('/assets/')
        ? {
            206: {
              description: 'Authorized single byte range',
              headers: {
                'Content-Range': { schema: { type: 'string' } },
                'Accept-Ranges': { schema: { type: 'string' } },
              },
              content: Object.fromEntries(
                ['image/png', 'image/jpeg', 'application/pdf'].map((mime) => [
                  mime,
                  { schema: { type: 'string', format: 'binary' } },
                ]),
              ),
            },
          }
        : {}),
      [status]: {
        description: 'Successful operation',
        content:
          output === 'binaryFile'
            ? Object.fromEntries(
                ['image/png', 'image/jpeg', 'application/pdf'].map((mime) => [
                  mime,
                  { schema: { type: 'string', format: 'binary' } },
                ]),
              )
            : { 'application/json': { schema: { $ref: '#/components/schemas/' + output } } },
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 412, 413, 415, 416, 428, 429, 503].map((code) => [
          code,
          {
            description: 'Safe problem response',
            content: {
              'application/problem+json': { schema: { $ref: '#/components/schemas/problem' } },
            },
          },
        ]),
      ),
    },
  };
}
const text = await format(JSON.stringify(schema), { parser: 'json', printWidth: 100 });
const path = 'packages/contracts/openapi.json';
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== text)
    throw new Error('OpenAPI drift: run pnpm openapi:generate');
  console.log('OpenAPI and generated client match product/foundation contracts');
} else {
  await writeFile(path, text);
  console.log('Product/foundation OpenAPI and client generated');
}

function tsType(s) {
  if (s.type === 'string' && s.format === 'binary') return 'Blob';
  if (Object.keys(s).length === 0) return 'unknown';
  if (s.anyOf) return s.anyOf.map(tsType).join('|');
  if (s.$ref) return s.$ref.split('/').at(-1);
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join('|');
  if (Array.isArray(s.type)) return s.type.map((type) => tsType({ ...s, type })).join('|');
  if (s.type === 'object')
    return (
      '{' +
      Object.entries(s.properties ?? {})
        .map(
          ([key, value]) =>
            JSON.stringify(key) + (s.required?.includes(key) ? '' : '?') + ':' + tsType(value),
        )
        .join(';') +
      '}'
    );
  if (s.type === 'array') return 'Array<' + tsType(s.items) + '>';
  if (s.type === 'integer' || s.type === 'number') return 'number';
  if (s.type === 'boolean') return 'boolean';
  if (s.type === 'null') return 'null';
  return 'string';
}
let client = '// Generated by pnpm openapi:generate. Do not edit.\n';
for (const [name, shape] of Object.entries(responseSchemas))
  client += 'export type ' + name + ' = ' + tsType(shape) + ';\n';
client += 'export interface ApiOperations {\n';
for (const [name, , path, input, output] of operations) {
  const shape = input ? inputJsonSchema(schemas[input]) : null;
  client +=
    name +
    ': { path:' +
    JSON.stringify('/api/v1' + path) +
    '; request:' +
    (shape ? tsType(shape) : 'never') +
    '; response:' +
    output +
    ' };\n';
}
client += '}\n';
client = await format(client, { parser: 'typescript', singleQuote: true, printWidth: 100 });
const generated = 'packages/contracts/src/client.generated.ts';
if (process.argv.includes('--check')) {
  if ((await readFile(generated, 'utf8')) !== client)
    throw new Error('Generated client contract drift');
} else await writeFile(generated, client);
