import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { listenForInstall } from './install.ts';

listenForInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. A new version takes over in the background (see
// sw-template.js); the open page keeps running and offers to reload into it.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      // The first install taking control of the page is not an update.
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) window.dispatchEvent(new CustomEvent('lonekoll:update', { detail: () => location.reload() }));
        hadController = true;
      });
      // A worker from before this change may still be waiting for the old "Update" tap.
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.waiting?.postMessage('skip-waiting');
    } catch {
      // Without a service worker the app still works online.
    }
  });
}
