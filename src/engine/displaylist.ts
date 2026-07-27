// Builds resolution-independent display lists (in document pixel coordinates)
// for vector-representable layers. Consumed by both the canvas2d rasterizer
// and the SVG exporter so raster and vector output share placement logic.

import { Rng, makeNoise2D } from './prng';
import { slotColor } from './palette';
import { PATTERNS, PLACEMENTS, SHAPES, TYPE_LAYOUTS, type Layer, type TFDocument } from './types';

export interface ShapeItem {
  kind: 'shape';
  /** 'bar' is an internal pattern primitive: a size×strokeW filled rectangle. */
  shape: (typeof SHAPES)[number] | 'bar';
  x: number;
  y: number;
  size: number; // radius-ish, doc px
  rot: number; // radians
  color: string;
  alpha: number;
  fill: boolean;
  stroke: boolean;
  strokeW: number; // doc px
  pts?: number[]; // blob outline offsets (unit radii per vertex)
}

export interface TextItem {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number; // font size doc px
  rot: number;
  color: string;
  alpha: number;
  font: string;
  weight: number;
  fill: boolean;
  strokeW: number;
}

export type Item = ShapeItem | TextItem;

export interface GradientStop {
  offset: number;
  color: string;
}
export interface FillSpec {
  type: 'solid' | 'linear' | 'radial' | 'conic' | 'blobs';
  angle: number; // degrees
  stops: GradientStop[];
  blobs?: { x: number; y: number; r: number; color: string }[];
}

const n = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const s = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function itemColor(doc: TFDocument, slotParam: number, rng: Rng): string {
  if (slotParam >= 0) return slotColor(doc.palette, slotParam);
  return slotColor(doc.palette, rng.int(1, 4)); // "mix": any non-background slot
}

// --- fill -------------------------------------------------------------------

export function buildFillSpec(layer: Layer, doc: TFDocument): FillSpec {
  const p = layer.params;
  const types = ['solid', 'linear', 'radial', 'conic', 'blobs'] as const;
  const type = types[Math.max(0, Math.min(4, Math.round(n(p.fillType, 1))))];
  const a = slotColor(doc.palette, n(p.slotA));
  const b = slotColor(doc.palette, n(p.slotB, 1));
  const c = slotColor(doc.palette, n(p.slotC, 2));
  const stops: GradientStop[] =
    n(p.useC) >= 0.5
      ? [
          { offset: 0, color: a },
          { offset: 0.5, color: c },
          { offset: 1, color: b },
        ]
      : [
          { offset: 0, color: a },
          { offset: 1, color: b },
        ];
  const spec: FillSpec = { type, angle: n(p.angle, 45), stops };
  if (type === 'blobs') {
    const rng = new Rng(layer.seed + '/blobs');
    const count = Math.round(n(p.blobCount, 5));
    const minDim = Math.min(doc.width, doc.height);
    spec.blobs = [];
    for (let i = 0; i < count; i++) {
      spec.blobs.push({
        x: rng.range(0, doc.width),
        y: rng.range(0, doc.height),
        r: rng.range(0.35, 0.9) * minDim,
        color: slotColor(doc.palette, rng.int(1, 4)),
      });
    }
  }
  return spec;
}

// --- scatter ------------------------------------------------------------------

function blobPts(rng: Rng): number[] {
  const k = rng.int(6, 9);
  const pts: number[] = [];
  for (let i = 0; i < k; i++) pts.push(rng.range(0.6, 1.15));
  return pts;
}

interface Pos {
  x: number;
  y: number;
  scale: number;
}

