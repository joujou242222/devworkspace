import { expansionSchemas, expansionQuery, schemas, uuid } from '@devworkspace/contracts';
import type { SqlTransaction } from '@devworkspace/database';
import type { ActiveSession } from './identity.js';
import type { Reviews } from './reviews.js';
import { Problem, digest } from './security.js';

type Actor = { id: string; role: string; capacity: 'INTERNAL' | 'CLIENT' };
type Row = Record<string, unknown> & {
  id: string;
  project_id: string;
  revision: number;
  status: string;
};
const fields = {
  discussion: 'id project_id title body author_id status revision created_at',
  discussion_reply: 'id project_id discussion_id body author_id created_at',
  document: 'id project_id title content status revision created_at updated_at',
  client_update: 'id project_id body status revision created_at withdrawn_at',
} as const;
const dto = (r: Row, table: keyof typeof fields) =>
  Object.fromEntries(fields[table].split(' ').map((k) => [k, r[k]]));
export class Expansion {
  constructor(readonly reviews: Reviews) {}
  supports(path: string) {
    return (
      /^\/(reports|audit|documents|portal\/updates)$/.test(path) ||
      /^\/projects\/[^/]+\/(discussions|documents|activity|updates)(\/|$)/.test(path)
    );
  }
  async projects(tx: SqlTransaction, org: string, actor: Actor) {
    const visibility =
      actor.capacity === 'CLIENT'
        ? "p.portal_enabled AND p.status<>'ARCHIVED' AND EXISTS(SELECT 1 FROM public.client_project_access g JOIN public.client_contact c ON c.organization_id=g.organization_id AND c.id=g.contact_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id WHERE g.organization_id=p.organization_id AND g.project_id=p.id AND g.contact_id=$2 AND g.status='ACTIVE' AND c.status='ACTIVE' AND x.status='ACTIVE')"
        : "($3<>'MEMBER' OR EXISTS(SELECT 1 FROM public.project_membership m WHERE m.organization_id=p.organization_id AND m.project_id=p.id AND m.membership_id=$2 AND m.status='ACTIVE'))";
    return (
      await tx.query<Row>(
        `SELECT p.id,p.name,p.status,($3<>'CLIENT' AND p.status NOT IN ('ARCHIVED','COMPLETED') AND ($3<>'MEMBER' OR EXISTS(SELECT 1 FROM public.project_membership w WHERE w.organization_id=p.organization_id AND w.project_id=p.id AND w.membership_id=$2 AND w.status='ACTIVE' AND w.role IN ('MANAGER','CONTRIBUTOR')))) can_write FROM public.project p WHERE p.organization_id=$1 AND $3::text IS NOT NULL AND ${visibility} ORDER BY p.id`,
        [org, actor.id, actor.role],
      )
    ).rows;
  }
  async execute(
    user: ActiveSession,
    org: string,
    principal: string,
    path: string,
    method: string,
    body: unknown,
    revision: () => number,
    rid: string,
    params: URLSearchParams,
    key?: string,
  ) {
    const client = path === '/portal/updates';
    return this.reviews.scoped(user, org, principal, client, async (tx, actor) => {
      const core = this.reviews.core;
      const q = expansionQuery.parse(Object.fromEntries(params));
      const parts = path.split('/').filter(Boolean);
      const project = parts[0] === 'projects' ? uuid.parse(parts[1]) : q.project_id;
      if (q.project_id && project !== q.project_id) core.missing();
      const access = project ? await this.reviews.access(tx, org, project, actor) : undefined;
      const projects = await this.projects(tx, org, actor);
      const ids = projects.filter((p) => !project || p.id === project).map((p) => p.id);
      const manager = access?.manager ?? actor.role !== 'MEMBER';
      const canWrite =
        !!access &&
        access.p.status !== 'ARCHIVED' &&
        access.p.status !== 'COMPLETED' &&
        ['MANAGER', 'CONTRIBUTOR'].includes(access.role);
      const page = (rows: Row[]) => {
        const total = rows.length;
        const index = q.cursor ? rows.findIndex((r) => r.id === q.cursor) : -1;
        if (q.cursor && index < 0) core.missing();
        const items = rows.slice(index + 1, index + 1 + q.limit);
        return {
          items,
          total,
          nextCursor: index + 1 + q.limit < total ? items.at(-1)!.id : null,
          limit: q.limit,
          manager,
          canWrite,
          projects: projects.map((p) => ({ id: p.id, name: p.name, canWrite: p.can_write })),
        };
      };
      const active = () => {
        if (!canWrite) {
          if (access && ['COMPLETED', 'ARCHIVED'].includes(access.p.status))
            core.conflict('Project is read only');
          core.denied();
        }
      };
      const load = async (table: keyof typeof fields, id: string) => {
        const r =
          (
            await tx.query<Row>(
              `SELECT * FROM public.${table} WHERE organization_id=$1 AND project_id=$2 AND id=$3`,
              [org, project, uuid.parse(id)],
            )
          ).rows[0] ?? core.missing();
        return r;
      };
      const event = (target: string, action: string) =>
        this.reviews.organizations.event(tx, org, user.user.id, 'core.changed', target, rid, {
          action,
          capacity: actor.capacity,
          principal_id: actor.id,
        });
      const receipt = async (operation: string, payload: unknown, work: () => Promise<unknown>) => {
        const k = uuid.parse(key),
          hash = digest(JSON.stringify(payload)),
          op = `expansion:${actor.id}:${operation}`;
        const previous = (
          await tx.query(
            'SELECT request_hash,result FROM public.command_receipt WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
            [org, user.user.id, op, k],
          )
        ).rows[0];
        if (previous) {
          if (previous.request_hash !== hash) core.conflict('Idempotency key payload changed');
          return previous.result;
        }
        const result = await work();
        await tx.query(
          'INSERT INTO public.command_receipt(organization_id,actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
          [org, user.user.id, op, k, hash, result],
        );
        return result;
      };
      if (method !== 'GET')
        await tx.query(
          "SELECT set_config('app.request_id',$1,true),set_config('app.principal_id',$2,true),set_config('app.capacity',$3,true)",
          [rid, actor.id, actor.capacity],
        );
      if (path === '/audit' && method === 'GET') {
        if (actor.role === 'MEMBER') core.denied();
        const rows = (
          await tx.query<Row>(
            "SELECT a.id,a.actor_id,coalesce(a.metadata->>'action',a.action) action,a.target_id,a.request_id,a.metadata->>'capacity' capacity,u.name actor_name,u.email actor_email,a.created_at FROM public.audit_event a LEFT JOIN LATERAL public.team_identity(a.actor_id) u ON true WHERE a.organization_id=$1 AND ($2::text IS NULL OR coalesce(a.metadata->>'action',a.action)=$2) AND ($3::text IS NULL OR a.actor_id=$3) AND ($4::timestamptz IS NULL OR a.created_at>=$4) AND ($5::timestamptz IS NULL OR a.created_at<$5) ORDER BY a.created_at DESC,a.id DESC",
            [org, q.action ?? null, q.actor ?? null, q.from ?? null, q.to ?? null],
          )
        ).rows;
        return page(rows);
      }
      if (path === '/reports' && method === 'GET')
        return this.report(tx, org, ids, projects, q.from, q.to);
      if (client && method === 'GET') {
        const rows = (
          await tx.query<Row>(
            `SELECT id,project_id,'UPDATE'::text kind,body,created_at,NULL::uuid review_id,NULL::integer version_number,status FROM public.client_update WHERE organization_id=$1 AND project_id=ANY($2::uuid[]) AND status='PUBLISHED'
          UNION ALL SELECT r.id,r.project_id,'REVIEW', 'Shared review milestone',coalesce(r.closed_at,r.created_at),r.id,v.version_number,r.status FROM public.review_cycle r JOIN public.deliverable_version v ON v.organization_id=r.organization_id AND v.project_id=r.project_id AND v.id=r.version_id WHERE r.organization_id=$1 AND r.project_id=ANY($2::uuid[]) AND r.status IN ('OPEN','APPROVED','CHANGES_REQUESTED') AND public.notification_access($1,$3,$4,'CLIENT',r.project_id,'REVIEW',r.id,'review.changed') ORDER BY created_at DESC,id DESC`,
            [org, ids, user.user.id, actor.id],
          )
        ).rows;
        return page(
          rows.filter(
            (r) =>
              (!q.from || new Date(String(r.created_at)).getTime() >= Date.parse(q.from)) &&
              (!q.to || new Date(String(r.created_at)).getTime() < Date.parse(q.to)),
          ),
        );
      }
      if (path === '/documents' && method === 'GET') {
        const rows = (
          await tx.query<Row>(
            "SELECT * FROM public.document WHERE organization_id=$1 AND project_id=ANY($2::uuid[]) AND ($3::text IS NULL OR title ILIKE '%'||$3||'%' OR content::text ILIKE '%'||$3||'%') AND ($4::text IS NULL OR status=$4) ORDER BY created_at DESC,id DESC",
            [org, ids, q.q ?? null, q.status ?? null],
          )
        ).rows;
        return page(rows.map((r) => dto(r, 'document') as Row));
      }
      if (path === '/documents' && method === 'POST') {
        const b = expansionSchemas.documentCreate.parse(body);
        const destination = await core.project(tx, org, b.project_id, actor);
        if (!['MANAGER', 'CONTRIBUTOR'].includes(destination.role)) core.denied();
        if (['ARCHIVED', 'COMPLETED'].includes(destination.p.status))
          core.conflict('Project is read only');
        return receipt('document:create', b, async () => {
          const r = (
            await tx.query<Row>(
              'INSERT INTO public.document(organization_id,project_id,author_id,title,content) VALUES($1,$2,$3,$4,$5) RETURNING *',
              [org, b.project_id, user.user.id, b.title, b.content],
            )
          ).rows[0]!;
          await event(r.id, 'document.created');
          return dto(r, 'document');
        });
      }
      if (parts[0] !== 'projects' || !access) core.missing();
      const resource = parts[2],
        id = parts[3],
        action = parts[4];
      if (resource === 'activity' && parts.length === 3 && method === 'GET') {
        return page(
          (
            await tx.query<Row>(
              'SELECT id,project_id,event_id,action,summary,actor,created_at FROM public.project_activity WHERE organization_id=$1 AND project_id=$2 AND ($3::text IS NULL OR action=$3) AND ($4::timestamptz IS NULL OR created_at>=$4) AND ($5::timestamptz IS NULL OR created_at<$5) ORDER BY created_at DESC,id DESC',
              [org, project, q.action ?? null, q.from ?? null, q.to ?? null],
            )
          ).rows,
        );
      }
      if (resource === 'documents' && id && parts.length === 4) {
        const r = await load('document', id);
        if (method === 'GET') return dto(r, 'document');
        if (method === 'PATCH') {
          active();
          if (r.status !== 'ACTIVE') core.conflict('Document is archived');
          const b = expansionSchemas.documentSave.parse(body);
          core.stale(r, revision());
          const saved = (
            await tx.query<Row>(
              'UPDATE public.document SET title=$4,content=$5,revision=revision+1 WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *',
              [org, project, r.id, b.title, b.content],
            )
          ).rows[0]!;
          await event(r.id, 'document.saved');
          return dto(saved, 'document');
        }
      }
      if (
        resource === 'documents' &&
        id &&
        action === 'archive' &&
        parts.length === 5 &&
        method === 'POST'
      ) {
        active();
        if (!manager) core.denied();
        schemas.empty.parse(body);
        const r = await load('document', id);
        core.stale(r, revision());
        const saved = (
          await tx.query<Row>(
            "UPDATE public.document SET status='ARCHIVED',revision=revision+1 WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *",
            [org, project, r.id],
          )
        ).rows[0]!;
        await event(r.id, 'document.archived');
        return dto(saved, 'document');
      }
      if (resource === 'discussions' || resource === 'updates') {
        const table = resource === 'discussions' ? 'discussion' : 'client_update';
        if (parts.length === 3 && method === 'GET') {
          const search =
            table === 'discussion'
              ? "(title ILIKE '%'||$3||'%' OR body ILIKE '%'||$3||'%')"
              : "body ILIKE '%'||$3||'%'";
          return page(
            (
              await tx.query<Row>(
                `SELECT * FROM public.${table} WHERE organization_id=$1 AND project_id=$2 AND ($3::text IS NULL OR ${search}) AND ($4::text IS NULL OR status=$4) ORDER BY created_at DESC,id DESC`,
                [org, project, q.q ?? null, q.status ?? null],
              )
            ).rows.map((r) => dto(r, table) as Row),
          );
        }
        if (parts.length === 3 && method === 'POST') {
          active();
          if (table === 'client_update' && !manager) core.denied();
          const b =
            table === 'discussion'
              ? expansionSchemas.discussionCreate.parse(body)
              : expansionSchemas.clientUpdateCreate.parse(body);
          return receipt(`${table}:create:${project}`, b, async () => {
            const r = (
              await tx.query<Row>(
                `INSERT INTO public.${table}(organization_id,project_id,author_id,body${table === 'discussion' ? ',title' : ''}) VALUES($1,$2,$3,$4${table === 'discussion' ? ',$5' : ''}) RETURNING *`,
                [org, project, user.user.id, b.body, ...('title' in b ? [b.title] : [])],
              )
            ).rows[0]!;
            await event(r.id, table === 'discussion' ? 'discussion.created' : 'update.published');
            return dto(r, table);
          });
        }
        if (id) {
          const r = await load(table, id);
          if (parts.length === 4 && method === 'GET') return dto(r, table);
          if (
            parts.length === 5 &&
            ((table === 'discussion' && action === 'archive') ||
              (table === 'client_update' && action === 'withdraw')) &&
            method === 'POST'
          ) {
            active();
            if (!manager) core.denied();
            schemas.empty.parse(body);
            core.stale(r, revision());
            const saved = (
              await tx.query<Row>(
                `UPDATE public.${table} SET status=$4,revision=revision+1${table === 'client_update' ? ',withdrawn_at=now()' : ''} WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *`,
                [org, project, r.id, table === 'discussion' ? 'ARCHIVED' : 'WITHDRAWN'],
              )
            ).rows[0]!;
            await event(r.id, table === 'discussion' ? 'discussion.archived' : 'update.withdrawn');
            return dto(saved, table);
          }
          if (table === 'discussion' && action === 'replies' && parts.length === 5) {
            if (method === 'GET')
              return page(
                (
                  await tx.query<Row>(
                    'SELECT * FROM public.discussion_reply WHERE organization_id=$1 AND project_id=$2 AND discussion_id=$3 ORDER BY created_at,id',
                    [org, project, r.id],
                  )
                ).rows.map((r) => dto(r, 'discussion_reply') as Row),
              );
            if (method === 'POST') {
              active();
              if (r.status !== 'ACTIVE') core.conflict('Topic is archived');
              const b = expansionSchemas.discussionReply.parse(body);
              return receipt(`discussion:reply:${r.id}`, b, async () => {
                const saved = (
                  await tx.query<Row>(
                    'INSERT INTO public.discussion_reply(organization_id,project_id,discussion_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING *',
                    [org, project, r.id, user.user.id, b.body],
                  )
                ).rows[0]!;
                await event(r.id, 'discussion.replied');
                return dto(saved, 'discussion_reply');
              });
            }
          }
        }
      }
      throw new Problem(404, 'NOT_FOUND', 'Route unavailable');
    });
  }
  async report(
    tx: SqlTransaction,
    org: string,
    ids: string[],
    projects: Row[],
    from?: string,
    to?: string,
  ) {
    const rows = [];
    let totalTasks = 0,
      totalDone = 0,
      totalOverdue = 0,
      totalApproved = 0,
      totalDecisions = 0,
      totalSeconds = 0;
    for (const id of ids) {
      const work = (
        await tx.query(
          "SELECT count(*) FILTER(WHERE status<>'CANCELLED')::int tasks,count(*) FILTER(WHERE status='DONE')::int done,count(*) FILTER(WHERE status NOT IN ('DONE','CANCELLED') AND due_at<now())::int overdue FROM public.task WHERE organization_id=$1 AND project_id=$2",
          [org, id],
        )
      ).rows[0];
      const decisions = (
        await tx.query(
          "SELECT count(*)::int decisions,coalesce(sum(extract(epoch FROM (closed_at-created_at))),0)::float8 seconds FROM public.review_cycle WHERE organization_id=$1 AND project_id=$2 AND status IN ('APPROVED','CHANGES_REQUESTED') AND ($3::timestamptz IS NULL OR closed_at>=$3) AND ($4::timestamptz IS NULL OR closed_at<$4)",
          [org, id, from ?? null, to ?? null],
        )
      ).rows[0];
      const approved = (
        await tx.query(
          'SELECT count(DISTINCT version_id)::int n FROM public.approval WHERE organization_id=$1 AND project_id=$2 AND ($3::timestamptz IS NULL OR created_at>=$3) AND ($4::timestamptz IS NULL OR created_at<$4)',
          [org, id, from ?? null, to ?? null],
        )
      ).rows[0].n;
      rows.push({
        id,
        name: projects.find((p) => p.id === id)!.name,
        ...work,
        progress: work.tasks ? work.done / work.tasks : null,
        approved_versions: approved,
        decisions: decisions.decisions,
        turnaround_seconds: decisions.decisions ? decisions.seconds / decisions.decisions : null,
      });
      totalTasks += work.tasks;
      totalDone += work.done;
      totalOverdue += work.overdue;
      totalApproved += approved;
      totalDecisions += decisions.decisions;
      totalSeconds += decisions.seconds;
    }
    return {
      projects: rows,
      totals: {
        tasks: totalTasks,
        done: totalDone,
        overdue: totalOverdue,
        progress: totalTasks ? totalDone / totalTasks : null,
        approved_versions: totalApproved,
        decisions: totalDecisions,
        turnaround_seconds: totalDecisions ? totalSeconds / totalDecisions : null,
      },
      from: from ?? null,
      to: to ?? null,
      definitions:
        'Tasks/progress/overdue are live state. Progress = DONE / noncancelled; no tasks = null. Overdue excludes DONE/CANCELLED. Approval counts identify distinct exact versions. Decision count/mean turnaround use APPROVED/CHANGES_REQUESTED terminal cycles closed in [from,to); cancelled/superseded excluded. UTC instants.',
    };
  }
}
