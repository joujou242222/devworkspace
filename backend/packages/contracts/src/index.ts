export interface FoundationHealth {
  status: 'ok';
  service: 'api';
  phase: 1 | 2;
}
export interface ExperimentSessionSummary {
  authenticated: boolean;
  userId?: string;
}
export * from './phase2.js';
export { operations, responseSchemas, inputJsonSchema } from './operations.js';
export type { ApiOperations } from './client.generated.js';
export type * from './client.generated.js';

export * from './phase3.js';
export * from './phase4.js';
export * from './phase5.js';
export * from './phase6.js';
export * from './phase7.js';
