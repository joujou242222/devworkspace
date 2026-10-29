'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  apiRequest,
  ApiRequestError,
  safeReturnPath,
  type AccountDto,
  type PrincipalDto,
} from '@devworkspace/contracts';
import { capacityKey } from './navigation';

/** Revalidate restored/focused private views; never retain a different account's DOM. */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const path = usePathname();
  const protectedPage = /^\/(w|portal|account|onboarding)(\/|$)/.test(path);
  const identity = useRef<string | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!protectedPage) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const me = await apiRequest<AccountDto>('/api/v1/me');
        if (!active) return;
        if (identity.current && identity.current !== me.id) {
          setDenied(true);
          return;
        }
        identity.current = me.id;
        const scope = path.match(/^\/(w|portal)\/([^/]+)(?:\/projects\/([^/]+))?/);
        if (scope) {
          const client = scope[1] === 'portal';
          const org = scope[2]!;
          const items: PrincipalDto[] = [];
          let cursor: string | null = null;
          do {
            const page: { items: PrincipalDto[]; nextCursor: string | null } = await apiRequest(
              `/api/v1/me/${client ? 'client-principals' : 'principals'}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
            );
            items.push(...page.items.filter((p) => p.organizationId === org));
            cursor = page.nextCursor;
          } while (cursor);
          const selected = sessionStorage.getItem(capacityKey(org, client));
          const principal = selected ? items.find((p) => p.id === selected) : items[0];
          if (!principal) {
            if (active) setDenied(true);
            return;
          }
          const resource = scope[3] ? `/projects/${scope[3]}` : '';
          const review = path.match(/\/reviews\/([^/]+)$/);
          const endpoint = `/api/v1/organizations/${org}${client ? '/portal' : ''}${resource}${resource && review ? '/reviews/' + review[1] : ''}`;
          await apiRequest(endpoint, 'GET', undefined, {
            'X-Organization-Principal': principal.id,
          });
        }
        if (!active) return;
        setError('');
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) setDenied(true);
        else setError('Cannot verify the session. Reconnect and retry. Your draft is retained.');
      } finally {
        checking = false;
      }
    };
    const focus = () => {
      void check();
    };
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    // Hide the snapshot before a back/forward-cache restoration can expose old content.
    const hide = () => {
      document.documentElement.style.visibility = 'hidden';
    };
    const expired = () => setDenied(true);
    void check();
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', restore);
    window.addEventListener('pagehide', hide);
    window.addEventListener('devworkspace:session-expired', expired);
    window.addEventListener('devworkspace:invalidate', focus);
    const timer = setInterval(focus, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('devworkspace:session-expired', expired);
      window.removeEventListener('devworkspace:invalidate', focus);
    };
  }, [path, protectedPage]);
  if (protectedPage && denied)
    return (
      <main id="main-content" tabIndex={-1}>
        <p role="alert">
          {path.startsWith('/w/') ? 'Organization access unavailable. ' : ''}
          This session or resource access is no longer available.{' '}
          <a
            href={
              '/login?returnTo=' +
              encodeURIComponent(
                safeReturnPath(
                  path + (typeof window === 'undefined' ? '' : window.location.search),
                ) ?? path,
              )
            }
          >
            Sign in again
          </a>{' '}
          <a href="/account">Choose organization or capacity</a>
        </p>
      </main>
    );
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {children}
    </>
  );
}
