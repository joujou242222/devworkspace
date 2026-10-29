import { z } from 'zod';
import { coreSchemas } from './phase3.js';
const coordinate = z.number().min(0).max(1);
/** Inverse of clockwise CSS quarter-turns, relative to the rendered content box. */
export function canonicalAnnotationPoint(sx: number, sy: number, rotation: number) {
  const x = Math.max(0, Math.min(1, sx)),
    y = Math.max(0, Math.min(1, sy));
  if (rotation === 90) return { x: y, y: 1 - x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: 1 - y, y: x };
  return { x, y };
}
export const annotationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('IMAGE_PIN'), x: coordinate, y: coordinate }),
  z.strictObject({
    type: z.literal('PDF_POINT'),
    page: z.number().int().min(1).max(100),
    x: coordinate,
    y: coordinate,
  }),
]);
export const reviewSchemas = {
  reviewOpen: z.strictObject({
    version_id: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    approver_ids: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine((a) => new Set(a).size === a.length),
    due_at: z.iso.datetime().nullable(),
  }),
  versionShare: z.strictObject({ status: z.enum(['ACTIVE', 'REVOKED']) }),
  reviewDecision: z
    .strictObject({
      version_id: z.uuid(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
      reason: z.string().trim().max(10000),
    })
    .refine((b) => b.decision !== 'CHANGES_REQUESTED' || b.reason.length > 0),
  reviewFeedback: z.strictObject({
    version_id: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    visibility: z.enum(['INTERNAL', 'CLIENT']),
    body: z.string().trim().min(1).max(10000),
    annotation: annotationSchema.nullable(),
  }),
  feedbackReply: z.strictObject({ body: z.string().trim().min(1).max(10000) }),
  feedbackResolution: z.strictObject({
    state: z.enum(['RESOLVED', 'REOPENED']),
    note: z.string().max(2000),
  }),
  feedbackTask: coreSchemas.task,
};
export const reviewQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED', 'SUPERSEDED']).optional(),
  project_id: z.uuid().optional(),
  version_id: z.uuid().optional(),
  due_before: z.iso.datetime().optional(),
});

const record = z.strictObject({
  milestone_total: z.number().optional(),
  milestone_page: z.number().optional(),
  milestones: z
    .array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        due_at: z.string().nullable(),
      }),
    )
    .optional(),
  id: z.string(),
  project_id: z.string().optional(),
  deliverable_id: z.string().optional(),
  version_id: z.string().optional(),
  version_number: z.number().optional(),
  cycle_number: z.number().optional(),
  policy: z.string().optional(),
  status: z.string().optional(),
  revision: z.number().optional(),
  created_at: z.string().optional(),
  closed_at: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  replaces_cycle_id: z.string().nullable().optional(),
  digest: z.string().optional(),
  mime: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  share_status: z.string().nullable().optional(),
  share_revision: z.number().optional(),
  review_status: z.string().nullable().optional(),
  review_id: z.string().nullable().optional(),
  decision: z
    .union([
      z.string(),
      z.strictObject({
        decision: z.string(),
        reason: z.string(),
        digest: z.string(),
        version_id: z.string(),
        created_at: z.string(),
      }),
    ])
    .nullable()
    .optional(),
  version: z
    .strictObject({
      id: z.string(),
      version_number: z.number(),
      digest: z.string(),
      mime: z.string(),
    })
    .optional(),
  previews: z
    .array(z.strictObject({ page: z.number(), width: z.number(), height: z.number() }))
    .optional(),
  source: z
    .strictObject({
      width: z.number().nullable(),
      height: z.number().nullable(),
      pages: z.number().nullable(),
    })
    .nullable()
    .optional(),
  manager: z.boolean().optional(),
  canFeedback: z.boolean().optional(),
  canResolve: z.boolean().optional(),
  canDecide: z.boolean().optional(),
  participants: z
    .array(z.strictObject({ contact_id: z.string(), grant_id: z.string(), role: z.string() }))
    .optional(),
  latest_prepared_version_id: z.string().nullable().optional(),
});
const reply = z.strictObject({
  id: z.string(),
  actor_id: z.string(),
  principal_id: z.string(),
  capacity: z.string(),
  body: z.string(),
  created_at: z.string(),
});
const feedback = z.strictObject({
  id: z.string(),
  cycle_id: z.string(),
  version_id: z.string(),
  actor_id: z.string(),
  principal_id: z.string(),
  capacity: z.string(),
  visibility: z.string(),
  body: z.string(),
  annotation: annotationSchema.nullable(),
  digest: z.string(),
  source_width: z.number().nullable(),
  source_height: z.number().nullable(),
  created_at: z.string(),
  replies: z.array(reply),
  resolution: z.string(),
  task_id: z.string().nullable().optional(),
  resolution_history: z
    .array(
      z.strictObject({
        id: z.string(),
        state: z.string(),
        note: z.string(),
        actor_id: z.string(),
        created_at: z.string(),
      }),
    )
    .optional(),
});
export type ReviewRecord = z.infer<typeof record>;
export type ReviewFeedback = z.infer<typeof feedback>;
export const reviewResponseSchemas = {
  reviewRecord: z.toJSONSchema(record, { target: 'draft-2020-12' }),
  reviewPage: z.toJSONSchema(
    z.strictObject({
      items: z.array(record),
      page: z.number(),
      limit: z.number(),
      total: z.number().optional(),
      manager: z.boolean().optional(),
    }),
    { target: 'draft-2020-12' },
  ),
  feedbackPage: z.toJSONSchema(
    z.strictObject({ items: z.array(feedback), page: z.number(), limit: z.number() }),
    { target: 'draft-2020-12' },
  ),
  shareRecord: z.toJSONSchema(
    z.strictObject({ version_id: z.string(), status: z.string(), revision: z.number() }),
    { target: 'draft-2020-12' },
  ),
};
