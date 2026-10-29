'use client';
import { useSyncExternalStore } from 'react';

function subscribe(restore: () => void) {
  window.addEventListener('popstate', restore);
  window.addEventListener('devworkspace:view-query', restore);
  return () => {
    window.removeEventListener('popstate', restore);
    window.removeEventListener('devworkspace:view-query', restore);
  };
}

/** Only filters and cursors enter the URL, never drafts, secrets or response data. */
export function useViewQuery() {
  const query = useSyncExternalStore(
    subscribe,
    () => window.location.search.slice(1),
    () => '',
  );
  const setQuery = (value: string | ((previous: string) => string)) => {
    // Read the URL so multiple changes in the same event build on each other.
    const next = typeof value === 'function' ? value(window.location.search.slice(1)) : value;
    const url = window.location.pathname + (next ? '?' + next : '');
    if (url !== window.location.pathname + window.location.search)
      window.history.pushState(null, '', url);
    window.dispatchEvent(new Event('devworkspace:view-query'));
  };
  return [query, setQuery] as const;
}

export function useViewParam<T extends string | number>(name: string, initial: T) {
  const [query, setQuery] = useViewQuery();
  const parse = (search: string): T => {
    const raw = new URLSearchParams(search).get(name);
    if (raw === null) return initial;
    if (typeof initial === 'number') {
      const n = Number(raw);
      return (Number.isSafeInteger(n) && n > 0 ? n : initial) as T;
    }
    return raw as T;
  };
  const setValue = (value: T | ((previous: T) => T)) =>
    setQuery((previous) => {
      const p = new URLSearchParams(previous);
      const next = typeof value === 'function' ? value(parse(previous)) : value;
      if (next === initial) p.delete(name);
      else p.set(name, String(next));
      return p.toString();
    });
  return [parse(query), setValue] as const;
}