function placements(layer: Layer, doc: TFDocument, count: number, rng: Rng): Pos[] {
  const placement = PLACEMENTS[Math.max(0, Math.min(PLACEMENTS.length - 1, Math.round(n(layer.params.placement))))];
  const jitter = n(layer.params.jitter, 0.5);
  const W = doc.width;
  const H = doc.height;
  const out: Pos[] = [];
  switch (placement) {
    case 'uniform':
      for (let i = 0; i < count; i++) out.push({ x: rng.range(0, W), y: rng.range(0, H), scale: 1 });
      break;
    case 'grid': {
      const cols = Math.max(1, Math.round(Math.sqrt((count * W) / H)));
      const rows = Math.max(1, Math.ceil(count / cols));
      const cw = W / cols;
      const ch = H / rows;
      let i = 0;
      for (let r = 0; r < rows && i < count; r++)
        for (let c = 0; c < cols && i < count; c++, i++) {
          out.push({
            x: (c + 0.5) * cw + rng.range(-0.5, 0.5) * jitter * cw,
            y: (r + 0.5) * ch + rng.range(-0.5, 0.5) * jitter * ch,
            scale: 1,
          });
        }
      break;
    }
    case 'ring': {
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.35;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng.range(-0.5, 0.5) * jitter;
        const rr = R * (1 + rng.range(-0.4, 0.4) * jitter);
        out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, scale: 1 });
      }
      break;
    }
    case 'flow': {
      const noise = makeNoise2D(layer.seed + '/flowfield');
      const streams = Math.max(1, Math.round(count / 12));
      const per = Math.ceil(count / streams);
      let placed = 0;
      for (let st = 0; st < streams && placed < count; st++) {
        let x = rng.range(0, W);
        let y = rng.range(0, H);
        for (let k = 0; k < per && placed < count; k++, placed++) {
          out.push({ x, y, scale: 1 - (k / per) * 0.6 });
          const a = noise((x / W) * 3, (y / H) * 3) * Math.PI * 4;
          const step = Math.min(W, H) * 0.035 * (1 + jitter);
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
        }
      }
      break;
    }
    case 'subdiv': {
      // Recursive random subdivision; cell centers become positions.
      const cells: { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: W, h: H }];
      while (cells.length < count) {
        // Split the largest cell.
        let bi = 0;
        for (let i = 1; i < cells.length; i++) if (cells[i].w * cells[i].h > cells[bi].w * cells[bi].h) bi = i;
        const c = cells.splice(bi, 1)[0];
        const t = rng.range(0.3, 0.7);
        if (c.w > c.h) {
          cells.push({ x: c.x, y: c.y, w: c.w * t, h: c.h }, { x: c.x + c.w * t, y: c.y, w: c.w * (1 - t), h: c.h });
        } else {
          cells.push({ x: c.x, y: c.y, w: c.w, h: c.h * t }, { x: c.x, y: c.y + c.h * t, w: c.w, h: c.h * (1 - t) });
        }
      }
      for (const c of cells.slice(0, count)) {
        out.push({
          x: c.x + c.w / 2 + rng.range(-0.3, 0.3) * jitter * c.w,
          y: c.y + c.h / 2 + rng.range(-0.3, 0.3) * jitter * c.h,
          scale: Math.min(c.w, c.h) / Math.min(W, H) / 0.25,
        });
      }
      break;
    }
  }
  return out;
}

export function buildScatter(layer: Layer, doc: TFDocument): ShapeItem[] {
  const p = layer.params;
  const rng = new Rng(layer.seed + '/scatter');
  const count = Math.max(1, Math.round(n(p.count, 20)));
  const shape = SHAPES[Math.max(0, Math.min(SHAPES.length - 1, Math.round(n(p.shape))))];
  const minDim = Math.min(doc.width, doc.height);
  const minSize = n(p.minSize, 0.02) * minDim;
  const maxSize = Math.max(minSize, n(p.maxSize, 0.12) * minDim);
  const rotJit = (n(p.rotJitter) * Math.PI) / 180;
  const fillMode = Math.round(n(p.fillMode));
  const alpha = n(p.alpha, 1);
  const strokeW = n(p.strokeW, 0.006) * minDim;
  const pos = placements(layer, doc, count, rng.fork('pos'));
  const items: ShapeItem[] = [];
  for (let i = 0; i < pos.length; i++) {
    const ir = rng.fork('item' + i);
    const size = ir.range(minSize, maxSize) * Math.max(0.15, Math.min(pos[i].scale, 2));
    items.push({
      kind: 'shape',
      shape,
      x: pos[i].x,
      y: pos[i].y,
      size,
      rot: ir.range(-rotJit, rotJit),
      color: itemColor(doc, n(p.colorSlot, -1), ir),
      alpha,
      fill: fillMode !== 1,
      stroke: fillMode !== 0,
      strokeW,
      pts: shape === 'blob' ? blobPts(ir) : undefined,
    });
  }
  return items;
}

