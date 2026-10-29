import { randomUUID } from 'node:crypto';
import { TenantDatabase, type SqlTransaction } from '@devworkspace/database';
import { fileSchemas, uuid, schemas } from '@devworkspace/contracts';
import type { ActiveSession } from './identity.js';
import type { Organizations } from './organizations.js';
import { PrivateStorage } from './storage.js';
import { Problem } from './security.js';
import type { ProductResponse } from './product.js';
type Scope = 'logo' | 'profile';
const missing = (): never => {
  throw new Problem(404, 'NOT_FOUND', 'Image unavailable');
};
const conflict = (message: string): never => {
  throw new Problem(409, 'CONFLICT', message);
};
export class Media {
  readonly identity: TenantDatabase;
  constructor(
    readonly organizations: Organizations,
    readonly storage: PrivateStorage,
    identityUrl: string,
  ) {
    this.identity = new TenantDatabase(identityUrl, 2);
  }
  async own<T>(user: ActiveSession, work: (tx: SqlTransaction) => Promise<T>) {
    const tx = await this.identity.pool.connect();
    try {
      await tx.query('BEGIN');
      const active = await tx.query(
        'SELECT id FROM public.identity_user WHERE id=$1 AND active AND "emailVerified" FOR UPDATE',
        [user.user.id],
      );
      const session = await tx.query(
        'SELECT id FROM public.identity_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">now() AND "createdAt">now()-interval \'8 hours\' AND "lastActivityAt">now()-interval \'30 minutes\' FOR SHARE',
        [user.session.id, user.user.id],
      );
      if (!active.rowCount || !session.rowCount)
        throw new Problem(401, 'SESSION_REQUIRED', 'Sign in to continue');
      await tx.query("SELECT set_config('app.profile_user_id',$1,true)", [user.user.id]);
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  async branding<T>(
    user: ActiveSession,
    org: string,
    principal: string,
    write: boolean,
    work: (tx: SqlTransaction) => Promise<T>,
  ) {
    return this.organizations.database.transaction(org, async (tx) => {
      const o = await tx.query(
        "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [org],
      );
      if (!o.rowCount) missing();
      await tx.query('SELECT public.assert_session($1,$2)', [user.session.id, user.user.id]);
      const member = (
        await tx.query(
          "SELECT role FROM public.membership WHERE organization_id=$1 AND id=$2 AND user_id=$3 AND status='ACTIVE'",
          [org, principal, user.user.id],
        )
      ).rows[0];
      if (write && (!member || !['OWNER', 'ADMIN'].includes(member.role)))
        throw new Problem(403, 'FORBIDDEN', 'Organization administrator required');
      if (!member) {
        const contact = await tx.query(
          "SELECT c.id FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id WHERE c.organization_id=$1 AND c.id=$2 AND c.user_id=$3 AND c.status='ACTIVE' AND g.status='ACTIVE' AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE' LIMIT 1",
          [org, principal, user.user.id],
        );
        if (!contact.rowCount) missing();
      }
      return work(tx);
    });
  }
  async execute(
    tx: SqlTransaction,
    user: ActiveSession,
    scope: Scope,
    owner: string,
    suffix: string,
    method: string,
    body: unknown,
    revision: () => number,
    rid: string,
  ): Promise<ProductResponse> {
    const column = scope === 'logo' ? 'organization_id' : 'user_id';
    const table = scope + '_upload';
    const ok = (body: unknown, status = 200): ProductResponse => ({
      status,
      body,
      headers: { 'X-Request-Id': rid },
    });
    const audit = async (action: string, target: string) => {
      if (scope === 'logo')
        await this.organizations.event(tx, owner, user.user.id, 'core.changed', target, rid, {
          action,
          capacity: 'INTERNAL',
        });
      else {
        await tx.query('SELECT public.record_profile_change($1,$2)', [action, target]);
      }
    };
    const upload = async (id: string) => {
      const row = (
        await tx.query(`SELECT * FROM public.${table} WHERE ${column}=$1 AND id=$2 FOR UPDATE`, [
          owner,
          id,
        ])
      ).rows[0];
      return row ?? missing();
    };
    const uploadDto = (row: Record<string, unknown>) =>
      Object.fromEntries(
        [
          'id',
          'name',
          'revision',
          'expected_size',
          'expected_digest',
          'mime',
          'status',
          'error_code',
          'attempts',
          'expires_at',
          'created_at',
          'updated_at',
        ].map((k) => [k, row[k]]),
      );
    if (suffix === '' && method === 'GET') {
      const row = (
        await tx.query(
          `SELECT asset_id,revision FROM public.${scope}_reference WHERE ${column}=$1`,
          [owner],
        )
      ).rows[0];
      return ok(row ?? { asset_id: null, revision: 1 });
    }
    if (suffix === '' && method === 'PATCH') {
      const b = fileSchemas.imageAttachment.parse(body);
      const prior = (
        await tx.query(
          `SELECT asset_id,revision FROM public.${scope}_reference WHERE ${column}=$1 FOR UPDATE`,
          [owner],
        )
      ).rows[0];
      if ((prior?.revision ?? 1) !== revision())
        throw new Problem(412, 'STALE_REVISION', 'Image changed. Reload before saving');
      if (b.asset_id) {
        const clean = await tx.query(
          `SELECT a.id FROM public.${scope}_asset a JOIN public.${scope}_access x ON x.asset_id=a.id AND x.${column}=a.${column} WHERE a.${column}=$1 AND a.id=$2 AND x.status='AVAILABLE'`,
          [owner, b.asset_id],
        );
        if (!clean.rowCount) missing();
      }
      const saved = await tx.query(
        `INSERT INTO public.${scope}_reference(${column},asset_id,revision) VALUES($1,$2,2) ON CONFLICT(${column}) DO UPDATE SET asset_id=$2,revision=${scope}_reference.revision+1 RETURNING asset_id,revision`,
        [owner, b.asset_id],
      );
      await audit(scope + '.attached', b.asset_id ?? owner);
      return ok(saved.rows[0]);
    }
    if (suffix === '/content' && method === 'GET') {
      const image = (
        await tx.query(
          `SELECT a.preview_key,a.preview_version FROM public.${scope}_reference r JOIN public.${scope}_asset a ON a.id=r.asset_id AND a.${column}=r.${column} JOIN public.${scope}_access x ON x.asset_id=a.id AND x.${column}=a.${column} WHERE r.${column}=$1 AND x.status='AVAILABLE'`,
          [owner],
        )
      ).rows[0];
      if (!image) missing();
      const response = await this.storage.request(
        'GET',
        'dw-canonical',
        image.preview_key,
        undefined,
        {},
        { versionId: image.preview_version },
      );
      if (response.status !== 200)
        throw new Problem(503, 'IMAGE_UNAVAILABLE', 'Image temporarily unavailable');
      return {
        status: 200,
        body: Buffer.from(await response.arrayBuffer()),
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'inline; filename="image.png"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      };
    }
    if (suffix === '/uploads' && method === 'POST') {
      if (body && typeof body === 'object') {
        const input = body as Record<string, unknown>;
        if (typeof input.size === 'number' && input.size > 2097152)
          throw new Problem(413, 'FILE_TOO_LARGE', 'Image limit is 2 MiB');
        if (typeof input.mime === 'string' && !['image/png', 'image/jpeg'].includes(input.mime))
          throw new Problem(415, 'UNSUPPORTED_MEDIA', 'Choose PNG or JPEG');
      }
      const b = fileSchemas.mediaUpload.parse(body);
      const id = randomUUID();
      const key = randomUUID() + '/' + id;
      // Owner serialization plus this persisted window bounds issuance for both media purposes.
      const recent = (
        await tx.query(
          `SELECT count(*)::int n FROM public.${table} WHERE ${column}=$1 AND created_at>now()-interval '1 minute'`,
          [owner],
        )
      ).rows[0].n;
      if (recent >= 12) throw new Problem(429, 'RATE_LIMITED', 'Too many image uploads');
      const created = await tx.query(
        `INSERT INTO public.${table}(id,${column},initiator_id,name,staging_key,expected_size,expected_digest,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, owner, user.user.id, b.name, key, b.size, b.digest, b.mime],
      );
      await audit(scope + '.upload.issued', id);
      return ok(
        {
          ...uploadDto(created.rows[0]),
          capability: this.storage.capability(key, b.size, b.mime, b.digest),
        },
        201,
      );
    }
    const match = /^\/uploads\/([^/]+)(?:\/(finalize|retry))?$/.exec(suffix);
    if (match) {
      const id = uuid.parse(match[1]);
      const row = await upload(id);
      if (method === 'GET' && !match[2]) return ok(uploadDto(row));
      if (method === 'POST' && match[2]) {
        schemas.empty.parse(body);
        if (['READY', 'UPLOADED', 'PROCESSING'].includes(row.status)) return ok(uploadDto(row));
        if (match[2] === 'retry') {
          if (row.status !== 'FAILED' || row.attempts >= 5)
            conflict('This image cannot be retried');
        } else if (row.status !== 'ISSUED' || new Date(row.expires_at).getTime() <= Date.now())
          conflict('Image upload expired or unavailable');
        const source = await this.storage.request('HEAD', 'dw-staging', row.staging_key);
        if (
          source.status !== 200 ||
          Number(source.headers.get('content-length')) !== row.expected_size
        )
          conflict('Image upload is incomplete');
        await tx.query(
          `UPDATE public.${table} SET status='UPLOADED',revision=revision+1,updated_at=now() WHERE ${column}=$1 AND id=$2`,
          [owner, id],
        );
        await tx.query(
          `INSERT INTO public.media_job(id,scope,${column}) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET completed_at=NULL,available_at=now()`,
          [id, scope, owner],
        );
        await audit(scope + '.upload.finalized', id);
        return ok(uploadDto(await upload(id)));
      }
    }
    return missing();
  }
}
