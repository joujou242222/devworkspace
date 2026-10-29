'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  apiRequest,
  ApiRequestError,
  documentContent,
  safeLink,
  type DocumentContent,
  type DocumentRecord,
  type DiscussionRecord,
  type UpdateRecord,
  type ReplyRecord,
  type ExpansionPage,
  type PrincipalDto,
  type ReportResult,
  type ActivityRecord,
  type AuditRecord,
  type FeedRecord,
} from '@devworkspace/contracts';
import {
  WorkspaceNavigation,
  ProjectNavigation,
  preferredCapacity,
  capacityKey,
} from './navigation';
import { useViewQuery } from './view-state';
import { NotificationBadge } from './notifications';

type Entry =
  | DiscussionRecord
  | DocumentRecord
  | UpdateRecord
  | ReplyRecord
  | ActivityRecord
  | AuditRecord
  | FeedRecord;
const empty: DocumentContent = { version: 1, blocks: [{ type: 'paragraph', spans: [] }] };
function useRead<T>(path: string, principal: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiRequest<T>(path, 'GET', undefined, { 'X-Organization-Principal': principal })
      .then((r) => {
        if (active) {
          setData(r);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setData(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, principal, tick]);
  useEffect(() => {
    window.addEventListener('devworkspace:invalidate', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('devworkspace:invalidate', refresh);
      clearInterval(timer);
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
export default function ExpansionWorkspace({
  orgId,
  segments,
  client = false,
}: {
  orgId: string;
  segments: string[];
  client?: boolean;
}) {
  const [principals, setPrincipals] = useState<PrincipalDto[]>([]),
    [principal, setPrincipal] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const all: PrincipalDto[] = [];
      let cursor: string | null = null;
      do {
        const r: { items: PrincipalDto[]; nextCursor: string | null } = await apiRequest(
          `/api/v1/me/${client ? 'client-principals' : 'principals'}${cursor ? '?cursor=' + cursor : ''}`,
        );
        all.push(...r.items);
        cursor = r.nextCursor;
      } while (cursor);
      if (active) {
        const ps = all.filter((p) => p.organizationId === orgId);
        setPrincipals(ps);
        setPrincipal(preferredCapacity(ps, orgId, client)?.id ?? '');
      }
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [orgId, client]);
  const root = `${client ? '/portal' : '/w'}/${orgId}`,
    projectId = segments[0] === 'projects' ? segments[1] : undefined;
  return (
    <section>
      <h1>{client ? 'Client updates' : 'Expansion workspace'}</h1>
      <p>
        <a href="/account">Account and capacities</a>
      </p>
      {client ? (
        <nav aria-label="Portal">
          <a href={root + '/projects'}>My projects</a>
          <a href={root + '/updates'}>Client updates</a>
        </nav>
      ) : (
        principal && (
          <WorkspaceNavigation
            orgId={orgId}
            role={principals.find((p) => p.id === principal)?.role}
          />
        )
      )}
      <label>
        Acting capacity
        <select
          aria-label="Acting capacity"
          value={principal}
          onChange={(e) => {
            sessionStorage.setItem(capacityKey(orgId, client), e.target.value);
            setPrincipal(e.target.value);
          }}
        >
          {principals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.role}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
      )}
      {!principal ? (
        <p>Select an available capacity to continue.</p>
      ) : (
        <div key={principal}>
          <NotificationBadge
            orgId={orgId}
            principalId={principal}
            client={client}
            projectId={projectId}
          />
          {projectId && <ProjectNavigation orgId={orgId} projectId={projectId} client={client} />}
          <ExpansionView
            orgId={orgId}
            principalId={principal}
            segments={segments}
            client={client}
          />
        </div>
      )}
    </section>
  );
}
function ExpansionView({
  orgId,
  principalId,
  segments,
  client,
}: {
  orgId: string;
  principalId: string;
  segments: string[];
  client: boolean;
}) {
  const project = segments[0] === 'projects' ? segments[1] : undefined,
    resource = project ? segments[2] : segments[0],
    id = project ? segments[3] : undefined;
  const root = `${client ? '/portal' : '/w'}/${orgId}`,
    api = `/api/v1/organizations/${orgId}`;
  if (resource === 'documents' && id && project)
    return (
      <DocumentEditor
        key={id}
        path={`${api}/projects/${project}/documents/${id}`}
        principalId={principalId}
      />
    );
  if (resource === 'discussions' && id && project)
    return (
      <DiscussionDetail
        path={`${api}/projects/${project}/discussions/${id}`}
        principalId={principalId}
      />
    );
  return (
    <ExpansionList
      key={segments.join('/')}
      path={
        api +
        (client ? '/portal' : '') +
        (project ? `/projects/${project}/${resource}` : `/${resource}`)
      }
      root={root}
      principalId={principalId}
      project={project}
      resource={resource ?? ''}
    />
  );
}
function ExpansionList({
  path,
  root,
  principalId,
  project,
  resource,
}: {
  path: string;
  root: string;
  principalId: string;
  project: string | undefined;
  resource: string;
}) {
  const [query, setQuery] = useViewQuery();
  const params = new URLSearchParams(query);
  const cursor = params.get('cursor') ?? '';
  const setCursor = (value: string) =>
    setQuery((previous) => {
      const p = new URLSearchParams(previous);
      if (value) p.set('cursor', value);
      else p.delete('cursor');
      return p.toString();
    });
  const readFilters = (search: string) => {
    const p = new URLSearchParams(search);
    const localDate = (key: string) => {
      const value = p.get(key);
      if (!value || !Number.isFinite(Date.parse(value))) return '';
      const d = new Date(value);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    return {
      q: p.get('q') ?? '',
      project_id: p.get('project_id') ?? p.get('projectId') ?? '',
      status: p.get('status') ?? '',
      action: p.get('action') ?? '',
      actor: p.get('actor') ?? '',
      from: localDate('from'),
      to: localDate('to'),
    };
  };
  const [filters, setFilters] = useState(() => readFilters(query));
  useEffect(() => {
    setFilters(readFilters(query));
  }, [query]);
  // Older project entry links use projectId; the versioned API accepts project_id.
  const apiQuery = new URLSearchParams(query);
  if (apiQuery.has('projectId')) {
    apiQuery.set('project_id', apiQuery.get('projectId')!);
    apiQuery.delete('projectId');
  }
  const { data, error, loading, refresh } = useRead<ExpansionPage<Entry> | ReportResult>(
    path + '?' + apiQuery.toString(),
    principalId,
  );
  const page = data && 'items' in data ? data : undefined,
    report = data && 'totals' in data ? data : undefined;
  const [mutation, setMutation] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  async function archive(r: DiscussionRecord | DocumentRecord | UpdateRecord) {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setMutation('');
    try {
      const kind =
        'title' in r ? (resource === 'discussions' ? 'discussions' : 'documents') : 'updates';
      await apiRequest(
        `${path.includes('/documents') && !project ? path.replace('/documents', `/projects/${r.project_id}/documents`) : path}/${r.id}/${kind === 'updates' ? 'withdraw' : 'archive'}`,
        'POST',
        {},
        { 'X-Organization-Principal': principalId, 'If-Match': `"${r.revision}"` },
      );
      refresh();
    } catch (e) {
      setMutation((e as Error).message);
    } finally {
      setArchiveBusy(false);
    }
  }
  return (
    <section>
      <h2>
        {resource === 'reports'
          ? 'Reports & analytics'
          : resource === 'audit'
            ? 'Audit log'
            : resource === 'updates'
              ? 'Client updates'
              : resource === 'documents'
                ? 'Documents library'
                : resource === 'activity'
                  ? 'Project activity'
                  : 'Project discussions'}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = new URLSearchParams();
          for (const [k, v] of Object.entries(filters))
            if (v) q.set(k, ['from', 'to'].includes(k) ? new Date(v).toISOString() : v);
          setQuery(q.toString());
        }}
      >
        {['documents', 'discussions'].includes(resource) && (
          <label>
            Search
            <input
              aria-label="Search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </label>
        )}
        {!project && resource !== 'audit' && (
          <label>
            Project filter
            <select
              aria-label="Project filter"
              value={filters.project_id}
              onChange={(e) => setFilters({ ...filters, project_id: e.target.value })}
            >
              <option value="">All permitted projects</option>
              {filters.project_id &&
                !page?.projects.some((p) => p.id === filters.project_id) &&
                !report?.projects.some((p) => p.id === filters.project_id) && (
                  <option value={filters.project_id}>Selected project</option>
                )}
              {(page?.projects ?? report?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {['documents', 'discussions'].includes(resource) && (
          <label>
            Status filter
            <select
              aria-label="Status filter"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All states</option>
              <option>ACTIVE</option>
              <option>ARCHIVED</option>
            </select>
          </label>
        )}
        {['activity', 'audit'].includes(resource) && (
          <label>
            Action filter
            <input
              aria-label="Action filter"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            />
          </label>
        )}
        {resource === 'audit' && (
          <label>
            Actor filter
            <input
              aria-label="Actor filter"
              value={filters.actor}
              onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
            />
          </label>
        )}
        {['reports', 'activity', 'audit', 'updates'].includes(resource) &&
          (['from', 'to'] as const).map((k) => (
            <label key={k}>
              {k === 'from' ? 'From (local time)' : 'To, exclusive (local time)'}
              <input
                type="datetime-local"
                aria-label={k}
                value={filters[k]}
                onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
              />
            </label>
          ))}
        <button>Apply filters</button>
      </form>
      <button onClick={refresh}>Refresh data</button>
      {loading && <p role="status">Loading…</p>}
      {error && (
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
      )}
      {mutation && <p role="alert">{mutation}</p>}
      {resource === 'discussions' && page?.canWrite && (
        <CreateForm
          fields={['title', 'body']}
          label="Create topic"
          submit={async (b, k) => {
            await apiRequest(path, 'POST', b, {
              'X-Organization-Principal': principalId,
              'Idempotency-Key': k,
            });
            refresh();
          }}
        />
      )}
      {resource === 'documents' && page?.projects.some((p) => p.canWrite) && (
        <CreateForm
          fields={['title']}
          projects={page.projects.filter((p) => p.canWrite)}
          label="Create document"
          submit={async (b, k) => {
            const r = await apiRequest<DocumentRecord>(
              path,
              'POST',
              { ...b, content: empty },
              { 'X-Organization-Principal': principalId, 'Idempotency-Key': k },
            );
            location.href = `${root}/projects/${r.project_id}/documents/${r.id}`;
          }}
        />
      )}
      {report && (
        <>
          <p>{report.definitions}</p>
          <MetricsTable result={report} />
        </>
      )}
      {page && (
        <>
          <p>{page.total} results</p>
          {!page.items.length && <p>No results in this scope.</p>}
          <ul>
            {page.items.map((r) => (
              <li key={r.id}>
                {'title' in r ? (
                  <a href={`${root}/projects/${r.project_id}/${resource}/${r.id}`}>{r.title}</a>
                ) : 'summary' in r ? (
                  <>
                    {r.summary} — {r.action} — {r.actor}
                  </>
                ) : 'target_id' in r ? (
                  <>
                    {r.action} — {r.actor_id} — {r.target_id} — correlation {r.request_id} —{' '}
                    {r.capacity}
                  </>
                ) : 'kind' in r ? (
                  <>
                    {r.kind === 'REVIEW' ? (
                      <a href={`${root}/projects/${r.project_id}/reviews/${r.review_id}`}>
                        Review version {r.version_number} — {r.status}
                      </a>
                    ) : (
                      r.body
                    )}{' '}
                    <a href={`${root}/projects/${r.project_id}`}>Project</a>
                  </>
                ) : 'body' in r ? (
                  r.body
                ) : null}{' '}
                {'status' in r && <span>{r.status}</span>}{' '}
                <time>{new Date(r.created_at).toLocaleString()}</time>
                {page.manager && 'revision' in r && r.status === 'ACTIVE' && (
                  <button
                    disabled={archiveBusy}
                    onClick={() => {
                      if (window.confirm('Archive this item? It will become read only.'))
                        void archive(r);
                    }}
                  >
                    Archive
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button disabled={!cursor} onClick={() => setCursor('')}>
            First page
          </button>
          <button disabled={!page.nextCursor} onClick={() => setCursor(page.nextCursor ?? '')}>
            Next page
          </button>
        </>
      )}
    </section>
  );
}
function MetricsTable({ result }: { result: ReportResult }) {
  return (
    <table>
      <caption>Scoped delivery and exact-version review metrics</caption>
      <thead>
        <tr>
          {[
            'Project',
            'Noncancelled tasks',
            'Done',
            'Overdue',
            'Progress',
            'Approved versions',
            'Terminal decisions',
            'Mean turnaround seconds',
          ].map((x) => (
            <th key={x}>{x}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...result.projects, { id: 'total', name: 'Total', ...result.totals }].map((r) => (
          <tr key={r.id}>
            <th>{r.name}</th>
            <td>{r.tasks}</td>
            <td>{r.done}</td>
            <td>{r.overdue}</td>
            <td>{r.progress === null ? 'No tasks' : (r.progress * 100).toFixed(1) + '%'}</td>
            <td>{r.approved_versions}</td>
            <td>{r.decisions}</td>
            <td>
              {r.turnaround_seconds === null
                ? 'No terminal decisions'
                : r.turnaround_seconds.toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function CreateForm({
  fields,
  label,
  submit,
  projects,
}: {
  fields: string[];
  label: string;
  submit: (b: Record<string, string>, key: string) => Promise<void>;
  projects?: { id: string; name: string }[];
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    attempt = useRef({ payload: '', key: crypto.randomUUID() });
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)])),
        payload = JSON.stringify(body);
      if (attempt.current.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      await submit(body, attempt.current.key);
      attempt.current = { payload: '', key: crypto.randomUUID() };
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send}>
      <fieldset disabled={busy}>
        <legend>{label}</legend>
        {projects && (
          <label>
            Destination project
            <select name="project_id" aria-label="Destination project">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.map((f) => (
          <label key={f}>
            {f === 'title' ? 'Title' : 'Body'}
            {f === 'body' ? (
              <textarea required name={f} aria-label={label + ' body'} maxLength={10000} />
            ) : (
              <input required name={f} aria-label={label + ' title'} maxLength={200} />
            )}
          </label>
        ))}
        <button>{label}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function DiscussionDetail({ path, principalId }: { path: string; principalId: string }) {
  const topic = useRead<DiscussionRecord>(path, principalId),
    [cursor, setCursor] = useState('');
  const replies = useRead<ExpansionPage<ReplyRecord>>(
    path + '/replies?limit=25' + (cursor ? '&cursor=' + cursor : ''),
    principalId,
  );
  return (
    <section>
      <h2>{topic.data?.title ?? 'Discussion'}</h2>
      {topic.error && <p role="alert">{topic.error}</p>}
      {topic.loading && <p role="status">Loading…</p>}
      {topic.data && (
        <>
          <p>{topic.data.body}</p>
          <p>{topic.data.status}</p>
          {replies.data?.canWrite && topic.data.status === 'ACTIVE' && (
            <CreateForm
              fields={['body']}
              label="Post reply"
              submit={async (b, k) => {
                await apiRequest(path + '/replies', 'POST', b, {
                  'X-Organization-Principal': principalId,
                  'Idempotency-Key': k,
                });
                replies.refresh();
              }}
            />
          )}
          {replies.data?.manager && topic.data.status === 'ACTIVE' && (
            <ArchiveButton
              path={path + '/archive'}
              revision={topic.data.revision}
              principalId={principalId}
              refresh={topic.refresh}
            />
          )}
          <ul>
            {replies.data?.items.map((r) => (
              <li key={r.id}>
                {r.body} <time>{new Date(r.created_at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
          <button disabled={!cursor} onClick={() => setCursor('')}>
            First replies
          </button>
          <button
            disabled={!replies.data?.nextCursor}
            onClick={() => setCursor(replies.data?.nextCursor ?? '')}
          >
            Next replies
          </button>
        </>
      )}
      {replies.error && <p role="alert">{replies.error}</p>}
      <button
        onClick={() => {
          topic.refresh();
          replies.refresh();
        }}
      >
        Refresh discussion
      </button>
    </section>
  );
}
function ArchiveButton({
  path,
  revision,
  principalId,
  refresh,
}: {
  path: string;
  revision: number;
  principalId: string;
  refresh: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          if (!window.confirm('Archive this item? It will become read only.')) return;
          setBusy(true);
          try {
            await apiRequest(
              path,
              'POST',
              {},
              { 'X-Organization-Principal': principalId, 'If-Match': `"${revision}"` },
            );
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Archive
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function ClientUpdatePublisher({
  orgId,
  principalId,
  projectId,
}: {
  orgId: string;
  principalId: string;
  projectId: string;
}) {
  const path = `/api/v1/organizations/${orgId}/projects/${projectId}/updates`,
    read = useRead<ExpansionPage<UpdateRecord>>(path, principalId),
    [error, setError] = useState(''),
    [cursor, setCursor] = useState('');
  const listing = useRead<ExpansionPage<UpdateRecord>>(
    path + (cursor ? '?cursor=' + cursor : ''),
    principalId,
  );
  return (
    <section>
      <h2>Published client updates</h2>
      <a href={`/portal/${orgId}/updates?projectId=${projectId}`}>
        Client update feed (client capacity required)
      </a>
      {read.data?.manager && read.data.canWrite && (
        <CreateForm
          fields={['body']}
          label="Publish client update"
          submit={async (b, k) => {
            await apiRequest(path, 'POST', b, {
              'X-Organization-Principal': principalId,
              'Idempotency-Key': k,
            });
            read.refresh();
            listing.refresh();
          }}
        />
      )}
      {(error || read.error || listing.error) && (
        <p role="alert">{error || read.error || listing.error}</p>
      )}
      <ul>
        {listing.data?.items.map((r) => (
          <li key={r.id}>
            {r.body} — {r.status}
            {read.data?.manager && read.data.canWrite && r.status === 'PUBLISHED' && (
              <button
                onClick={async () => {
                  try {
                    await apiRequest(
                      `${path}/${r.id}/withdraw`,
                      'POST',
                      {},
                      { 'X-Organization-Principal': principalId, 'If-Match': `"${r.revision}"` },
                    );
                    listing.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Withdraw update
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        onClick={() => {
          read.refresh();
          listing.refresh();
        }}
      >
        Refresh client updates
      </button>
      <button disabled={!cursor} onClick={() => setCursor('')}>
        First updates
      </button>
      <button
        disabled={!listing.data?.nextCursor}
        onClick={() => setCursor(listing.data?.nextCursor ?? '')}
      >
        Next updates
      </button>
    </section>
  );
}

function renderSpans(
  spans: {
    text: string;
    bold?: boolean | undefined;
    italic?: boolean | undefined;
    href?: string | undefined;
  }[],
): ReactNode {
  return spans.map((s, i) => {
    let node: ReactNode = s.text;
    if (s.bold) node = <strong>{node}</strong>;
    if (s.italic) node = <em>{node}</em>;
    if (s.href && safeLink.safeParse(s.href).success)
      node = (
        <a href={s.href} rel="noopener noreferrer">
          {node}
        </a>
      );
    return <span key={i}>{node}</span>;
  });
}
function RichContent({ content }: { content: DocumentContent }) {
  return content.blocks.map((b, i) => {
    if (b.type === 'paragraph') return <p key={i}>{renderSpans(b.spans)}</p>;
    if (b.type === 'heading') {
      const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3';
      return <Tag key={i}>{renderSpans(b.spans)}</Tag>;
    }
    const Tag = b.type === 'orderedList' ? 'ol' : 'ul';
    return (
      <Tag key={i}>
        {b.items.map((spans, j) => (
          <li key={j}>{renderSpans(spans)}</li>
        ))}
      </Tag>
    );
  });
}
function readEditor(root: HTMLElement): DocumentContent {
  type Span = { text: string; bold?: boolean; italic?: boolean; href?: string };
  const spans = (node: Node, marks: Omit<Span, 'text'> = {}): Span[] => {
    if (node.nodeType === Node.TEXT_NODE) return [{ text: node.textContent ?? '', ...marks }];
    if (!(node instanceof HTMLElement)) return [];
    const tag = node.tagName;
    const next = {
      ...marks,
      ...(['B', 'STRONG'].includes(tag) ? { bold: true } : {}),
      ...(['I', 'EM'].includes(tag) ? { italic: true } : {}),
      ...(tag === 'A' ? { href: node.getAttribute('href') ?? '' } : {}),
    };
    if (tag === 'BR') return [{ text: '\n', ...next }];
    return [...node.childNodes].flatMap((n) => spans(n, next));
  };
  const blocks: DocumentContent['blocks'] = [];
  const visit = (n: Node) => {
    if (n instanceof HTMLElement && ['UL', 'OL'].includes(n.tagName)) {
      blocks.push({
        type: n.tagName === 'OL' ? 'orderedList' : 'bulletList',
        items: [...n.children].map((x) => spans(x)),
      });
    } else if (n instanceof HTMLElement && /^H[123]$/.test(n.tagName)) {
      blocks.push({ type: 'heading', level: Number(n.tagName[1]) as 1 | 2 | 3, spans: spans(n) });
    } else if (n instanceof HTMLElement && n.querySelector('ul,ol,p,div,h1,h2,h3')) {
      for (const child of n.childNodes) visit(child);
    } else blocks.push({ type: 'paragraph', spans: spans(n) });
  };
  for (const n of root.childNodes) visit(n);
  return documentContent.parse({ version: 1, blocks });
}
function DocumentEditor({ path, principalId }: { path: string; principalId: string }) {
  const read = useRead<DocumentRecord>(path, principalId),
    [initial, setInitial] = useState<DocumentRecord>(),
    [title, setTitle] = useState(''),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [link, setLink] = useState(''),
    [editorEpoch, setEditorEpoch] = useState(0);
  const editor = useRef<HTMLDivElement>(null),
    selection = useRef<Range | null>(null);
  const projectPath = path.slice(0, path.lastIndexOf('/documents/'));
  const permissions = useRead<ExpansionPage<DocumentRecord>>(
    path.split('/projects/')[0] +
      '/documents?project_id=' +
      path.split('/projects/')[1]!.split('/')[0],
    principalId,
  );
  useEffect(() => {
    if (read.data && !initial) {
      setInitial(read.data);
      setTitle(read.data.title);
      setRevision(read.data.revision);
    }
  }, [read.data, initial]);
  const canWrite =
    !!permissions.data?.projects.find((p) => p.id === read.data?.project_id)?.canWrite &&
    read.data?.status === 'ACTIVE';
  const manager = permissions.data?.manager;
  function remember() {
    const s = window.getSelection();
    if (s?.rangeCount && editor.current?.contains(s.anchorNode))
      selection.current = s.getRangeAt(0).cloneRange();
  }
  function command(name: string, value?: string) {
    if (selection.current) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(selection.current);
    }
    document.execCommand(name, false, value);
    setDirty(true);
    editor.current?.focus();
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const content = readEditor(editor.current!);
      const r = await apiRequest<DocumentRecord>(
        path,
        'PATCH',
        { title, content },
        { 'X-Organization-Principal': principalId, 'If-Match': `"${revision}"` },
      );
      setRevision(r.revision);
      setDirty(false);
      setConflict(false);
      setMessage('Document saved.');
      read.refresh();
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e.message
          : 'Unsupported or excessive document content. Use the supported formats.',
      );
      if (e instanceof ApiRequestError && e.status === 412) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Document editor</h2>
      {read.error && (
        <p role="alert">
          {read.error} <a href="/login">Sign in</a>
        </p>
      )}
      {read.loading && !initial && <p role="status">Loading…</p>}
      {initial && (
        <div hidden={!read.data}>
          <p>
            {dirty ? 'Unsaved changes' : 'Saved'} — {read.data?.status ?? initial.status}
          </p>
          <label>
            Document title
            <input
              aria-label="Document title"
              value={title}
              readOnly={!canWrite}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              maxLength={200}
            />
          </label>
          {canWrite && (
            <div role="toolbar" aria-label="Formatting">
              {[
                ['Paragraph', 'formatBlock', 'p'],
                ['Heading 1', 'formatBlock', 'h1'],
                ['Heading 2', 'formatBlock', 'h2'],
                ['Heading 3', 'formatBlock', 'h3'],
                ['Bold', 'bold'],
                ['Italic', 'italic'],
                ['Bulleted list', 'insertUnorderedList'],
                ['Numbered list', 'insertOrderedList'],
              ].map(([label, name, value]) => (
                <button
                  type="button"
                  key={label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    command(name!, value);
                  }}
                >
                  {label}
                </button>
              ))}
              <label>
                Link URL
                <input
                  aria-label="Link URL"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
              </label>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (safeLink.safeParse(link).success) command('createLink', link);
                  else setError('Use an absolute HTTP(S) link.');
                }}
              >
                Insert link
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  command('unlink');
                }}
              >
                Remove link
              </button>
            </div>
          )}
          <div
            key={initial.revision + ':' + editorEpoch}
            ref={editor}
            role="textbox"
            aria-label="Document content"
            aria-multiline="true"
            contentEditable={canWrite && !busy}
            suppressContentEditableWarning
            onInput={() => {
              setDirty(true);
              remember();
            }}
            onMouseUp={remember}
            onKeyUp={remember}
            onBlur={remember}
            onPaste={(e) => {
              e.preventDefault();
              document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
              setDirty(true);
            }}
            onDrop={(e) => {
              e.preventDefault();
              document.execCommand('insertText', false, e.dataTransfer.getData('text/plain'));
              setDirty(true);
            }}
            style={{ border: '1px solid', minHeight: 180, padding: 8 }}
          >
            <RichContent content={initial.content} />
          </div>
          <p>
            Pasted or dropped formatting is normalized to plain text. Supported formatting uses the
            toolbar.
          </p>
          {canWrite && (
            <button disabled={busy} onClick={() => void save()}>
              Save document
            </button>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              if (!dirty || window.confirm('Discard unsaved changes and reload?')) {
                setBusy(true);
                try {
                  const latest = await apiRequest<DocumentRecord>(path, 'GET', undefined, {
                    'X-Organization-Principal': principalId,
                  });
                  setInitial(latest);
                  setTitle(latest.title);
                  setRevision(latest.revision);
                  setEditorEpoch((x) => x + 1);
                  setDirty(false);
                  setConflict(false);
                  read.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }
            }}
          >
            Discard draft and reload
          </button>
          {conflict && (
            <button
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError('');
                try {
                  const r = await apiRequest<DocumentRecord>(path, 'GET', undefined, {
                    'X-Organization-Principal': principalId,
                  });
                  setRevision(r.revision);
                  setConflict(false);
                  setMessage(
                    'Latest revision selected; your draft is retained. Review before saving.',
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use latest revision and keep my draft
            </button>
          )}
          {manager && canWrite && (
            <ArchiveButton
              path={path + '/archive'}
              revision={revision}
              principalId={principalId}
              refresh={read.refresh}
            />
          )}
          <a href={projectPath.replace('/api/v1/organizations/', '/w/')}>Project overview</a>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
