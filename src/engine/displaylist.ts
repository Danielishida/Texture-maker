// Builds resolution-independent display lists (in document pixel coordinates)
// for vector-representable layers. Consumed by both the canvas2d rasterizer
// and the SVG exporter so raster and vector output share placement logic.

import { Rng, makeNoise2D } from './prng';
import { slotColor } from './palette';
import { PATTERNS, PLACEMENTS, SHAPES, TYPE_LAYOUTS, type Layer, type TFDocument } from './types';

export interface ShapeItem {
  kind: 'shape';
  /**
   * Beyond the scatter primitives, internal shapes used by patterns/tiles:
   * 'bar' size×strokeW filled rect · 'quarter' quarter-disc pivoted at the
   * corner · 'semi' half-disc · 'qarc' stroked 90° arc · 'poly' closed
   * polygon (pts = flat unit coords × size) · 'polyline' open stroked path.
   */
  shape: (typeof SHAPES)[number] | 'bar' | 'quarter' | 'semi' | 'qarc' | 'poly' | 'polyline';
  x: number;
  y: number;
  size: number; // radius-ish, doc px
  rot: number; // radians
  color: string;
  alpha: number;
  fill: boolean;
  stroke: boolean;
  strokeW: number; // doc px
  pts?: number[]; // blob radii, or poly/polyline flat [x,y,...] unit coords
  aspect?: number; // x-axis stretch applied after rotation (default 1)
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
  const baseRot = (n(p.baseRot) * Math.PI) / 180;
  const aspect = Math.max(1, n(p.aspect, 1));
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
      rot: baseRot + ir.range(-rotJit, rotJit),
      color: itemColor(doc, n(p.colorSlot, -1), ir),
      alpha,
      fill: fillMode !== 1,
      stroke: fillMode !== 0,
      strokeW,
      pts: shape === 'blob' ? blobPts(ir) : undefined,
      aspect: aspect !== 1 ? aspect : undefined,
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

// --- tile grid ------------------------------------------------------------------
// Grid of cells, each drawing one motif from a curated vocabulary with
// quantized rotation — the engine behind quilt/Bauhaus/deco style patterns.

type Motif =
  | 'quarter'
  | 'semi'
  | 'circle'
  | 'ring'
  | 'concentric'
  | 'dots'
  | 'qarc'
  | 'insetSquare'
  | 'stripes'
  | 'htri'
  | 'rect'
  | 'dotfan'
  | 'cube'
  | 'blank';

const MOTIF_VOCAB: Motif[][] = [
  ['quarter'], // quarter quilt
  ['semi', 'quarter', 'circle', 'ring', 'concentric', 'dots', 'qarc', 'insetSquare', 'stripes', 'blank'], // bauhaus mix
  ['dotfan'], // dot fans
  ['cube'], // deco cubes
  ['qarc', 'ring', 'concentric', 'circle', 'semi'], // arcs & rings
  ['quarter', 'htri', 'circle', 'rect', 'stripes', 'blank'], // geo mix
];

interface CellCtx {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number; // usable half-extent after inset
  rot: number;
  color: string;
  color2: string;
  lineW: number;
  detail: number;
  rng: Rng;
  out: ShapeItem[];
}

const shapeItem = (over: Partial<ShapeItem> & Pick<ShapeItem, 'shape' | 'x' | 'y' | 'size' | 'color'>): ShapeItem => ({
  kind: 'shape',
  rot: 0,
  alpha: 1,
  fill: true,
  stroke: false,
  strokeW: 0,
  ...over,
});

function emitMotif(motif: Motif, c: CellCtx) {
  const { cx, cy, r, rot, color, lineW, rng, out } = c;
  switch (motif) {
    case 'quarter': {
      // Quarter disc pivoted at a cell corner; rot picks which corner.
      const k = Math.round(rot / (Math.PI / 2)) % 4;
      const corners = [
        [cx - c.w / 2, cy - c.h / 2],
        [cx + c.w / 2, cy - c.h / 2],
        [cx + c.w / 2, cy + c.h / 2],
        [cx - c.w / 2, cy + c.h / 2],
      ];
      const [px, py] = corners[((k % 4) + 4) % 4];
      out.push(
        shapeItem({
          shape: 'quarter',
          x: px,
          y: py,
          size: c.h,
          rot: (k * Math.PI) / 2,
          aspect: c.w / c.h,
          color,
        }),
      );
      break;
    }
    case 'semi':
      out.push(shapeItem({ shape: 'semi', x: cx, y: cy, size: r * rng.range(0.7, 1), rot, color }));
      break;
    case 'circle':
      out.push(shapeItem({ shape: 'circle', x: cx, y: cy, size: r * rng.range(0.45, 0.95), color }));
      break;
    case 'ring':
      out.push(
        shapeItem({ shape: 'ring', x: cx, y: cy, size: r * rng.range(0.5, 0.9), color, fill: false, stroke: true, strokeW: lineW }),
      );
      break;
    case 'concentric': {
      const nRings = 2 + Math.round(c.detail * 3);
      for (let i = 0; i < nRings; i++) {
        out.push(
          shapeItem({
            shape: 'ring',
            x: cx,
            y: cy,
            size: (r * 0.92 * (i + 1)) / nRings,
            color,
            fill: false,
            stroke: true,
            strokeW: lineW,
          }),
        );
      }
      break;
    }
    case 'dots': {
      const grid = rng.chance(0.5) ? 2 : 3;
      const gap = (r * 1.2) / grid;
      const d = r * (grid === 2 ? 0.28 : 0.18);
      for (let gy = 0; gy < grid; gy++)
        for (let gx = 0; gx < grid; gx++) {
          out.push(
            shapeItem({
              shape: 'circle',
              x: cx + (gx - (grid - 1) / 2) * gap,
              y: cy + (gy - (grid - 1) / 2) * gap,
              size: d,
              color,
            }),
          );
        }
      break;
    }
    case 'qarc':
      out.push(
        shapeItem({ shape: 'qarc', x: cx, y: cy, size: r * rng.range(0.6, 0.95), rot, color, fill: false, stroke: true, strokeW: lineW }),
      );
      break;
    case 'insetSquare': {
      const nSq = 1 + Math.round(c.detail * 2);
      for (let i = 0; i < nSq; i++) {
        out.push(
          shapeItem({
            shape: 'rect',
            x: cx,
            y: cy,
            size: r * (0.85 - i * 0.25),
            rot,
            color,
            fill: false,
            stroke: true,
            strokeW: lineW,
          }),
        );
      }
      break;
    }
    case 'stripes': {
      const nBars = 3 + Math.round(c.detail * 4);
      const span = r * 1.7;
      for (let i = 0; i < nBars; i++) {
        const off = (i - (nBars - 1) / 2) * (span / nBars);
        out.push(
          shapeItem({
            shape: 'bar',
            x: cx + Math.cos(rot + Math.PI / 2) * off,
            y: cy + Math.sin(rot + Math.PI / 2) * off,
            size: span,
            rot,
            strokeW: Math.max(lineW, (span / nBars) * 0.45),
            color,
          }),
        );
      }
      break;
    }
    case 'htri':
      out.push(
        shapeItem({ shape: 'poly', x: cx, y: cy, size: r, rot, color, pts: [-1, -1, 1, -1, 1, 1] }),
      );
      break;
    case 'rect':
      out.push(shapeItem({ shape: 'rect', x: cx, y: cy, size: r * rng.range(0.5, 0.9), rot, color }));
      break;
    case 'dotfan': {
      // Fan of dot-arcs opening upward from the cell's bottom center (image 1).
      const fx = cx;
      const fy = cy + c.h / 2;
      const nArcs = 4 + Math.round(c.detail * 4);
      const spread = Math.PI * 0.62; // half-angle of the fan
      const maxR = Math.min(c.h * 0.96, c.w * 0.78);
      for (let a = 1; a <= nArcs; a++) {
        const rr = (a / nArcs) * maxR;
        const dot = Math.max((maxR / nArcs) * 0.32, rr * 0.045);
        const nDots = Math.max(3, Math.round((spread * 2 * rr) / (dot * 2.6)));
        for (let i = 0; i < nDots; i++) {
          const ang = -Math.PI / 2 - spread + (i / (nDots - 1)) * spread * 2;
          out.push(shapeItem({ shape: 'circle', x: fx + Math.cos(ang) * rr, y: fy + Math.sin(ang) * rr, size: dot, color }));
        }
      }
      break;
    }
    case 'cube':
      emitCube(cx, cy, r, 1, c.detail, color, out);
      break;
    case 'blank':
      break;
  }
}

/** Isometric cube (pointy-top hex): three rhombus faces with concentric inset
 *  outlines. `ky` squashes vertically so the lattice can close exactly. */
function emitCube(cx: number, cy: number, R: number, ky: number, detail: number, color: string, out: ShapeItem[]) {
  const v = (deg: number): [number, number] => [
    Math.cos((deg * Math.PI) / 180) * R,
    -Math.sin((deg * Math.PI) / 180) * R * ky,
  ];
  const C: [number, number] = [0, 0];
  const faces: [number, number][][] = [
    [C, v(150), v(90), v(30)], // top
    [C, v(150), v(210), v(270)], // left
    [C, v(30), v(330), v(270)], // right
  ];
  const nIn = 4 + Math.round(detail * 4);
  // Ring gap in face space ≈ (0.92/nIn) × centroid-to-edge distance (~R/2).
  // Stroke at ~40% of the gap keeps an even line/gap rhythm like the reference.
  const strokeW = ((R * 0.5 * 0.92) / nIn) * 0.4;
  for (const face of faces) {
    const fcx = face.reduce((s, p) => s + p[0], 0) / 4;
    const fcy = face.reduce((s, p) => s + p[1], 0) / 4;
    for (let i = 0; i < nIn; i++) {
      const t = 1 - (i / nIn) * 0.92;
      const pts: number[] = [];
      for (const p of face) pts.push((fcx + (p[0] - fcx) * t) / R, (fcy + (p[1] - fcy) * t) / R);
      out.push(shapeItem({ shape: 'poly', x: cx, y: cy, size: R, color, pts, fill: false, stroke: true, strokeW }));
    }
  }
}

/** Interlocking pointy-top hex lattice of cubes (Art-Deco "geo cubes"). */
function buildCubeLattice(layer: Layer, doc: TFDocument, cols: number, colorMode: number): ShapeItem[] {
  const p = layer.params;
  const detail = n(p.detail, 0.6);
  // Pointy-top hexes: width √3·R, horizontal pitch = width; rows at 1.5·R with
  // alternate rows shifted half a hex. Snap R so an even number of rows fits
  // exactly — that keeps the lattice (and seamless tiling) closed.
  const hexW = doc.width / cols;
  const R0 = hexW / Math.sqrt(3);
  const rows = Math.max(2, 2 * Math.round(doc.height / (3 * R0)));
  const vpitch = doc.height / rows;
  const ky = vpitch / (1.5 * R0); // slight vertical squash to close the lattice
  const items: ShapeItem[] = [];
  for (let row = -1; row <= rows; row++) {
    const shifted = ((row % 2) + 2) % 2 === 1;
    for (let col = shifted ? -1 : 0; col < cols; col++) {
      const seedRow = ((row % rows) + rows) % rows;
      const seedCol = ((col % cols) + cols) % cols;
      const rng = new Rng(`${layer.seed}/hex${seedCol}_${seedRow}`);
      const colorSlot = colorMode === 0 ? 1 : rng.int(1, 4);
      emitCube(
        (col + (shifted ? 1 : 0.5)) * hexW,
        row * vpitch,
        R0,
        ky,
        detail,
        slotColor(doc.palette, colorSlot),
        items,
      );
    }
  }
  return items;
}

export function buildTiles(layer: Layer, doc: TFDocument): ShapeItem[] {
  const p = layer.params;
  const setIdx = Math.max(0, Math.min(MOTIF_VOCAB.length - 1, Math.round(n(p.motifSet))));
  const vocab = MOTIF_VOCAB[setIdx];
  const staggered = Math.round(n(p.gridType)) === 1;
  const cols = Math.max(2, Math.round(n(p.columns, 6)));
  if (setIdx === 3) {
    // Deco cubes use their own interlocking hex lattice instead of the grid.
    return buildCubeLattice(layer, doc, cols, Math.round(n(p.colorMode, 0)));
  }
  const rotMode = Math.round(n(p.rotMode, 1));
  const colorMode = Math.round(n(p.colorMode, 1));
  const cellBg = Math.round(n(p.cellBg));
  const inset = n(p.inset, 0.04);
  const detail = n(p.detail, 0.6);
  const cellW = doc.width / cols;
  const rows = Math.max(1, Math.round(doc.height / cellW));
  const cellH = doc.height / rows;
  const lineW = Math.max(1.5, n(p.lineW, 0.07) * Math.min(cellW, cellH));
  const items: ShapeItem[] = [];

  for (let col = 0; col < cols; col++) {
    const shifted = staggered && col % 2 === 1;
    // Shifted columns need one extra cell above; its seed wraps to the last row
    // so seamless tiling stays consistent.
    for (let row = shifted ? -1 : 0; row < rows; row++) {
      const seedRow = ((row % rows) + rows) % rows;
      const rng = new Rng(`${layer.seed}/cell${col}_${seedRow}`);
      const motif = rng.pick(vocab);
      const rotSteps = rotMode === 0 ? 0 : rotMode === 2 ? rng.pick([0, 2]) : rng.int(0, 3);
      const cx = (col + 0.5) * cellW;
      const cy = (row + 0.5 + (shifted ? 0.5 : 0)) * cellH;

      // Cell background + motif colors.
      let bgSlot = -1; // -1 = transparent
      if (cellBg === 1) bgSlot = 0;
      else if (cellBg === 2) bgSlot = rng.chance(0.65) ? 0 : rng.int(1, 4);
      let colorSlot: number;
      if (colorMode === 0) colorSlot = 1;
      else {
        do {
          colorSlot = rng.int(colorMode === 2 ? 0 : 1, 4);
        } while (colorSlot === bgSlot && rng.chance(0.9));
      }
      const color = slotColor(doc.palette, colorSlot);
      if (bgSlot >= 0) {
        items.push(
          shapeItem({ shape: 'rect', x: cx, y: cy, size: cellH / 2 + 0.5, aspect: cellW / cellH, color: slotColor(doc.palette, bgSlot) }),
        );
      }

      const ctx: CellCtx = {
        cx,
        cy,
        w: cellW * (1 - inset * 2),
        h: cellH * (1 - inset * 2),
        r: (Math.min(cellW, cellH) / 2) * (1 - inset * 2),
        rot: (rotSteps * Math.PI) / 2,
        color,
        color2: slotColor(doc.palette, ((colorSlot % 4) + 1) as number),
        lineW,
        detail,
        rng: rng.fork('draw'),
        out: items,
      };
      emitMotif(motif, ctx);
      // Bauhaus-style secondary accent (small dot/ring on top of some motifs).
      if (setIdx === 1 && rng.chance(detail * 0.4) && motif !== 'blank' && motif !== 'dots') {
        items.push(
          shapeItem({ shape: 'circle', x: cx, y: cy, size: ctx.r * 0.16, color: ctx.color2 }),
        );
      }
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
