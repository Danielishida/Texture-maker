// Main-thread export API: spins up the worker, streams progress, returns a Blob.

import { getLocalFonts } from '../fonts';
import type { TFDocument } from '../types';
import type { ExportDone, ExportError, ExportProgress } from './exportWorker';

export interface ExportOptions {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  quality: number;
}

export function exportDocument(
  doc: TFDocument,
  opts: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ExportProgress | ExportDone | ExportError>) => {
      const msg = e.data;
      if (msg.kind === 'progress') onProgress?.(msg.done, msg.total);
      else if (msg.kind === 'done') {
        worker.terminate();
        resolve(msg.blob);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Export worker failed'));
    };
    const fonts = getLocalFonts().map((f) => ({ family: f.family, data: f.data.slice(0) }));
    worker.postMessage(
      { doc, width: opts.width, height: opts.height, format: opts.format, quality: opts.quality, fonts },
      fonts.map((f) => f.data),
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportFilename(doc: TFDocument, w: number, h: number, ext: string, seed?: string): string {
  const name = doc.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'untitled';
  return `${name}-${seed ?? doc.seed}-${w}x${h}.${ext}`;
}

/** CSV manifest matching common stock bulk-upload templates. */
export function buildCsvManifest(rows: { filename: string }[]): Blob {
  const header = 'Filename,Title,Keywords,Category,Releases';
  const lines = rows.map((r) => `${r.filename},,,,`);
  return new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
}
