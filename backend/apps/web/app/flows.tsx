'use client';
import { WorkspaceNavigation, capacityKey } from './navigation';
import { ImageControl } from './files';
import { NotificationPreferencesForm } from './notifications';
import { useEffect, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import {
  apiRequest,
  safeReturnPath,
  callOperation,
  type AccountDto,
  type PrincipalDto,
  type OrganizationDto,
  type MemberDto,
  type InvitationDto,
  type SessionDto,
} from '@devworkspace/contracts';
type Mode =
  | 'login'
  | 'register'
  | 'recovery'
  | 'reset'
  | 'invitation'
  | 'onboarding'
  | 'account'
  | 'team'
  | 'settings';
const titles: Record<Mode, string> = {
  login: 'Sign in',
  register: 'Create your account',
  recovery: 'Forgot password',
  reset: 'Reset password',
  invitation: 'Accept invitation',
  onboarding: 'Create your organization',
  account: 'My account',
  team: 'Team management',
  settings: 'Organization settings',
};
function values(event: FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(event.currentTarget));
}
function Field({
  name,
  label,
  type = 'text',
  value,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={type === 'password' ? 128 : 254}
        minLength={type === 'password' ? 12 : undefined}
        autoComplete={type === 'password' ? 'current-password' : name === 'email' ? 'email' : 'off'}
      />
    </label>
  );
}
export function Navigation() {
  const pathname = usePathname();
  const [items, setItems] = useState<PrincipalDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void callOperation('accountPrincipals')
      .then((data) => {
        setItems(data.items);
        setCursor(data.nextCursor);
        setSignedIn(true);
      })
      .catch(() => {});
  }, []);
  return (
    <nav aria-label="Main navigation">
      <a href="/">DevWorkspace</a> <a href="/account">My account</a>{' '}
      <a href="/onboarding">Create organization</a>
      {signedIn ? (
        <>
          <label>
            Organization
            <select
              aria-label="Organization"
              value={
                pathname.startsWith('/w/')
                  ? (items.find((p) => p.organizationId === pathname.split('/')[2])?.id ?? '')
                  : ''
              }
              onChange={(e) => {
                const principal = items.find((p) => p.id === e.target.value);
                if (principal) window.location.assign(`/w/${principal.organizationId}`);
              }}
            >
              <option value="" disabled>
                Choose an internal principal
              </option>
              {items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.role}
                </option>
              ))}
            </select>
          </label>
          {cursor && (
            <button
              onClick={() =>
                void apiRequest<{ items: PrincipalDto[]; nextCursor: string | null }>(
                  '/api/v1/me/principals?cursor=' + cursor,
                )
                  .then((data) => {
                    setItems([...items, ...data.items]);
                    setCursor(data.nextCursor);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Load more organizations
            </button>
          )}
          <button
            onClick={() =>
              void apiRequest('/api/v1/identity/logout', 'POST', {})
                .then(() => window.location.assign('/login'))
                .catch((e) => setError(e.message))
            }
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <a href="/login">Sign in</a> <a href="/register">Register</a>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </nav>
  );
}
export default function Flow({ mode, orgId }: { mode: Mode; orgId?: string }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [proof, setProof] = useState('');
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [organization, setOrganization] = useState<OrganizationDto | null>(null);
  const [principal, setPrincipal] = useState<PrincipalDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [inviteCursor, setInviteCursor] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<{
    organization: OrganizationDto;
    role: string;
    capacity: string;
    accepted: boolean;
    project?: { id: string; name: string; clientName: string };
  } | null>(null);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function tenantHeaders() {
    return { 'X-Organization-Principal': principal?.id ?? '' };
  }
  async function load() {
    setError('');
    setLoading(true);
    try {
      const protectedMode = ['invitation', 'onboarding', 'account', 'team', 'settings'].includes(
        mode,
      );
      if (protectedMode) setAccount(await apiRequest<AccountDto>('/api/v1/me'));
      if (mode === 'account') {
        const data = await apiRequest<{ items: SessionDto[]; nextCursor: string | null }>(
          '/api/v1/me/sessions',
        );
        setSessions(data.items);
        setSessionCursor(data.nextCursor);
      }
      if (orgId) {
        let ps = await apiRequest<{ items: PrincipalDto[]; nextCursor: string | null }>(
          '/api/v1/me/principals',
        );
        let p = ps.items.find((x) => x.organizationId === orgId);
        while (!p && ps.nextCursor) {
          ps = await apiRequest('/api/v1/me/principals?cursor=' + ps.nextCursor);
          p = ps.items.find((x) => x.organizationId === orgId);
        }
        if (!p) throw new Error('This organization is unavailable for your current identity.');
        setPrincipal(p);
        const h = { 'X-Organization-Principal': p.id };
        setOrganization(
          await apiRequest<OrganizationDto>(`/api/v1/organizations/${orgId}`, 'GET', undefined, h),
        );
        if (mode === 'team' || (mode === 'settings' && p.role === 'OWNER')) {
          const team = await apiRequest<{ items: MemberDto[]; nextCursor: string | null }>(
            `/api/v1/organizations/${orgId}/team`,
            'GET',
            undefined,
            h,
          );
          setMembers(team.items);
          setMemberCursor(team.nextCursor);
          const invites = await apiRequest<{ items: InvitationDto[]; nextCursor: string | null }>(
            `/api/v1/organizations/${orgId}/invitations`,
            'GET',
            undefined,
            h,
          );
          setInvitations(invites.items);
          setInviteCursor(invites.nextCursor);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot load this page');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const token = params.get('token');
    if (token) {
      setProof(token);
      if (mode === 'invitation') sessionStorage.setItem('pending-invitation', token);
      window.history.replaceState(null, '', window.location.pathname);
    } else if (mode === 'invitation') setProof(sessionStorage.getItem('pending-invitation') ?? '');
    void load();
    // Full navigation separates principal state; no shared private query cache.
  }, [mode, orgId]);
  const submit =
    (work: (data: Record<string, FormDataEntryValue>) => Promise<void>) =>
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = values(event);
      void run(() => work(data));
    };
  const mutation = async (
    path: string,
    data: unknown,
    method = 'POST',
    headers: Record<string, string> = {},
  ) => apiRequest(path, method, data, headers);
  const saved = async () => {
    setMessage('Saved');
    await load();
  };
  if (loading)
    return (
      <>
        <h1>{titles[mode]}</h1>
        <p role="status">Loading…</p>
      </>
    );
  const needsAccount = ['invitation', 'onboarding', 'account', 'team', 'settings'].includes(mode);
  return (
    <section>
      <h1>{titles[mode]}</h1>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button disabled={busy} onClick={() => void load()}>
            Reload data
          </button>
          <p>Unsaved form values remain until you reload or leave this page.</p>
          <a href="/login">Sign in again</a>
        </div>
      )}
      <p role="status" aria-live="polite">
        {busy ? 'Working…' : message}
      </p>
      {(!needsAccount || account) && (
        <fieldset disabled={busy}>
          {mode === 'login' && (
            <>
              <form
                onSubmit={submit(async (data) => {
                  await mutation('/api/v1/identity/login', data);
                  const target = new URL(window.location.href).searchParams.get('returnTo');
                  window.location.assign(
                    safeReturnPath(target)
                      ? safeReturnPath(target)!
                      : sessionStorage.getItem('pending-invitation')
                        ? '/invitations/accept'
                        : '/account',
                  );
                })}
              >
                <Field name="email" label="Email" type="email" />
                <Field name="password" label="Password" type="password" />
                <button>Sign in</button>
              </form>
              <a href="/forgot-password">Forgot password</a>
              <a href="/register">Create an account</a>
              <form
                onSubmit={submit(async (data) => {
                  await mutation('/api/v1/identity/resend', data);
                  setMessage('If eligible, check your email.');
                })}
              >
                <Field name="email" label="Email for verification" type="email" />
                <button>Resend verification</button>
              </form>
            </>
          )}
          {mode === 'register' && (
            <>
              {proof ? (
                <form
                  onSubmit={submit(async () => {
                    await mutation('/api/v1/identity/verify', { token: proof });
                    setProof('');
                    setMessage('Email verified. Sign in to continue.');
                  })}
                >
                  <p>Confirm your email using the link you opened.</p>
                  <button>Verify email</button>
                  <a href="/login">Sign in</a>
                </form>
              ) : (
                <form
                  onSubmit={submit(async (data) => {
                    await mutation('/api/v1/identity/register', data);
                    setMessage('If eligible, check your email to verify your account.');
                  })}
                >
                  <Field name="name" label="Display name" />
                  <Field name="email" label="Email" type="email" />
                  <Field name="password" label="Password" type="password" />
                  <button>Register</button>
                </form>
              )}
              <p>
                Verification links expire after 24 hours.{' '}
                <a href="/login">Sign in or resend verification</a>.
              </p>
            </>
          )}
          {mode === 'recovery' && (
            <form
              onSubmit={submit(async (data) => {
                await mutation('/api/v1/identity/recovery', data);
                setMessage('If eligible, check your email.');
              })}
            >
              <Field name="email" label="Email" type="email" />
              <button>Send reset link</button>
            </form>
          )}
          {mode === 'reset' && (
            <>
              {proof ? (
                <form
                  onSubmit={submit(async (data) => {
                    await mutation('/api/v1/identity/reset', { token: proof, ...data });
                    setProof('');
                    setMessage('Password reset. Prior sessions are revoked. Sign in again.');
                  })}
                >
                  <Field name="newPassword" label="New password" type="password" />
                  <button>Reset password</button>
                </form>
              ) : (
                <p>Open an unused reset link from your email.</p>
              )}
              <a href="/forgot-password">Request another link</a>
              <a href="/login">Sign in</a>
            </>
          )}
          {mode === 'onboarding' && (
            <form
              onSubmit={submit(async (data) => {
                let key = sessionStorage.getItem('onboarding-key');
                if (!key) {
                  key = crypto.randomUUID();
                  sessionStorage.setItem('onboarding-key', key);
                }
                const result = await apiRequest<{ organizationId: string }>(
                  '/api/v1/organizations',
                  'POST',
                  data,
                  { 'Idempotency-Key': key },
                );
                sessionStorage.removeItem('onboarding-key');
                window.location.assign(
                  `/login?returnTo=${encodeURIComponent(`/w/${result.organizationId}/settings`)}`,
                );
              })}
            >
              <Field name="name" label="Organization name" />
              <label>
                Description
                <textarea aria-label="Description" name="description" maxLength={2000} />
              </label>
              <Field name="timezone" label="Timezone" value="Africa/Cairo" />
              <button>Create organization</button>
            </form>
          )}
          {mode === 'invitation' && (
            <>
              {proof ? (
                <>
                  <button
                    onClick={() =>
                      void run(async () =>
                        setInvitation(
                          await apiRequest('/api/v1/invitations/inspect', 'POST', { token: proof }),
                        ),
                      )
                    }
                  >
                    Review invitation
                  </button>
                  {invitation && (
                    <>
                      <p>
                        {invitation.organization.name} — {invitation.capacity}, {invitation.role}
                      </p>
                      {invitation.project && (
                        <p>
                          Client: {invitation.project.clientName}; project:{' '}
                          {invitation.project.name}. This grants only the displayed client project
                          capacity.
                        </p>
                      )}
                      <button
                        onClick={() =>
                          void run(async () => {
                            const result = await apiRequest<{ organizationId: string }>(
                              '/api/v1/invitations/accept',
                              'POST',
                              { token: proof },
                              {
                                'Idempotency-Key':
                                  'accept-' +
                                  (await crypto.subtle
                                    .digest('SHA-256', new TextEncoder().encode(proof))
                                    .then((buffer) =>
                                      Array.from(new Uint8Array(buffer))
                                        .map((b) => b.toString(16).padStart(2, '0'))
                                        .join(''),
                                    )),
                              },
                            );
                            sessionStorage.removeItem('pending-invitation');
                            setProof('');
                            window.location.assign(
                              invitation.capacity === 'CLIENT'
                                ? `/portal/${result.organizationId}/projects`
                                : `/login?returnTo=${encodeURIComponent(`/w/${result.organizationId}/settings`)}`,
                            );
                          })
                        }
                      >
                        {invitation.capacity === 'CLIENT'
                          ? 'Accept client project access'
                          : 'Accept internal membership'}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p>Open your invitation email link to continue.</p>
              )}
            </>
          )}
          {mode === 'account' && account && <ClientCapacities />}
          {mode === 'account' && account && (
            <>
              <p>Signed in as {account.email}</p>
              <ImageControl path="/api/v1/me/image" label="Profile image" />
              <NotificationPreferencesForm />
              <form
                key={account.revision}
                onSubmit={submit(async (data) => {
                  await mutation('/api/v1/me', data, 'PATCH', {
                    'If-Match': `"${account.revision}"`,
                  });
                  await saved();
                })}
              >
                <Field name="name" label="Display name" value={account.name} />
                <button>Save profile</button>
              </form>
              <form
                onSubmit={submit(async (data) => {
                  await mutation('/api/v1/me/password', data);
                  setMessage('Password changed; other sessions revoked.');
                  setSessions(
                    (await apiRequest<{ items: SessionDto[] }>('/api/v1/me/sessions')).items,
                  );
                  setSessionCursor(null);
                })}
              >
                <Field name="currentPassword" label="Current password" type="password" />
                <Field name="newPassword" label="New password" type="password" />
                <button>Change password</button>
              </form>
              <h2>Active sessions</h2>
              <ul>
                {sessions.map((s) => (
                  <li key={s.id}>
                    {s.current ? 'This session' : 'Other session'} — signed in{' '}
                    {new Date(s.createdAt).toLocaleString()}
                    <button
                      onClick={() =>
                        void run(async () => {
                          await mutation(
                            `/api/v1/me/sessions/${encodeURIComponent(s.id)}`,
                            {},
                            'DELETE',
                          );
                          if (s.current) window.location.assign('/login');
                          else setSessions(sessions.filter((x) => x.id !== s.id));
                        })
                      }
                    >
                      Revoke {s.current ? 'this' : 'other'} session
                    </button>
                  </li>
                ))}
              </ul>
              {sessionCursor && (
                <button
                  onClick={() =>
                    void run(async () => {
                      const data = await apiRequest<{
                        items: SessionDto[];
                        nextCursor: string | null;
                      }>('/api/v1/me/sessions?cursor=' + encodeURIComponent(sessionCursor));
                      setSessions([...sessions, ...data.items]);
                      setSessionCursor(data.nextCursor);
                    })
                  }
                >
                  Load more sessions
                </button>
              )}
            </>
          )}
          {orgId && organization && principal && (
            <>
              <p>
                Acting as {principal.role} in {organization.name}.
              </p>
              <WorkspaceNavigation orgId={orgId} role={principal.role} />
              {mode === 'settings' && (
                <>
                  {principal.role === 'MEMBER' ? (
                    <p>
                      Organization settings are read only for Members. {organization.description} —{' '}
                      {organization.timezone}
                    </p>
                  ) : (
                    <form
                      key={organization.revision}
                      onSubmit={submit(async (data) => {
                        await mutation(`/api/v1/organizations/${orgId}`, data, 'PATCH', {
                          ...tenantHeaders(),
                          'If-Match': `"${organization.revision}"`,
                        });
                        await saved();
                      })}
                    >
                      <Field name="name" label="Organization name" value={organization.name} />
                      <label>
                        Description
                        <textarea
                          aria-label="Description"
                          name="description"
                          defaultValue={organization.description}
                          maxLength={2000}
                        />
                      </label>
                      <Field name="timezone" label="Timezone" value={organization.timezone} />
                      <button>Save settings</button>
                    </form>
                  )}
                  <ImageControl
                    path={`/api/v1/organizations/${orgId}/logo`}
                    headers={tenantHeaders()}
                    editable={principal.role === 'OWNER' || principal.role === 'ADMIN'}
                    label="Organization logo"
                  />
                  {principal.role === 'OWNER' && (
                    <form
                      onSubmit={submit(async (data) => {
                        await mutation(
                          `/api/v1/organizations/${orgId}/ownership`,
                          data,
                          'POST',
                          tenantHeaders(),
                        );
                        window.location.assign('/login');
                      })}
                    >
                      <p>
                        Transfer makes the selected active member an Owner and changes your role to
                        Admin. Both identities must sign in again.
                      </p>
                      <label>
                        New Owner
                        <select aria-label="New Owner" name="membershipId" required defaultValue="">
                          <option value="" disabled>
                            Choose an active member
                          </option>
                          {members
                            .filter((m) => m.id !== principal.id && m.status === 'ACTIVE')
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} — {m.email}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <input type="checkbox" required />
                        Confirm ownership transfer
                      </label>
                      {memberCursor && (
                        <button
                          type="button"
                          onClick={() =>
                            void run(async () => {
                              const data = await apiRequest<{
                                items: MemberDto[];
                                nextCursor: string | null;
                              }>(
                                `/api/v1/organizations/${orgId}/team?cursor=${memberCursor}`,
                                'GET',
                                undefined,
                                tenantHeaders(),
                              );
                              setMembers([...members, ...data.items]);
                              setMemberCursor(data.nextCursor);
                            })
                          }
                        >
                          Load more eligible members
                        </button>
                      )}
                      <button>Transfer ownership</button>
                    </form>
                  )}
                </>
              )}
              {mode === 'team' && principal.role !== 'MEMBER' && (
                <>
                  <h2>Members</h2>
                  {!members.length && <p>No members to display.</p>}
                  {members.map((m) => (
                    <form
                      key={m.id + '-' + m.revision}
                      onSubmit={submit(async (data) => {
                        await mutation(
                          `/api/v1/organizations/${orgId}/team/${m.id}`,
                          data,
                          'PATCH',
                          { ...tenantHeaders(), 'If-Match': `"${m.revision}"` },
                        );
                        if (m.email === account?.email) window.location.assign('/login');
                        else await saved();
                      })}
                    >
                      <p>
                        {m.name} — {m.email}{' '}
                      </p>
                      <label>
                        Role for {m.name}
                        <select aria-label={'Role for ' + m.name} name="role" defaultValue={m.role}>
                          {(principal.role === 'OWNER'
                            ? ['OWNER', 'ADMIN', 'MEMBER']
                            : m.role === 'OWNER'
                              ? ['OWNER']
                              : ['ADMIN', 'MEMBER']
                          ).map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Status for {m.name}
                        <select
                          aria-label={'Status for ' + m.name}
                          name="status"
                          defaultValue={m.status}
                        >
                          <option>ACTIVE</option>
                          <option>INACTIVE</option>
                        </select>
                      </label>
                      <button disabled={principal.role !== 'OWNER' && m.role === 'OWNER'}>
                        Save membership
                      </button>
                    </form>
                  ))}
                  {memberCursor && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          const data = await apiRequest<{
                            items: MemberDto[];
                            nextCursor: string | null;
                          }>(
                            `/api/v1/organizations/${orgId}/team?cursor=${memberCursor}`,
                            'GET',
                            undefined,
                            tenantHeaders(),
                          );
                          setMembers([...members, ...data.items]);
                          setMemberCursor(data.nextCursor);
                        })
                      }
                    >
                      Load more members
                    </button>
                  )}
                  <h2>Invite an internal teammate</h2>
                  <form
                    onSubmit={submit(async (data) => {
                      await mutation(
                        `/api/v1/organizations/${orgId}/invitations`,
                        data,
                        'POST',
                        tenantHeaders(),
                      );
                      setMessage('Invitation queued for email delivery.');
                      await load();
                    })}
                  >
                    <Field name="email" label="Invitation email" type="email" />
                    <label>
                      Invitation role
                      <select name="role" defaultValue="MEMBER">
                        <option>MEMBER</option>
                        <option>ADMIN</option>
                      </select>
                    </label>
                    <button>Send invitation</button>
                  </form>
                  <h2>Invitations</h2>
                  {!invitations.length && <p>No invitations yet.</p>}
                  <ul>
                    {invitations.map((i) => (
                      <li key={i.id}>
                        {i.email} — {i.role} — {i.state}
                        {i.state === 'PENDING' && (
                          <button
                            onClick={() =>
                              void run(async () => {
                                await mutation(
                                  `/api/v1/organizations/${orgId}/invitations/${i.id}`,
                                  {},
                                  'DELETE',
                                  { ...tenantHeaders(), 'If-Match': `"${i.revision}"` },
                                );
                                await saved();
                              })
                            }
                          >
                            Revoke invitation
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {inviteCursor && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          const data = await apiRequest<{
                            items: InvitationDto[];
                            nextCursor: string | null;
                          }>(
                            `/api/v1/organizations/${orgId}/invitations?cursor=${inviteCursor}`,
                            'GET',
                            undefined,
                            tenantHeaders(),
                          );
                          setInvitations([...invitations, ...data.items]);
                          setInviteCursor(data.nextCursor);
                        })
                      }
                    >
                      Load more invitations
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </fieldset>
      )}
    </section>
  );
}

function ClientCapacities() {
  const [items, setItems] = useState<Array<{ id: string; organizationId: string; name: string }>>(
    [],
  );
  const [projects, setProjects] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [error, setError] = useState('');
  async function pages<T>(path: string, headers: Record<string, string> = {}): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;
    do {
      const data: { items: T[]; nextCursor: string | null } = await apiRequest<{
        items: T[];
        nextCursor: string | null;
      }>(path + (cursor ? '?cursor=' + cursor : ''), 'GET', undefined, headers);
      rows.push(...data.items);
      cursor = data.nextCursor;
    } while (cursor);
    return rows;
  }
  useEffect(() => {
    void pages<(typeof items)[number]>('/api/v1/me/client-principals')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h2>Client capacities</h2>
      {error && <p role="alert">{error}</p>}
      {!items.length && <p>No linked client contacts.</p>}
      {items.map((c) => (
        <div key={c.id}>
          <button
            onClick={() => {
              setProjects([]);
              void pages<(typeof projects)[number]>(
                `/api/v1/organizations/${c.organizationId}/client-access`,
                { 'X-Organization-Principal': c.id },
              )
                .then(setProjects)
                .catch((e) => setError(e.message));
            }}
          >
            Inspect access for {c.name}
          </button>
          <a
            href={`/portal/${c.organizationId}`}
            onClick={() => sessionStorage.setItem(capacityKey(c.organizationId, true), c.id)}
          >
            Open client portal
          </a>
        </div>
      ))}
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            {p.name} - {p.role}
          </li>
        ))}
      </ul>
    </section>
  );
}
