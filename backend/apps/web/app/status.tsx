'use client';
import { useState } from 'react';
import type { FoundationHealth } from '@devworkspace/contracts';
export default function Status() {
  const [message, setMessage] = useState('API not checked');
  async function check() {
    try {
      const response = await fetch('/api/v1/health/live', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data: FoundationHealth = await response.json();
      setMessage('API ' + data.status + ' — phase ' + data.phase);
    } catch {
      setMessage('API unavailable');
    }
  }
  return (
    <section>
      <h2>Connection check</h2>
      <button onClick={check}>Check API</button>
      <p role="status">{message}</p>
    </section>
  );
}
