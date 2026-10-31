import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The app's promise: what a user enters never leaves their device, and nobody,
// including whoever runs or develops the app, can see it. These checks fail
// (and with them the build and the deploy) if a change could break that
// promise: a connection to another server, a way of sending data out, or a
// looser security policy. A deliberate exception must change this file, in
// the open.

const root = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The Content Security Policy the built app ships with (vite.config.ts). */
function csp(): Map<string, string[]> {
  const config = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const block = config.match(/const CSP = \[([\s\S]*?)\]\.join/);
  if (!block) throw new Error('No CSP found in vite.config.ts');
  const directives = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].split(/\s+/));
  return new Map(directives.map(([name, ...values]) => [name, values]));
}

describe('privacy: nothing leaves the device', () => {
  it('the browser may only connect to the app itself', () => {
    const policy = csp();
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", 'blob:', 'data:']);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    // No other server, and no wildcard, anywhere in the policy.
    for (const [name, values] of policy) {
      for (const value of values) {
        expect(value, `${name} ${value}`).not.toMatch(/^(https?:|wss?:|\*|[a-z0-9-]+\.[a-z])/i);
      }
    }
  });

  it('the app’s code has no way of sending data out', () => {
    // Network calls, sending files to other apps, links that carry data
    // elsewhere, and addresses of other servers.
    const forbidden = [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /RTCPeerConnection/,
      /navigator\.share\b/,
      /window\.open\s*\(/,
      /mailto:/,
      /https?:\/\/(?!localhost)[a-z0-9-]+\.[a-z]/i,
    ];
    // The service worker only passes on the app's own requests for its own files,
    // and the links to the agreement and the law are fixed addresses (both checked below).
    const serviceWorker = path.join(root, 'src', 'sw-template.js');
    const sources = path.join(root, 'src', 'domain', 'sources.ts');
    const found: string[] = [];
    for (const file of [...sourceFiles(path.join(root, 'src')), path.join(root, 'index.html')].filter((f) => f !== serviceWorker && f !== sources)) {
      // Comments may mention addresses (e.g. sources of the rules); only code counts.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const pattern of forbidden) {
        if (pattern.test(code)) found.push(`${path.relative(root, file)}: ${pattern}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the offline cache only passes on the app’s own requests for its own files', () => {
    const code = readFileSync(path.join(root, 'src', 'sw-template.js'), 'utf8');
    expect(code).toContain("if (request.method !== 'GET') return;");
    expect(code).toContain('if (url.origin !== self.location.origin) return;');
    // Every request it makes is the page's own (at most asked to skip the browser's short-term cache).
    const calls = [...code.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((arg) => arg === 'request' || arg === 'request, FRESH')).toBe(true);
    expect(code).toContain("const FRESH = { cache: 'no-store' };");
    expect(code).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\//);
  });

  it('the links to the agreement and the law carry nothing from the app', () => {
    const code = readFileSync(path.join(root, 'src', 'domain', 'sources.ts'), 'utf8');
    // Exactly two addresses: the agreement as published by the union, and the Sick Pay Act at the Riksdag.
    expect(code.match(/https?:\/\/[^'\s]+/g)).toEqual([
      'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2025.pdf',
      'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19911047-om-sjuklon_sfs-1991-1047/',
    ]);
    // A link adds only a page or a paragraph, never anything the user entered…
    const links = [...code.matchAll(/href: (?!string;)(.*) };$/gm)].map((m) => m[1].trim());
    expect(links).toEqual(['paragraph ? `${SICK_PAY_ACT_URL}#P${paragraph}` : SICK_PAY_ACT_URL', '`${AGREEMENT_URL}#page=${page}`']);
    // …and is opened only by a tap, without telling the other site where it came from.
    const cited = readFileSync(path.join(root, 'src', 'ui', 'Cited.tsx'), 'utf8');
    expect(cited).toContain('rel="noopener noreferrer"');
    expect(cited).not.toMatch(/location|window\.open|fetch/);
  });

  it('a pay slip is read from its own bytes on the device, and nothing else is loaded for it', () => {
    const extract = readFileSync(path.join(root, 'src', 'pdf', 'extract.ts'), 'utf8');
    const browser = readFileSync(path.join(root, 'src', 'pdf', 'browser.ts'), 'utf8');
    // pdf.js gets the file's bytes, never a link to fetch it from.
    expect(extract).toMatch(/getDocument\(\{ data, isEvalSupported: false \}\)/);
    // No fonts, character maps or decoders from elsewhere, and the reader itself is bundled with the app.
    for (const code of [extract, browser]) expect(code).not.toMatch(/\burl\s*:|cMapUrl|standardFontDataUrl|wasmUrl|iccUrl/);
    expect(browser).toContain("import('pdfjs-dist/build/pdf.worker.min.mjs?url')");
  });
});
