'use client';
import { useViewParam } from './view-state';
import {
  WorkspaceNavigation,
  ProjectNavigation,
  preferredCapacity,
  capacityKey,
} from './navigation';
import { NotificationBadge, NotificationsPanel } from './notifications';
import { useEffect, useState, useRef, type FormEvent, type MouseEvent } from 'react';
import {
  apiRequest,
  canonicalAnnotationPoint,
  type ReviewRecord,
  type ReviewFeedback,
  type PrincipalDto,
} from '@devworkspace/contracts';
type Page<T> = { items: T[]; page: number; limit: number; total?: number };
export default function ReviewWorkspace({
  orgId,
  segments,
  client = false,
}: {
  orgId: string;
  segments: string[];
  client?: boolean;
}) {
  const [principal, setPrincipal] = useState<PrincipalDto>();
  const [principals, setPrincipals] = useState<PrincipalDto[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPrincipal(undefined);
    const load = async () => {
      const items: PrincipalDto[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: PrincipalDto[]; nextCursor: string | null } = await apiRequest(
          (client ? '/api/v1/me/client-principals' : '/api/v1/me/principals') +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return { items };
    };
    void load()
      .then((r) => {
        if (active) {
          const p = r.items.filter((p) => p.organizationId === orgId);
          setPrincipals(p);
          setPrincipal(preferredCapacity(p, orgId, client));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [orgId, client]);
  return (
    <section>
      <h1>
        {client
          ? 'Client portal'
          : segments[0] === 'notifications'
            ? 'Notifications'
            : 'Review Center'}
      </h1>
      <p>
        <a href="/account">Account and capacities</a> |{' '}
        {!client && <a href={`/w/${orgId}`}>Internal workspace</a>}{' '}
        {client && !(segments[0] === 'projects' && segments[1]) && (
          <a
            href={`/portal/${orgId}/updates${segments[0] === 'projects' && segments[1] ? '?projectId=' + segments[1] : ''}`}
          >
            Client updates
          </a>
        )}
      </p>
      {!client && principal && <WorkspaceNavigation orgId={orgId} role={principal.role} />}
      {segments[0] === 'projects' && segments[1] && (
        <ProjectNavigation orgId={orgId} projectId={segments[1]} client={client} />
      )}
      {client && (
        <p>
          <a href={`/portal/${orgId}/projects`}>My projects</a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <label>
        Acting capacity{' '}
        <select
          aria-label="Acting capacity"
          value={principal?.id ?? ''}
          onChange={(e) => {
            sessionStorage.setItem(capacityKey(orgId, client), e.target.value);
            setPrincipal(principals.find((p) => p.id === e.target.value));
          }}
        >
          <option value="">Select capacity</option>
          {principals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
      </label>
      {principal && segments[0] !== 'notifications' && (
        <NotificationBadge
          key={principal.id}
          orgId={orgId}
          principalId={principal.id}
          client={client}
          projectId={segments[0] === 'projects' ? segments[1] : undefined}
        />
      )}
      {principal && segments[0] === 'notifications' ? (
        <NotificationsPanel
          key={principal.id}
          orgId={orgId}
          principalId={principal.id}
          client={client}
        />
      ) : principal ? (
        <ReviewView
          key={principal.id + segments.join('/')}
          orgId={orgId}
          segments={segments}
          client={client}
          principal={principal}
        />
      ) : (
        <p>Select an available capacity to continue.</p>
      )}
    </section>
  );
}
function ReviewView({
  orgId,
  segments,
  client,
  principal,
}: {
  orgId: string;
  segments: string[];
  client: boolean;
  principal: PrincipalDto;
}) {
  const api = `/api/v1/organizations/${orgId}${client ? '/portal' : ''}`;
  const root = client ? `/portal/${orgId}` : `/w/${orgId}`;
  const project = segments[0] === 'projects' ? segments[1] : undefined;
  const review = segments[2] === 'reviews' ? segments[3] : undefined;
  const path = project
    ? `/projects/${project}/reviews${review ? '/' + review : ''}`
    : client
      ? ''
      : '/reviews';
  const headers = { 'X-Organization-Principal': principal.id };
  const [page, setPage] = useViewParam<number>('page', 1),
    [status, setStatus] = useViewParam<string>('status', ''),
    [tick, setTick] = useState(0);
  const [dueBefore, setDueBefore] = useViewParam<string>('due_before', '');
  const [exactVersion, setExactVersion] = useViewParam<string>('version_id', '');
  const [milestonePage, setMilestonePage] = useViewParam<number>('milestone_page', 1);
  const [overview, setOverview] = useState<ReviewRecord>();
  const [feedbackPage, setFeedbackPage] = useViewParam<number>('feedback_page', 1),
    [versionPage, setVersionPage] = useViewParam<number>('version_page', 1);
  const [canManage, setCanManage] = useState(false);
  const [total, setTotal] = useState<number>();
  const [rows, setRows] = useState<ReviewRecord[]>([]),
    [current, setCurrent] = useState<ReviewRecord>(),
    [feedback, setFeedback] = useState<ReviewFeedback[]>([]),
    [versions, setVersions] = useState<ReviewRecord[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const retryKeys = useRef(new Map<string, string>());
  const [version, setVersion] = useState(''),
    [approvers, setApprovers] = useState(''),
    [due, setDue] = useState('');
  const [contacts, setContacts] = useState<
    Array<{ contact_id: string; role: string; status: string; name?: string | undefined }>
  >([]);
  const [confirm, setConfirm] = useState(false),
    [reason, setReason] = useState(''),
    [text, setText] = useState(''),
    [visibility, setVisibility] = useState('CLIENT');
  const [pageNumber, setPageNumber] = useState(1),
    [zoom, setZoom] = useState(1),
    [rotation, setRotation] = useState(0),
    [image, setImage] = useState('');
  const [pin, setPin] = useState<{ x: number; y: number }>();
  const [taskTitle, setTaskTitle] = useState(''),
    [priority, setPriority] = useState('NORMAL'),
    [assignee, setAssignee] = useState(''),
    [milestone, setMilestone] = useState('');
  const [candidates, setCandidates] = useState<
      Array<{ id: string; name?: string; membership_id?: string }>
    >([]),
    [milestones, setMilestones] = useState<Array<{ id: string; title: string }>>([]);
  const request = <T,>(p: string, method = 'GET', body?: unknown, h: Record<string, string> = {}) =>
    apiRequest<T>(api + p, method, body, { ...headers, ...h });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCurrent(undefined);
    setFeedback([]);
    setOverview(undefined);
    setVersions([]);
    setContacts([]);
    setCanManage(false);
    setError('');
    const run = async () => {
      if (review) {
        const c = await request<ReviewRecord>(path);
        const source = new URLSearchParams(window.location.search).get('feedback_id');
        const f = await request<Page<ReviewFeedback>>(
          source
            ? path + '/feedback/' + encodeURIComponent(source)
            : path + '/feedback?limit=100&page=' + feedbackPage,
        );
        if (active) {
          setCurrent(c);
          setFeedback(f.items);
          setConfirm(false);
        }
      } else {
        const data = await request<Page<ReviewRecord>>(
          path +
            `?page=${page}&limit=25${status ? '&status=' + status : ''}${dueBefore ? '&due_before=' + encodeURIComponent(dueBefore) : ''}${exactVersion ? '&version_id=' + encodeURIComponent(exactVersion) : ''}`,
        );
        if (active) {
          setRows(data.items);
          setTotal(data.total);
        }
      }
      if (project) {
        if (client) {
          const overview = await request<ReviewRecord>(
            `/projects/${project}?page=${milestonePage}&limit=25`,
          );
          if (active) setOverview(overview);
        }
        const vs = await request<Page<ReviewRecord> & { manager: boolean }>(
          `/projects/${project}/versions?limit=100&page=${versionPage}`,
        );
        if (active) {
          setVersions(vs.items);
          setCanManage(vs.manager);
        }
        if (!client && vs.manager) {
          const all = async <T,>(resource: string) => {
            const items: T[] = [];
            for (let p = 1; active; p++) {
              const result = await request<Page<T>>(resource + `?limit=100&page=${p}`);
              items.push(...result.items);
              if (
                result.items.length < 100 ||
                (result.total !== undefined && items.length >= result.total)
              )
                break;
            }
            return items;
          };
          const p = await request<{ client_id: string }>(`/projects/${project}`);
          const [gs, ms, cs, names] = await Promise.all([
            all<{ contact_id: string; role: string; status: string }>(
              `/projects/${project}/grants`,
            ),
            all<{ id: string; title: string }>(`/projects/${project}/milestones`),
            all<{ id: string; name?: string; role: string; status: string }>(
              `/projects/${project}/members`,
            ),
            all<{ id: string; name: string }>(`/clients/${p.client_id}/contacts`),
          ]);
          if (active) {
            setContacts(
              gs.map((g) => ({ ...g, name: names.find((c) => c.id === g.contact_id)?.name })),
            );
            setMilestones(ms);
            setCandidates(
              cs.filter(
                (c) => c.status === 'ACTIVE' && ['MANAGER', 'CONTRIBUTOR'].includes(c.role),
              ),
            );
          }
        }
      }
    };
    void run()
      .catch((e) => {
        if (active) {
          setError(e.message);
          setRows([]);
          setCurrent(undefined);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The component key changes with capacity/navigation; requests cannot repopulate another capacity.
  }, [page, status, tick, feedbackPage, versionPage, dueBefore, exactVersion, milestonePage]);
  useEffect(() => {
    let active = true;
    let url = '';
    setImage('');
    if (!current || !review) return;
    void fetch(api + path + '/preview/' + pageNumber, { headers, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Preview unavailable or access revoked');
        const b = await r.blob();
        url = URL.createObjectURL(b);
        if (active) setImage(url);
        else URL.revokeObjectURL(url);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [current, pageNumber]);
  async function mutate(p: string, body: unknown, method = 'POST', revision?: number) {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const fingerprint = JSON.stringify([p, method, body, revision]);
      if (!retryKeys.current.has(fingerprint))
        retryKeys.current.set(fingerprint, crypto.randomUUID());
      await request(p, method, body, {
        'Idempotency-Key': retryKeys.current.get(fingerprint)!,
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      });
      setTick((t) => t + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function open(e: FormEvent) {
    e.preventDefault();
    await mutate(
      review ? path + '/replace' : path,
      {
        version_id: version,
        digest: versions.find((v) => v.id === version)?.digest,
        approver_ids: approvers.split(',').filter(Boolean),
        due_at: due ? new Date(due).toISOString() : null,
      },
      'POST',
      review ? current?.revision : undefined,
    );
  }
  async function sendFeedback(e: FormEvent) {
    e.preventDefault();
    if (!current?.version) return;
    const annotation = pin
      ? {
          type: current.version.mime === 'application/pdf' ? 'PDF_POINT' : 'IMAGE_PIN',
          ...(current.version.mime === 'application/pdf' ? { page: pageNumber } : {}),
          ...pin,
        }
      : null;
    if (
      await mutate(path + '/feedback', {
        version_id: current.version.id,
        digest: current.version.digest,
        visibility,
        body: text,
        annotation,
      })
    ) {
      setText('');
      setPin(undefined);
    }
  }
  function place(e: MouseEvent<HTMLDivElement>) {
    if (!current?.canFeedback) return;
    const box = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width,
      sy = (e.clientY - box.top) / box.height;
    setPin(canonicalAnnotationPoint(sx, sy, rotation));
  }
  const preview = current?.previews?.find((p) => p.page === pageNumber);
  const displayWidth = preview ? Math.min(preview.width, 800) * zoom : 0;
  const displayHeight = preview ? (displayWidth * preview.height) / preview.width : 0;
  const frameWidth = rotation % 180 ? displayHeight : displayWidth;
  const frameHeight = rotation % 180 ? displayWidth : displayHeight;
  const annotationPins = feedback.filter(
    (f) => f.annotation && (f.annotation.type !== 'PDF_POINT' || f.annotation.page === pageNumber),
  );
  return (
    <section>
      {client && <PortalBranding key={tick} orgId={orgId} principal={principal.id} />}
      {overview && (
        <section>
          <h2>{overview.name}</h2>
          <p>
            {overview.description} · {overview.status}
          </p>
          <h3>Milestones</h3>
          <ul>
            {overview.milestones?.map((m) => (
              <li key={m.id}>
                {m.title} · {m.status} · {m.due_at ?? 'No deadline'}
              </li>
            ))}
          </ul>
          {!overview.milestones?.length && <p>No milestones in this view.</p>}
          <p>
            {overview.milestone_total ?? 0} milestones · Page {milestonePage}
          </p>
          <button disabled={milestonePage === 1} onClick={() => setMilestonePage((p) => p - 1)}>
            Previous milestones
          </button>
          <button
            disabled={milestonePage * 25 >= (overview.milestone_total ?? 0)}
            onClick={() => setMilestonePage((p) => p + 1)}
          >
            Next milestones
          </button>
          <a href={`${root}/projects/${project}/deliverables`}>Shared deliverables</a>
        </section>
      )}
      <p>
        <a href={root + (client ? '' : '/reviews')}>All {client ? 'portal projects' : 'reviews'}</a>
        {project && (
          <>
            {' '}
            | <a href={`${root}/projects/${project}/reviews`}>Project reviews</a>
            {!client && (
              <>
                {' '}
                | <a href={`${root}/projects/${project}`}>Project overview</a>
              </>
            )}
          </>
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => setTick((t) => t + 1)} disabled={busy}>
        Reload current state
      </button>
      {loading && <p role="status">Loading…</p>}
      {!review && (
        <>
          {total !== undefined && (
            <p>{total} matching reviews, each with its own exact target version.</p>
          )}
          {(!client || project) && (
            <form
              key={dueBefore + exactVersion}
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const date = String(d.get('due_before') ?? '');
                setDueBefore(date ? new Date(date).toISOString() : '');
                setExactVersion(String(d.get('version_id') ?? '').trim());
                setPage(1);
              }}
            >
              <label>
                Due on or before (local time)
                <input
                  type="datetime-local"
                  name="due_before"
                  defaultValue={
                    dueBefore && Number.isFinite(Date.parse(dueBefore))
                      ? new Date(
                          Date.parse(dueBefore) - new Date(dueBefore).getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ''
                  }
                />
              </label>
              <label>
                Exact version identifier
                <input
                  name="version_id"
                  defaultValue={exactVersion}
                  pattern="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
                />
              </label>
              <button>Apply review filters</button>
            </form>
          )}
          {(!client || project) && (
            <label>
              Review status{' '}
              <select
                aria-label="Review status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                {['OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED', 'SUPERSEDED'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          {!loading && !rows.length && (
            <p>No accessible {client && !project ? 'projects' : 'reviews'}.</p>
          )}
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <a
                  href={
                    client && !project
                      ? `${root}/projects/${r.id}`
                      : `${root}/projects/${r.project_id}/reviews/${r.id}`
                  }
                >
                  {r.name ?? `${r.status}: exact version ${r.version_id}`}
                </a>
                {r.cycle_number && ` · cycle ${r.cycle_number}`}
              </li>
            ))}
          </ul>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>{' '}
          Page {page}{' '}
          <button disabled={rows.length < 25} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </>
      )}
      {project && (
        <details open={!review}>
          <summary>Shared version history and review management</summary>
          <p>
            <button
              disabled={versionPage === 1}
              onClick={() => {
                setVersion('');
                setVersionPage((p) => p - 1);
              }}
            >
              Previous versions
            </button>{' '}
            Version history page {versionPage}{' '}
            <button
              disabled={versions.length < 100}
              onClick={() => {
                setVersion('');
                setVersionPage((p) => p + 1);
              }}
            >
              Next versions
            </button>
          </p>
          <ul>
            {versions.map((v) => (
              <li key={v.id}>
                {v.title}: version {v.version_number} ({v.share_status ?? 'PRIVATE'}){' · '}
                {v.review_id ? (
                  <a href={`${root}/projects/${project}/reviews/${v.review_id}`}>
                    Exact-version review: {v.review_status}
                  </a>
                ) : (
                  <span>No review opened for this exact version</span>
                )}
                {client ? (
                  <a
                    href={api + `/projects/${project}/versions/${v.id}/download`}
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        await download(
                          api + `/projects/${project}/versions/${v.id}/download`,
                          headers,
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {' '}
                    Download
                  </a>
                ) : canManage ? (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        v.share_status === 'ACTIVE' &&
                        !window.confirm(
                          'Revoking this share cancels its open review and removes client access to this version. Continue?',
                        )
                      )
                        return;
                      void mutate(
                        `/projects/${project}/versions/${v.id}/share`,
                        { status: v.share_status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' },
                        'PATCH',
                        v.share_revision,
                      );
                    }}
                  >
                    {' '}
                    {v.share_status === 'ACTIVE' ? 'Revoke share' : 'Share version'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {!client && canManage && (!review || current?.status === 'OPEN') && (
            <form onSubmit={open}>
              <h2>
                {review ? 'Explicitly replace this open review' : 'Open exact-version review'}
              </h2>
              <label>
                Target version{' '}
                <select
                  aria-label="Target version"
                  required
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  <option value="">Select shared version</option>
                  {versions
                    .filter((v) => v.share_status === 'ACTIVE')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title} · version {v.version_number}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                Target SHA-256:{' '}
                {versions.find((v) => v.id === version)?.digest ?? 'Select a version'}
              </p>
              <fieldset>
                <legend>Named eligible Approvers</legend>
                {contacts
                  .filter((c) => c.role === 'APPROVER' && c.status === 'ACTIVE')
                  .map((c) => (
                    <label key={c.contact_id}>
                      <input
                        type="checkbox"
                        checked={approvers.split(',').includes(c.contact_id)}
                        onChange={(e) =>
                          setApprovers((a) =>
                            e.target.checked
                              ? [...a.split(',').filter(Boolean), c.contact_id].join(',')
                              : a
                                  .split(',')
                                  .filter((id) => id !== c.contact_id)
                                  .join(','),
                          )
                        }
                      />
                      {c.name ?? 'Client contact'} ({c.contact_id})
                    </label>
                  ))}
              </fieldset>
              <label>
                Review deadline{' '}
                <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <button disabled={busy || !approvers || (!!review && current?.status !== 'OPEN')}>
                {review ? 'Replace active review' : 'Open review'}
              </button>
            </form>
          )}
        </details>
      )}
      {current && (
        <>
          <h2>
            Cycle {current.cycle_number}: {current.status}
          </h2>
          <p>
            Exact review version {current.version?.version_number} · {current.version_id}
          </p>
          <p>
            SHA-256: <code>{current.version?.digest}</code>
          </p>
          {!client && (
            <p>
              Latest prepared version: {current.latest_prepared_version_id}. This review remains
              bound to {current.version_id}.
            </p>
          )}
          {current.decision && typeof current.decision !== 'string' && (
            <p>
              Decision: {current.decision.decision} · {current.decision.reason} ·{' '}
              {current.decision.created_at}
            </p>
          )}
          {current.manager && current.status === 'OPEN' && (
            <button
              disabled={busy}
              onClick={() => void mutate(path + '/cancel', {}, 'POST', current.revision)}
            >
              Cancel review
            </button>
          )}
          <button
            onClick={() =>
              void download(api + path + '/download', headers).catch((e) => setError(e.message))
            }
          >
            Download exact version
          </button>
          <div>
            <label>
              Page{' '}
              <select
                aria-label="Page"
                value={pageNumber}
                onChange={(e) => {
                  setPageNumber(Number(e.target.value));
                  setPin(undefined);
                }}
              >
                {current.previews?.map((p) => (
                  <option key={p.page} value={p.page}>
                    {p.page}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zoom{' '}
              <input
                type="range"
                min="0.25"
                max="3"
                step="0.25"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <button onClick={() => setRotation((r) => (r + 90) % 360)}>Rotate {rotation}°</button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 700, padding: 100, border: '1px solid' }}>
            {image && preview ? (
              <div style={{ position: 'relative', width: frameWidth, height: frameHeight }}>
                <div
                  onClick={place}
                  aria-label="Annotation surface"
                  style={{
                    position: 'absolute',
                    left: (frameWidth - displayWidth) / 2,
                    top: (frameHeight - displayHeight) / 2,
                    width: displayWidth,
                    height: displayHeight,
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: 'center',
                    cursor: current.canFeedback ? 'crosshair' : 'default',
                  }}
                >
                  <img
                    src={image}
                    alt={`Exact review preview page ${pageNumber}`}
                    draggable={false}
                    style={{ width: '100%', height: '100%' }}
                  />
                  {annotationPins.map((f, i) => (
                    <span
                      key={f.id}
                      title={f.body}
                      style={{
                        position: 'absolute',
                        left: f.annotation!.x * 100 + '%',
                        top: f.annotation!.y * 100 + '%',
                        background: 'yellow',
                        color: 'black',
                        transform: 'translate(-50%,-50%)',
                      }}
                    >
                      {i + 1}
                    </span>
                  ))}
                  {pin && (
                    <span
                      style={{
                        position: 'absolute',
                        left: pin.x * 100 + '%',
                        top: pin.y * 100 + '%',
                        background: 'red',
                        color: 'white',
                      }}
                    >
                      +
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p>Preview unavailable. Reload to retry.</p>
            )}
          </div>
          {current.canFeedback && (
            <form onSubmit={sendFeedback}>
              <label>
                Feedback{' '}
                <textarea required value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {!client && (
                <label>
                  Visibility{' '}
                  <select
                    aria-label="Visibility"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                  >
                    <option>CLIENT</option>
                    <option>INTERNAL</option>
                  </select>
                </label>
              )}
              <p>Click the preview to place a pin, or enter normalized coordinates.</p>
              <label>
                X{' '}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={pin?.x ?? ''}
                  onChange={(e) => setPin({ x: Number(e.target.value), y: pin?.y ?? 0.5 })}
                />
              </label>
              <label>
                Y{' '}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={pin?.y ?? ''}
                  onChange={(e) => setPin({ y: Number(e.target.value), x: pin?.x ?? 0.5 })}
                />
              </label>
              <button type="button" onClick={() => setPin(undefined)}>
                Remove pin
              </button>
              <button disabled={busy}>Save feedback</button>
            </form>
          )}
          {current.canDecide && (
            <section>
              <h2>Formal decision</h2>
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I confirm version {current.version?.version_number} and the displayed digest.
              </label>
              <label>
                Reason (required for changes){' '}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {['APPROVED', 'CHANGES_REQUESTED'].map((d) => (
                <button
                  key={d}
                  disabled={!confirm || busy || (d === 'CHANGES_REQUESTED' && !reason.trim())}
                  onClick={() =>
                    void mutate(
                      path + '/decisions',
                      {
                        version_id: current.version!.id,
                        digest: current.version!.digest,
                        decision: d,
                        reason,
                      },
                      'POST',
                      current.revision,
                    )
                  }
                >
                  {d === 'APPROVED' ? 'Approve exact version' : 'Request changes'}
                </button>
              ))}
            </section>
          )}
          <h2>Feedback history</h2>
          <p>
            <button disabled={feedbackPage === 1} onClick={() => setFeedbackPage((p) => p - 1)}>
              Previous feedback
            </button>{' '}
            Feedback page {feedbackPage}{' '}
            <button disabled={feedback.length < 100} onClick={() => setFeedbackPage((p) => p + 1)}>
              Next feedback
            </button>
          </p>
          {!feedback.length && <p>No visible feedback.</p>}
          {feedback.map((f) => (
            <article key={f.id} id={'feedback-' + f.id}>
              <p>
                {f.body} · {f.visibility} · {f.resolution} · {f.created_at} · {f.actor_id}
              </p>
              {f.annotation && (
                <p>
                  {f.annotation.type} {f.annotation.x.toFixed(3)}, {f.annotation.y.toFixed(3)}{' '}
                  {'page' in f.annotation && `page ${f.annotation.page}`}
                </p>
              )}
              {f.replies.map((r) => (
                <p key={r.id}>
                  {r.body} · {r.actor_id} · {r.created_at}
                </p>
              ))}
              {current.canFeedback && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const b = String(new FormData(form).get('reply'));
                    void mutate(path + `/feedback/${f.id}/replies`, { body: b }).then((ok) => {
                      if (ok) form.reset();
                    });
                  }}
                >
                  <label>
                    Reply <input required name="reply" />
                  </label>
                  <button disabled={busy}>Post reply</button>
                </form>
              )}
              {current.canResolve && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(path + `/feedback/${f.id}/resolution`, {
                      state: f.resolution === 'RESOLVED' ? 'REOPENED' : 'RESOLVED',
                      note: '',
                    })
                  }
                >
                  {f.resolution === 'RESOLVED' ? 'Reopen feedback' : 'Resolve feedback'}
                </button>
              )}
              {current.manager &&
                (f.task_id ? (
                  <p>
                    <a href={`/w/${orgId}/projects/${project}/tasks/${f.task_id}`}>
                      Internal source task
                    </a>
                  </p>
                ) : (
                  <details>
                    <summary>Create internal task</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate(path + `/feedback/${f.id}/task`, {
                          title: taskTitle,
                          description: f.body,
                          milestone_id: milestone || null,
                          assignee_id: assignee || null,
                          priority,
                          status: 'TODO',
                          due_at: null,
                          position: 0,
                        });
                      }}
                    >
                      <label>
                        Task title{' '}
                        <input
                          required
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                        />
                      </label>
                      <label>
                        Priority{' '}
                        <select
                          aria-label="Priority"
                          value={priority}
                          onChange={(e) => setPriority(e.target.value)}
                        >
                          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Milestone{' '}
                        <select
                          aria-label="Milestone"
                          value={milestone}
                          onChange={(e) => setMilestone(e.target.value)}
                        >
                          <option value="">None</option>
                          {milestones.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Assignee{' '}
                        <select
                          aria-label="Assignee"
                          value={assignee}
                          onChange={(e) => setAssignee(e.target.value)}
                        >
                          <option value="">Unassigned</option>
                          {candidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name ?? c.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy}>Convert feedback to task</button>
                    </form>
                  </details>
                ))}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
async function download(path: string, headers: Record<string, string>) {
  const r = await fetch(path, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error('Download unavailable or access revoked');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'review-source';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PortalBranding({ orgId, principal }: { orgId: string; principal: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let blobUrl = '';
    const headers = { 'X-Organization-Principal': principal };
    void apiRequest<{ asset_id: string | null }>(
      `/api/v1/organizations/${orgId}/logo`,
      'GET',
      undefined,
      headers,
    )
      .then(async (r) => {
        if (!r.asset_id) return;
        const response = await fetch(`/api/v1/organizations/${orgId}/logo/content`, {
          headers,
          cache: 'no-store',
        });
        if (!response.ok) return;
        blobUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(blobUrl);
        else URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [orgId, principal]);
  return url ? (
    <img src={url} alt="Organization logo" style={{ maxWidth: 96, maxHeight: 96 }} />
  ) : null;
}
