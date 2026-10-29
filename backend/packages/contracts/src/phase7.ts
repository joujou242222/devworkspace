import { z } from 'zod';

export const safeLink = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        ['http:', 'https:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !/[\u0000-\u0020]/.test(value)
      );
    } catch {
      return false;
    }
  }, 'Use an absolute HTTP(S) link');
const inline = z.strictObject({
  text: z.string().max(10000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: safeLink.optional(),
});
const spans = z.array(inline).max(200);
export const documentContent = z
  .strictObject({
    version: z.literal(1),
    blocks: z
      .array(
        z.discriminatedUnion('type', [
          z.strictObject({ type: z.literal('paragraph'), spans }),
          z.strictObject({
            type: z.literal('heading'),
            level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            spans,
          }),
          z.strictObject({
            type: z.enum(['bulletList', 'orderedList']),
            items: z.array(spans).min(1).max(100),
          }),
        ]),
      )
      .max(200),
  })
  .refine((value) => JSON.stringify(value).length <= 100000, 'Document is too large');
export type DocumentContent = z.infer<typeof documentContent>;
export const expansionSchemas = {
  discussionCreate: z.strictObject({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
  }),
  discussionReply: z.strictObject({ body: z.string().trim().min(1).max(10000) }),
  documentCreate: z.strictObject({
    project_id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    content: documentContent,
  }),
  documentSave: z.strictObject({
    title: z.string().trim().min(1).max(200),
    content: documentContent,
  }),
  clientUpdateCreate: z.strictObject({ body: z.string().trim().min(1).max(10000) }),
};
export const expansionQuery = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    project_id: z.uuid().optional(),
    q: z.string().max(200).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'PUBLISHED', 'WITHDRAWN']).optional(),
    action: z.string().max(100).optional(),
    actor: z.string().max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), 'Invalid date window');

export interface DiscussionRecord {
  id: string;
  project_id: string;
  title: string;
  body: string;
  author_id: string;
  status: string;
  revision: number;
  created_at: string;
}
export interface ReplyRecord {
  id: string;
  project_id: string;
  discussion_id: string;
  body: string;
  author_id: string;
  created_at: string;
}
export interface DocumentRecord {
  id: string;
  project_id: string;
  title: string;
  content: DocumentContent;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface UpdateRecord {
  id: string;
  project_id: string;
  body: string;
  status: string;
  revision: number;
  created_at: string;
  withdrawn_at: string | null;
}
export interface ActivityRecord {
  id: string;
  project_id: string;
  event_id: string;
  action: string;
  summary: string;
  actor: string;
  created_at: string;
}
export interface AuditRecord {
  id: string;
  actor_id: string;
  action: string;
  target_id: string;
  request_id: string;
  capacity: string | null;
  created_at: string;
}
export interface FeedRecord {
  id: string;
  project_id: string;
  kind: 'UPDATE' | 'REVIEW';
  body: string;
  created_at: string;
  review_id: string | null;
  version_number: number | null;
  status: string;
}
export interface ExpansionPage<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
  limit: number;
  manager: boolean;
  canWrite: boolean;
  projects: { id: string; name: string; canWrite: boolean }[];
}
export interface ReportMetrics {
  tasks: number;
  done: number;
  overdue: number;
  progress: number | null;
  approved_versions: number;
  decisions: number;
  turnaround_seconds: number | null;
}
export interface ReportResult {
  projects: ({ id: string; name: string } & ReportMetrics)[];
  totals: ReportMetrics;
  from: string | null;
  to: string | null;
  definitions: string;
}

const record = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  title: z.string(),
  body: z.string(),
  author_id: z.string(),
  status: z.string(),
  revision: z.number().int(),
  created_at: z.iso.datetime(),
});
const doc = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  title: z.string(),
  content: documentContent,
  status: z.string(),
  revision: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
const update = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  body: z.string(),
  status: z.string(),
  revision: z.number().int(),
  created_at: z.iso.datetime(),
  withdrawn_at: z.iso.datetime().nullable(),
});
const reply = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  discussion_id: z.uuid(),
  body: z.string(),
  author_id: z.string(),
  created_at: z.iso.datetime(),
});
const activity = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  event_id: z.uuid(),
  action: z.string(),
  summary: z.string(),
  actor: z.string(),
  created_at: z.iso.datetime(),
});
const audit = z.strictObject({
  id: z.uuid(),
  actor_id: z.string(),
  action: z.string(),
  target_id: z.string(),
  request_id: z.uuid(),
  capacity: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_email: z.string().nullable(),
  created_at: z.iso.datetime(),
});
const feed = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  kind: z.enum(['UPDATE', 'REVIEW']),
  body: z.string(),
  created_at: z.iso.datetime(),
  review_id: z.uuid().nullable(),
  version_number: z.number().int().nullable(),
  status: z.string(),
});
const page = (item: z.ZodType) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    nextCursor: z.uuid().nullable(),
    limit: z.number().int(),
    manager: z.boolean(),
    canWrite: z.boolean(),
    projects: z.array(z.strictObject({ id: z.uuid(), name: z.string(), canWrite: z.boolean() })),
  });
const metrics = {
  tasks: z.number().int(),
  done: z.number().int(),
  overdue: z.number().int(),
  progress: z.number().nullable(),
  approved_versions: z.number().int(),
  decisions: z.number().int(),
  turnaround_seconds: z.number().nullable(),
};
export const expansionResponseSchemas = Object.fromEntries(
  Object.entries({
    discussionRecord: record,
    discussionPage: page(record),
    replyRecord: reply,
    replyPage: page(reply),
    documentRecord: doc,
    documentPage: page(doc),
    updateRecord: update,
    updatePage: page(update),
    activityPage: page(activity),
    auditPage: page(audit),
    clientFeedPage: page(feed),
    reportResult: z.strictObject({
      projects: z.array(z.strictObject({ id: z.uuid(), name: z.string(), ...metrics })),
      totals: z.strictObject(metrics),
      from: z.string().nullable(),
      to: z.string().nullable(),
      definitions: z.string(),
    }),
  }).map(([k, v]) => [k, z.toJSONSchema(v)]),
);
