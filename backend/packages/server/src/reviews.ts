import { randomUUID } from 'node:crypto';
import { reviewSchemas, reviewQuery, uuid, schemas } from '@devworkspace/contracts';
import type { SqlTransaction } from '@devworkspace/database';
import type { Organizations } from './organizations.js';
import type { ActiveSession } from './identity.js';
import type { ProductResponse } from './product.js';
import { CoreDomain } from './core.js';
import { Files } from './files.js';
import { Problem, digest } from './security.js';
type Actor = { id: string; role: string; capacity: 'INTERNAL' | 'CLIENT' };
type Row = Record<string, unknown> & { id: string; revision: number; status: string };
const select = (r: Record<string, unknown>, fields: string) =>
  Object.fromEntries(
    fields
      .split(' ')
      .filter((k) => k in r)
      .map((k) => [k, r[k]]),
  );
const cycleFields =
  'id project_id deliverable_id version_id cycle_number policy status revision created_at closed_at due_at replaces_cycle_id';
export class Reviews {
  readonly core: CoreDomain;
  constructor(
    readonly organizations: Organizations,
    readonly files: Files | null,
  ) {
    this.core = new CoreDomain(organizations);
  }
  supports(path: string) {
    return (
      /^\/(reviews|portal)(\/|$)/.test(path) ||
      /^\/projects\/[^/]+\/(reviews|versions)(\/|$)/.test(path)
    );
  }
  async scoped<T>(
    user: ActiveSession,
    org: string,
    principal: string,
    client: boolean,
    work: (tx: SqlTransaction, actor: Actor) => Promise<T>,
  ) {
    if (!client)
      return this.organizations.scoped(user, org, principal, false, (tx, a) =>
        work(tx, { ...a, capacity: 'INTERNAL' }),
      );
    return this.organizations.database.transaction(org, async (tx) => {
      const o = await tx.query(
        "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [org],
      );
      if (!o.rowCount) this.core.missing();
      await tx.query('SELECT public.assert_session($1,$2)', [user.session.id, user.user.id]);
      const c = await tx.query(
        "SELECT id FROM public.client_contact WHERE organization_id=$1 AND id=$2 AND user_id=$3 AND status='ACTIVE'",
        [org, principal, user.user.id],
      );
      if (!c.rowCount) this.core.missing();
      await tx.query("SELECT set_config('app.actor_id',$1,true)", [user.user.id]);
      return work(tx, { id: principal, role: 'CLIENT', capacity: 'CLIENT' });
    });
  }
  async access(tx: SqlTransaction, org: string, project: string, actor: Actor) {
    if (actor.capacity === 'INTERNAL') return this.core.project(tx, org, project, actor);
    const result = await tx.query<Row>(
      "SELECT p.*,g.role,g.id grant_id FROM public.project p JOIN public.client_project_access g ON g.organization_id=p.organization_id AND g.project_id=p.id JOIN public.client_contact c ON c.organization_id=g.organization_id AND c.id=g.contact_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id WHERE p.organization_id=$1 AND p.id=$2 AND p.portal_enabled AND p.status<>'ARCHIVED' AND g.contact_id=$3 AND g.status='ACTIVE' AND c.status='ACTIVE' AND x.status='ACTIVE'",
      [org, project, actor.id],
    );
    const p = result.rows[0] ?? this.core.missing();
    return { p, manager: false, role: String(p.role), grant_id: String(p.grant_id) };
  }
  async shared(tx: SqlTransaction, org: string, project: string, version: string) {
    const r = await tx.query<Row>(
      "SELECT v.* FROM public.deliverable_version v JOIN public.version_share s ON s.organization_id=v.organization_id AND s.project_id=v.project_id AND s.version_id=v.id AND s.status='ACTIVE' JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id AND d.status='ACTIVE' WHERE v.organization_id=$1 AND v.project_id=$2 AND v.id=$3",
      [org, project, version],
    );
    const v = r.rows[0] ?? this.core.missing();
    if (!this.files) throw new Problem(503, 'STORAGE_UNAVAILABLE', 'Storage unavailable');
    await this.files.asset(tx, org, project, String(v.asset_id));
    return v;
  }
  async execute(
    tx: SqlTransaction,
    user: ActiveSession,
    org: string,
    actor: Actor,
    path: string,
    method: string,
    body: unknown,
    revision: () => number,
    rid: string,
    params: URLSearchParams,
    key?: string,
    range?: string,
  ): Promise<ProductResponse> {
    if (method !== 'GET')
      await tx.query(
        "SELECT set_config('app.request_id',$1,true),set_config('app.principal_id',$2,true),set_config('app.capacity',$3,true)",
        [rid, actor.id, actor.capacity],
      );
    const client = actor.capacity === 'CLIENT';
    if (path === '/portal/projects') path = '/portal';
    const ok = (body: unknown, status = method === 'POST' ? 201 : 200): ProductResponse => ({
      status,
      body,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    });
    const event = async (target: string, action: string, metadata: Record<string, string> = {}) =>
      this.organizations.event(tx, org, user.user.id, 'review.changed', target, rid, {
        action,
        capacity: actor.capacity,
        principal_id: actor.id,
        ...metadata,
      });
    const receipt = async (operation: string, payload: unknown, work: () => Promise<unknown>) => {
      const k = uuid.parse(key),
        hash = digest(JSON.stringify(payload));
      const op = 'review:' + actor.id + ':' + operation;
      const previous = (
        await tx.query(
          'SELECT request_hash,result FROM public.command_receipt WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
          [org, user.user.id, op, k],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) this.core.conflict('Idempotency key payload changed');
        return previous.result;
      }
      const result = await work();
      await tx.query(
        'INSERT INTO public.command_receipt(organization_id,actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
        [org, user.user.id, op, k, hash, result],
      );
      return result;
    };
    // Portal aggregate and internal review center authorize before pagination/counts.
    if (
      (path === '/reviews' || path === '/portal' || path === '/portal/reviews') &&
      method === 'GET'
    ) {
      const q = reviewQuery.parse(Object.fromEntries(params));
      const projectFilter = q.project_id;
      if (projectFilter) await this.access(tx, org, projectFilter, actor);
      const visibility = client
        ? "EXISTS(SELECT 1 FROM public.client_project_access g JOIN public.client_contact c ON c.organization_id=g.organization_id AND c.id=g.contact_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id WHERE g.organization_id=p.organization_id AND g.project_id=p.id AND g.contact_id=$2 AND g.status='ACTIVE' AND c.status='ACTIVE' AND x.status='ACTIVE') AND p.portal_enabled AND p.status<>'ARCHIVED'"
        : "($3<>'MEMBER' OR EXISTS(SELECT 1 FROM public.project_membership m WHERE m.organization_id=p.organization_id AND m.project_id=p.id AND m.membership_id=$2 AND m.status='ACTIVE'))";
      if (path === '/portal') {
        const r = await tx.query(
          `SELECT p.id,p.name,p.description,p.status FROM public.project p WHERE p.organization_id=$1 AND $3::text IS NOT NULL AND ${visibility} AND ($4::uuid IS NULL OR p.id=$4) ORDER BY p.id LIMIT $5 OFFSET $6`,
          [org, actor.id, actor.role, projectFilter ?? null, q.limit, (q.page - 1) * q.limit],
        );
        return ok({ items: r.rows, page: q.page, limit: q.limit });
      }
      const where =
        `FROM public.review_cycle r JOIN public.project p ON p.organization_id=r.organization_id AND p.id=r.project_id WHERE r.organization_id=$1 AND $3::text IS NOT NULL AND ${visibility} AND ($4::uuid IS NULL OR p.id=$4) AND ($5::text IS NULL OR r.status=$5) AND ($6::timestamptz IS NULL OR r.due_at<=$6) AND ($7::uuid IS NULL OR r.version_id=$7)` +
        (client
          ? " AND EXISTS(SELECT 1 FROM public.version_share s WHERE s.organization_id=r.organization_id AND s.version_id=r.version_id AND s.status='ACTIVE')"
          : '');
      const args = [
        org,
        actor.id,
        actor.role,
        projectFilter ?? null,
        q.status ?? null,
        q.due_before ?? null,
        q.version_id ?? null,
      ];
      const total = (await tx.query('SELECT count(*)::int total ' + where, args)).rows[0].total;
      const r = await tx.query(`SELECT r.* ${where} ORDER BY r.id LIMIT $8 OFFSET $9`, [
        ...args,
        q.limit,
        (q.page - 1) * q.limit,
      ]);
      return ok({
        items: r.rows.map((r) => select(r, cycleFields)),
        total,
        page: q.page,
        limit: q.limit,
      });
    }
    const overview = /^\/portal\/projects\/([^/]+)$/.exec(path);
    if (overview && method === 'GET') {
      const project = uuid.parse(overview[1]);
      const access = await this.access(tx, org, project, actor);
      const q = reviewQuery.parse(Object.fromEntries(params));
      const total = (
        await tx.query(
          'SELECT count(*)::int total FROM public.milestone WHERE organization_id=$1 AND project_id=$2',
          [org, project],
        )
      ).rows[0].total;
      const milestones = (
        await tx.query(
          'SELECT id,title,status,due_at FROM public.milestone WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id LIMIT $3 OFFSET $4',
          [org, project, q.limit, (q.page - 1) * q.limit],
        )
      ).rows;
      return ok({
        ...select(access.p, 'id name description status'),
        milestones,
        milestone_total: total,
        milestone_page: q.page,
      });
    }
    const m =
      /^\/(?:portal\/)?projects\/([^/]+)\/(reviews|versions)(?:\/([^/]+))?(?:\/(share|replace|cancel|decisions|feedback|download|preview))?(?:\/([^/]+))?(?:\/(replies|resolution|task))?$/.exec(
        path,
      );
    if (!m) this.core.missing();
    const project = uuid.parse(m[1]),
      kind = m[2]!,
      id = m[3] ? uuid.parse(m[3]) : undefined,
      action = m[4],
      child = m[5],
      tail = m[6];
    const access = await this.access(tx, org, project, actor);
    const writable = () => {
      if (!['PLANNED', 'ACTIVE'].includes(access.p.status))
        this.core.conflict('Reopen the project before changing content');
    };
    const manager = () => {
      if (client || !access.manager) this.core.denied();
    };
    if (kind === 'versions') {
      if (action === 'share' && method === 'PATCH' && id) {
        manager();
        writable();
        const b = reviewSchemas.versionShare.parse(body);
        const v = await this.core.row(tx, 'deliverable_version', org, id, project);
        if (b.status === 'ACTIVE') await this.files?.asset(tx, org, project, String(v.asset_id));
        const old = (
          await tx.query(
            'SELECT revision FROM public.version_share WHERE organization_id=$1 AND project_id=$2 AND version_id=$3',
            [org, project, id],
          )
        ).rows[0];
        if ((old?.revision ?? 1) !== revision())
          throw new Problem(412, 'STALE_REVISION', 'Share changed. Reload.');
        const r = await tx.query(
          'INSERT INTO public.version_share(organization_id,project_id,version_id,status,actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(version_id) DO UPDATE SET status=EXCLUDED.status,actor_id=EXCLUDED.actor_id,updated_at=now(),revision=version_share.revision+1 RETURNING version_id,status,revision',
          [org, project, id, b.status, user.user.id],
        );
        await event(id, 'version.shared', { status: b.status });
        return ok(r.rows[0]);
      }
      if (method !== 'GET') this.core.missing();
      if (!id) {
        const q = reviewQuery.parse(Object.fromEntries(params));
        const r = await tx.query(
          "SELECT v.id,v.deliverable_id,v.version_number,v.digest,v.mime,v.created_at,d.title,r.status review_status,r.id review_id,s.status share_status,coalesce(s.revision,1) share_revision FROM public.deliverable_version v JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id LEFT JOIN public.version_share s ON s.organization_id=v.organization_id AND s.version_id=v.id LEFT JOIN LATERAL (SELECT id,status FROM public.review_cycle c WHERE c.organization_id=v.organization_id AND c.project_id=v.project_id AND c.version_id=v.id ORDER BY c.cycle_number DESC LIMIT 1) r ON true WHERE v.organization_id=$1 AND v.project_id=$2 AND ($3::boolean=false OR (s.status='ACTIVE' AND d.status='ACTIVE')) ORDER BY v.id LIMIT $4 OFFSET $5",
          [org, project, client, q.limit, (q.page - 1) * q.limit],
        );
        return ok({ items: r.rows, page: q.page, limit: q.limit, manager: access.manager });
      }
      const v = client
        ? await this.shared(tx, org, project, id)
        : await this.core.row(tx, 'deliverable_version', org, id, project);
      if (action === 'download' || action === 'preview')
        return this.content(tx, org, project, v, action, child, range);
      if (action) this.core.missing();
      return ok(select(v, 'id project_id deliverable_id version_number digest mime created_at'));
    }
    const open = async (b: ReturnType<typeof reviewSchemas.reviewOpen.parse>, replaces?: Row) => {
      manager();
      writable();
      if (access.p.status !== 'ACTIVE' || access.p.portal_enabled !== true)
        this.core.conflict('Enable the portal on an active project before opening a review');
      const v = await this.shared(tx, org, project, b.version_id);
      if (v.digest !== b.digest) this.core.conflict('Confirm the selected exact version digest');
      const d = await this.core.row(tx, 'deliverable', org, String(v.deliverable_id), project);
      if (replaces) {
        if (replaces.status !== 'OPEN' || replaces.deliverable_id !== v.deliverable_id)
          this.core.conflict('Only an open review can be replaced within the same deliverable');
        const prior = await this.core.row(
          tx,
          'deliverable_version',
          org,
          String(replaces.version_id),
          project,
        );
        if (Number(v.version_number) <= Number(prior.version_number))
          this.core.conflict('Select a newer version');
      }
      if (
        (
          await tx.query(
            'SELECT id FROM public.approval WHERE organization_id=$1 AND version_id=$2',
            [org, v.id],
          )
        ).rowCount
      )
        this.core.conflict('Approved versions cannot be reviewed again');
      const grants = [];
      for (const contact of b.approver_ids) {
        const g = (
          await tx.query(
            "SELECT g.id FROM public.client_project_access g JOIN public.client_contact c ON c.organization_id=g.organization_id AND c.id=g.contact_id WHERE g.organization_id=$1 AND g.project_id=$2 AND g.contact_id=$3 AND g.status='ACTIVE' AND g.role='APPROVER' AND c.status='ACTIVE' AND c.user_id IS NOT NULL AND public.eligible_contact(c.id)",
            [org, project, contact],
          )
        ).rows[0];
        if (!g) this.core.conflict('Select currently eligible named Approvers');
        grants.push({ contact, id: g.id });
      }
      if (replaces)
        await tx.query(
          "UPDATE public.review_cycle SET status='SUPERSEDED',revision=revision+1,closed_at=now() WHERE organization_id=$1 AND id=$2",
          [org, replaces.id],
        );
      const num = (
        await tx.query(
          'SELECT coalesce(max(cycle_number),0)+1 n FROM public.review_cycle WHERE organization_id=$1 AND version_id=$2',
          [org, v.id],
        )
      ).rows[0].n;
      const created = (
        await tx.query<Row>(
          'INSERT INTO public.review_cycle(organization_id,project_id,deliverable_id,version_id,cycle_number,opener_id,due_at,replaces_cycle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [org, project, d.id, v.id, num, user.user.id, b.due_at, replaces?.id ?? null],
        )
      ).rows[0]!;
      for (const g of grants)
        await tx.query(
          "INSERT INTO public.review_participant(organization_id,project_id,cycle_id,contact_id,grant_id,role) VALUES($1,$2,$3,$4,$5,'APPROVER')",
          [org, project, created.id, g.contact, g.id],
        );
      await event(created.id, replaces ? 'review.replaced' : 'review.opened', {
        version_id: v.id,
        previous_cycle_id: replaces?.id ?? '',
        previous_version_id: String(replaces?.version_id ?? ''),
      });
      return select(created, cycleFields);
    };
    if (!id) {
      if (method === 'POST') {
        manager();
        const b = reviewSchemas.reviewOpen.parse(body);
        return ok(await receipt(path, b, () => open(b)));
      }
      if (method === 'GET') {
        const supplied = reviewQuery.parse(Object.fromEntries(params));
        if (supplied.project_id && supplied.project_id !== project) this.core.missing();
        const q = new URLSearchParams(params);
        q.set('project_id', project);
        return this.execute(
          tx,
          user,
          org,
          actor,
          client ? '/portal/reviews' : '/reviews',
          method,
          body,
          revision,
          rid,
          q,
          key,
        );
      }
      this.core.missing();
    }
    const c = await this.core.row(tx, 'review_cycle', org, id, project);
    const v = client
      ? await this.shared(tx, org, project, String(c.version_id))
      : await this.core.row(tx, 'deliverable_version', org, String(c.version_id), project);
    const roster = (
      await tx.query(
        'SELECT contact_id,grant_id,role FROM public.review_participant WHERE organization_id=$1 AND cycle_id=$2',
        [org, c.id],
      )
    ).rows;
    const eligible =
      client &&
      access.role === 'APPROVER' &&
      roster.some(
        (r) =>
          r.contact_id === actor.id &&
          r.grant_id === ('grant_id' in access ? access.grant_id : undefined),
      );
    if (!action && method === 'GET') {
      const a = await this.files?.asset(tx, org, project, String(v.asset_id));
      const previews = (
        await tx.query(
          'SELECT page,width,height FROM public.file_preview WHERE organization_id=$1 AND project_id=$2 AND asset_id=$3 ORDER BY page',
          [org, project, v.asset_id],
        )
      ).rows;
      const decision =
        (
          await tx.query(
            'SELECT decision,reason,digest,version_id,created_at FROM public.review_decision WHERE organization_id=$1 AND cycle_id=$2',
            [org, c.id],
          )
        ).rows[0] ?? null;
      return ok({
        ...select(c, cycleFields),
        version: select(v, 'id version_number digest mime'),
        previews,
        source: a ? select(a, 'width height pages') : null,
        decision,
        manager: access.manager,
        canFeedback:
          access.role !== 'VIEWER' &&
          c.status === 'OPEN' &&
          ['PLANNED', 'ACTIVE'].includes(access.p.status),
        canResolve: !client && access.role !== 'VIEWER',
        canDecide: eligible && c.status === 'OPEN',
        ...(!client
          ? {
              participants: roster,
              latest_prepared_version_id: (
                await this.core.row(tx, 'deliverable', org, String(c.deliverable_id), project)
              ).latest_version_id,
            }
          : {}),
      });
    }
    if ((action === 'preview' || action === 'download') && method === 'GET')
      return this.content(tx, org, project, v, action, child, range);
    if (action === 'replace' && method === 'POST') {
      manager();
      writable();
      const b = reviewSchemas.reviewOpen.parse(body);
      return ok(
        await receipt(path, { ...b, revision: revision() }, async () => {
          this.core.stale(c, revision());
          return open(b, c);
        }),
      );
    }
    if (action === 'cancel' && method === 'POST') {
      manager();
      writable();
      schemas.empty.parse(body);
      this.core.stale(c, revision());
      if (c.status !== 'OPEN') this.core.conflict('Review is terminal');
      await tx.query(
        "UPDATE public.review_cycle SET status='CANCELLED',revision=revision+1,closed_at=now() WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      await event(id, 'review.cancelled');
      return ok({ status: 'ok' });
    }
    if (action === 'decisions' && method === 'POST') {
      if (!eligible) this.core.denied();
      writable();
      const b = reviewSchemas.reviewDecision.parse(body);
      if (b.version_id !== c.version_id || b.digest !== v.digest)
        this.core.conflict('Confirm the displayed exact version and digest');
      return ok(
        await receipt(path, { ...b, revision: revision() }, async () => {
          this.core.stale(c, revision());
          if (c.status !== 'OPEN') this.core.conflict('Review is terminal');
          await this.shared(tx, org, project, v.id);
          const d = (
            await tx.query(
              'INSERT INTO public.review_decision(organization_id,project_id,cycle_id,version_id,contact_id,grant_id,actor_id,decision,reason,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
              [
                org,
                project,
                c.id,
                v.id,
                actor.id,
                'grant_id' in access ? access.grant_id : null,
                user.user.id,
                b.decision,
                b.reason,
                v.digest,
              ],
            )
          ).rows[0];
          await tx.query(
            'UPDATE public.review_cycle SET status=$3,revision=revision+1,closed_at=now() WHERE organization_id=$1 AND id=$2',
            [org, c.id, b.decision],
          );
          if (b.decision === 'APPROVED')
            await tx.query(
              'INSERT INTO public.approval(organization_id,project_id,cycle_id,version_id,decision_id,digest,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [org, project, c.id, v.id, d.id, v.digest, user.user.id],
            );
          await event(c.id, 'review.decided', { version_id: v.id, decision: b.decision });
          return { id: d.id, version_id: v.id, decision: b.decision };
        }),
      );
    }
    if (action !== 'feedback') this.core.missing();
    const feedbackFields =
      'id cycle_id version_id actor_id principal_id capacity visibility body annotation digest source_width source_height created_at';
    const thread = child
      ? await this.core.row(tx, 'feedback_thread', org, uuid.parse(child), project)
      : undefined;
    if (thread && (thread.cycle_id !== c.id || (client && thread.visibility !== 'CLIENT')))
      this.core.missing();
    if (method === 'GET' && !tail) {
      const q = reviewQuery.parse(Object.fromEntries(params));
      const r = await tx.query<Row>(
        "SELECT * FROM public.feedback_thread WHERE organization_id=$1 AND project_id=$2 AND cycle_id=$3 AND ($4::boolean=false OR visibility='CLIENT') AND ($5::uuid IS NULL OR id=$5) ORDER BY id LIMIT $6 OFFSET $7",
        [org, project, c.id, client, thread?.id ?? null, q.limit, (q.page - 1) * q.limit],
      );
      const items = [];
      for (const f of r.rows) {
        const replies = (
          await tx.query(
            'SELECT id,actor_id,principal_id,capacity,body,created_at FROM public.feedback_reply WHERE organization_id=$1 AND project_id=$2 AND thread_id=$3 ORDER BY created_at,id',
            [org, project, f.id],
          )
        ).rows;
        const resolution =
          (
            await tx.query(
              'SELECT state FROM public.feedback_resolution WHERE organization_id=$1 AND project_id=$2 AND thread_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
              [org, project, f.id],
            )
          ).rows[0]?.state ?? 'REOPENED';
        const internal = client
          ? {}
          : {
              task_id:
                (
                  await tx.query(
                    'SELECT id FROM public.task WHERE organization_id=$1 AND project_id=$2 AND source_feedback_thread_id=$3',
                    [org, project, f.id],
                  )
                ).rows[0]?.id ?? null,
              resolution_history: (
                await tx.query(
                  'SELECT id,state,note,actor_id,created_at FROM public.feedback_resolution WHERE organization_id=$1 AND project_id=$2 AND thread_id=$3 ORDER BY created_at,id',
                  [org, project, f.id],
                )
              ).rows,
            };
        items.push({ ...select(f, feedbackFields), replies, resolution, ...internal });
      }
      return ok({ items, page: q.page, limit: q.limit });
    }
    if (method !== 'POST') this.core.missing();
    writable();
    if (tail === 'task' && thread) {
      manager();
      const b = reviewSchemas.feedbackTask.parse(body);
      return ok(
        await receipt(path, b, async () => {
          if (
            (
              await tx.query(
                'SELECT id FROM public.task WHERE organization_id=$1 AND project_id=$2 AND source_feedback_thread_id=$3',
                [org, project, thread.id],
              )
            ).rowCount
          )
            this.core.conflict('This feedback already has an internal task');
          const task = (await this.core.execute(
            tx,
            user,
            org,
            actor,
            `/projects/${project}/tasks`,
            'POST',
            b,
            revision,
            rid,
            new URLSearchParams(),
            thread.id,
          )) as { id: string };
          await this.core.history(tx, org, project, task.id, user.user.id, 'feedback.converted', {
            thread_id: thread.id,
          });
          await event(thread.id, 'feedback.converted', { task_id: task.id });
          return task;
        }),
      );
    }
    if (access.role === 'VIEWER') this.core.denied();
    if (tail === 'resolution' && thread) {
      if (client) this.core.denied();
      const b = reviewSchemas.feedbackResolution.parse(body);
      await tx.query(
        'INSERT INTO public.feedback_resolution(organization_id,project_id,thread_id,actor_id,state,note) VALUES($1,$2,$3,$4,$5,$6)',
        [org, project, thread.id, user.user.id, b.state, b.note],
      );
      await event(thread.id, 'feedback.resolved');
      return ok({ status: 'ok' });
    }
    if (c.status !== 'OPEN') this.core.conflict('Closed reviews are read only');
    if (tail === 'replies' && thread) {
      const b = reviewSchemas.feedbackReply.parse(body);
      const r = await tx.query(
        'INSERT INTO public.feedback_reply(organization_id,project_id,thread_id,actor_id,principal_id,capacity,body) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [org, project, thread.id, user.user.id, actor.id, actor.capacity, b.body],
      );
      await event(thread.id, 'feedback.replied');
      return ok(r.rows[0]);
    }
    if (child || tail) this.core.missing();
    const b = reviewSchemas.reviewFeedback.parse(body);
    if (client && b.visibility !== 'CLIENT') this.core.denied();
    if (b.version_id !== v.id || b.digest !== v.digest)
      this.core.conflict('Feedback targets another version');
    const page = b.annotation?.type === 'PDF_POINT' ? b.annotation.page : 1;
    const preview = (
      await tx.query(
        'SELECT width,height FROM public.file_preview WHERE organization_id=$1 AND project_id=$2 AND asset_id=$3 AND page=$4',
        [org, project, v.asset_id, page],
      )
    ).rows[0];
    if (
      b.annotation &&
      (!preview || (v.mime === 'application/pdf') !== (b.annotation.type === 'PDF_POINT'))
    )
      throw new Problem(400, 'INVALID_GEOMETRY', 'Annotation page or type is unavailable');
    const fid = randomUUID();
    await tx.query(
      'INSERT INTO public.feedback_thread(id,organization_id,project_id,cycle_id,version_id,actor_id,principal_id,capacity,visibility,body,annotation,digest,source_width,source_height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [
        fid,
        org,
        project,
        c.id,
        v.id,
        user.user.id,
        actor.id,
        actor.capacity,
        b.visibility,
        b.body,
        b.annotation,
        v.digest,
        b.annotation ? preview.width : null,
        b.annotation ? preview.height : null,
      ],
    );
    await event(fid, 'feedback.created', {
      cycle_id: c.id,
      version_id: v.id,
      visibility: b.visibility,
    });
    return ok({ id: fid });
  }
  async content(
    tx: SqlTransaction,
    org: string,
    project: string,
    v: Row,
    action: string,
    page?: string,
    range?: string,
  ): Promise<ProductResponse> {
    if (!this.files) throw new Problem(503, 'STORAGE_UNAVAILABLE', 'Storage unavailable');
    const a = await this.files.asset(tx, org, project, String(v.asset_id));
    // Reuse the private exact storage-version reader after the review/portal policy has succeeded.
    return this.files.content(tx, org, project, a, action, page, range);
  }
}
