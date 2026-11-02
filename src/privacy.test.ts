import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOUD } from './domain/model.ts';

// The app's promise: what a user enters never leaves their device, and nobody,
// including whoever runs or develops the app, can see it – unless the user
// themselves turns on a copy in their own Google Drive, or shares files to an
// app they pick. These checks fail
// (and with them the build and the deploy) if a change could break that
// promise: a connection to another server, a way of sending data out, or a
// looser security policy. A deliberate exception must change this file, in
// the open.

const root = path.resolve(__dirname, '..');

/** The only addresses outside the app: Google's sign-in and Drive, for the user's own copy. */
const GOOGLE = {
  script: 'https://accounts.google.com/gsi/client',
  style: 'https://accounts.google.com/gsi/style',
  frame: 'https://accounts.google.com/gsi/',
  connect: ['https://www.googleapis.com/drive/v3/', 'https://www.googleapis.com/upload/drive/v3/', 'https://accounts.google.com/gsi/'],
};

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
  it('the browser may only connect to the app itself, and to the user’s Google Drive', () => {
    const policy = csp();
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", 'blob:', 'data:', ...GOOGLE.connect]);
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'blob:', GOOGLE.script]);
    expect(policy.get('frame-src')).toEqual([GOOGLE.frame]);
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'", GOOGLE.style]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    // No other server, and no wildcard, anywhere in the policy.
    const google = new Set([...GOOGLE.connect, GOOGLE.script, GOOGLE.frame, GOOGLE.style]);
    for (const [name, values] of policy) {
      for (const value of values.filter((v) => !google.has(v))) {
        expect(value, `${name} ${value}`).not.toMatch(/^(https?:|wss?:|\*|[a-z0-9-]+\.[a-z])/i);
      }
    }
  });

  it('Google Drive is reached only from one file, only at Google’s addresses, and only the app’s own files there', () => {
    const code = readFileSync(path.join(root, 'src', 'cloud', 'google.ts'), 'utf8');
    expect(code.match(/https?:\/\/[^'`\s]+/g)).toEqual([
      'https://www.googleapis.com/auth/drive.file',
      GOOGLE.script,
      'https://www.googleapis.com/drive/v3',
      'https://www.googleapis.com/upload/drive/v3',
    ]);
    // drive.file: only files the app made, never the rest of the user's Drive.
    expect(code).toContain("const SCOPE = 'https://www.googleapis.com/auth/drive.file';");
    // Every request goes to one of those, with nothing but the user's own sign-in.
    expect([...code.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }']);
    expect([...code.matchAll(/call\(`([^`$]*)/g)].map((m) => m[1]).every((start) => start === '')).toBe(true);
    expect([...code.matchAll(/call\(`\$\{(\w+)\}/g)].map((m) => m[1]).every((base) => base === 'API' || base === 'UPLOAD')).toBe(true);
    // It is used only when the user has turned on Drive (sync.ts checks the setting first).
    const sync = readFileSync(path.join(root, 'src', 'cloud', 'sync.ts'), 'utf8');
    expect(sync).toContain("if (cloud.mode !== 'drive') return;");
    expect(DEFAULT_CLOUD.mode).toBe('local');
  });

  it('files go to another app only through the share sheet, after a tap', () => {
    const code = readFileSync(path.join(root, 'src', 'share.ts'), 'utf8');
    expect(code.match(/navigator\.share\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/fetch|https?:/);
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
    // The user's Google Drive and the share sheet (both checked above).
    const allowed = [serviceWorker, sources, path.join(root, 'src', 'cloud', 'google.ts'), path.join(root, 'src', 'share.ts')];
    const found: string[] = [];
    for (const file of [...sourceFiles(path.join(root, 'src')), path.join(root, 'index.html')].filter((f) => !allowed.includes(f))) {
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
    // Exactly four addresses: the agreement (2025 and 2020 editions as published by the union, the 2023 edition in an archive), and the Sick Pay Act at the Riksdag.
    expect(code.match(/https?:\/\/[^'\s]+/g)).toEqual([
      'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2025.pdf',
      'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2020-2023.pdf',
      'https://kollektivavtal.github.io/2023/livsmedelsavtalet.pdf',
      'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19911047-om-sjuklon_sfs-1991-1047/',
    ]);
    // A link adds only a page or a paragraph, never anything the user entered…
    const links = [...code.matchAll(/href: (?!string;)(.*) };$/gm)].map((m) => m[1].trim());
    expect(links).toEqual(['paragraph ? `${SICK_PAY_ACT_URL}#P${paragraph}` : SICK_PAY_ACT_URL', '`${info.url}#page=${page}`']);
    expect([...code.matchAll(/url: (\w+),/g)].map((m) => m[1])).toEqual(['AGREEMENT_URL', 'AGREEMENT_2020_URL', 'AGREEMENT_2023_URL']);
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

  it('the home page and the privacy policy (for Google’s consent screen) run nothing and load nothing from elsewhere', () => {
    for (const name of ['about.html', 'privacy.html']) {
      const page = readFileSync(path.join(root, 'public', name), 'utf8');
      expect(page, name).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"`);
      expect(page, name).not.toMatch(/<script|<iframe|<form|<link[^>]+stylesheet/i);
      // Images and the icon are the site's own files; other addresses are plain links, opened only by a tap.
      for (const m of page.matchAll(/\b(src|href)="([^"]+)"/g)) {
        if (m[1] === 'src' || !/^https?:/.test(m[2])) expect(m[2], `${name} ${m[1]}`).not.toMatch(/^(https?:)?\/\//);
      }
    }
    // The policy says what the app asks Google for: the same scope as the code.
    expect(readFileSync(path.join(root, 'public', 'privacy.html'), 'utf8')).toContain('<code>drive.file</code>');
    expect(readFileSync(path.join(root, 'src', 'cloud', 'google.ts'), 'utf8')).toContain("const SCOPE = 'https://www.googleapis.com/auth/drive.file';");
  });
});
