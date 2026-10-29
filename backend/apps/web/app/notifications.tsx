'use client';
import { useViewParam } from './view-state';
import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  apiRequest,
  type NotificationPage,
  type NotificationPreferences,
} from '@devworkspace/contracts';
type Scope = {
  orgId: string;
  principalId: string;
  client?: boolean;
  projectId?: string | undefined;
};
function useNotifications({ orgId, principalId, client = false, projectId }: Scope, query = '') {
  const [data, setData] = useState<NotificationPage>();
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const path = `/api/v1/organizations/${orgId}${client ? '/portal' : ''}/notifications`;
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    void apiRequest<NotificationPage>(path + query, 'GET', undefined, {
      'X-Organization-Principal': principalId,
    })
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) {
          setData(undefined);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [path, principalId, query, tick]);
  useEffect(() => {
    const socket = io({
      transports: ['websocket'],
      auth: {
        organization_id: orgId,
        principal_id: principalId,
        capacity: client ? 'CLIENT' : 'INTERNAL',
        ...(projectId ? { project_id: projectId } : {}),
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on('connect', () => {
      setConnected(true);
      refresh();
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setData(undefined);
    });
    socket.on('connect_error', () => {
      setConnected(false);
      setData(undefined);
    });
    socket.on('notifications.changed', refresh);
    socket.on('state.changed', () => {
      refresh();
      window.dispatchEvent(new Event('devworkspace:invalidate'));
    });
    const timer = setInterval(refresh, 30000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [orgId, principalId, client, projectId, refresh]);
  return { data, error, connected, path, refresh };
}
export function NotificationBadge(scope: Scope) {
  const { data, refresh } = useNotifications(scope, '?limit=1');
  const href = `${scope.client ? '/portal' : '/w'}/${scope.orgId}/notifications`;
  return (
    <p>
      <a href={href}>Notifications{data ? ` (${data.unread} unread)` : ''}</a>{' '}
      <button onClick={refresh}>Refresh notifications</button>
    </p>
  );
}
export function NotificationsPanel(scope: Scope) {
  const [page, setPage] = useViewParam<number>('page', 1),
    [state, setState] = useViewParam<string>('unread', ''),
    [category, setCategory] = useViewParam<string>('category', '');
  const query = `?page=${page}&limit=25${state ? '&unread=' + state : ''}${category ? '&category=' + category : ''}`;
  const { data, error, connected, path, refresh } = useNotifications(scope, query);
  const [mutationError, setMutationError] = useState(''),
    [busy, setBusy] = useState(false);
  async function read(suffix: string) {
    setBusy(true);
    setMutationError('');
    try {
      await apiRequest(
        path + suffix,
        'POST',
        {},
        { 'X-Organization-Principal': scope.principalId },
      );
      refresh();
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Notifications">
      <h2>Your notifications</h2>
      <p role="status">
        {connected ? 'Live updates connected' : 'Live updates disconnected; refresh to catch up'}
      </p>
      <label>
        Notification state{' '}
        <select
          aria-label="Notification state"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="true">Unread</option>
          <option value="false">Read</option>
        </select>
      </label>
      <label>
        Notification category{' '}
        <select
          aria-label="Notification category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          <option value="assignments">Assignments</option>
          <option value="reviews">Review activity</option>
          <option value="discussions_documents">Discussions and documents</option>
          <option value="client_updates">Client updates</option>
        </select>
      </label>
      <button onClick={refresh}>Reload notifications</button>
      <button disabled={busy || !data?.unread} onClick={() => void read('/read-all')}>
        Mark all authorized notifications read
      </button>
      {(error || mutationError) && <p role="alert">{error || mutationError}</p>}
      {!data && !error ? (
        <p>Loading notifications…</p>
      ) : (
        data && (
          <>
            <p>
              {data.total} notifications · {data.unread} unread
            </p>
            {!data.items.length && <p>No authorized notifications.</p>}
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <a href={n.href}>{n.summary}</a>{' '}
                  <time dateTime={n.occurred_at}>{new Date(n.occurred_at).toLocaleString()}</time>{' '}
                  {n.read_at ? (
                    'Read'
                  ) : (
                    <button disabled={busy} onClick={() => void read('/' + n.id + '/read')}>
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous notifications
            </button>{' '}
            Page {page}{' '}
            <button disabled={page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>
              Next notifications
            </button>
          </>
        )
      )}
    </section>
  );
}
export function NotificationPreferencesForm() {
  const [value, setValue] = useState<NotificationPreferences>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      setValue(await apiRequest<NotificationPreferences>('/api/v1/me/notification-preferences'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section>
      <h2>In-app notification preferences</h2>
      <p>
        Applies to future notifications. Verification, recovery, invitation and security messages
        remain mandatory.
      </p>
      <button onClick={() => void load()}>Reload notification preferences</button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {value && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              setValue(
                await apiRequest<NotificationPreferences>(
                  '/api/v1/me/notification-preferences',
                  'PATCH',
                  {
                    assignments: value.assignments,
                    reviews: value.reviews,
                    discussions_documents: value.discussions_documents,
                    client_updates: value.client_updates,
                  },
                  { 'If-Match': `"${value.revision}"` },
                ),
              );
              setMessage('Notification preferences saved.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend>Optional categories</legend>
            <label>
              <input
                type="checkbox"
                checked={value.assignments}
                onChange={(e) => setValue({ ...value, assignments: e.target.checked })}
              />
              Assignments
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.reviews}
                onChange={(e) => setValue({ ...value, reviews: e.target.checked })}
              />
              Review activity
            </label>
            <button>Save notification preferences</button>
            {(['discussions_documents', 'client_updates'] as const).map((category) => (
              <label key={category}>
                <input
                  type="checkbox"
                  checked={value[category]}
                  onChange={(e) => setValue({ ...value, [category]: e.target.checked })}
                />
                {category === 'client_updates' ? 'Client updates' : 'Discussions and documents'}
              </label>
            ))}
          </fieldset>
        </form>
      )}
    </section>
  );
}
