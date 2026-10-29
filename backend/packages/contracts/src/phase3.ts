import { z } from 'zod';
const id = z.uuid();
const name = z.string().trim().min(1).max(100);
const title = z.string().trim().min(1).max(200);
const due = z.iso.datetime({ offset: true }).nullable();
const position = z.number().int().min(0).max(1000000);
export const coreSchemas = {
  clientInvitation: z.strictObject({
    project_id: id,
    role: z.enum(['VIEWER', 'REVIEWER', 'APPROVER']),
  }),
  client: z.strictObject({
    name,
    description: z.string().max(2000),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  }),
  contact: z.strictObject({
    name,
    email: z
      .email()
      .max(254)
      .transform((x) => x.toLowerCase()),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  }),
  project: z.strictObject({
    client_id: id,
    name,
    description: z.string().max(10000),
    due_at: due,
    portal_enabled: z.boolean(),
    status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']),
  }),
  participation: z.strictObject({
    membership_id: id,
    role: z.enum(['MANAGER', 'CONTRIBUTOR', 'VIEWER']),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  }),
  grant: z.strictObject({
    contact_id: id,
    role: z.enum(['VIEWER', 'REVIEWER', 'APPROVER']),
    status: z.enum(['ACTIVE', 'REVOKED']),
  }),
  milestone: z.strictObject({
    title,
    due_at: due,
    position,
    status: z.enum(['OPEN', 'COMPLETED']),
  }),
  task: z.strictObject({
    title,
    description: z.string().max(10000),
    milestone_id: id.nullable(),
    assignee_id: id.nullable(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']),
    due_at: due,
    position,
  }),
  workState: z.strictObject({ status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']) }),
  checklist: z.strictObject({
    label: z.string().trim().min(1).max(500),
    position,
    completed: z.boolean(),
  }),
  toggle: z.strictObject({ completed: z.boolean() }),
  comment: z.strictObject({ body: z.string().trim().min(1).max(10000), thread_id: id.nullable() }),
};
export const coreUpdateSchemas = {
  taskUpdate: z.union([coreSchemas.task, coreSchemas.workState]),
  checklistUpdate: z.union([coreSchemas.checklist, coreSchemas.toggle]),
};
export const coreQuery = z
  .strictObject({
    q: z.string().max(200).optional(),
    status: z.string().max(30).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    assignee_id: id.optional(),
    milestone_id: id.optional(),
    project_id: id.optional(),
    client_id: id.optional(),
    due_from: z.iso.datetime({ offset: true }).optional(),
    due_to: z.iso.datetime({ offset: true }).optional(),
    sort: z.enum(['name', 'due_at', 'position', 'created_at']).default('created_at'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (x) => !x.due_from || !x.due_to || new Date(x.due_from) <= new Date(x.due_to),
    'Invalid date window',
  );
export type CoreTaskInput = z.infer<typeof coreSchemas.task>;
export interface CoreRecord {
  summary?: WorkSummary;
  id: string;
  revision: number;
  name?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  client_id?: string;
  project_id?: string;
  milestone_id?: string | null;
  assignee_id?: string | null;
  source_feedback_thread_id?: string | null;
  source_review_id?: string;
  membership_id?: string;
  contact_id?: string;
  role?: string;
  due_at?: string | null;
  position?: number;
  portal_enabled?: boolean;
  email?: string;
  label?: string;
  completed?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface CorePage {
  items: CoreRecord[];
  total: number;
  page: number;
  limit: number;
}
export interface WorkSummary {
  total: number;
  done: number;
  overdue: number;
  progress: number | null;
}

/** Bounded same-origin product returns, with allowlisted view state only. */
export function safeReturnPath(value: string | null): string | null {
  if (value?.includes('?')) {
    if (value.length > 4096 || /[#\\\r\n]/.test(value)) return null;
    const at = value.indexOf('?');
    const base = value.slice(0, at);
    if (!safeReturnPath(base)) return null;
    const params = new URLSearchParams(value.slice(at + 1));
    const seen = new Set<string>();
    for (const [key, v] of params) {
      if (seen.has(key) || /[\r\n]/.test(v)) return null;
      seen.add(key);
      if (
        [
          'projectId',
          'project_id',
          'task_id',
          'feedback_id',
          'version_id',
          'assignee_id',
          'milestone_id',
        ].includes(key)
      ) {
        if (!z.uuid().safeParse(v).success) return null;
      } else if (key === 'folder_id') {
        if (v !== 'root' && !z.uuid().safeParse(v).success) return null;
      } else if (
        [
          'page',
          'limit',
          'folder_page',
          'upload_page',
          'version_page',
          'feedback_page',
          'milestone_page',
        ].includes(key)
      ) {
        if (!/^\d{1,6}$/.test(v) || Number(v) < 1) return null;
      } else if (['due_before', 'due_from', 'due_to', 'from', 'to'].includes(key)) {
        if (!z.iso.datetime().safeParse(v).success) return null;
      } else if (key === 'status') {
        if (
          !/^(ACTIVE|ARCHIVED|INACTIVE|PLANNED|COMPLETED|OPEN|APPROVED|CHANGES_REQUESTED|CANCELLED|SUPERSEDED|TODO|IN_PROGRESS|BLOCKED|DONE|REVOKED)$/.test(
            v,
          )
        )
          return null;
      } else if (key === 'priority') {
        if (!/^(LOW|NORMAL|HIGH|URGENT)$/.test(v)) return null;
      } else if (key === 'sort') {
        if (!/^(created_at|due_at|position|name)$/.test(v)) return null;
      } else if (key === 'direction') {
        if (!/^(asc|desc)$/.test(v)) return null;
      } else if (key === 'unread') {
        if (!/^(true|false)$/.test(v)) return null;
      } else if (key === 'category') {
        if (!/^(assignments|reviews|discussions_documents|client_updates)$/.test(v)) return null;
      } else if (['q', 'action', 'actor', 'cursor'].includes(key)) {
        if (!v || v.length > (key === 'cursor' ? 2048 : 500)) return null;
      } else return null;
    }
    return base + (params.size ? '?' + params.toString() : '');
  }
  const id = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  const expansionReturn = new RegExp(
    '^/(?:w/' +
      id +
      '/(?:reports|audit|documents|projects/' +
      id +
      '/(?:activity|discussions(?:/' +
      id +
      ')?|documents/' +
      id +
      '))|portal/' +
      id +
      '/updates)/?$',
  );
  if (value && expansionReturn.test(value)) return value;
  const reviewReturn = new RegExp(
    '^/(?:portal/' +
      id +
      '(?:/projects(?:/' +
      id +
      '(?:/(?:deliverables|reviews(?:/' +
      id +
      ')?))?)?)?|w/' +
      id +
      '/(?:reviews|notifications|projects/' +
      id +
      '/reviews(?:/' +
      id +
      ')?))/?$',
  );
  if (
    value &&
    (reviewReturn.test(value) || new RegExp('^/portal/' + id + '/notifications/?$').test(value))
  )
    return value;
  const route = new RegExp(
    '^/(?:account|onboarding|invitations/accept|w/' +
      id +
      '(?:/(?:settings|team|my-tasks|clients(?:/' +
      id +
      ')?|projects(?:/' +
      id +
      '(?:/(?:milestones|access|files|deliverables|tasks(?:/' +
      id +
      ')?))?)?))?/?' +
      ')$',
  );
  return value && route.test(value) ? value : null;
}
