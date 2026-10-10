import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import './styles.css';
globalThis.Buffer = Buffer;
// Static imports execute before this module body. Load the Solana-dependent app
// only after Buffer is available to its dependencies.
void import('./App').then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}).catch((error: unknown) => {
  console.error('PaySim failed to start:', error);
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('role', 'alert');
    root.style.cssText = 'padding:32px;color:#eaf0fe;font:16px system-ui;white-space:pre-wrap';
    root.textContent = `PaySim could not start.\n${error instanceof Error ? error.message : String(error)}`;
  }
});
