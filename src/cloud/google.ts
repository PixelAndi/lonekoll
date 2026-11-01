// The app's only connection to another server: the user's own Google Drive,
// used only after they turn it on and sign in themselves. The permission asked
// for (drive.file) reaches only the files this app creates there, nothing else
// in their Drive. The address list here is checked by privacy.test.ts.

export const CLIENT_ID = '802358798802-36e0p1p6jlpih260q29rf5kotran7jic.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SIGN_IN_SCRIPT = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'lonekoll.driveToken';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

export class NeedsSignIn extends Error {
  constructor() {
    super('needs sign-in');
  }
}

let script: Promise<void> | undefined;
function loadSignIn(): Promise<void> {
  script ??= new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const s = document.createElement('script');
    s.src = SIGN_IN_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = undefined;
      reject(new Error('Google sign-in could not be loaded'));
    };
    document.head.append(s);
  });
  return script;
}

function storedToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, until } = JSON.parse(raw) as { token: string; until: number };
    return Date.now() < until - 60_000 ? token : null;
  } catch {
    return null;
  }
}
function storeToken(token: string | null, seconds = 0) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, until: Date.now() + seconds * 1000 }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Without storage the user signs in again next time.
  }
}

export const isSignedIn = () => storedToken() !== null;

/**
 * Signs in (a Google window; must follow a tap, or the browser blocks it).
 * After the first time Google answers at once without asking again.
 */
export async function signIn(): Promise<void> {
  await loadSignIn();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? 'no access'));
        storeToken(r.access_token, r.expires_in ?? 3600);
        resolve();
      },
      error_callback: (e) => reject(new Error(e.type)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function signOut(): Promise<void> {
  const token = storedToken();
  storeToken(null);
  folders.clear();
  if (!token) return;
  try {
    await loadSignIn();
    window.google!.accounts.oauth2.revoke(token);
  } catch {
    // The permission ends by itself within the hour.
  }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = storedToken();
  if (!token) throw new NeedsSignIn();
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    storeToken(null);
    throw new NeedsSignIn();
  }
  if (!response.ok) throw new Error(`Google Drive ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function findIn(parent: string, name: string, mime?: string): Promise<string | undefined> {
  const q = [`name = ${quote(name)}`, `${quote(parent)} in parents`, 'trashed = false', mime ? `mimeType = ${quote(mime)}` : ''].filter(Boolean).join(' and ');
  const r = await call(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
  return ((await r.json()) as { files: { id: string }[] }).files[0]?.id;
}

const folders = new Map<string, string>();

/** The folder at this path from the top of the user's Drive, made where missing. */
export async function folder(path: string[]): Promise<string> {
  let parent = 'root';
  for (let i = 0; i < path.length; i++) {
    const key = path.slice(0, i + 1).join('/');
    let id = folders.get(key);
    if (!id) {
      id = await findIn(parent, path[i], FOLDER);
      if (!id) {
        const r = await call(`${API}/files?fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: path[i], mimeType: FOLDER, parents: [parent] }),
        });
        id = ((await r.json()) as { id: string }).id;
      }
      folders.set(key, id);
    }
    parent = id;
  }
  return parent;
}

export const findFile = (parent: string, name: string) => findIn(parent, name);

/** Uploads a new file, or new contents for an existing one; answers its id and the size Drive stored. */
export async function upload(file: { parent: string; name: string; mime: string; blob: Blob; id?: string }): Promise<{ id: string; size: number }> {
  const boundary = `lonekoll${Math.random().toString(36).slice(2)}`;
  const meta = file.id ? { name: file.name } : { name: file.name, mimeType: file.mime, parents: [file.parent] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`,
    file.blob,
    `\r\n--${boundary}--`,
  ]);
  const r = await call(`${UPLOAD}/files${file.id ? `/${file.id}` : ''}?uploadType=multipart&fields=id,size`, {
    method: file.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const done = (await r.json()) as { id: string; size?: string };
  return { id: done.id, size: Number(done.size ?? file.blob.size) };
}

/** Moves a file to another folder under another name (a pay slip whose period was corrected). */
export async function move(id: string, parent: string, name: string): Promise<void> {
  const r = await call(`${API}/files/${encodeURIComponent(id)}?fields=parents`);
  const { parents = [] } = (await r.json()) as { parents?: string[] };
  const params = new URLSearchParams({ fields: 'id', addParents: parent, removeParents: parents.filter((p) => p !== parent).join(',') });
  await call(`${API}/files/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function download(id: string): Promise<Blob> {
  return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob();
}

/** Whether the file is still there (not deleted or in the bin), and its size. */
export async function stat(id: string): Promise<{ size: number } | null> {
  try {
    const r = await call(`${API}/files/${encodeURIComponent(id)}?fields=size,trashed`);
    const f = (await r.json()) as { size?: string; trashed?: boolean };
    return f.trashed ? null : { size: Number(f.size ?? 0) };
  } catch (e) {
    if (e instanceof NeedsSignIn) throw e;
    return null;
  }
}

export async function accountEmail(): Promise<string | undefined> {
  const r = await call(`${API}/about?fields=user(emailAddress)`);
  return ((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress;
}
