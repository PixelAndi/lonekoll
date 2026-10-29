import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. A new version waits until the user taps "Update".
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Reload only when the user asked for the update, not when the first
      // install takes control of the page.
      let reloadOnChange = false;
      const announce = (worker: ServiceWorker | null) => {
        if (!worker || !navigator.serviceWorker.controller) return;
        const apply = () => {
          reloadOnChange = true;
          worker.postMessage('skip-waiting');
        };
        window.dispatchEvent(new CustomEvent('lonekoll:update', { detail: apply }));
      };
      announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => worker.state === 'installed' && announce(worker));
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadOnChange) return;
        reloadOnChange = false;
        location.reload();
      });
    } catch {
      // Without a service worker the app still works online.
    }
  });
}
