// Local persistence: IndexedDB autosave + .json project files.
// No backend — everything stays on the user's machine.

import { migrateDocument, type TFDocument } from '../engine/types';

const DB_NAME = 'texture-forge';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- project files -----------------------------------------------------------

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
}

export async function saveProjectFile(doc: TFDocument): Promise<void> {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const name = `${doc.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'untitled'}.texture-forge.json`;
  const w = window as FilePickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Texture Forge project', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function openProjectFile(): Promise<TFDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(migrateDocument(JSON.parse(await file.text())));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

// --- recipes -------------------------------------------------------------------

export interface Recipe {
  id: string;
  name: string;
  doc: TFDocument;
}

export async function loadRecipes(): Promise<Recipe[]> {
  return (await idbGet<Recipe[]>('recipes')) ?? [];
}

export async function saveRecipes(recipes: Recipe[]): Promise<void> {
  await idbPut('recipes', recipes);
}
