import { randomBytes, randomUUID } from 'node:crypto';
import { coreSchemas, uuid } from '@devworkspace/contracts';
import type { Organizations } from './organizations.js';
import type { ActiveSession } from './identity.js';
import type { SqlTransaction } from '@devworkspace/database';
import { Problem, digest, sealMail } from './security.js';
export class ClientAccess {
  constructor(readonly organizations: Organizations) {}
  async principals(user: ActiveSession, cursor: string) {
    const { rows } = await this.organizations.database.pool.query(
      'SELECT * FROM public.client_principals_page($1,$2)',
      [user.user.id, cursor ? uuid.parse(cursor) : null],
    );
    return {
      items: rows.slice(0, 50).map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        name: r.name,
        role: r.role,
        capacity: r.capacity,
      })),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  async read(user: ActiveSession, org: string, principal: string, cursor: string) {
    return this.organizations.database.transaction(org, async (tx) => {
      await tx.query(
        "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [org],
      );
      await tx.query('SELECT public.assert_session($1,$2)', [user.session.id, user.user.id]);
      const c = await tx.query(
        "SELECT id FROM public.client_contact WHERE organization_id=$1 AND id=$2 AND user_id=$3 AND status='ACTIVE'",
        [org, principal, user.user.id],
      );
      if (!c.rowCount) throw new Problem(404, 'PRINCIPAL_UNAVAILABLE', 'Principal unavailable');
      const { rows } = await tx.query(
        "SELECT p.id,p.name,p.status,g.role FROM public.project p JOIN public.client_project_access g ON g.organization_id=p.organization_id AND g.project_id=p.id WHERE p.organization_id=$1 AND g.contact_id=$2 AND g.status='ACTIVE' AND p.portal_enabled AND ($3::uuid IS NULL OR p.id>$3::uuid) ORDER BY p.id LIMIT 51",
        [org, principal, cursor ? uuid.parse(cursor) : null],
      );
      return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
    });
  }
  async invitations(tx: SqlTransaction, org: string, client: string, page: number, limit: number) {
    const predicate =
      "FROM public.invitation i JOIN public.client_contact c ON c.organization_id=i.organization_id AND c.id=i.contact_id WHERE i.organization_id=$1 AND c.client_id=$2 AND i.purpose='CLIENT'";
    const total = (await tx.query('SELECT count(*)::int total ' + predicate, [org, client])).rows[0]
      .total;
    const result = await tx.query(
      "SELECT i.id,i.email,i.project_id,i.contact_id,i.project_role AS role,i.revision,i.expires_at,CASE WHEN i.revoked_at IS NOT NULL THEN 'REVOKED' WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED' WHEN i.expires_at<=now() THEN 'EXPIRED' ELSE 'PENDING' END state " +
        predicate +
        ' ORDER BY i.id LIMIT $3 OFFSET $4',
      [org, client, limit, (page - 1) * limit],
    );
    return { items: result.rows, total, page, limit };
  }
  async invite(
    tx: SqlTransaction,
    user: ActiveSession,
    org: string,
    actor: string,
    client: string,
    contact: string,
    body: unknown,
    rid: string,
  ) {
    const b = coreSchemas.clientInvitation.parse(body);
    const result = await tx.query<{ email: string }>(
      "SELECT c.email FROM public.client_contact c JOIN public.client x ON x.organization_id=c.organization_id AND x.id=c.client_id JOIN public.project p ON p.organization_id=c.organization_id AND p.client_id=c.client_id WHERE c.organization_id=$1 AND c.client_id=$2 AND c.id=$3 AND c.status='ACTIVE' AND x.status='ACTIVE' AND p.id=$4 AND p.status IN ('PLANNED','ACTIVE')",
      [org, client, contact, b.project_id],
    );
    if (!result.rowCount)
      throw new Problem(
        409,
        'TARGET_UNAVAILABLE',
        'Contact/project invitation target is unavailable',
      );
    await tx.query(
      'UPDATE public.invitation SET revoked_at=now(),revision=revision+1 WHERE organization_id=$1 AND contact_id=$2 AND project_id=$3 AND expires_at<=now() AND accepted_at IS NULL AND revoked_at IS NULL',
      [org, contact, b.project_id],
    );
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await tx.query(
      "INSERT INTO public.invitation(id,organization_id,inviter_id,email,role,digest,purpose,contact_id,project_id,project_role) VALUES($1,$2,$3,$4,'CLIENT',$5,'CLIENT',$6,$7,$8)",
      [id, org, actor, result.rows[0]!.email, digest(token), contact, b.project_id, b.role],
    );
    const event = await this.organizations.event(
      tx,
      org,
      user.user.id,
      'invitation.created',
      id,
      rid,
      { capacity: 'CLIENT' },
    );
    const envelope = sealMail(this.organizations.mailKey, {
      to: result.rows[0]!.email,
      subject: 'DevWorkspace client invitation',
      text: `${this.organizations.origin}/invitations/accept?token=${token}`,
    });
    await tx.query(
      'INSERT INTO public.tenant_mail(id,organization_id,invitation_id,envelope) VALUES($1,$2,$3,$4)',
      [event, org, id, envelope],
    );
    return { id, status: 'pending' };
  }
}
