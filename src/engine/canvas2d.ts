// Rasterizes display lists onto a 2D canvas for a given document region.
// Works with HTMLCanvasElement or OffscreenCanvas (worker-safe: no DOM access).
// When the document is tileable, content is drawn at 3×3 toroidal offsets so
// shapes crossing an edge reappear on the opposite side.

import { buildFillSpec, buildPattern, buildScatter, buildType, type FillSpec, type Item } from './displaylist';
import type { Layer, TFDocument } from './types';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawItem(ctx: Ctx2D, it: Item) {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.rot);
  ctx.globalAlpha *= it.alpha;
  if (it.kind === 'text') {
    ctx.font = `${it.weight} ${Math.max(1, it.size)}px "${it.font}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (it.fill) {
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, 0, 0);
    } else {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = Math.max(0.5, it.strokeW);
      ctx.strokeText(it.text, 0, 0);
    }
    ctx.restore();
    return;
  }
  const r = it.size;
  ctx.beginPath();
  switch (it.shape) {
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'ring':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = Math.max(0.5, it.strokeW);
      ctx.stroke();
      ctx.restore();
      return;
    case 'rect':
      ctx.rect(-r, -r, r * 2, r * 2);
      break;
    case 'bar':
      ctx.rect(-r / 2, -it.strokeW / 2, r, it.strokeW);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.restore();
      return;
    case 'triangle':
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'blob': {
      const pts = it.pts ?? [1, 1, 1, 1, 1, 1];
      const k = pts.length;
      const px: number[] = [];
      const py: number[] = [];
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        px.push(Math.cos(a) * r * pts[i]);
        py.push(Math.sin(a) * r * pts[i]);
      }
      // Smooth closed curve through midpoints.
      ctx.moveTo((px[0] + px[k - 1]) / 2, (py[0] + py[k - 1]) / 2);
      for (let i = 0; i < k; i++) {
        const nx = (px[i] + px[(i + 1) % k]) / 2;
        const ny = (py[i] + py[(i + 1) % k]) / 2;
        ctx.quadraticCurveTo(px[i], py[i], nx, ny);
      }
      ctx.closePath();
      break;
    }
    case 'line':
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = Math.max(0.5, it.strokeW);
      ctx.stroke();
      ctx.restore();
      return;
    case 'arc':
      ctx.arc(0, 0, r, 0, Math.PI * 1.2);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = Math.max(0.5, it.strokeW);
      ctx.stroke();
      ctx.restore();
      return;
  }
  if (it.fill) {
    ctx.fillStyle = it.color;
    ctx.fill();
  }
  if (it.stroke) {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = Math.max(0.5, it.strokeW);
    ctx.stroke();
  }
  ctx.restore();
}

function paintFill(ctx: Ctx2D, spec: FillSpec, doc: TFDocument, rect: Region) {
  const { width: W, height: H } = doc;
  // Gradient geometry is based on the document; the painted rect may extend
  // beyond it (export-tile aprons) — canvas gradients clamp their end colors.
  const fillRect = () => ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  switch (spec.type) {
    case 'solid':
      ctx.fillStyle = spec.stops[0].color;
      fillRect();
      return;
    case 'linear': {
      const a = ((spec.angle - 90) * Math.PI) / 180;
      const cx = W / 2;
      const cy = H / 2;
      const L = (Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H) / 2;
      const g = ctx.createLinearGradient(cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      for (const st of spec.stops) g.addColorStop(st.offset, st.color);
      ctx.fillStyle = g;
      fillRect();
      return;
    }
    case 'radial': {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      for (const st of spec.stops) g.addColorStop(st.offset, st.color);
      ctx.fillStyle = g;
      fillRect();
      return;
    }
    case 'conic': {
      const g = ctx.createConicGradient((spec.angle * Math.PI) / 180, W / 2, H / 2);
      for (const st of spec.stops) g.addColorStop(st.offset, st.color);
      g.addColorStop(1, spec.stops[0].color);
      ctx.fillStyle = g;
      fillRect();
      return;
    }
    case 'blobs': {
      ctx.fillStyle = spec.stops[0].color;
      fillRect();
      for (const b of spec.blobs ?? []) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, b.color);
        g.addColorStop(1, b.color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      return;
    }
  }
}

export function layerItems(layer: Layer, doc: TFDocument): Item[] {
  switch (layer.type) {
    case 'scatter':
      return buildScatter(layer, doc);
    case 'pattern':
      return buildPattern(layer, doc);
    case 'type':
      return buildType(layer, doc);
    default:
      return [];
  }
}

/**
 * Render one 2D-source layer into `canvas` covering document `region`,
 * at output resolution canvas.width × canvas.height.
 */
export function renderLayer2D(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  layer: Layer,
  doc: TFDocument,
  region: Region,
): void {
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D context unavailable');
  const sx = canvas.width / region.w;
  const sy = canvas.height / region.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(sx, 0, 0, sy, -region.x * sx, -region.y * sy);
  ctx.globalAlpha = 1;

  const offsets: [number, number][] = doc.tileable
    ? [-1, 0, 1].flatMap((oy) => [-1, 0, 1].map((ox) => [ox * doc.width, oy * doc.height] as [number, number]))
    : [[0, 0]];

  if (layer.type === 'fill') {
    const spec = buildFillSpec(layer, doc);
    if (doc.tileable) {
      for (const [ox, oy] of offsets) {
        ctx.save();
        ctx.translate(ox, oy);
        paintFill(ctx, spec, doc, { x: 0, y: 0, w: doc.width, h: doc.height });
        ctx.restore();
      }
    } else {
      paintFill(ctx, spec, doc, region);
    }
    return;
  }

  const items = layerItems(layer, doc);
  for (const [ox, oy] of offsets) {
    if (ox !== 0 || oy !== 0) {
      ctx.save();
      ctx.translate(ox, oy);
      for (const it of items) drawItem(ctx, it);
      ctx.restore();
    } else {
      for (const it of items) drawItem(ctx, it);
    }
  }
}
