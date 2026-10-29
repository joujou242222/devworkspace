import {
  notificationPreferenceSchema,
  notificationQuery,
  schemas,
  uuid,
  type NotificationItem,
} from '@devworkspace/contracts';
import type { SqlTransaction } from '@devworkspace/database';
import type { ActiveSession } from './identity.js';
import type { Reviews } from './reviews.js';
import { Problem } from './security.js';
export class Notifications {
  constructor(readonly reviews: Reviews) {}
  async preferences(user: ActiveSession, method: string, body: unknown, revision: () => number) {
    const db = this.reviews.organizations.database.pool;
    if (method === 'GET')
      return (
        await db.query('SELECT public.read_notification_preferences($1,$2) result', [
          user.user.id,
          user.session.id,
        ])
      ).rows[0].result;
    if (method !== 'PATCH') throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
    const b = notificationPreferenceSchema.parse(body);
    return (
      await db.query(
        'SELECT public.save_all_notification_preferences($1,$2,$3,$4,$5,$6,$7) result',
        [
          user.user.id,
          user.session.id,
          b.assignments,
          b.reviews,
          b.discussions_documents ?? null,
          b.client_updates ?? null,
          revision(),
        ],
      )
    ).rows[0].result;
  }
  async scoped<T>(
    user: ActiveSession,
    org: string,
    principal: string,
    client: boolean,
    work: (tx: SqlTransaction) => Promise<T>,
  ) {
    return this.reviews.scoped(user, org, principal, client, async (tx) => {
      await tx.query(
        "SELECT set_config('app.notification_user',$1,true),set_config('app.notification_principal',$2,true),set_config('app.notification_capacity',$3,true)",
        [user.user.id, principal, client ? 'CLIENT' : 'INTERNAL'],
      );
      return work(tx);
    });
  }
  async execute(
    user: ActiveSession,
    org: string,
    principal: string,
    path: string,
    method: string,
    body: unknown,
    params: URLSearchParams,
  ) {
    const client = path.startsWith('/portal/');
    const root = client ? '/portal/notifications' : '/notifications';
    const suffix = path.slice(root.length);
    return this.scoped(user, org, principal, client, async (tx) => {
      if (method === 'GET' && !suffix) {
        const q = notificationQuery.parse(Object.fromEntries(params));
        const where =
          "organization_id=$1 AND ($2::text IS NULL OR category=$2) AND ($3::text IS NULL OR (read_at IS NULL)=($3='true'))";
        const args = [org, q.category ?? null, q.unread ?? null];
        const counts = (
          await tx.query(
            'SELECT count(*)::int total,count(*) FILTER(WHERE read_at IS NULL)::int unread FROM public.notification WHERE ' +
              where,
            args,
          )
        ).rows[0];
        const { rows } = await tx.query(
          'SELECT id,event_id,category,project_id,resource_kind,resource_id,occurred_at,read_at FROM public.notification WHERE ' +
            where +
            ' ORDER BY occurred_at DESC,id DESC LIMIT $4 OFFSET $5',
          [...args, q.limit, (q.page - 1) * q.limit],
        );
        const prefix = client ? `/portal/${org}` : `/w/${org}`;
        const items = rows.map((n) => ({
          ...n,
          summary:
            n.category === 'assignments'
              ? 'Task assignment or activity updated'
              : n.category === 'discussions_documents'
                ? 'Internal collaboration updated'
                : n.category === 'client_updates'
                  ? 'Client update published'
                  : 'Review activity updated',
          href:
            n.resource_kind === 'UPDATE'
              ? client
                ? `${prefix}/updates?projectId=${n.project_id}`
                : `${prefix}/projects/${n.project_id}`
              : prefix +
                `/projects/${n.project_id}/` +
                (n.resource_kind === 'TASK'
                  ? `tasks/${n.resource_id}`
                  : n.resource_kind === 'REVIEW'
                    ? `reviews/${n.resource_id}`
                    : n.resource_kind === 'DISCUSSION'
                      ? `discussions/${n.resource_id}`
                      : n.resource_kind === 'DOCUMENT'
                        ? `documents/${n.resource_id}`
                        : 'deliverables'),
        })) as NotificationItem[];
        return { ...counts, items, page: q.page, limit: q.limit };
      }
      if (method === 'POST' && (suffix === '/read-all' || /^\/[a-f0-9-]+\/read$/.test(suffix))) {
        schemas.empty.parse(body);
        if (suffix !== '/read-all') {
          const id = uuid.parse(suffix.split('/')[1]);
          if (
            !(
              await tx.query(
                'SELECT id FROM public.notification WHERE organization_id=$1 AND id=$2',
                [org, id],
              )
            ).rowCount
          )
            throw new Problem(404, 'NOT_FOUND', 'Notification unavailable');
          await tx.query(
            'UPDATE public.notification SET read_at=now() WHERE organization_id=$1 AND id=$2 AND read_at IS NULL',
            [org, id],
          );
        } else
          await tx.query(
            'UPDATE public.notification SET read_at=now() WHERE organization_id=$1 AND read_at IS NULL',
            [org],
          );
        return { status: 'ok' };
      }
      throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
    });
  }
}