// --- pattern -----------------------------------------------------------------

export function buildPattern(layer: Layer, doc: TFDocument): ShapeItem[] {
  const p = layer.params;
  const rng = new Rng(layer.seed + '/pattern');
  const patType = PATTERNS[Math.max(0, Math.min(PATTERNS.length - 1, Math.round(n(p.patType))))];
  const minDim = Math.min(doc.width, doc.height);
  const spacing = Math.max(4, n(p.spacing, 0.06) * minDim);
  const thickness = n(p.thickness, 0.5);
  const angle = (n(p.angle) * Math.PI) / 180;
  const phase = n(p.phase);
  const waveAmp = n(p.waveAmp, 0.3);
  const colorOf = (i: number) => itemColor(doc, n(p.colorSlot, 2), rng.fork('c' + i));
  const items: ShapeItem[] = [];
  // Cover the rotated bounding diagonal so any angle fills the frame.
  const diag = Math.hypot(doc.width, doc.height);
  const cx = doc.width / 2;
  const cy = doc.height / 2;
  const mk = (over: Partial<ShapeItem>): ShapeItem => ({
    kind: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    size: 1,
    rot: 0,
    color: '#000',
    alpha: 1,
    fill: true,
    stroke: false,
    strokeW: 0,
    ...over,
  });

  switch (patType) {
    case 'stripes': {
      const nLines = Math.ceil(diag / spacing) + 2;
      for (let i = 0; i < nLines; i++) {
        const off = (i - nLines / 2 + phase) * spacing;
        items.push(
          mk({
            shape: 'bar',
            x: cx + Math.cos(angle + Math.PI / 2) * off,
            y: cy + Math.sin(angle + Math.PI / 2) * off,
            size: diag,
            rot: angle,
            strokeW: spacing * thickness,
            color: colorOf(i),
          }),
        );
      }
      break;
    }
    case 'checker':
    case 'dots': {
      const cols = Math.ceil(doc.width / spacing) + 1;
      const rows = Math.ceil(doc.height / spacing) + 1;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (patType === 'checker' && (r + c) % 2 === 0) continue;
          items.push(
            mk({
              shape: patType === 'checker' ? 'rect' : 'circle',
              x: (c + 0.5) * spacing,
              y: (r + 0.5) * spacing,
              size: patType === 'checker' ? spacing / 2 : (spacing / 2) * thickness,
              color: colorOf(r * cols + c),
            }),
          );
        }
      break;
    }
    case 'herringbone': {
      const cols = Math.ceil(doc.width / spacing) + 2;
      const rows = Math.ceil(doc.height / spacing) + 2;
      for (let r = -1; r < rows; r++)
        for (let c = -1; c < cols; c++) {
          items.push(
            mk({
              shape: 'bar',
              x: (c + 0.5) * spacing,
              y: (r + 0.5) * spacing,
              size: spacing * 1.3,
              rot: ((r + c) % 2 === 0 ? 1 : -1) * (Math.PI / 4) + angle,
              strokeW: spacing * thickness * 0.5,
              color: colorOf(r * cols + c),
            }),
          );
        }
      break;
    }
    case 'waves': {
      const nLines = Math.ceil(doc.height / spacing) + 3;
      const segs = 48;
      for (let i = -1; i < nLines; i++) {
        const y0 = (i + phase) * spacing;
        const color = colorOf(i);
        for (let sgm = 0; sgm < segs; sgm++) {
          const x0 = (sgm / segs) * doc.width;
          const x1 = ((sgm + 1) / segs) * doc.width;
          const w0 = y0 + Math.sin((x0 / doc.width) * Math.PI * 4 + i) * spacing * waveAmp;
          const w1 = y0 + Math.sin((x1 / doc.width) * Math.PI * 4 + i) * spacing * waveAmp;
          items.push(
            mk({
              shape: 'bar',
              x: (x0 + x1) / 2,
              y: (w0 + w1) / 2,
              size: Math.hypot(x1 - x0, w1 - w0) * 1.05,
              rot: Math.atan2(w1 - w0, x1 - x0),
              strokeW: spacing * thickness * 0.5,
              color,
            }),
          );
        }
      }
      break;
    }
    case 'rings': {
      const nRings = Math.ceil(diag / 2 / spacing) + 1;
      for (let i = 0; i < nRings; i++) {
        items.push(
          mk({
            shape: 'ring',
            x: cx,
            y: cy,
            size: (i + 0.5 + phase) * spacing,
            strokeW: spacing * thickness * 0.5,
            fill: false,
            stroke: true,
            color: colorOf(i),
          }),
        );
      }
      break;
    }
  }
  return items;
}

