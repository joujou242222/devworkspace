import { randomUUID } from 'node:crypto';
import { fileSchemas, fileQuery, uuid, schemas } from '@devworkspace/contracts';
import type { SqlTransaction } from '@devworkspace/database';
import { CoreDomain } from './core.js';
import type { Organizations } from './organizations.js';
import type { ActiveSession } from './identity.js';
import type { ProductResponse } from './product.js';
import { PrivateStorage } from './storage.js';
import { Problem } from './security.js';
type Row = Record<string, unknown> & { id: string; revision: number; status: string };
const fields = [
  'id',
  'project_id',
  'revision',
  'name',
  'title',
  'description',
  'position',
  'folder_id',
  'status',
  'purpose',
  'error_code',
  'attempts',
  'mime',
  'expected_size',
  'expected_digest',
  'created_at',
  'updated_at',
  'expires_at',
  'task_id',
  'latest_version_id',
  'version_number',
  'asset_id',
  'digest',
  'byte_size',
  'creator_id',
  'ready_at',
  'width',
  'height',
  'pages',
];
const dto = (row: Row) =>
  Object.fromEntries(fields.filter((k) => k in row).map((k) => [k, row[k]]));
export class Files {
  readonly core: CoreDomain;
  constructor(
    readonly organizations: Organizations,
    readonly storage: PrivateStorage,
  ) {
    this.core = new CoreDomain(organizations);
  }
  supports(path: string) {
    return /^\/projects\/[^/]+\/(folders|files|uploads|deliverables|assets)(\/|$)/.test(path);
  }
  async execute(
    tx: SqlTransaction,
    user: ActiveSession,
    org: string,
    actor: { id: string; role: string },
    path: string,
    method: string,
    body: unknown,
    revision: () => number,
    rid: string,
    query: URLSearchParams,
    range?: string,
  ): Promise<ProductResponse> {
    if (method !== 'GET')
      await tx.query(
        "SELECT set_config('app.request_id',$1,true),set_config('app.principal_id',$2,true),set_config('app.capacity','INTERNAL',true)",
        [rid, actor.id],
      );
    const match =
      /^\/projects\/([^/]+)\/(folders|files|uploads|deliverables|assets)(?:\/([^/]+))?(?:\/(finalize|retry|versions|download|preview))?(?:\/([^/]+))?$/.exec(
        path,
      );
    if (!match) this.core.missing();
    const project = uuid.parse(match[1]);
    const kind = match[2]!;
    const id = match[3] ? uuid.parse(match[3]) : undefined;
    const action = match[4];
    const access = await this.core.project(tx, org, project, actor);
    const write = method !== 'GET';
    if (write && ['COMPLETED', 'ARCHIVED'].includes(access.p.status))
      this.core.conflict('Reopen the project before changing its content');
    if (
      write &&
      (access.role === 'VIEWER' ||
        ((kind === 'folders' ||
          kind === 'files' ||
          (kind === 'deliverables' && method === 'PATCH')) &&
          !access.manager))
    )
      this.core.denied();
    const row = async (table: string, target = id!) =>
      this.core.row(tx, table, org, target, project);
    const event = async (target: string, action: string) =>
      this.core.event(tx, org, user.user.id, target, rid, action, { principal_id: actor.id });
    const ok = (body: unknown, status = method === 'POST' ? 201 : 200): ProductResponse => ({
      status,
      body,
      headers: { 'X-Request-Id': rid },
    });
    const list = async (table: string, extra = '', values: unknown[] = []) => {
      const q = fileQuery.parse(Object.fromEntries(query));
      if (table === 'deliverable_version' && (q.q || q.folder_id || q.status))
        throw new Problem(400, 'INVALID_INPUT', 'Version history supports pagination only');
      const args: unknown[] = [org, project, ...values];
      let where = ' WHERE organization_id=$1 AND project_id=$2' + extra;
      if (kind === 'files') {
        if (q.folder_id === 'root') where += ' AND folder_id IS NULL';
        else if (q.folder_id) {
          await row('project_folder', q.folder_id);
          args.push(q.folder_id);
          where += ' AND folder_id=$' + args.length;
        }
        args.push(q.status ?? 'ACTIVE');
        where += ' AND status=$' + args.length;
      }
      if (q.q) {
        args.push('%' + q.q + '%');
        where +=
          ' AND ' +
          (['folders', 'uploads'].includes(kind) ? 'name' : 'title') +
          ' ILIKE $' +
          args.length;
      }
      if (table === 'deliverable' && q.status) {
        args.push(q.status);
        where += ' AND status=$' + args.length;
      }
      const total = (
        await tx.query(`SELECT count(*)::int total FROM public.${table}${where}`, args)
      ).rows[0].total;
      const items = await tx.query<Row>(
        `SELECT * FROM public.${table}${where} ORDER BY id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.limit, (q.page - 1) * q.limit],
      );
      return ok({
        items: items.rows.map(dto),
        total,
        page: q.page,
        limit: q.limit,
        manager: access.manager,
        canUpload: access.role !== 'VIEWER' && !['ARCHIVED', 'COMPLETED'].includes(access.p.status),
      });
    };
    if (kind === 'folders' && !action) {
      if (method === 'GET' && !id) return list('project_folder');
      if (method === 'POST' && !id) {
        const b = fileSchemas.folder.parse(body);
        const created = await tx.query<Row>(
          'INSERT INTO public.project_folder(organization_id,project_id,name,position) VALUES($1,$2,$3,$4) RETURNING *',
          [org, project, b.name, b.position],
        );
        await event(created.rows[0]!.id, 'folder.created');
        return ok(dto(created.rows[0]!));
      }
      if (id && ['PATCH', 'DELETE'].includes(method)) {
        const current = await row('project_folder');
        this.core.stale(current, revision());
        if (method === 'DELETE') {
          schemas.empty.parse(body);
          const pending = await tx.query(
            "SELECT id FROM public.project_upload WHERE organization_id=$1 AND project_id=$2 AND folder_id=$3 AND (status IN ('ISSUED','UPLOADED','PROCESSING') OR (status='FAILED' AND attempts<5)) LIMIT 1",
            [org, project, id],
          );
          if (pending.rowCount) this.core.conflict('Folder has pending uploads');
          await tx.query(
            'DELETE FROM public.project_folder WHERE organization_id=$1 AND project_id=$2 AND id=$3',
            [org, project, id],
          );
          await event(id, 'folder.removed');
          return ok({ status: 'ok' });
        }
        const b = fileSchemas.folder.parse(body);
        const changed = await tx.query<Row>(
          'UPDATE public.project_folder SET name=$4,position=$5,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *',
          [org, project, id, b.name, b.position],
        );
        await event(id, 'folder.updated');
        return ok(dto(changed.rows[0]!));
      }
    }
    if (kind === 'uploads') {
      if (method === 'GET' && !action)
        return id
          ? ok(
              dto(
                (
                  await tx.query<Row>(
                    'SELECT * FROM public.project_upload WHERE organization_id=$1 AND project_id=$2 AND id=$3',
                    [org, project, id],
                  )
                ).rows[0] ?? this.core.missing(),
              ),
            )
          : list('project_upload');
      if (method === 'POST' && !id) {
        if (body && typeof body === 'object') {
          const input = body as Record<string, unknown>;
          if (typeof input.size === 'number' && input.size > 26214400)
            throw new Problem(413, 'FILE_TOO_LARGE', 'Project file limit is 25 MiB');
          if (
            typeof input.mime === 'string' &&
            !['image/png', 'image/jpeg', 'application/pdf'].includes(input.mime)
          )
            throw new Problem(415, 'UNSUPPORTED_MEDIA', 'Choose PNG, JPEG or PDF');
        }
        const b = fileSchemas.upload.parse(body);
        if (b.folder_id) await row('project_folder', b.folder_id);
        if (b.purpose === 'DELIVERABLE' && b.folder_id)
          throw new Problem(400, 'INVALID_INPUT', 'Version uploads do not use folders');
        const allowed = await tx.query('SELECT public.abuse($1,12) allowed', [
          'upload:' + org + ':' + user.user.id,
        ]);
        if (!allowed.rows[0].allowed)
          throw new Problem(429, 'RATE_LIMITED', 'Too many upload requests');
        const uploadId = randomUUID();
        const staging = randomUUID() + '/' + uploadId;
        const result = await tx.query<Row>(
          'INSERT INTO public.project_upload(id,organization_id,project_id,initiator_id,purpose,folder_id,name,staging_key,expected_size,expected_digest,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
          [
            uploadId,
            org,
            project,
            user.user.id,
            b.purpose,
            b.folder_id,
            b.name,
            staging,
            b.size,
            b.digest,
            b.mime,
          ],
        );
        await event(uploadId, 'upload.issued');
        return ok({
          ...dto(result.rows[0]!),
          capability: this.storage.capability(staging, b.size, b.mime, b.digest),
        });
      }
      if (method === 'POST' && id && ['finalize', 'retry'].includes(action ?? '')) {
        schemas.empty.parse(body);
        const u = await row('project_upload');
        if (u.initiator_id !== user.user.id && !access.manager) this.core.denied();
        if (['READY', 'UPLOADED', 'PROCESSING'].includes(u.status)) return ok(dto(u), 200);
        if (action === 'retry') {
          if (u.status !== 'FAILED' || Number(u.attempts) >= 5)
            this.core.conflict('This upload cannot be retried');
        } else if (u.status !== 'ISSUED' || new Date(String(u.expires_at)).getTime() <= Date.now())
          this.core.conflict('Upload intent expired or unavailable');
        const stored = await this.storage.request('HEAD', 'dw-staging', String(u.staging_key));
        if (stored.status !== 200)
          this.core.conflict('Upload is incomplete. Retry the upload before finalizing');
        if (Number(stored.headers.get('content-length')) !== u.expected_size)
          this.core.conflict('Uploaded size does not match the intent');
        await tx.query(
          "UPDATE public.project_upload SET status='UPLOADED',revision=revision+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3",
          [org, project, id],
        );
        await tx.query(
          'INSERT INTO public.file_job(id,organization_id,project_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET completed_at=NULL,available_at=now()',
          [id, org, project],
        );
        await event(id, 'upload.finalized');
        return ok(dto(await row('project_upload')), 200);
      }
    }
    if (kind === 'files' && !action) {
      if (method === 'GET') return id ? ok(dto(await row('project_file'))) : list('project_file');
      if (method === 'PATCH' && id) {
        const b = fileSchemas.fileListing.parse(body);
        const current = await row('project_file');
        this.core.stale(current, revision());
        if (b.folder_id) await row('project_folder', b.folder_id);
        const changed = await tx.query<Row>(
          'UPDATE public.project_file SET title=$4,folder_id=$5,status=$6,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *',
          [org, project, id, b.title, b.folder_id, b.status],
        );
        await event(id, 'file.updated');
        return ok(dto(changed.rows[0]!));
      }
    }
    if (kind === 'deliverables') {
      if (!action) {
        if (method === 'GET') return id ? ok(dto(await row('deliverable'))) : list('deliverable');
        if ((method === 'POST' && !id) || (method === 'PATCH' && id)) {
          const b = fileSchemas.deliverable.parse(body);
          if (b.task_id) await row('task', b.task_id);
          if (id) {
            const current = await row('deliverable');
            this.core.stale(current, revision());
            if (current.status === 'ARCHIVED') this.core.conflict('Deliverable is archived');
          }
          if (method === 'POST' && b.status !== 'ACTIVE')
            this.core.conflict('New deliverables must be active');
          const result = id
            ? await tx.query<Row>(
                'UPDATE public.deliverable SET title=$4,description=$5,task_id=$6,status=$7,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING *',
                [org, project, id, b.title, b.description, b.task_id, b.status],
              )
            : await tx.query<Row>(
                'INSERT INTO public.deliverable(organization_id,project_id,title,description,task_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
                [org, project, b.title, b.description, b.task_id],
              );
          await event(result.rows[0]!.id, 'deliverable.changed');
          return ok(dto(result.rows[0]!));
        }
      }
      if (id && action === 'versions' && !match[5]) {
        const d = await row('deliverable');
        if (method === 'GET') return list('deliverable_version', ' AND deliverable_id=$3', [id]);
        if (method === 'POST') {
          if (d.status !== 'ACTIVE') this.core.conflict('Deliverable is archived');
          const b = fileSchemas.version.parse(body);
          const asset = await this.asset(tx, org, project, b.asset_id);
          const prior = (
            await tx.query<Row>(
              'SELECT * FROM public.deliverable_version WHERE organization_id=$1 AND project_id=$2 AND deliverable_id=$3 AND asset_id=$4',
              [org, project, id, b.asset_id],
            )
          ).rows[0];
          if (prior) return ok(dto(prior));
          const version = await tx.query<Row>(
            'INSERT INTO public.deliverable_version(organization_id,project_id,deliverable_id,version_number,asset_id,digest,byte_size,mime,creator_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [
              org,
              project,
              id,
              d.next_version,
              asset.id,
              asset.digest,
              asset.byte_size,
              asset.mime,
              user.user.id,
            ],
          );
          await tx.query(
            'UPDATE public.deliverable SET latest_version_id=$4,next_version=next_version+1,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3',
            [org, project, id, version.rows[0]!.id],
          );
          await event(version.rows[0]!.id, 'version.created');
          return ok(dto(version.rows[0]!));
        }
      }
    }
    if (
      kind === 'assets' &&
      id &&
      method === 'GET' &&
      ['download', 'preview'].includes(action ?? '')
    ) {
      const a = await this.asset(tx, org, project, id);
      return this.content(tx, org, project, a, action!, match[5], range);
    }
    return this.core.missing();
  }
  async content(
    tx: SqlTransaction,
    org: string,
    project: string,
    a: Row,
    action: string,
    pageNumber?: string,
    range?: string,
  ): Promise<ProductResponse> {
    const id = a.id;
    let key = String(a.canonical_key);
    let mime = String(a.mime);
    let storageVersion = String(a.storage_version);
    if (action === 'preview') {
      const page = Number(pageNumber ?? '1');
      if (!Number.isInteger(page) || page < 1 || page > 100)
        throw new Problem(400, 'INVALID_INPUT', 'Invalid page');
      const preview = (
        await tx.query(
          'SELECT object_key,storage_version FROM public.file_preview WHERE organization_id=$1 AND project_id=$2 AND asset_id=$3 AND page=$4',
          [org, project, id, page],
        )
      ).rows[0];
      if (!preview) this.core.missing();
      key = preview.object_key;
      storageVersion = preview.storage_version;
      mime = 'image/png';
    } else if (pageNumber) this.core.missing();
    if (range && !/^bytes=\d+-\d*$/.test(range))
      throw new Problem(416, 'INVALID_RANGE', 'Use one bounded byte range');
    const response = await this.storage.request(
      'GET',
      'dw-canonical',
      key,
      undefined,
      range ? { range } : {},
      { versionId: storageVersion },
    );
    if (response.status === 416)
      throw new Problem(416, 'INVALID_RANGE', 'Requested range unavailable');
    if (![200, 206].includes(response.status))
      throw new Problem(503, 'STORAGE_UNAVAILABLE', 'File unavailable. Retry later');
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition':
        (action === 'preview' ? 'inline' : 'attachment') +
        '; filename="' +
        id +
        (mime === 'application/pdf' ? '.pdf' : mime === 'image/jpeg' ? '.jpg' : '.png') +
        '"',
    };
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers };
  }
  async asset(tx: SqlTransaction, org: string, project: string, id: string) {
    const a = (
      await tx.query<Row>(
        "SELECT a.* FROM public.file_asset a JOIN public.file_access x ON x.asset_id=a.id AND x.organization_id=a.organization_id AND x.project_id=a.project_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND x.status='AVAILABLE'",
        [org, project, id],
      )
    ).rows[0];
    return a ?? this.core.missing();
  }
}
