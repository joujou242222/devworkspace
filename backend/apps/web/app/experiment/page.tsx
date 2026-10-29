import { headers } from 'next/headers';
import Login from './login';
export const dynamic = 'force-dynamic';
export default async function Experiment() {
  const cookie = (await headers()).get('cookie') ?? '';
  let authenticated = false;
  try {
    const response = await fetch(
      (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001') + '/api/auth/get-session',
      { headers: { cookie }, cache: 'no-store' },
    );
    const session = await response.json();
    authenticated = !!session?.user?.id;
  } catch {
    /* Render an honest disconnected experiment state. */
  }
  return (
    <>
      <h1>Isolated compatibility experiment</h1>
      <p>No production identity, organizations, or product permissions are implemented.</p>
      <p data-testid="server-session">
        {authenticated ? 'Authenticated experiment session' : 'No authenticated experiment session'}
      </p>
      <Login />
      <p>
        <a href="/">Foundation status</a>
      </p>
    </>
  );
}
