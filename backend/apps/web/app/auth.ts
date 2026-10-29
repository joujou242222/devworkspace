import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeReturnPath } from '@devworkspace/contracts';
/** Forward only the current request's cookies to the fixed private API host. */
export async function requireAccount(
  returnTo: string,
  query?: Record<string, string | string[] | undefined>,
) {
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') params.set(key, value);
    }
    returnTo = safeReturnPath(returnTo + '?' + params.toString()) ?? returnTo;
  }
  const response = await fetch('http://127.0.0.1:3001/api/v1/me', {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (response.status === 401) redirect('/login?returnTo=' + encodeURIComponent(returnTo));
  // Unavailability renders the recoverable client error flow, never a cached user.
}
