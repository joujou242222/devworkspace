'use client';
import { useState, type FormEvent } from 'react';
export default function Login() {
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    setMessage(
      response.ok
        ? 'Signed in; reload to verify the server session.'
        : 'Experiment sign-in failed or experiment is disabled.',
    );
  }
  async function logout() {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    setMessage(response.ok ? 'Signed out; reload to verify revocation.' : 'Sign-out failed.');
  }
  return (
    <>
      <form onSubmit={submit}>
        <p>
          <label>
            Email <input name="email" type="email" required autoComplete="username" />
          </label>
        </p>
        <p>
          <label>
            Password{' '}
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
        </p>
        <button type="submit">Sign in to experiment</button>
      </form>
      <button onClick={logout}>Sign out of experiment</button>
      <p role="status">{message}</p>
    </>
  );
}
