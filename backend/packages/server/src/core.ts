import { randomUUID } from 'node:crypto';
import { coreSchemas, coreQuery } from '@devworkspace/contracts';
import type { SqlTransaction } from '@devworkspace/database';
import type { Organizations } from './organizations.js';
import type { ActiveSession } from './identity.js';
import { Problem } from './security.js';
type Row = Record<string, unknown> & { id: string; revision: number; status: string };
type Actor = { id: string; role: string };
const definitions = {
  clients: { table: 'client', schema: 'client', fields: ['name', 'description', 'status'] },
  contacts: { table: 'client_contact', schema: 'contact', fields: ['name', 'email', 'status'] },
  projects: {
    table: 'project',
    schema: 'project',
    fields: ['client_id', 'name', 'description', 'status', 'due_at', 'portal_enabled'],
  },
  members: {
    table: 'project_membership',
    schema: 'participation',
    fields: ['membership_id', 'role', 'status'],
  },
  grants: {
    table: 'client_project_access',
    schema: 'grant',
    fields: ['contact_id', 'role', 'status'],
  },
  milestones: {
    table: 'milestone',
    schema: 'milestone',
    fields: ['title', 'due_at', 'position', 'status'],
  },
  tasks: {
    table: 'task',
    schema: 'task',
    fields: [
      'title',
      'description',
      'milestone_id',
      'assignee_id',
      'priority',
      'status',
      'due_at',
      'position',
    ],
  },
  checklist: {
    table: 'task_checklist',
    schema: 'checklist',
    fields: ['label', 'position', 'completed'],
  },
} as const;
type Resource = keyof typeof definitions;
export class CoreDomain {
  constructor(readonly organizations: Organizations) {}
  supports(sub: string) {
    return /^\/(clients|projects|my-tasks|dashboard)(\/|$)/.test(sub);
  }
  denied(): never {
    throw new Problem(403, 'FORBIDDEN', 'This action requires project management permission');
  }
  missing(): never {
    throw new Problem(404, 'NOT_FOUND', 'Resource unavailable');
  }
  conflict(message: string): never {
    throw new Problem(409, 'CONFLICT', message);
  }
  stale(row: Row, revision: number) {
    if (row.revision !== revision)
      throw new Problem(412, 'STALE_REVISION', 'This record changed. Reload before saving.');
  }
  async row(
    tx: SqlTransaction,
    table: string,
    org: string,
    id: string,
    project?: string,
    task?: string,
  ) {
    const values = [org, id, ...(project ? [project] : []), ...(task ? [task] : [])];
    const r = await tx.query<Row>(
      `SELECT * FROM public.${table} WHERE organization_id=$1 AND id=$2${project ? ' AND project_id=$3' : ''}${task ? ' AND task_id=$4' : ''}${['task_comment', 'deliverable_version', 'feedback_thread'].includes(table) ? '' : ' FOR UPDATE'}`,
      values,
    );
    return r.rows[0] ?? this.missing();
  }
  dto(row: Row, resource: Resource) {
    const d = definitions[resource];
    const keys = [
      'id',
      'revision',
      ...d.fields,
      ...(resource === 'members' ? ['name'] : []),
      'project_id',
      'created_at',
      'updated_at',
      ...(resource === 'tasks' ? ['source_feedback_thread_id'] : []),
      ...(resource === 'checklist' ? ['completed_at', 'completed_by'] : []),
    ];
    return Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));
  }
  async project(tx: SqlTransaction, org: string, id: string, actor: Actor) {
    const p = await this.row(tx, 'project', org, id);
    const r = await tx.query<Row>(
      "SELECT * FROM public.project_membership WHERE organization_id=$1 AND project_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [org, id, actor.id],
    );
    const member = r.rows[0];
    if (actor.role === 'MEMBER' && !member) this.missing();
    return {
      p,
      member,
      manager: actor.role !== 'MEMBER' || member?.role === 'MANAGER',
      role: actor.role !== 'MEMBER' ? 'MANAGER' : String(member?.role),
    };
  }
  async history(
    tx: SqlTransaction,
    org: string,
    project: string,
    task: string,
    user: string,
    kind: string,
    fields: Record<string, unknown> = {},
  ) {
    await tx.query(
      'INSERT INTO public.task_history(organization_id,project_id,task_id,actor_id,kind,fields) VALUES($1,$2,$3,$4,$5,$6)',
      [org, project, task, user, kind, fields],
    );
  }
  async event(
    tx: SqlTransaction,
    org: string,
    user: string,
    target: string,
    rid: string,
    action: string,
    metadata: Record<string, string> = {},
  ) {
    await this.organizations.event(tx, org, user, 'core.changed', target, rid, {
      action,
      capacity: 'INTERNAL',
      ...metadata,
    });
  }
  async summary(tx: SqlTransaction, org: string, project: string, milestone?: string) {
    const { rows } = await tx.query<{ total: number; done: number; overdue: number }>(
      `SELECT count(*) FILTER(WHERE status<>'CANCELLED')::int total,count(*) FILTER(WHERE status='DONE')::int done,count(*) FILTER(WHERE status NOT IN ('DONE','CANCELLED') AND due_at<now())::int overdue FROM public.task WHERE organization_id=$1 AND project_id=$2${milestone ? ' AND milestone_id=$3' : ''}`,
      [org, project, ...(milestone ? [milestone] : [])],
    );
    const s = rows[0]!;
    return { ...s, progress: s.total ? s.done / s.total : null };
  }
  async execute(
    tx: SqlTransaction,
    user: ActiveSession,
    org: string,
    actor: Actor,
    sub: string,
    method: string,
    body: unknown,
    revision: () => number,
    rid: string,
    params: URLSearchParams,
    sourceFeedback?: string,
  ) {
    if (method !== 'GET')
      await tx.query(
        "SELECT set_config('app.request_id',$1,true),set_config('app.principal_id',$2,true),set_config('app.capacity','INTERNAL',true)",
        [rid, actor.id],
      );
    if (
      !/^\/(?:clients(?:\/[^/]+(?:\/contacts(?:\/[^/]+)?)?)?|projects(?:\/[^/]+(?:\/(?:members|grants|milestones|tasks|candidates)(?:\/[^/]+(?:\/(?:checklist|comments|history)(?:\/[^/]+)?)?)?)?)?|my-tasks|dashboard)$/.test(
        sub,
      )
    )
      this.missing();
    const parts = sub.split('/').filter(Boolean);
    // UUID validation precedes all database casts and protects nested resource lookup.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (let i = 1; i < parts.length; i += 2)
      if (!uuidPattern.test(parts[i]!))
        throw new Problem(400, 'INVALID_INPUT', 'Invalid resource identifier');
    if (parts[0] === 'projects' && parts.length > 4 && parts[2] !== 'tasks') this.missing();
    if (
      parts[0] === 'projects' &&
      ['comments', 'history'].includes(parts[4] ?? '') &&
      parts.length > 5
    )
      this.missing();
    const isAdmin = actor.role !== 'MEMBER';
    const q = coreQuery.parse(Object.fromEntries(params));
    const projectId = parts[0] === 'projects' ? parts[1] : undefined;
    const access = projectId ? await this.project(tx, org, projectId, actor) : undefined;
    const manager = access?.manager ?? isAdmin;
    const project = access?.p;
    if (
      method !== 'GET' &&
      project &&
      ['COMPLETED', 'ARCHIVED'].includes(project.status) &&
      !(parts.length === 2 && method === 'PATCH' && project.status === 'COMPLETED') &&
      !(
        method === 'PATCH' &&
        ['members', 'grants'].includes(parts[2] ?? '') &&
        typeof body === 'object' &&
        body !== null &&
        'status' in body &&
        ['INACTIVE', 'REVOKED'].includes(String(body.status))
      )
    )
      this.conflict('Reopen the project before changing its content');
    if (parts[0] === 'dashboard' || parts[0] === 'my-tasks') {
      if (method !== 'GET') this.missing();
      return this.list(
        tx,
        org,
        actor,
        parts[0] === 'dashboard' ? 'projects' : 'tasks',
        q,
        undefined,
        undefined,
        undefined,
        parts[0] === 'my-tasks',
      );
    }
    if (parts[2] === 'candidates' && projectId && method === 'GET') {
      if (!manager) this.denied();
      const from =
        "FROM public.membership m CROSS JOIN LATERAL public.team_identity(m.user_id) u WHERE m.organization_id=$1 AND m.status='ACTIVE' AND public.eligible_member(m.user_id) AND u.name ILIKE $2";
      const result = await tx.query(
        'SELECT m.id,u.name ' + from + ' ORDER BY m.id LIMIT $3 OFFSET $4',
        [org, '%' + (q.q ?? '') + '%', q.limit, (q.page - 1) * q.limit],
      );
      const total = (
        await tx.query('SELECT count(*)::int total ' + from, [org, '%' + (q.q ?? '') + '%'])
      ).rows[0].total;
      return { items: result.rows, total, page: q.page, limit: q.limit };
    }
    let resource: Resource;
    let id: string | undefined;
    let client: string | undefined;
    let task: string | undefined;
    if (parts[0] === 'clients') {
      client = parts[1];
      resource = parts[2] === 'contacts' ? 'contacts' : 'clients';
      id = parts[2] ? parts[3] : parts[1];
    } else if (parts[0] === 'projects') {
      resource = (parts[2] ?? 'projects') as Resource;
      id = parts[2] ? parts[3] : parts[1];
      if (parts[2] === 'tasks' && parts[4]) {
        task = parts[3];
        resource = parts[4] as Resource;
        id = parts[5];
      }
    } else return this.missing();
    if (resource === 'contacts' && client) {
      await this.row(tx, 'client', org, client);
      if (!isAdmin) {
        const allowed = await tx.query(
          "SELECT 1 FROM public.project p JOIN public.project_membership m ON m.organization_id=p.organization_id AND m.project_id=p.id WHERE p.organization_id=$1 AND p.client_id=$2 AND m.membership_id=$3 AND m.role='MANAGER' AND m.status='ACTIVE'",
          [org, client, actor.id],
        );
        if (!allowed.rowCount) this.missing();
      }
    }
    const t = task && projectId ? await this.row(tx, 'task', org, task, projectId) : undefined;
    const assigned = access?.member?.id === t?.assignee_id && access?.role === 'CONTRIBUTOR';
    if ((resource as string) === 'comments' || (resource as string) === 'history') {
      if (!t || !projectId) this.missing();
      const table = (resource as string) === 'comments' ? 'task_comment' : 'task_history';
      if (method === 'GET') {
        const result = await tx.query(
          `SELECT ${table === 'task_comment' ? 'id,thread_id,author_id,body,created_at' : 'id,actor_id,kind,fields,created_at'} FROM public.${table} WHERE organization_id=$1 AND project_id=$2 AND task_id=$3 ORDER BY created_at,id LIMIT $4 OFFSET $5`,
          [org, projectId, task, q.limit, (q.page - 1) * q.limit],
        );
        return { items: result.rows, page: q.page, limit: q.limit };
      }
      if (method !== 'POST' || table !== 'task_comment') this.missing();
      if (!manager && access?.role !== 'CONTRIBUTOR') this.denied();
      const b = coreSchemas.comment.parse(body);
      if (b.thread_id) {
        const thread = await this.row(tx, 'task_comment', org, b.thread_id, projectId, task);
        if (thread.thread_id) this.conflict('Replies must target a root thread');
      }
      const result = await tx.query(
        'INSERT INTO public.task_comment(organization_id,project_id,task_id,author_id,body,thread_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,thread_id,author_id,body,created_at',
        [org, projectId, task, user.user.id, b.body, b.thread_id],
      );
      await this.history(tx, org, projectId, task!, user.user.id, 'comment.created', {
        commentId: result.rows[0].id,
      });
      await this.event(tx, org, user.user.id, t!.id, rid, 'comment.created');
      return result.rows[0];
    }
    if (!(resource in definitions)) this.missing();
    if (resource === 'grants' && !manager) this.missing();
    const def = definitions[resource];
    if (
      !['GET', 'POST', 'PATCH', 'DELETE'].includes(method) ||
      (method === 'POST' && id) ||
      (['PATCH', 'DELETE'].includes(method) && !id)
    )
      this.missing();
    if (method === 'GET') {
      if (!id) return this.list(tx, org, actor, resource, q, projectId, client, task);
      const row = await this.row(
        tx,
        def.table,
        org,
        id,
        resource !== 'projects' && resource !== 'clients' && resource !== 'contacts'
          ? projectId
          : undefined,
        task,
      );
      if (resource === 'contacts' && row.client_id !== client) this.missing();
      if (resource === 'clients' && !isAdmin) {
        const visible = await tx.query(
          "SELECT 1 FROM public.project p JOIN public.project_membership pm ON pm.organization_id=p.organization_id AND pm.project_id=p.id WHERE p.organization_id=$1 AND p.client_id=$2 AND pm.membership_id=$3 AND pm.status='ACTIVE'",
          [org, id, actor.id],
        );
        if (!visible.rowCount) this.missing();
      }
      return {
        ...this.dto(row, resource),
        ...(resource === 'tasks' && row.source_feedback_thread_id
          ? {
              source_review_id: (
                await tx.query(
                  'SELECT cycle_id FROM public.feedback_thread WHERE organization_id=$1 AND project_id=$2 AND id=$3',
                  [org, projectId, row.source_feedback_thread_id],
                )
              ).rows[0]?.cycle_id,
            }
          : {}),
        ...(resource === 'clients' && !isAdmin ? { description: '' } : {}),
        ...(resource === 'projects' ? { summary: await this.summary(tx, org, id) } : {}),
        ...(resource === 'milestones'
          ? { summary: await this.summary(tx, org, projectId!, id) }
          : {}),
      };
    }
    if (resource === 'contacts' || resource === 'clients' || (resource === 'projects' && !id)) {
      if (!isAdmin) this.denied();
    } else if (
      !manager &&
      !(resource === 'tasks' && method === 'PATCH') &&
      !(resource === 'checklist' && assigned && method === 'PATCH')
    )
      this.denied();
    if (method === 'DELETE' && resource !== 'checklist') this.missing();
    let b: Record<string, unknown>;
    if (method === 'DELETE') {
      coreSchemas.toggle.pick({}).parse(body);
      b = {};
    } else if (resource === 'tasks' && !manager) b = coreSchemas.workState.parse(body);
    else if (resource === 'checklist' && !manager) b = coreSchemas.toggle.parse(body);
    else b = coreSchemas[def.schema].parse(body);
    let existing: Row | undefined;
    if (id) {
      existing = await this.row(
        tx,
        def.table,
        org,
        id,
        resource !== 'projects' && resource !== 'clients' && resource !== 'contacts'
          ? projectId
          : undefined,
        task,
      );
      this.stale(existing, revision());
      if (resource === 'contacts' && existing.client_id !== client) this.missing();
      if (resource === 'contacts' && existing.user_id && b.email !== existing.email)
        this.conflict('Linked contact email cannot change');
    }
    if (
      resource === 'tasks' &&
      !manager &&
      (access?.role !== 'CONTRIBUTOR' ||
        access.member?.id !== existing?.assignee_id ||
        existing?.status === 'CANCELLED')
    )
      this.denied();
    if (resource === 'projects') {
      if (existing && b.client_id !== existing.client_id)
        this.conflict('A project cannot change client');
      const c = await this.row(tx, 'client', org, String(b.client_id));
      if (c.status !== 'ACTIVE' && (!existing || b.status === 'ACTIVE' || b.status === 'PLANNED'))
        this.conflict('Client is archived');
      const from = existing?.status;
      const to = b.status;
      const transitions: Record<string, string[]> = {
        PLANNED: ['PLANNED', 'ACTIVE', 'ARCHIVED'],
        ACTIVE: ['ACTIVE', 'COMPLETED', 'ARCHIVED'],
        COMPLETED: ['COMPLETED', 'ACTIVE', 'ARCHIVED'],
        ARCHIVED: [],
      };
      if (
        (!existing && !['PLANNED', 'ACTIVE'].includes(String(to))) ||
        (from && !transitions[from]?.includes(String(to)))
      )
        this.conflict('Invalid project transition');
      if (to === 'COMPLETED' && existing) {
        const s = await this.summary(tx, org, id!);
        if (s.total !== s.done) this.conflict('Finish or cancel outstanding tasks first');
        if (
          (
            await tx.query(
              "SELECT id FROM public.review_cycle WHERE organization_id=$1 AND project_id=$2 AND status='OPEN' LIMIT 1",
              [org, id],
            )
          ).rowCount
        )
          this.conflict('Close or decide open reviews before completing the project');
      }
    }
    if (resource === 'clients' && b.status === 'ARCHIVED') {
      const active = await tx.query(
        "SELECT 1 FROM public.project WHERE organization_id=$1 AND client_id=$2 AND status IN ('PLANNED','ACTIVE')",
        [org, id],
      );
      if (active.rowCount) this.conflict('Client has active projects');
    }
    if (resource === 'members') {
      if (existing && b.membership_id !== existing.membership_id)
        this.conflict('Cannot change membership identity');
      const m = await this.row(tx, 'membership', org, String(b.membership_id));
      if (
        b.status === 'ACTIVE' &&
        (m.status !== 'ACTIVE' ||
          !(await tx.query('SELECT public.eligible_member($1) eligible', [m.user_id])).rows[0]
            .eligible)
      )
        this.conflict('Member is not eligible');
    }
    if (resource === 'grants') {
      if (existing && b.contact_id !== existing.contact_id)
        this.conflict('Cannot change grant identity');
      const c = await this.row(tx, 'client_contact', org, String(b.contact_id));
      if (c.client_id !== project?.client_id) this.conflict('Contact belongs to another client');
      if (b.status === 'ACTIVE' && c.status !== 'ACTIVE') this.conflict('Contact is inactive');
      b.client_id = project!.client_id;
    }
    if (resource === 'milestones' && b.status === 'COMPLETED' && id) {
      const s = await this.summary(tx, org, projectId!, id);
      if (s.total !== s.done) this.conflict('Finish or cancel linked tasks first');
    }
    if (resource === 'tasks') {
      if (b.milestone_id) await this.row(tx, 'milestone', org, String(b.milestone_id), projectId);
      const assignee = Object.hasOwn(b, 'assignee_id') ? b.assignee_id : existing?.assignee_id;
      if (
        assignee &&
        (!existing ||
          (Object.hasOwn(b, 'assignee_id') && b.assignee_id !== existing.assignee_id) ||
          !['DONE', 'CANCELLED'].includes(String(b.status ?? existing.status)))
      ) {
        const eligible = await tx.query(
          "SELECT 1 FROM public.project_membership p JOIN public.membership m ON m.organization_id=p.organization_id AND m.id=p.membership_id WHERE p.organization_id=$1 AND p.project_id=$2 AND p.id=$3 AND p.status='ACTIVE' AND p.role IN ('MANAGER','CONTRIBUTOR') AND m.status='ACTIVE' AND public.eligible_member(m.user_id)",
          [org, projectId, assignee],
        );
        if (!eligible.rowCount) this.conflict('Assignee is not eligible for this project');
      }
    }
    if (resource === 'checklist' && 'completed' in b) {
      b.completed_at = b.completed ? new Date() : null;
      b.completed_by = b.completed ? user.user.id : null;
    }
    let row: Row;
    if (method === 'DELETE') {
      await tx.query('DELETE FROM public.task_checklist WHERE organization_id=$1 AND id=$2', [
        org,
        id,
      ]);
      row = existing!;
    } else if (id) {
      const fields = Object.keys(b);
      const result = await tx.query<Row>(
        `UPDATE public.${def.table} SET ${fields.map((f, i) => `${f}=$${i + 3}`).join(',')},revision=revision+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [org, id, ...fields.map((f) => b[f])],
      );
      row = result.rows[0]!;
    } else {
      const data = {
        id: randomUUID(),
        organization_id: org,
        ...(projectId ? { project_id: projectId } : {}),
        ...(resource === 'contacts' ? { client_id: client } : {}),
        ...(task ? { task_id: task } : {}),
        ...b,
        ...(resource === 'tasks' && sourceFeedback
          ? { source_feedback_thread_id: sourceFeedback }
          : {}),
      };
      const fields = Object.keys(data);
      const result = await tx.query<Row>(
        `INSERT INTO public.${def.table}(${fields.join(',')}) VALUES(${fields.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        Object.values(data),
      );
      row = result.rows[0]!;
    }
    const action =
      resource +
      '.' +
      (method === 'POST' ? 'created' : method === 'DELETE' ? 'removed' : 'updated');
    if (resource === 'tasks') {
      await this.history(tx, org, projectId!, row.id, user.user.id, action, b);
    }
    if (task)
      await this.history(tx, org, projectId!, task, user.user.id, action, { itemId: row.id, ...b });

    await this.event(tx, org, user.user.id, row.id, rid, action, {
      principalId: actor.id,
      role: String(row.role ?? ''),
      status: row.status ?? '',
      previousRole: String(existing?.role ?? ''),
      previousStatus: existing?.status ?? '',
    });
    return method === 'DELETE' ? { status: 'ok' } : this.dto(row, resource);
  }
  async list(
    tx: SqlTransaction,
    org: string,
    actor: Actor,
    resource: Resource,
    q: ReturnType<typeof coreQuery.parse>,
    project?: string,
    client?: string,
    task?: string,
    mine = false,
  ) {
    const def = definitions[resource];
    const values: unknown[] = [org];
    const where = ['r.organization_id=$1'];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace('?', `$${values.length}`));
    };
    if (project && resource !== 'projects') add('r.project_id=?', project);
    if (client && resource === 'contacts') add('r.client_id=?', client);
    if (task) add('r.task_id=?', task);
    const access =
      'EXISTS(SELECT 1 FROM public.project_membership pm WHERE pm.organization_id=r.organization_id AND pm.project_id=' +
      (resource === 'projects' ? 'r.id' : 'r.project_id') +
      " AND pm.membership_id=? AND pm.status='ACTIVE')";
    if (actor.role === 'MEMBER') {
      if (resource === 'clients')
        add(
          "EXISTS(SELECT 1 FROM public.project p JOIN public.project_membership pm ON pm.organization_id=p.organization_id AND pm.project_id=p.id WHERE p.organization_id=r.organization_id AND p.client_id=r.id AND pm.membership_id=? AND pm.status='ACTIVE')",
          actor.id,
        );
      else if (resource !== 'contacts') add(access, actor.id);
    }
    if (mine)
      add(
        "EXISTS(SELECT 1 FROM public.project_membership own WHERE own.organization_id=r.organization_id AND own.id=r.assignee_id AND own.membership_id=? AND own.status='ACTIVE' AND own.role IN ('MANAGER','CONTRIBUTOR'))",
        actor.id,
      );
    for (const key of [
      'status',
      'priority',
      'assignee_id',
      'milestone_id',
      'project_id',
      'client_id',
    ] as const)
      if (
        (q[key] && def.fields.includes(key as never)) ||
        (q[key] && key === 'project_id' && resource === 'tasks')
      )
        add(`r.${key}=?`, q[key]);
    if (q.q) {
      const column = def.fields.includes('name' as never)
        ? 'name'
        : def.fields.includes('title' as never)
          ? 'title'
          : undefined;
      if (column) add(`r.${column} ILIKE ?`, '%' + q.q + '%');
    }
    if (def.fields.includes('due_at' as never)) {
      if (q.due_from) add('r.due_at>=?', q.due_from);
      if (q.due_to) add('r.due_at<=?', q.due_to);
    }
    const sort = def.fields.includes(q.sort as never) ? q.sort : 'created_at';
    const predicate = where.join(' AND ');
    const total = (
      await tx.query<{ total: number }>(
        `SELECT count(*)::int total FROM public.${def.table} r WHERE ${predicate}`,
        values,
      )
    ).rows[0]!.total;
    const result = await tx.query<Row>(
      `SELECT r.*${resource === 'members' ? ',(SELECT u.name FROM public.membership m CROSS JOIN LATERAL public.team_identity(m.user_id) u WHERE m.organization_id=r.organization_id AND m.id=r.membership_id) AS name' : ''} FROM public.${def.table} r WHERE ${predicate} ORDER BY r.${sort} ${q.direction} NULLS LAST,r.id ${q.direction} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, q.limit, (q.page - 1) * q.limit],
    );
    const items = [];
    for (const r of result.rows)
      items.push({
        ...this.dto(r, resource),
        ...(resource === 'clients' && actor.role === 'MEMBER' ? { description: '' } : {}),
        ...(resource === 'projects' ? { summary: await this.summary(tx, org, r.id) } : {}),
        ...(resource === 'milestones'
          ? { summary: await this.summary(tx, org, project!, r.id) }
          : {}),
      });
    return { items, total, page: q.page, limit: q.limit };
  }
}
