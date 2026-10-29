import { z } from 'zod';
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f/\\]+$/);
export const fileSchemas = {
  folder: z.strictObject({ name: name.max(100), position: z.number().int().min(0).max(1000000) }),
  upload: z.strictObject({
    name,
    purpose: z.enum(['PROJECT_FILE', 'DELIVERABLE']),
    folder_id: z.uuid().nullable(),
    size: z.number().int().min(1).max(26214400),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  }),
  fileListing: z.strictObject({
    title: name,
    folder_id: z.uuid().nullable(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  }),
  deliverable: z.strictObject({
    title: name,
    description: z.string().max(5000),
    task_id: z.uuid().nullable(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  }),
  version: z.strictObject({ asset_id: z.uuid() }),
  imageAttachment: z.strictObject({ asset_id: z.uuid().nullable() }),
  mediaUpload: z.strictObject({
    name,
    size: z.number().int().min(1).max(2097152),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.enum(['image/png', 'image/jpeg']),
  }),
};
export const fileQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  folder_id: z.union([z.uuid(), z.literal('root')]).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  q: z.string().max(100).optional(),
});
