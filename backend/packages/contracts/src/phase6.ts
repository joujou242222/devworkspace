import { z } from 'zod';
export const notificationPreferenceSchema = z.strictObject({
  assignments: z.boolean(),
  reviews: z.boolean(),
  discussions_documents: z.boolean().optional(),
  client_updates: z.boolean().optional(),
});
export const notificationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  unread: z.enum(['true', 'false']).optional(),
  category: z
    .enum(['assignments', 'reviews', 'discussions_documents', 'client_updates'])
    .optional(),
});
export const socketContext = z.strictObject({
  organization_id: z.uuid(),
  principal_id: z.uuid(),
  capacity: z.enum(['INTERNAL', 'CLIENT']),
  project_id: z.uuid().optional(),
});
export const socketSubscription = z.strictObject({ project_id: z.uuid() });
export const notificationSchemas = { notificationPreferences: notificationPreferenceSchema };
export interface NotificationPreferences {
  assignments: boolean;
  reviews: boolean;
  discussions_documents: boolean;
  client_updates: boolean;
  revision: number;
}
export interface NotificationItem {
  id: string;
  event_id: string;
  category: 'assignments' | 'reviews' | 'discussions_documents' | 'client_updates';
  project_id: string;
  resource_kind: 'TASK' | 'REVIEW' | 'VERSION' | 'DISCUSSION' | 'DOCUMENT' | 'UPDATE';
  resource_id: string;
  occurred_at: string;
  read_at: string | null;
  href: string;
  summary: string;
}
export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}
export const notificationResponseSchemas = {
  notificationPreferences: z.toJSONSchema(
    notificationPreferenceSchema.extend({ revision: z.number().int().positive() }),
  ),
  notificationPage: z.toJSONSchema(
    z.strictObject({
      items: z.array(
        z.strictObject({
          id: z.uuid(),
          event_id: z.uuid(),
          category: z.enum(['assignments', 'reviews', 'discussions_documents', 'client_updates']),
          project_id: z.uuid(),
          resource_kind: z.enum(['TASK', 'REVIEW', 'VERSION', 'DISCUSSION', 'DOCUMENT', 'UPDATE']),
          resource_id: z.uuid(),
          occurred_at: z.iso.datetime(),
          read_at: z.iso.datetime().nullable(),
          href: z.string(),
          summary: z.string(),
        }),
      ),
      total: z.number().int().nonnegative(),
      unread: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      limit: z.number().int().positive(),
    }),
  ),
};
