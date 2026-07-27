// Export worker: renders the document at full resolution, tiled so we stay
// under GPU texture limits and keep the UI thread free.

import { Compositor } from '../gl/compositor';
import type { TFDocument } from '../types';

export interface ExportRequest {
  doc: TFDocument;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  quality: number; // 0..1, jpeg only
  fonts: { family: string; data: ArrayBuffer }[];
}

export interface ExportProgress {
  kind: 'progress';
  done: number;
  total: number;
}
export interface ExportDone {
  kind: 'done';
  blob: Blob;
}
export interface ExportError {
  kind: 'error';
  message: string;
}

const TILE = 2048;
const PAD = 256; // apron re-rendered around each tile so blur/displace effects don't seam

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ExportRequest>) => void) | null;
  postMessage(msg: ExportProgress | ExportDone | ExportError): void;
  fonts?: { add(f: FontFace): void };
};

scope.onmessage = async (e) => {
  try {
    const { doc, width, height, format, quality, fonts } = e.data;
    for (const f of fonts) {
      try {
        const face = new FontFace(f.family, f.data);
        await face.load();
        scope.fonts?.add(face);
      } catch {
        // Missing fonts fall back to a default family; not fatal.
      }
    }

    const out = new OffscreenCanvas(width, height);
    const ctx = out.getContext('2d')!;
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    const probe = new OffscreenCanvas(1, 1);
    const comp = new Compositor(probe);
    const maxDim = Math.min(comp.maxTexSize, 8192);
    comp.destroy();

    const sx = doc.width / width; // doc px per output px

    if (width <= maxDim && height <= maxDim) {
      const glCanvas = new OffscreenCanvas(width, height);
      const c = new Compositor(glCanvas);
      c.render(doc);
      ctx.drawImage(glCanvas, 0, 0);
      c.destroy();
      scope.postMessage({ kind: 'progress', done: 1, total: 1 });
    } else {
      const cols = Math.ceil(width / TILE);
      const rows = Math.ceil(height / TILE);
      const glCanvas = new OffscreenCanvas(TILE + PAD * 2, TILE + PAD * 2);
      const c = new Compositor(glCanvas);
      let done = 0;
      const total = cols * rows;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const x0 = col * TILE;
          const y0 = r * TILE;
          const region = {
            x: (x0 - PAD) * sx,
            y: (y0 - PAD) * sx,
            w: (TILE + PAD * 2) * sx,
            h: (TILE + PAD * 2) * sx,
          };
          c.render(doc, region);
          const tw = Math.min(TILE, width - x0);
          const th = Math.min(TILE, height - y0);
          ctx.drawImage(glCanvas, PAD, PAD, tw, th, x0, y0, tw, th);
          done++;
          scope.postMessage({ kind: 'progress', done, total });
          // Yield so progress messages flush.
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      c.destroy();
    }

    const blob = await out.convertToBlob(
      format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality },
    );
    scope.postMessage({ kind: 'done', blob });
  } catch (err) {
    scope.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
