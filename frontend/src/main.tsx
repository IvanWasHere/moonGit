import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { bootstrap } from '@/app/bootstrap';
import '@/styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found in index.html');

const root = createRoot(container);

/**
 * The schema is brought up to date before the first render, so no component
 * ever queries a table that does not exist yet. A failure is reported rather
 * than swallowed — see `bootstrap.ts` for why it is fatal.
 */
void bootstrap().then((result) => {
  if (!result.ok) {
    root.render(
      <div style={{ padding: 24, fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>
        <h1 style={{ fontSize: 16, marginBottom: 8 }}>moonGit could not start</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{result.detail}</p>
      </div>,
    );
    return;
  }

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
