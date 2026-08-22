/**
 * File access layer.
 *
 * Chromium (web + Electron): File System Access API — open/save-in-place with
 * real permission prompts, and persistent recents: we store FileSystemFileHandle
 * objects in IndexedDB (handles are structured-cloneable), then re-request
 * permission with a user gesture when a recent is reopened. Exactly the
 * "the app asks for access to the file" flow.
 *
 * Firefox/Safari fallback: <input type=file> to open, download to save.
 */

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  handle: FileSystemFileHandle | null;
}

export const hasFSA = typeof (globalThis as any).showOpenFilePicker === 'function';

const PICKER_TYPES = [{
  description: 'Debate documents',
  accept: {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] as ['.docx'],
  },
}];

export async function openViaPicker(): Promise<OpenedFile | null> {
  if (hasFSA) {
    try {
      const [handle] = await (globalThis as any).showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      const file: File = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save in place when we hold a handle; otherwise Save As / download. */
export async function saveFile(bytes: Uint8Array, name: string, handle: FileSystemFileHandle | null): Promise<FileSystemFileHandle | null> {
  if (handle) {
    const perm = await verifyPermission(handle, true);
    if (perm) {
      const w = await handle.createWritable();
      await w.write(bytes as unknown as BufferSource);
      await w.close();
      return handle;
    }
  }
  return saveAs(bytes, name);
}

export async function saveAs(bytes: Uint8Array, suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (hasFSA) {
    try {
      const handle = await (globalThis as any).showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
      const w = await handle.createWritable();
      await w.write(bytes as unknown as BufferSource);
      await w.close();
      return handle;
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  }
  // Fallback: download a copy.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return null;
}

export async function verifyPermission(handle: FileSystemFileHandle, write: boolean): Promise<boolean> {
  const opts = { mode: write ? 'readwrite' : 'read' } as any;
  const h = handle as any;
  if (typeof h.queryPermission === 'function' && (await h.queryPermission(opts)) === 'granted') return true;
  if (typeof h.requestPermission === 'function' && (await h.requestPermission(opts)) === 'granted') return true;
  return typeof h.queryPermission !== 'function'; // environments without the permission API
}

// ---------------------------------------------------------------------------
// Recents: file handles persisted in IndexedDB.
// ---------------------------------------------------------------------------

export interface RecentEntry {
  name: string;
  openedAt: number;
  handle: FileSystemFileHandle | null;
}

const DB_NAME = 'spread';
const STORE = 'recents';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addRecent(entry: RecentEntry): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* recents are a convenience; never block on them */ }
}

export async function listRecents(limit = 8): Promise<RecentEntry[]> {
  try {
    const d = await db();
    const all = await new Promise<RecentEntry[]>((res, rej) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result as RecentEntry[]);
      req.onerror = () => rej(req.error);
    });
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  } catch { return []; }
}

export async function clearRecents(): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* ignore */ }
}

/** Re-open a recent: asks the browser for permission again if needed. */
export async function openRecent(entry: RecentEntry): Promise<OpenedFile | null> {
  if (!entry.handle) return null;
  const ok = await verifyPermission(entry.handle, false);
  if (!ok) return null;
  const file = await entry.handle.getFile();
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: entry.handle };
}
