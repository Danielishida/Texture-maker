// Shared thumbnail renderer for the variations contact sheet.

import { Compositor } from '../engine/gl/compositor';
import type { TFDocument } from '../engine/types';

let canvas: HTMLCanvasElement | null = null;
let comp: Compositor | null = null;

export function renderThumb(doc: TFDocument, targetW = 240): string {
  if (!canvas) {
    canvas = document.createElement('canvas');
  }
  const h = Math.max(2, Math.round((targetW * doc.height) / doc.width));
  if (canvas.width !== targetW || canvas.height !== h) {
    canvas.width = targetW;
    canvas.height = h;
  }
  if (!comp) comp = new Compositor(canvas);
  comp.render(doc);
  return canvas.toDataURL('image/png');
}
