/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Writes sw.js with the list of built files so the app works offline.
 * The OCR files (public/ocr, ~7 MB) are cached the first time they are used.
 */
function serviceWorker(): Plugin {
  return {
    name: 'lonekoll-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      // index.html is added by Vite after this hook runs, so list it explicitly.
      const precache = ['index.html', ...built, 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
      const version = createHash('sha256').update(built.sort().join('|')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * Strict Content Security Policy for the built app: the browser refuses any
 * connection to another server, so nothing can leave the device. (Dev mode
 * needs inline scripts for hot reload, so this is build-only.)
 */
// Google: only the user's own Drive, and only once they turn it on and sign in
// (src/cloud/google.ts; the exact addresses are checked by src/privacy.test.ts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://accounts.google.com/gsi/client",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://www.googleapis.com/drive/v3/ https://www.googleapis.com/upload/drive/v3/ https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'lonekoll-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  // Relative paths so the app works from any folder, e.g. GitHub Pages.
  base: './',
  resolve: {
    alias: [
      // ONNX Runtime (reading pay slip photos) without its WebAssembly bundled into the app: it is
      // loaded from public/ocr/paddle when a slip is first read, and kept for offline use there.
      { find: /^onnxruntime-web\/wasm$/, replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)) },
    ],
  },
  plugins: [react(), serviceWorker(), contentSecurityPolicy()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['src/**/*.test.ts'] },
});
