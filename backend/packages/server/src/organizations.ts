import { randomBytes, randomUUID } from 'node:crypto';
import { TenantDatabase, type SqlTransaction } from '@devworkspace/database';
import type { OrganizationDto, MemberDto, InvitationDto } from '@devworkspace/contracts';
import { Problem, digest, sealMail } from './security.js';
import type { ActiveSession } from './identity.js';
type Member = {
  id: string;
  user_id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: string;
  revision: number;
};
export class Organizations {
  readonly database: TenantDatabase;
  constructor(
    url: string,
    readonly mailKey: string,
    readonly origin: string,
  ) {
    this.database = new TenantDatabase(url);
  }
  async principals(user: ActiveSession, cursor: string) {
    const { rows } = await this.database.pool.query<{
      id: string;
      organization_id: string;
      name: string;
      role: string;
    }>('SELECT * FROM public.principals_page($1,$2)', [user.user.id, cursor || null]);
    return {
      items: rows.slice(0, 50).map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        name: r.name,
        role: r.role,
        capacity: 'INTERNAL' as const,
      })),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async onboarding(
    user: ActiveSession,
    body: Omit<OrganizationDto, 'id' | 'revision'>,
    key: string,
    requestId: string,
  ) {
    const { rows } = await this.database.pool.query<{ id: string }>(
      'SELECT public.bootstrap($1,$2,$3,$4,$5,$6,$7,$8) AS id',
      [
        user.user.id,
        user.session.id,
        body.name,
        body.description,
        body.timezone,
        key,
        digest(JSON.stringify(body)),
        requestId,
      ],
    );
    return { organizationId: rows[0]!.id };
  }
  async scoped<T>(
    user: ActiveSession,
    orgId: string,
    principalId: string,
    admin: boolean,
    work: (tx: SqlTransaction, actor: Member) => Promise<T>,
  ) {
    return this.database.transaction(orgId, async (tx) => {
      // All org mutations and authority changes share the same lock order.
      const org = await tx.query(
        "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [orgId],
      );
      if (!org.rowCount) throw new Problem(404, 'NOT_FOUND', 'Organization unavailable');
      await tx.query('SELECT public.assert_session($1,$2)', [user.session.id, user.user.id]);
      const { rows } = await tx.query<Member>(
        "SELECT * FROM public.membership WHERE organization_id=$1 AND id=$2 AND user_id=$3 AND status='ACTIVE' FOR UPDATE",
        [orgId, principalId, user.user.id],
      );
      await tx.query("SELECT set_config('app.actor_id',$1,true)", [user.user.id]);
      const actor = rows[0];
      if (!actor) throw new Problem(404, 'PRINCIPAL_UNAVAILABLE', 'Principal unavailable');
      if (admin && actor.role === 'MEMBER')
        throw new Problem(403, 'FORBIDDEN', 'Organization administrator required');
      return work(tx, actor);
    });
  }
  async event(
    tx: SqlTransaction,
    orgId: string,
    userId: string,
    kind: string,
    targetId: string,
    requestId: string,
    metadata: Record<string, string> = {},
  ) {
    await tx.query(
      'INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [orgId, userId, kind, targetId, requestId, metadata],
    );
    const result = await tx.query<{ id: string }>(
      'INSERT INTO public.tenant_event(organization_id,kind,target_id,action) VALUES($1,$2,$3,$4) RETURNING id',
      [orgId, kind, targetId, metadata.action ?? kind],
    );
    return result.rows[0]!.id;
  }
  async settings(tx: SqlTransaction, orgId: string): Promise<OrganizationDto> {
    const { rows } = await tx.query<OrganizationDto>(
      'SELECT id,name,description,timezone,revision FROM public.organization WHERE id=$1',
      [orgId],
    );
    return rows[0]!;
  }
  async update(
    tx: SqlTransaction,
    user: ActiveSession,
    orgId: string,
    body: Omit<OrganizationDto, 'id' | 'revision'>,
    revision: number,
    rid: string,
  ): Promise<OrganizationDto> {
    const result = await tx.query(
      'UPDATE public.organization SET name=$2,description=$3,timezone=$4,revision=revision+1 WHERE id=$1 AND revision=$5 RETURNING id',
      [orgId, body.name, body.description, body.timezone, revision],
    );
    if (!result.rowCount)
      throw new Problem(412, 'STALE_REVISION', 'Settings changed. Reload before saving.');
    await this.event(tx, orgId, user.user.id, 'organization.updated', orgId, rid);
    return this.settings(tx, orgId);
  }
  async team(tx: SqlTransaction, orgId: string, cursor: string) {
    const { rows } = await tx.query<MemberDto>(
      `SELECT m.id,u.name,u.email,m.role,m.status,m.revision FROM public.membership m CROSS JOIN LATERAL public.team_identity(m.user_id) u WHERE m.organization_id=$1 AND ($2='' OR m.id::text>$2) ORDER BY m.id LIMIT 51`,
      [orgId, cursor],
    );
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  }
  async changeMember(
    tx: SqlTransaction,
    user: ActiveSession,
    orgId: string,
    actor: Member,
    id: string,
    body: { role: Member['role']; status: 'ACTIVE' | 'INACTIVE' },
    revision: number,
    rid: string,
  ) {
    const result = await tx.query<Member>(
      'SELECT * FROM public.membership WHERE organization_id=$1 AND id=$2 FOR UPDATE',
      [orgId, id],
    );
    const target = result.rows[0];
    if (!target) throw new Problem(404, 'NOT_FOUND', 'Member unavailable');
    if (actor.role !== 'OWNER' && (target.role === 'OWNER' || body.role === 'OWNER'))
      throw new Problem(403, 'OWNER_REQUIRED', 'Only an Owner manages ownership');
    if (
      body.role === 'OWNER' &&
      !(
        await tx.query<{ eligible: boolean }>('SELECT public.eligible_member($1) AS eligible', [
          target.user_id,
        ])
      ).rows[0]?.eligible
    )
      throw new Problem(409, 'IDENTITY_UNAVAILABLE', 'Owner must be an active verified member');
    if (target.revision !== revision)
      throw new Problem(412, 'STALE_REVISION', 'Membership changed. Reload before saving.');
    if (target.role === 'OWNER' && (body.role !== 'OWNER' || body.status !== 'ACTIVE')) {
      const owners = await tx.query(
        "SELECT 1 FROM public.membership WHERE organization_id=$1 AND role='OWNER' AND status='ACTIVE' AND id<>$2",
        [orgId, id],
      );
      if (!owners.rowCount)
        throw new Problem(409, 'LAST_OWNER', 'The last active Owner cannot be removed');
    }
    if (target.role === 'OWNER' || body.role === 'OWNER') this.recent(user);
    await tx.query(
      'UPDATE public.membership SET role=$3,status=$4,revision=revision+1 WHERE organization_id=$1 AND id=$2',
      [orgId, id, body.role, body.status],
    );
    await this.event(tx, orgId, user.user.id, 'membership.changed', id, rid, {
      role: body.role,
      status: body.status,
    });
    await tx.query('SELECT public.revoke_member_sessions($1)', [target.user_id]);
    return { status: 'ok' };
  }
  recent(user: ActiveSession) {
    if (Date.now() - new Date(user.session.createdAt).getTime() > 600000)
      throw new Problem(403, 'REAUTHENTICATE', 'Sign in again before this sensitive action');
  }
  async transfer(
    tx: SqlTransaction,
    user: ActiveSession,
    orgId: string,
    actor: Member,
    id: string,
    rid: string,
  ) {
    if (actor.role !== 'OWNER')
      throw new Problem(403, 'OWNER_REQUIRED', 'Only an Owner transfers ownership');
    this.recent(user);
    if (id === actor.id) throw new Problem(409, 'CONFLICT', 'Choose another active member');
    const { rows } = await tx.query<Member>(
      "SELECT * FROM public.membership WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",
      [orgId, id],
    );
    if (!rows[0]) throw new Problem(404, 'NOT_FOUND', 'Member unavailable');
    if (
      !(
        await tx.query<{ eligible: boolean }>('SELECT public.eligible_member($1) AS eligible', [
          rows[0].user_id,
        ])
      ).rows[0]?.eligible
    )
      throw new Problem(409, 'IDENTITY_UNAVAILABLE', 'New Owner must be an active verified member');
    await tx.query(
      "UPDATE public.membership SET role=CASE WHEN id=$2 THEN 'OWNER' ELSE 'ADMIN' END,revision=revision+1 WHERE organization_id=$1 AND id IN ($2,$3)",
      [orgId, id, actor.id],
    );
    await this.event(tx, orgId, user.user.id, 'ownership.transferred', id, rid, {
      previousOwner: actor.id,
      newOwner: id,
    });
    await tx.query('SELECT public.revoke_member_sessions($1)', [rows[0].user_id]);
    await tx.query('SELECT public.revoke_member_sessions($1)', [user.user.id]);
    return { status: 'ok', signInRequired: true };
  }
  async invitations(tx: SqlTransaction, orgId: string, cursor: string) {
    const { rows } = await tx.query<InvitationDto>(
      `SELECT id,email,role,revision,expires_at AS "expiresAt", CASE WHEN accepted_at IS NOT NULL THEN 'ACCEPTED' WHEN revoked_at IS NOT NULL THEN 'REVOKED' WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'PENDING' END AS state FROM public.invitation WHERE purpose='INTERNAL' AND organization_id=$1 AND ($2='' OR id::text>$2) ORDER BY id LIMIT 51`,
      [orgId, cursor],
    );
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  }
  async invite(
    tx: SqlTransaction,
    user: ActiveSession,
    orgId: string,
    actor: Member,
    body: { email: string; role: 'ADMIN' | 'MEMBER' },
    rid: string,
  ) {
    const members = await tx.query(
      "SELECT 1 FROM public.membership m CROSS JOIN LATERAL public.team_identity(m.user_id) u WHERE m.organization_id=$1 AND m.status='ACTIVE' AND u.email=$2",
      [orgId, body.email],
    );
    if (members.rowCount)
      throw new Problem(409, 'MEMBER_EXISTS', 'This identity is already an active member');
    // Expiry releases the pending uniqueness slot, preserving history.
    await tx.query(
      "UPDATE public.invitation SET revoked_at=now(),revision=revision+1 WHERE purpose='INTERNAL' AND organization_id=$1 AND email=$2 AND expires_at<=now() AND accepted_at IS NULL AND revoked_at IS NULL",
      [orgId, body.email],
    );
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await tx.query(
      'INSERT INTO public.invitation(id,organization_id,inviter_id,email,role,digest) VALUES($1,$2,$3,$4,$5,$6)',
      [id, orgId, actor.id, body.email, body.role, digest(token)],
    );
    const event = await this.event(tx, orgId, user.user.id, 'invitation.created', id, rid);
    const envelope = sealMail(this.mailKey, {
      to: body.email,
      subject: 'DevWorkspace team invitation',
      text: `${this.origin}/invitations/accept?token=${token}`,
    });
    await tx.query(
      'INSERT INTO public.tenant_mail(id,organization_id,invitation_id,envelope) VALUES($1,$2,$3,$4)',
      [event, orgId, id, envelope],
    );
    return { id, status: 'pending' };
  }
  async revoke(
    tx: SqlTransaction,
    user: ActiveSession,
    orgId: string,
    id: string,
    revision: number,
    rid: string,
  ) {
    const result = await tx.query(
      'UPDATE public.invitation SET revoked_at=now(),revision=revision+1 WHERE organization_id=$1 AND id=$2 AND revision=$3 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id',
      [orgId, id, revision],
    );
    if (!result.rowCount)
      throw new Problem(
        409,
        'INVITATION_UNAVAILABLE',
        'Invitation changed or is no longer pending',
      );
    await this.event(tx, orgId, user.user.id, 'invitation.revoked', id, rid);
    return { status: 'ok' };
  }
  async invitation(
    user: ActiveSession,
    token: string,
    key: string | null,
    rid: string,
  ): Promise<
    | { organizationId: string }
    | {
        organization: OrganizationDto;
        role: string;
        capacity: string;
        accepted: boolean;
        project?: { id: string; name: string; clientName: string };
      }
  > {
    const result = await this.database.pool.query<{ organization_id: string }>(
      'SELECT public.invitation_scope($1) AS organization_id',
      [digest(token)],
    );
    const orgId = result.rows[0]?.organization_id;
    if (!orgId) throw new Problem(404, 'INVITATION_UNAVAILABLE', 'Invitation unavailable');
    return this.database.transaction(orgId, async (tx) => {
      const organization = await tx.query(
        "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
        [orgId],
      );
      if (!organization.rowCount)
        throw new Problem(404, 'INVITATION_UNAVAILABLE', 'Invitation unavailable');
      await tx.query('SELECT public.assert_session($1,$2)', [user.session.id, user.user.id]);
      const { rows } = await tx.query<{
        id: string;
        email: string;
        role: string;
        accepted_at: Date | null;
        revoked_at: Date | null;
        valid: boolean;
        inviter_id: string;
        purpose: string;
        contact_id: string;
        project_id: string;
        project_role: string;
      }>(
        'SELECT *,expires_at>now() AS valid FROM public.invitation WHERE organization_id=$1 AND digest=$2 FOR UPDATE',
        [orgId, digest(token)],
      );
      const invite = rows[0];
      if (
        !invite ||
        invite.email !== user.user.email.toLowerCase() ||
        invite.revoked_at ||
        !invite.valid
      )
        throw new Problem(
          404,
          'INVITATION_UNAVAILABLE',
          'Invitation unavailable for this identity',
        );
      const inviter = await tx.query(
        "SELECT 1 FROM public.membership WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND role IN ('OWNER','ADMIN') AND public.eligible_member(user_id)",
        [orgId, invite.inviter_id],
      );
      if (!inviter.rowCount)
        throw new Problem(
          409,
          'INVITER_UNAVAILABLE',
          'The invitation issuer no longer has authority',
        );
      let projectDetails: { id: string; name: string; clientName: string } | undefined;
      if (invite.purpose === 'CLIENT') {
        const target = await tx.query<{ id: string; name: string; clientName: string }>(
          `SELECT p.id,p.name,c.name AS "clientName" FROM public.project p JOIN public.client c ON c.organization_id=p.organization_id AND c.id=p.client_id JOIN public.client_contact contact ON contact.organization_id=c.organization_id AND contact.client_id=c.id WHERE p.organization_id=$1 AND p.id=$2 AND contact.id=$3 AND contact.status='ACTIVE' AND p.status IN ('PLANNED','ACTIVE')`,
          [orgId, invite.project_id, invite.contact_id],
        );
        projectDetails = target.rows[0];
        if (!projectDetails)
          throw new Problem(409, 'TARGET_UNAVAILABLE', 'Invitation target is unavailable');
      }
      if (!key)
        return {
          organization: await this.settings(tx, orgId),
          role: invite.purpose === 'CLIENT' ? invite.project_role : invite.role,
          capacity: invite.purpose,
          accepted: !!invite.accepted_at,
          ...(projectDetails ? { project: projectDetails } : {}),
        };
      const receipt = await tx.query<{ result: { organizationId: string } }>(
        'SELECT result FROM public.command_receipt WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
        [orgId, user.user.id, 'invite:' + invite.id, key],
      );
      if (receipt.rows[0]) {
        const active = await tx.query(
          "SELECT 1 FROM public.membership WHERE organization_id=$1 AND user_id=$2 AND status='ACTIVE'",
          [orgId, user.user.id],
        );
        if (!active.rowCount && invite.purpose !== 'CLIENT')
          throw new Problem(403, 'FORBIDDEN', 'Membership inactive');
        if (invite.purpose === 'CLIENT') {
          const grant = await tx.query(
            "SELECT 1 FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id WHERE c.organization_id=$1 AND c.id=$2 AND c.user_id=$3 AND c.status='ACTIVE' AND g.project_id=$4 AND g.status='ACTIVE'",
            [orgId, invite.contact_id, user.user.id, invite.project_id],
          );
          if (!grant.rowCount) throw new Problem(403, 'FORBIDDEN', 'Client access inactive');
        }
        return receipt.rows[0].result;
      }
      if (invite.accepted_at)
        throw new Problem(409, 'INVITATION_USED', 'Invitation already accepted');
      if (invite.purpose === 'CLIENT') {
        const contact = await tx.query<{
          id: string;
          client_id: string;
          user_id: string | null;
          email: string;
        }>(
          "SELECT * FROM public.client_contact WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",
          [orgId, invite.contact_id],
        );
        const c = contact.rows[0];
        const project = await tx.query(
          "SELECT 1 FROM public.project WHERE organization_id=$1 AND id=$2 AND client_id=$3 AND status IN ('PLANNED','ACTIVE')",
          [orgId, invite.project_id, c?.client_id],
        );
        if (
          !c ||
          c.email !== user.user.email.toLowerCase() ||
          (c.user_id && c.user_id !== user.user.id) ||
          !project.rowCount
        )
          throw new Problem(409, 'TARGET_UNAVAILABLE', 'Invitation target is unavailable');
        await tx.query(
          'UPDATE public.client_contact SET user_id=$3,revision=revision+1 WHERE organization_id=$1 AND id=$2',
          [orgId, c.id, user.user.id],
        );
        await tx.query(
          "INSERT INTO public.client_project_access(organization_id,project_id,client_id,contact_id,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,project_id,contact_id) DO UPDATE SET role=excluded.role,status='ACTIVE',revision=client_project_access.revision+1",
          [orgId, invite.project_id, c.client_id, c.id, invite.project_role],
        );
        await tx.query(
          'UPDATE public.invitation SET accepted_at=now(),revision=revision+1 WHERE organization_id=$1 AND id=$2',
          [orgId, invite.id],
        );
        await this.event(tx, orgId, user.user.id, 'invitation.accepted', invite.id, rid, {
          capacity: 'CLIENT',
        });
        const answer = { organizationId: orgId };
        await tx.query(
          'INSERT INTO public.command_receipt(organization_id,actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
          [orgId, user.user.id, 'invite:' + invite.id, key, digest(token), answer],
        );
        return answer;
      }
      const existing = await tx.query<Member>(
        'SELECT * FROM public.membership WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
        [orgId, user.user.id],
      );
      if (existing.rows[0]?.status === 'ACTIVE')
        throw new Problem(409, 'MEMBER_EXISTS', 'Already an active member');
      await tx.query(
        "INSERT INTO public.membership(id,organization_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,status='ACTIVE',revision=membership.revision+1",
        [randomUUID(), orgId, user.user.id, invite.role],
      );
      await tx.query(
        'UPDATE public.invitation SET accepted_at=now(),revision=revision+1 WHERE organization_id=$1 AND id=$2',
        [orgId, invite.id],
      );
      await this.event(tx, orgId, user.user.id, 'invitation.accepted', invite.id, rid);
      const answer = { organizationId: orgId };
      await tx.query(
        'INSERT INTO public.command_receipt(organization_id,actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
        [orgId, user.user.id, 'invite:' + invite.id, key, digest(token), answer],
      );
      return answer;
    });
  }
}