// --- type ---------------------------------------------------------------------

export function buildType(layer: Layer, doc: TFDocument): TextItem[] {
  const p = layer.params;
  const rng = new Rng(layer.seed + '/type');
  const text = s(p.text, 'A') || 'A';
  const font = s(p.font, 'Georgia');
  const weight = [400, 700, 900][Math.max(0, Math.min(2, Math.round(n(p.weight, 1))))];
  const layout = TYPE_LAYOUTS[Math.max(0, Math.min(TYPE_LAYOUTS.length - 1, Math.round(n(p.layout))))];
  const count = Math.max(1, Math.round(n(p.count, 1)));
  const minDim = Math.min(doc.width, doc.height);
  const size = n(p.size, 0.5) * minDim;
  const rotJit = (n(p.rotJitter) * Math.PI) / 180;
  const fill = Math.round(n(p.fillMode)) === 0;
  const strokeW = n(p.strokeW, 0.004) * minDim;
  const alpha = n(p.alpha, 1);
  const items: TextItem[] = [];
  const push = (x: number, y: number, sz: number, rot: number, i: number) =>
    items.push({
      kind: 'text',
      text,
      x,
      y,
      size: sz,
      rot,
      color: itemColor(doc, n(p.colorSlot, 4), rng.fork('c' + i)),
      alpha,
      font,
      weight,
      fill,
      strokeW,
    });

  switch (layout) {
    case 'single':
      push(doc.width / 2, doc.height / 2, size, rng.range(-rotJit, rotJit), 0);
      break;
    case 'scatter':
      for (let i = 0; i < count; i++) {
        const ir = rng.fork('p' + i);
        push(ir.range(0, doc.width), ir.range(0, doc.height), size * ir.range(0.3, 1), ir.range(-rotJit, rotJit), i);
      }
      break;
    case 'grid': {
      const cols = Math.max(1, Math.round(Math.sqrt((count * doc.width) / doc.height)));
      const rows = Math.max(1, Math.ceil(count / cols));
      let i = 0;
      for (let r = 0; r < rows && i < count; r++)
        for (let c = 0; c < cols && i < count; c++, i++) {
          push(((c + 0.5) * doc.width) / cols, ((r + 0.5) * doc.height) / rows, Math.min(size, (doc.width / cols) * 0.8), rng.fork('g' + i).range(-rotJit, rotJit), i);
        }
      break;
    }
    case 'ring': {
      const R = minDim * 0.32;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        push(doc.width / 2 + Math.cos(a) * R, doc.height / 2 + Math.sin(a) * R, size * 0.4, a + Math.PI / 2, i);
      }
      break;
    }
    case 'wave': {
      for (let i = 0; i < count; i++) {
        const x = ((i + 0.5) / count) * doc.width;
        const y = doc.height / 2 + Math.sin((i / count) * Math.PI * 2) * doc.height * 0.2;
        push(x, y, size * 0.5, Math.cos((i / count) * Math.PI * 2) * 0.4, i);
      }
      break;
    }
  }
  return items;
}
