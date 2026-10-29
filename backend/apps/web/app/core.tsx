'use client';
import { WorkspaceNavigation, ProjectNavigation } from './navigation';
import { useViewQuery } from './view-state';
import { NotificationBadge } from './notifications';
import { useEffect, useId, useState, type FormEvent } from 'react';
import FilesWorkspace from './files';
import { ClientUpdatePublisher } from './expansion';
import {
  apiRequest,
  type CoreRecord,
  type CorePage,
  type PrincipalDto,
  type WorkSummary,
} from '@devworkspace/contracts';
type Choice = {
  id: string;
  name?: string;
  title?: string;
  role?: string;
  membership_id?: string;
  client_id?: string;
};
type Field = { key: string; label: string; type?: string; options?: string[]; nullable?: boolean };
const statuses = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'];
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const fields: Record<string, Field[]> = {
  clients: [
    { key: 'name', label: 'Client name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Client status', options: ['ACTIVE', 'ARCHIVED'] },
  ],
  contacts: [
    { key: 'name', label: 'Contact name' },
    { key: 'email', label: 'Contact email', type: 'email' },
    { key: 'status', label: 'Contact status', options: ['ACTIVE', 'INACTIVE'] },
  ],
  projects: [
    { key: 'client_id', label: 'Client', type: 'choice' },
    { key: 'name', label: 'Project name' },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'status',
      label: 'Project status',
      options: ['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'],
    },
    { key: 'due_at', label: 'Deadline (your local time)', type: 'datetime-local', nullable: true },
    { key: 'portal_enabled', label: 'Enable client portal', type: 'checkbox' },
  ],
  milestones: [
    { key: 'title', label: 'Milestone title' },
    {
      key: 'due_at',
      label: 'Milestone deadline (your local time)',
      type: 'datetime-local',
      nullable: true,
    },
    { key: 'position', label: 'Order', type: 'number' },
    { key: 'status', label: 'Milestone status', options: ['OPEN', 'COMPLETED'] },
  ],
  tasks: [
    { key: 'title', label: 'Task title' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'milestone_id', label: 'Milestone', type: 'choice', nullable: true },
    { key: 'assignee_id', label: 'Assignee (project participant)', type: 'choice', nullable: true },
    { key: 'priority', label: 'Priority', options: priorities },
    { key: 'status', label: 'Task status', options: statuses },
    {
      key: 'due_at',
      label: 'Task deadline (your local time)',
      type: 'datetime-local',
      nullable: true,
    },
    { key: 'position', label: 'Order', type: 'number' },
  ],
  members: [
    { key: 'membership_id', label: 'Organization member', type: 'choice' },
    { key: 'role', label: 'Project role', options: ['MANAGER', 'CONTRIBUTOR', 'VIEWER'] },
    { key: 'status', label: 'Participation status', options: ['ACTIVE', 'INACTIVE'] },
  ],
  grants: [
    { key: 'contact_id', label: 'Client contact', type: 'choice' },
    { key: 'role', label: 'Client role', options: ['VIEWER', 'REVIEWER', 'APPROVER'] },
    { key: 'status', label: 'Grant status', options: ['ACTIVE', 'REVOKED'] },
  ],
  checklist: [
    { key: 'label', label: 'Checklist label' },
    { key: 'position', label: 'Order', type: 'number' },
    { key: 'completed', label: 'Completed', type: 'checkbox' },
  ],
};
const read = (row: CoreRecord | undefined, key: string) => row?.[key as keyof CoreRecord];
function dateInput(value: unknown) {
  if (!value) return '';
  const d = new Date(String(value));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function RecordForm({
  resource,
  row,
  choices,
  save,
  disabled = false,
}: {
  resource: string;
  row?: CoreRecord | undefined;
  choices: Record<string, Choice[]>;
  save: (body: Record<string, unknown>) => Promise<void>;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const f of fields[resource] ?? []) {
      const value = String(data.get(f.key) ?? '');
      body[f.key] =
        f.type === 'checkbox'
          ? data.has(f.key)
          : f.type === 'number'
            ? Number(value)
            : f.type === 'datetime-local'
              ? value
                ? new Date(value).toISOString()
                : null
              : f.nullable && !value
                ? null
                : value;
    }
    if (
      resource === 'projects' &&
      row &&
      ((body.status === 'ARCHIVED' && row.status !== 'ARCHIVED') ||
        (body.portal_enabled === false && row.portal_enabled === true)) &&
      !window.confirm(
        'This will cancel all open reviews in this project. Existing decisions remain in history. Continue?',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await save(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy || disabled} aria-describedby={error ? errorId : undefined}>
        <legend>
          {row ? 'Edit' : 'Create'} {resource}
        </legend>
        {fields[resource]?.map((f) => (
          <label key={f.key}>
            {f.label}
            {resource === 'projects' && row && f.key === 'client_id' ? (
              <select aria-label={f.label} name={f.key} defaultValue={row.client_id}>
                <option value={row.client_id}>
                  {choices.client_id?.find((c) => c.id === row.client_id)?.name ??
                    'Current project client (fixed)'}
                </option>
              </select>
            ) : f.options ? (
              <select
                aria-label={f.label}
                name={f.key}
                defaultValue={String(read(row, f.key) ?? f.options[0])}
              >
                {f.options.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            ) : f.type === 'choice' ? (
              <select
                aria-label={f.label}
                name={f.key}
                defaultValue={String(read(row, f.key) ?? '')}
                required={!f.nullable}
              >
                <option value="">{f.nullable ? 'None' : 'Choose'}</option>
                {choices[f.key]?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.title ?? c.role ?? c.id} {c.membership_id ?? ''}
                  </option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                aria-label={f.label}
                name={f.key}
                defaultValue={String(read(row, f.key) ?? '')}
                maxLength={10000}
              />
            ) : f.type === 'checkbox' ? (
              <input name={f.key} type="checkbox" defaultChecked={Boolean(read(row, f.key))} />
            ) : (
              <input
                name={f.key}
                type={f.type ?? 'text'}
                defaultValue={
                  f.type === 'datetime-local'
                    ? dateInput(read(row, f.key))
                    : String(read(row, f.key) ?? (f.type === 'number' ? 0 : ''))
                }
                required={!f.nullable}
                min={f.type === 'number' ? 0 : undefined}
                maxLength={f.key === 'description' ? 10000 : 500}
              />
            )}
          </label>
        ))}
        <button>Save {resource}</button>
      </fieldset>
      {error && (
        <p id={errorId} role="alert">
          {error} Your input is retained. Reload to fetch the current revision.
        </p>
      )}
    </form>
  );
}
async function allRecords<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page++) {
    const data = await apiRequest<{ items: T[]; total?: number }>(
      url + (url.includes('?') ? '&' : '?') + 'limit=100&page=' + page,
      'GET',
      undefined,
      headers,
    );
    result.push(...data.items);
    if (data.items.length < 100 || (data.total !== undefined && result.length >= data.total))
      return result;
  }
}
export default function CoreWorkspace({ orgId, segments }: { orgId: string; segments: string[] }) {
  const [principal, setPrincipal] = useState<PrincipalDto>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setPrincipal(undefined);
    setError('');
    setBusy(true);
    void (async () => {
      try {
        let ps = await apiRequest<{ items: PrincipalDto[]; nextCursor: string | null }>(
          '/api/v1/me/principals',
        );
        let p = ps.items.find((x) => x.organizationId === orgId);
        while (!p && ps.nextCursor) {
          ps = await apiRequest('/api/v1/me/principals?cursor=' + ps.nextCursor);
          p = ps.items.find((x) => x.organizationId === orgId);
        }
        if (!p)
          throw new Error(
            'Organization access unavailable. Sign in with an active internal identity.',
          );
        if (alive) setPrincipal(p);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId, tick]);
  if (busy)
    return (
      <section>
        <p role="status">Loading workspace…</p>
      </section>
    );
  return (
    <section>
      {principal && <WorkspaceNavigation orgId={orgId} role={principal.role} />}
      {principal && (
        <NotificationBadge
          key={principal.id}
          orgId={orgId}
          principalId={principal.id}
          projectId={segments[0] === 'projects' ? segments[1] : undefined}
        />
      )}
      {error && (
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
      )}
      <button onClick={() => setTick(tick + 1)}>Reload access</button>
      {principal &&
      segments[0] === 'projects' &&
      segments[1] &&
      (segments[2] === 'files' || segments[2] === 'deliverables') ? (
        <FilesWorkspace
          orgId={orgId}
          projectId={segments[1]}
          principal={principal}
          kind={segments[2]}
        />
      ) : (
        principal && (
          <DomainView
            key={segments.join('/') + tick}
            orgId={orgId}
            segments={segments}
            principal={principal}
          />
        )
      )}
    </section>
  );
}
function DomainView({
  orgId,
  segments,
  principal,
}: {
  orgId: string;
  segments: string[];
  principal: PrincipalDto;
}) {
  const api = '/api/v1/organizations/' + orgId;
  const root = '/w/' + orgId;
  const headers = { 'X-Organization-Principal': principal.id };
  const get = <T,>(path: string) => apiRequest<T>(api + path, 'GET', undefined, headers);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [records, setRecords] = useState<CorePage>({ items: [], total: 0, page: 1, limit: 25 });
  const [record, setRecord] = useState<CoreRecord & { summary?: WorkSummary }>();
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const [manager, setManager] = useState(principal.role !== 'MEMBER');
  const [canWork, setCanWork] = useState(principal.role !== 'MEMBER');
  const [canPost, setCanPost] = useState(principal.role !== 'MEMBER');
  const [projectWritable, setProjectWritable] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useViewQuery();
  const filters = new URLSearchParams(query);
  const [editing, setEditing] = useState<CoreRecord>();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const projectId = segments[0] === 'projects' ? segments[1] : undefined;
  const clientId = segments[0] === 'clients' ? segments[1] : undefined;
  const taskId = segments[2] === 'tasks' ? segments[3] : undefined;
  const overview = Boolean(projectId && segments.length === 2);
  const taskDetail = Boolean(taskId);
  const clientDetail = Boolean(clientId);
  const resource = overview
    ? 'projects'
    : taskDetail
      ? 'tasks'
      : clientDetail
        ? 'clients'
        : segments[2] === 'access'
          ? 'members'
          : (segments[2] ?? segments[0] ?? 'dashboard');
  const path = overview
    ? '/projects/' + projectId
    : taskDetail
      ? `/projects/${projectId}/tasks/${taskId}`
      : clientDetail
        ? '/clients/' + clientId
        : resource === 'dashboard'
          ? '/dashboard'
          : resource === 'my-tasks'
            ? '/my-tasks'
            : projectId
              ? `/projects/${projectId}/${resource}`
              : '/' + resource;
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setFailed(false);
    setError('');
    void (async () => {
      try {
        const data = await get<CorePage & CoreRecord>(path + (query ? '?' + query : ''));
        if (!alive) return;
        if (overview || taskDetail || clientDetail) setRecord(data);
        else setRecords(data);
        const all = async (path: string) => {
          let page = 1;
          let items: Choice[] = [];
          for (;;) {
            const d = await get<CorePage>(
              path + (path.includes('?') ? '&' : '?') + 'limit=100&page=' + page,
            );
            items = items.concat(d.items);
            if (items.length >= d.total) break;
            page++;
          }
          return items;
        };
        const options: Record<string, Choice[]> = {};
        const jobs: Array<Promise<void>> = [];
        if (resource === 'projects' && principal.role !== 'MEMBER')
          jobs.push(
            all('/clients?status=ACTIVE').then((x) => {
              options.client_id = x;
            }),
          );
        if (resource === 'my-tasks')
          jobs.push(
            all('/projects').then((x) => {
              options.project_id = x;
            }),
          );
        if (projectId) {
          jobs.push(
            get<CoreRecord>(`/projects/${projectId}`).then((p) => {
              if (alive) setProjectWritable(['PLANNED', 'ACTIVE'].includes(p.status ?? ''));
            }),
          );
          jobs.push(
            allRecords<CoreRecord>(api + `/projects/${projectId}/members`, headers).then(
              async (items) => {
                const self = items.find(
                  (x) => x.membership_id === principal.id && x.status === 'ACTIVE',
                );
                const can = principal.role !== 'MEMBER' || self?.role === 'MANAGER';
                if (alive) {
                  setManager(can);
                  setCanWork(can || (self?.role === 'CONTRIBUTOR' && self.id === data.assignee_id));
                  setCanPost(can || self?.role === 'CONTRIBUTOR');
                }
                if (can && resource === 'members') {
                  options.membership_id = await all(`/projects/${projectId}/candidates`);
                  const p = await get<CoreRecord>(`/projects/${projectId}`);
                  if (p.client_id)
                    options.contact_id = await all(`/clients/${p.client_id}/contacts`);
                }
                options.assignee_id = items.filter(
                  (x) => x.status === 'ACTIVE' && x.role !== 'VIEWER',
                );
              },
            ),
          );
          jobs.push(
            all(`/projects/${projectId}/milestones`).then((x) => {
              options.milestone_id = x;
            }),
          );
        }
        const results = await Promise.allSettled(jobs);
        if (alive) {
          setChoices(options);
          setLoaded(true);
          for (const r of results)
            if (r.status === 'rejected')
              setError(
                r.reason instanceof Error ? r.reason.message : 'Some choices are unavailable',
              );
        }
      } catch (e) {
        if (alive) {
          setFailed(true);
          setError(e instanceof Error ? e.message : 'Load failed');
        }
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId, path, query, revision]);
  const refresh = () => {
    setEditing(undefined);
    setRevision((x) => x + 1);
  };
  async function save(body: Record<string, unknown>, row?: CoreRecord) {
    setMessage('');
    await apiRequest(
      api + path + (row && !record ? '/' + row.id : ''),
      row ? 'PATCH' : 'POST',
      body,
      { ...headers, ...(row ? { 'If-Match': `"${row.revision}"` } : {}) },
    );
    setMessage('Saved to the database.');
    refresh();
  }
  const link = (r: CoreRecord) =>
    resource === 'clients'
      ? root + '/clients/' + r.id
      : resource === 'projects' || resource === 'dashboard'
        ? root + '/projects/' + r.id
        : resource === 'tasks' || resource === 'my-tasks'
          ? root + '/projects/' + (r.project_id ?? projectId) + '/tasks/' + r.id
          : undefined;
  const canCreate =
    resource === 'clients' || resource === 'projects'
      ? principal.role !== 'MEMBER'
      : manager && (projectWritable || resource === 'members');
  if (busy && !loaded)
    return (
      <section>
        <p role="status">Loading {resource}...</p>
      </section>
    );
  if (failed)
    return (
      <section>
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
        <button onClick={refresh}>Reload current data</button>
      </section>
    );
  return (
    <section>
      <h1>
        {taskDetail
          ? 'Task details'
          : clientDetail
            ? 'Client details'
            : overview
              ? 'Project overview'
              : resource === 'my-tasks'
                ? 'My Tasks'
                : resource === 'dashboard'
                  ? 'Dashboard'
                  : resource === 'members'
                    ? 'Project team and access'
                    : resource}
      </h1>
      {projectId && <ProjectNavigation orgId={orgId} projectId={projectId} />}
      {projectId && !projectWritable && (
        <p>
          Project work is read only in its current lifecycle state. Managers can inspect lifecycle
          options on Overview.
        </p>
      )}
      {(busy || message) && <p role="status">{busy ? 'Loading…' : message}</p>}
      {error && (
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
      )}
      <button onClick={refresh}>Reload current data</button>
      {!record && !overview && !taskDetail && !clientDetail && (
        <>
          <form
            key={query}
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              setQuery(
                new URLSearchParams(
                  [...d.entries()].filter(([, v]) => Boolean(v)) as [string, string][],
                ).toString(),
              );
            }}
          >
            <fieldset disabled={busy}>
              <legend>Filters</legend>
              <label>
                Search
                <input name="q" defaultValue={filters.get('q') ?? ''} />
              </label>
              <label>
                Status
                <select
                  aria-label="Status filter"
                  name="status"
                  defaultValue={filters.get('status') ?? ''}
                >
                  <option value="">All</option>
                  {(resource === 'tasks' || resource === 'my-tasks'
                    ? statuses
                    : resource === 'clients'
                      ? ['ACTIVE', 'ARCHIVED']
                      : resource === 'members'
                        ? ['ACTIVE', 'INACTIVE']
                        : resource === 'milestones'
                          ? ['OPEN', 'COMPLETED']
                          : ['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']
                  ).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {['tasks', 'my-tasks'].includes(resource) && (
                <>
                  {resource === 'my-tasks' && (
                    <label>
                      Project identifier
                      <select name="project_id" defaultValue={filters.get('project_id') ?? ''}>
                        <option value="">All accessible projects</option>
                        {choices.project_id?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Priority
                    <select
                      aria-label="Priority"
                      name="priority"
                      defaultValue={filters.get('priority') ?? ''}
                    >
                      <option value="">All</option>
                      {priorities.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  {resource === 'tasks' && (
                    <>
                      <label>
                        Assignee
                        <select
                          aria-label="Assignee filter"
                          name="assignee_id"
                          defaultValue={filters.get('assignee_id') ?? ''}
                        >
                          <option value="">All</option>
                          {choices.assignee_id?.map((x) => (
                            <option value={x.id} key={x.id}>
                              {x.name ?? x.role} {x.membership_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Milestone
                        <select
                          aria-label="Milestone"
                          name="milestone_id"
                          defaultValue={filters.get('milestone_id') ?? ''}
                        >
                          <option value="">All</option>
                          {choices.milestone_id?.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label>
                    Due from (UTC)
                    <input
                      name="due_from"
                      defaultValue={filters.get('due_from') ?? ''}
                      placeholder="2026-10-16T00:00:00Z"
                    />
                  </label>
                  <label>
                    Due to (UTC)
                    <input
                      name="due_to"
                      defaultValue={filters.get('due_to') ?? ''}
                      placeholder="2026-10-20T00:00:00Z"
                    />
                  </label>
                </>
              )}
              <label>
                Sort
                <select
                  aria-label="Sort"
                  name="sort"
                  defaultValue={filters.get('sort') ?? 'created_at'}
                >
                  <option value="created_at">Created</option>
                  {['projects', 'dashboard', 'tasks', 'my-tasks', 'milestones'].includes(
                    resource,
                  ) && <option value="due_at">Deadline</option>}
                  {['tasks', 'my-tasks', 'milestones'].includes(resource) && (
                    <option value="position">Order</option>
                  )}
                  {['clients', 'projects', 'dashboard'].includes(resource) && (
                    <option value="name">Name</option>
                  )}
                </select>
              </label>
              <label>
                Direction
                <select
                  aria-label="Direction"
                  name="direction"
                  defaultValue={filters.get('direction') ?? 'asc'}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
              <button>Apply filters</button>
            </fieldset>
          </form>
          <p>{records.total} matching records</p>
          {!busy && !records.items.length && <p>No records for this view.</p>}
          <ul>
            {records.items.map((r) => (
              <li key={r.id}>
                {link(r) ? (
                  <a href={link(r)}>{r.name ?? r.title}</a>
                ) : (
                  <span>
                    {r.title ?? r.name ?? r.role} {r.membership_id}
                  </span>
                )}{' '}
                — {r.role} {r.status} {r.priority}{' '}
                {r.summary && (
                  <span>
                    {' '}
                    {r.summary.progress === null
                      ? 'No tasks'
                      : `${r.summary.done}/${r.summary.total} done`}
                  </span>
                )}{' '}
                {r.due_at && new Date(r.due_at).toLocaleString()}
                {r.due_at &&
                  new Date(r.due_at) < new Date() &&
                  !['DONE', 'CANCELLED', 'COMPLETED', 'ARCHIVED'].includes(r.status ?? '') && (
                    <strong> Overdue</strong>
                  )}
                {canCreate && fields[resource] && (
                  <button onClick={() => setEditing(r)}>Edit {r.title ?? r.name ?? r.role}</button>
                )}
              </li>
            ))}
          </ul>
          {records.page > 1 && (
            <button
              disabled={busy}
              onClick={() =>
                setQuery((x) => {
                  const p = new URLSearchParams(x);
                  p.set('page', String(records.page - 1));
                  return p.toString();
                })
              }
            >
              Previous page
            </button>
          )}
          {records.page * records.limit < records.total && (
            <button
              disabled={busy}
              onClick={() =>
                setQuery((x) => {
                  const p = new URLSearchParams(x);
                  p.set('page', String(records.page + 1));
                  return p.toString();
                })
              }
            >
              Next page
            </button>
          )}
          {canCreate && fields[resource] && (
            <RecordForm
              key={editing?.id ?? 'new:' + revision}
              resource={resource}
              disabled={busy}
              row={editing}
              choices={choices}
              save={(b) => save(b, editing)}
            />
          )}
        </>
      )}
      {record && (
        <>
          <h2>{record.name ?? record.title}</h2>
          <p>{record.description}</p>
          <p>
            Status: {record.status}. Revision: {record.revision}
          </p>
          {taskDetail && (
            <dl>
              <dt>Priority</dt>
              <dd>{record.priority}</dd>
              <dt>Deadline</dt>
              <dd>{record.due_at ? new Date(record.due_at).toLocaleString() : 'No deadline'}</dd>
              <dt>Assignee</dt>
              <dd>
                {record.assignee_id
                  ? (choices.assignee_id?.find((x) => x.id === record.assignee_id)?.name ??
                    record.assignee_id)
                  : 'Unassigned'}
              </dd>
              <dt>Milestone</dt>
              <dd>
                {record.milestone_id
                  ? (choices.milestone_id?.find((x) => x.id === record.milestone_id)?.title ??
                    record.milestone_id)
                  : 'None'}
              </dd>
            </dl>
          )}
          {record.summary && (
            <p>
              Progress:{' '}
              {record.summary.progress === null
                ? 'No tasks'
                : `${record.summary.done}/${record.summary.total} done`}
              ; {record.summary.overdue} overdue
            </p>
          )}
          {manager && (overview || clientDetail || projectWritable) && (
            <RecordForm
              key={record.revision}
              resource={resource}
              disabled={busy}
              row={record}
              choices={choices}
              save={(b) => save(b, record)}
            />
          )}
        </>
      )}
      {resource === 'dashboard' && <UpcomingWork api={api} root={root} headers={headers} />}
      {(resource === 'dashboard' || overview) && (
        <ReviewSummary api={api} root={root} headers={headers} projectId={projectId} />
      )}
      {taskDetail && (
        <p>
          {record?.source_feedback_thread_id && record.source_review_id && (
            <>
              <a
                href={
                  root +
                  `/projects/${projectId}/reviews/${record.source_review_id}?feedback_id=${record.source_feedback_thread_id}`
                }
              >
                Original review feedback
              </a>
              {' · '}
            </>
          )}
          <a href={root + `/projects/${projectId}/deliverables?task_id=${taskId}`}>
            Project deliverables and optional task link
          </a>
        </p>
      )}
      {overview && record && <OverviewMilestones api={api} project={record} headers={headers} />}
      {overview && record && principal && (
        <ClientUpdatePublisher
          key={principal.id + record.id}
          orgId={orgId}
          principalId={principal.id}
          projectId={record.id}
        />
      )}
      {clientDetail && record && (
        <ClientDetails
          orgId={orgId}
          client={record}
          headers={headers}
          admin={principal.role !== 'MEMBER'}
        />
      )}
      {taskDetail && record && (
        <TaskDetails
          path={api + path}
          headers={headers}
          record={record}
          manager={manager && projectWritable}
          canWork={canWork && projectWritable}
          canPost={canPost && projectWritable}
          key={revision}
          refresh={refresh}
        />
      )}
      {resource === 'members' && projectId && manager && (
        <GrantPanel
          path={api + `/projects/${projectId}/grants`}
          headers={headers}
          choices={choices}
        />
      )}
    </section>
  );
}

function ReviewSummary({
  api,
  root,
  headers,
  projectId,
}: {
  api: string;
  root: string;
  headers: Record<string, string>;
  projectId?: string | undefined;
}) {
  const [items, setItems] = useState<
      Array<{ id: string; project_id: string; version_id: string; status: string }>
    >([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void apiRequest<{ items: typeof items }>(
      api + '/reviews?limit=10' + (projectId ? '&project_id=' + projectId : ''),
      'GET',
      undefined,
      headers,
    )
      .then((r) => {
        if (active) setItems(r.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, projectId, headers['X-Organization-Principal']]);
  return (
    <section>
      <h2>Exact-version reviews</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : !items.length ? (
        <p>No accessible reviews.</p>
      ) : (
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              <a href={`${root}/projects/${c.project_id}/reviews/${c.id}`}>
                {c.status} · version {c.version_id}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function GrantPanel({
  path,
  headers,
  choices,
}: {
  path: string;
  headers: Record<string, string>;
  choices: Record<string, Choice[]>;
}) {
  const [rows, setRows] = useState<CoreRecord[]>([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<CoreRecord>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void allRecords<CoreRecord>(path, headers)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [path, tick]);
  return (
    <section>
      <h2>Explicit client grants</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            {choices.contact_id?.find((x) => x.id === r.contact_id)?.name} {r.role} {r.status}
            <button onClick={() => setEdit(r)}>Edit grant</button>
          </li>
        ))}
      </ul>
      <RecordForm
        key={edit?.id ?? tick}
        resource="grants"
        row={edit}
        choices={choices}
        save={async (b) => {
          await apiRequest(path + (edit ? '/' + edit.id : ''), edit ? 'PATCH' : 'POST', b, {
            ...headers,
            ...(edit ? { 'If-Match': `"${edit.revision}"` } : {}),
          });
          setEdit(undefined);
          setTick((x) => x + 1);
        }}
      />
    </section>
  );
}
function ClientDetails({
  orgId,
  client,
  headers,
  admin,
}: {
  orgId: string;
  client: CoreRecord;
  headers: Record<string, string>;
  admin: boolean;
}) {
  const path = `/api/v1/organizations/${orgId}/clients/${client.id}/contacts`;
  const [rows, setRows] = useState<CoreRecord[]>([]);
  const [projects, setProjects] = useState<CoreRecord[]>([]);
  const [edit, setEdit] = useState<CoreRecord>();
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled([
        allRecords<CoreRecord>(path, headers).then(setRows),
        allRecords<CoreRecord>(
          `/api/v1/organizations/${orgId}/projects?client_id=${client.id}`,
          headers,
        ).then(setProjects),
      ]);
      for (const r of results) if (r.status === 'rejected') setError(r.reason.message);
    })();
  }, [path, tick]);
  return (
    <section>
      <h2>Client projects</h2>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <a href={`/w/${orgId}/projects/${p.id}`}>{p.name}</a>
          </li>
        ))}
      </ul>
      {admin && (
        <ClientInvitationList
          key={tick}
          path={`/api/v1/organizations/${orgId}/clients/${client.id}/invitations`}
          organizationPath={`/api/v1/organizations/${orgId}`}
          headers={headers}
        />
      )}
      <h2>Client contacts</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <ul>
        {rows.map((c) => (
          <li key={c.id}>
            {c.name} {c.email} {c.status}
            {admin && (
              <>
                <button onClick={() => setEdit(c)}>Edit contact</button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (inviting) return;
                    setInviting(true);
                    setError('');
                    setNotice('');
                    const d = new FormData(e.currentTarget);
                    void apiRequest(
                      path + '/' + c.id + '/invitations',
                      'POST',
                      { project_id: String(d.get('project')), role: String(d.get('role')) },
                      headers,
                    )
                      .then(() => {
                        setNotice('Invitation queued for local email delivery.');
                        setTick((x) => x + 1);
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setInviting(false));
                  }}
                >
                  <label>
                    Project
                    <select aria-label="Invitation project" name="project">
                      {projects.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Client capacity
                    <select aria-label="Client capacity" name="role">
                      {['VIEWER', 'REVIEWER', 'APPROVER'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <button disabled={inviting || !projects.length}>Invite contact</button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
      {admin && (
        <RecordForm
          key={edit?.id ?? tick}
          resource="contacts"
          row={edit}
          choices={{}}
          save={async (b) => {
            await apiRequest(path + (edit ? '/' + edit.id : ''), edit ? 'PATCH' : 'POST', b, {
              ...headers,
              ...(edit ? { 'If-Match': `"${edit.revision}"` } : {}),
            });
            setEdit(undefined);
            setTick((x) => x + 1);
          }}
        />
      )}
    </section>
  );
}
function TaskDetails({
  path,
  headers,
  record,
  manager,
  canWork,
  canPost,
  refresh,
}: {
  path: string;
  headers: Record<string, string>;
  record: CoreRecord;
  manager: boolean;
  canWork: boolean;
  canPost: boolean;
  refresh: () => void;
}) {
  const [items, setItems] = useState<CoreRecord[]>([]);
  const [comments, setComments] = useState<
    Array<{ id: string; thread_id: string | null; author_id: string; body: string }>
  >([]);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      kind: string;
      actor_id: string;
      created_at: string;
      fields: Record<string, unknown>;
    }>
  >([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<CoreRecord>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled([
        allRecords<CoreRecord>(path + '/checklist', headers).then(setItems),
        allRecords<(typeof comments)[number]>(path + '/comments', headers).then(setComments),
        allRecords<(typeof history)[number]>(path + '/history', headers).then(setHistory),
      ]);
      for (const r of results) if (r.status === 'rejected') setError(r.reason.message);
    })();
  }, [path]);
  async function act(url: string, method: string, b: unknown, revision?: number) {
    setPending(true);
    try {
      await apiRequest(url, method, b, {
        ...headers,
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      });
      refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <fieldset disabled={pending}>
        <legend>Task collaboration</legend>
        <h2>Work state</h2>
        {error && <p role="alert">{error}</p>}
        {!manager && canWork && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                path,
                'PATCH',
                { status: String(new FormData(e.currentTarget).get('status')) },
                record.revision,
              );
            }}
          >
            <label>
              Work status
              <select aria-label="Work status" name="status" defaultValue={record.status}>
                {statuses
                  .filter((x) => x !== 'CANCELLED')
                  .map((x) => (
                    <option key={x}>{x}</option>
                  ))}
              </select>
            </label>
            <button>Update work status</button>
          </form>
        )}
        <h2>Checklist</h2>
        <p>
          {items.filter((x) => x.completed).length}/{items.length} checked; task status changes
          separately.
        </p>
        <ul>
          {items.map((x) => (
            <li key={x.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={!canWork || pending}
                  checked={x.completed}
                  onChange={(e) => {
                    const completed = e.target.checked;
                    setItems((rows) =>
                      rows.map((row) => (row.id === x.id ? { ...row, completed } : row)),
                    );
                    void act(
                      path + '/checklist/' + x.id,
                      'PATCH',
                      manager ? { label: x.label, position: x.position, completed } : { completed },
                      x.revision,
                    ).then((ok) => {
                      if (!ok) setItems((rows) => rows.map((row) => (row.id === x.id ? x : row)));
                    });
                  }}
                />
                {x.label}
              </label>
              {x.completed_at && <span>Completed {new Date(x.completed_at).toLocaleString()}</span>}
              {manager && (
                <>
                  <button onClick={() => setEdit(x)}>Edit checklist item</button>
                  <button
                    onClick={() => {
                      if (window.confirm('Remove this checklist item? Task history is retained.'))
                        void act(path + '/checklist/' + x.id, 'DELETE', {}, x.revision);
                    }}
                  >
                    Remove item
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {manager && (
          <RecordForm
            key={edit?.id ?? 'new'}
            resource="checklist"
            row={edit}
            choices={{}}
            save={async (b) => {
              await apiRequest(
                path + '/checklist' + (edit ? '/' + edit.id : ''),
                edit ? 'PATCH' : 'POST',
                b,
                { ...headers, ...(edit ? { 'If-Match': `"${edit.revision}"` } : {}) },
              );
              refresh();
            }}
          />
        )}
        <h2>Internal comments</h2>
        <ul>
          {comments.map((c) => (
            <li key={c.id}>
              {c.thread_id ? 'Reply: ' : ''}
              {c.body} — {c.author_id}
            </li>
          ))}
        </ul>
        {canPost && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void act(path + '/comments', 'POST', {
                body: String(d.get('body')),
                thread_id: d.get('thread_id') || null,
              });
            }}
          >
            <label>
              Comment
              <textarea name="body" required maxLength={10000} />
            </label>
            <label>
              Reply to
              <select aria-label="Reply to" name="thread_id">
                <option value="">New thread</option>
                {comments
                  .filter((x) => !x.thread_id)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.body.slice(0, 60)}
                    </option>
                  ))}
              </select>
            </label>
            <button>Post internal comment</button>
          </form>
        )}
        <h2>Task history</h2>
        <ol>
          {history.map((h) => (
            <li key={h.id}>
              {h.kind} — {h.actor_id} — {new Date(h.created_at).toLocaleString()}
              {Object.keys(h.fields ?? {}).length > 0 && (
                <details>
                  <summary>Changed fields</summary>
                  <dl>
                    {Object.entries(h.fields).map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          {fields.tasks?.find((f) => f.key === key)?.label ??
                            fields.checklist?.find((f) => f.key === key)?.label ??
                            'Reference'}
                        </dt>
                        <dd>
                          {value === null
                            ? 'None'
                            : typeof value === 'boolean'
                              ? value
                                ? 'Yes'
                                : 'No'
                              : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          ))}
        </ol>
      </fieldset>
    </section>
  );
}

function UpcomingWork({
  api,
  root,
  headers,
}: {
  api: string;
  root: string;
  headers: Record<string, string>;
}) {
  const [tasks, setTasks] = useState<CoreRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void allRecords<CoreRecord>(
      api +
        '/my-tasks?due_to=' +
        encodeURIComponent(new Date(Date.now() + 7 * 86400000).toISOString()) +
        '&sort=due_at',
      headers,
    )
      .then((x) => setTasks(x.filter((t) => !['DONE', 'CANCELLED'].includes(t.status ?? ''))))
      .catch((e) => setError(e.message));
  }, [api]);
  return (
    <section>
      <h2>Assigned work due in the next seven days or overdue</h2>
      {error && <p role="alert">{error}</p>}
      {!tasks.length && <p>No upcoming assigned deadlines.</p>}
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <a href={root + '/projects/' + t.project_id + '/tasks/' + t.id}>{t.title}</a> -{' '}
            {t.due_at && new Date(t.due_at).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
function OverviewMilestones({
  api,
  project,
  headers,
}: {
  api: string;
  project: CoreRecord;
  headers: Record<string, string>;
}) {
  const [milestones, setMilestones] = useState<CoreRecord[]>([]);
  const [client, setClient] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled([
        allRecords<CoreRecord>(
          api + '/projects/' + project.id + '/milestones?sort=position',
          headers,
        ).then(setMilestones),
        apiRequest<CoreRecord>(
          api + '/clients/' + project.client_id,
          'GET',
          undefined,
          headers,
        ).then((c) => setClient(c.name ?? '')),
      ]);
      for (const r of results) if (r.status === 'rejected') setError(r.reason.message);
    })();
  }, [api, project.id]);
  return (
    <section>
      <h2>Client and milestones</h2>
      <p>Client: {client}</p>
      {error && <p role="alert">{error}</p>}
      {!milestones.length && <p>No milestones.</p>}
      <ul>
        {milestones.map((m) => (
          <li key={m.id}>
            {m.title} - {m.status}
            {m.summary && (
              <span>
                {' '}
                -{' '}
                {m.summary.progress === null
                  ? 'No tasks'
                  : `${m.summary.done}/${m.summary.total} done`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClientInvitationList({
  path,
  organizationPath,
  headers,
}: {
  path: string;
  organizationPath: string;
  headers: Record<string, string>;
}) {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      email: string;
      role: string;
      revision: number;
      state: string;
      expires_at: string;
      project_id: string;
    }>
  >([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void allRecords<(typeof rows)[number]>(path, headers)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [path, tick]);
  return (
    <section>
      <h2>Client invitations</h2>
      {error && <p role="alert">{error}</p>}
      {!rows.length && <p>No client invitations.</p>}
      <ul>
        {rows.map((i) => (
          <li key={i.id}>
            {i.email} - {i.role} - {i.state} - expires {new Date(i.expires_at).toLocaleString()}
            {i.state === 'PENDING' && (
              <button
                onClick={() =>
                  void apiRequest(
                    organizationPath + '/invitations/' + i.id,
                    'DELETE',
                    {},
                    { ...headers, 'If-Match': `"${i.revision}"` },
                  )
                    .then(() => setTick((x) => x + 1))
                    .catch((e) => setError(e.message))
                }
              >
                Revoke client invitation
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
