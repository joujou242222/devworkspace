import type { ReactNode } from 'react';
import { Navigation } from './flows';
import { SessionBoundary } from './session-boundary';
import './global.css';
export const metadata = { title: 'DevWorkspace', referrer: 'no-referrer' };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SessionBoundary>
          <Navigation />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </SessionBoundary>
      </body>
    </html>
  );
}
