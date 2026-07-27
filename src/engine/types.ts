// Document model: a versioned JSON tree. Layers/effects describe params
// declaratively via ParamDef schemas so randomize/lock/UI are all generic.

export const SCHEMA_VERSION = 1;

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
];

export type ParamValue = number | string;

export type ParamDef =
  | {
      key: string;
      label: string;
      kind: 'number';
      min: number;
      max: number;
      step?: number;
      def: number;
      /** Optional narrower range used when randomizing (keeps rolls sane). */
      rmin?: number;
      rmax?: number;
    }
  | { key: string; label: string; kind: 'select'; options: { value: number; label: string }[]; def: number }
  /** Palette slot index 0..4; -1 means "mix" (a random slot per element). */
  | { key: string; label: string; kind: 'slot'; def: number; allowMix?: boolean }
  | { key: string; label: string; kind: 'text'; def: string }
  | { key: string; label: string; kind: 'font'; def: string };

export interface Effect {
  id: string;
  filterType: string;
  params: Record<string, ParamValue>;
  enabled: boolean;
  locked: boolean;
}

export type LayerType = 'fill' | 'scatter' | 'noise' | 'pattern' | 'type' | 'tiles';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  seed: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  params: Record<string, ParamValue>;
  paramLocks: Record<string, boolean>;
  effects: Effect[];
}

export interface Palette {
  name: string;
  colors: string[]; // 5 hex strings; slot 0 is conventionally the background
  locks: boolean[];
}

export interface TFDocument {
  version: number;
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  colorMode: 'raster' | 'vector-safe';
  tileable: boolean;
  seed: string;
  /** Style profile id steering randomization (default 'freeform'). */
  style?: string;
  palette: Palette;
  layers: Layer[]; // index 0 = bottom
}

// ---------------------------------------------------------------------------
// Layer definitions (param schemas)
// ---------------------------------------------------------------------------

export interface LayerDef {
  type: LayerType;
  name: string;
  vectorSafe: boolean;
  params: ParamDef[];
}

export const FILL_TYPES = { solid: 0, linear: 1, radial: 2, conic: 3, blobs: 4 } as const;
export const SHAPES = ['circle', 'ring', 'rect', 'triangle', 'blob', 'line', 'arc'] as const;
export const PLACEMENTS = ['uniform', 'grid', 'ring', 'flow', 'subdiv'] as const;
export const PATTERNS = ['stripes', 'checker', 'dots', 'herringbone', 'waves', 'rings'] as const;
export const TYPE_LAYOUTS = ['single', 'scatter', 'grid', 'ring', 'wave'] as const;
export const NOISE_TYPES = ['fbm', 'billow', 'ridged', 'worley'] as const;
export const MOTIF_SETS = ['quarter quilt', 'bauhaus mix', 'dot fans', 'deco cubes', 'arcs & rings', 'geo mix'] as const;
export const TILE_GRIDS = ['square', 'staggered'] as const;
export const TILE_ROT_MODES = ['fixed', 'quarter', 'half'] as const;
export const TILE_COLOR_MODES = ['duo', 'multi', 'collage'] as const;
export const TILE_BG_MODES = ['none', 'solid', 'mixed'] as const;

const opts = (labels: readonly string[]) => labels.map((label, value) => ({ value, label }));

export const LAYER_DEFS: Record<LayerType, LayerDef> = {
  fill: {
    type: 'fill',
    name: 'Fill / Gradient',
    vectorSafe: true,
    params: [
      { key: 'fillType', label: 'Type', kind: 'select', options: opts(['solid', 'linear', 'radial', 'conic', 'blobs']), def: 1 },
      { key: 'slotA', label: 'Color A', kind: 'slot', def: 0 },
      { key: 'slotB', label: 'Color B', kind: 'slot', def: 1 },
      { key: 'useC', label: 'Third stop', kind: 'select', options: opts(['off', 'on']), def: 0 },
      { key: 'slotC', label: 'Color C', kind: 'slot', def: 2 },
      { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 360, def: 45 },
      { key: 'blobCount', label: 'Blob count', kind: 'number', min: 2, max: 10, step: 1, def: 5 },
    ],
  },
  scatter: {
    type: 'scatter',
    name: 'Shape Scatter',
    vectorSafe: true,
    params: [
      { key: 'shape', label: 'Shape', kind: 'select', options: opts(SHAPES), def: 0 },
      { key: 'placement', label: 'Placement', kind: 'select', options: opts(PLACEMENTS), def: 0 },
      { key: 'count', label: 'Count', kind: 'number', min: 1, max: 500, step: 1, def: 40, rmin: 6, rmax: 220 },
      { key: 'minSize', label: 'Min size', kind: 'number', min: 0.002, max: 0.5, def: 0.02, rmax: 0.12 },
      { key: 'maxSize', label: 'Max size', kind: 'number', min: 0.004, max: 0.9, def: 0.12, rmin: 0.04, rmax: 0.45 },
      { key: 'baseRot', label: 'Base angle', kind: 'number', min: 0, max: 360, def: 0, rmin: 0, rmax: 0 },
      { key: 'aspect', label: 'Elongation', kind: 'number', min: 1, max: 16, def: 1, rmin: 1, rmax: 1 },
      { key: 'rotJitter', label: 'Rotation', kind: 'number', min: 0, max: 180, def: 0 },
      { key: 'jitter', label: 'Jitter', kind: 'number', min: 0, max: 1, def: 0.5 },
      { key: 'fillMode', label: 'Fill', kind: 'select', options: opts(['fill', 'stroke', 'both']), def: 0 },
      { key: 'strokeW', label: 'Stroke width', kind: 'number', min: 0.001, max: 0.05, def: 0.006 },
      { key: 'colorSlot', label: 'Color', kind: 'slot', def: -1, allowMix: true },
      { key: 'alpha', label: 'Shape alpha', kind: 'number', min: 0.05, max: 1, def: 1, rmin: 0.4 },
    ],
  },
  noise: {
    type: 'noise',
    name: 'Noise Field',
    vectorSafe: false,
    params: [
      { key: 'noiseType', label: 'Noise', kind: 'select', options: opts(NOISE_TYPES), def: 0 },
      { key: 'frequency', label: 'Frequency', kind: 'number', min: 1, max: 40, def: 4, rmax: 16 },
      { key: 'octaves', label: 'Octaves', kind: 'number', min: 1, max: 6, step: 1, def: 4 },
      { key: 'contrast', label: 'Contrast', kind: 'number', min: 0.2, max: 3, def: 1 },
      { key: 'mapMode', label: 'Mapping', kind: 'select', options: opts(['grayscale', 'duotone', 'palette']), def: 2 },
      { key: 'slotA', label: 'Duotone A', kind: 'slot', def: 0 },
      { key: 'slotB', label: 'Duotone B', kind: 'slot', def: 3 },
      { key: 'warp', label: 'Warp', kind: 'number', min: 0, max: 2, def: 0, rmax: 1.2 },
    ],
  },
  pattern: {
    type: 'pattern',
    name: 'Pattern',
    vectorSafe: true,
    params: [
      { key: 'patType', label: 'Pattern', kind: 'select', options: opts(PATTERNS), def: 0 },
      { key: 'spacing', label: 'Spacing', kind: 'number', min: 0.01, max: 0.3, def: 0.06 },
      { key: 'thickness', label: 'Thickness', kind: 'number', min: 0.05, max: 0.95, def: 0.5 },
      { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 360, def: 0 },
      { key: 'phase', label: 'Phase', kind: 'number', min: 0, max: 1, def: 0 },
      { key: 'waveAmp', label: 'Wave amount', kind: 'number', min: 0, max: 1, def: 0.3 },
      { key: 'colorSlot', label: 'Color', kind: 'slot', def: 2, allowMix: true },
    ],
  },
  tiles: {
    type: 'tiles',
    name: 'Tile Grid',
    vectorSafe: true,
    params: [
      { key: 'motifSet', label: 'Motifs', kind: 'select', options: opts(MOTIF_SETS), def: 0 },
      { key: 'gridType', label: 'Grid', kind: 'select', options: opts(TILE_GRIDS), def: 0 },
      { key: 'columns', label: 'Columns', kind: 'number', min: 2, max: 24, step: 1, def: 6, rmin: 3, rmax: 10 },
      { key: 'rotMode', label: 'Rotation', kind: 'select', options: opts(TILE_ROT_MODES), def: 1 },
      { key: 'colorMode', label: 'Coloring', kind: 'select', options: opts(TILE_COLOR_MODES), def: 1 },
      { key: 'cellBg', label: 'Cell background', kind: 'select', options: opts(TILE_BG_MODES), def: 0 },
      { key: 'inset', label: 'Cell inset', kind: 'number', min: 0, max: 0.25, def: 0.04, rmax: 0.1 },
      { key: 'lineW', label: 'Line weight', kind: 'number', min: 0.02, max: 0.2, def: 0.07 },
      { key: 'detail', label: 'Detail', kind: 'number', min: 0, max: 1, def: 0.6 },
    ],
  },
  type: {
    type: 'type',
    name: 'Type',
    vectorSafe: true,
    params: [
      { key: 'text', label: 'Text', kind: 'text', def: 'A' },
      { key: 'font', label: 'Font', kind: 'font', def: 'Georgia' },
      { key: 'weight', label: 'Weight', kind: 'select', options: opts(['regular', 'bold', 'black']), def: 1 },
      { key: 'layout', label: 'Layout', kind: 'select', options: opts(TYPE_LAYOUTS), def: 0 },
      { key: 'count', label: 'Count', kind: 'number', min: 1, max: 80, step: 1, def: 1, rmax: 40 },
      { key: 'size', label: 'Size', kind: 'number', min: 0.03, max: 1.2, def: 0.5 },
      { key: 'rotJitter', label: 'Rotation', kind: 'number', min: 0, max: 180, def: 0 },
      { key: 'fillMode', label: 'Fill', kind: 'select', options: opts(['fill', 'stroke']), def: 0 },
      { key: 'strokeW', label: 'Stroke width', kind: 'number', min: 0.001, max: 0.03, def: 0.004 },
      { key: 'colorSlot', label: 'Color', kind: 'slot', def: 4, allowMix: true },
      { key: 'alpha', label: 'Alpha', kind: 'number', min: 0.05, max: 1, def: 1, rmin: 0.5 },
    ],
  },
};

export function defaultParams(defs: ParamDef[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const d of defs) out[d.key] = d.def;
  return out;
}

export function makeLayer(type: LayerType, id: string, seed: string): Layer {
  const def = LAYER_DEFS[type];
  return {
    id,
    type,
    name: def.name,
    seed,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    params: defaultParams(def.params),
    paramLocks: {},
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export function migrateDocument(raw: unknown): TFDocument {
  const doc = raw as TFDocument;
  if (!doc || typeof doc !== 'object' || typeof doc.version !== 'number') {
    throw new Error('Not a Texture Forge document');
  }
  if (doc.version > SCHEMA_VERSION) {
    throw new Error(`Document version ${doc.version} is newer than this app (v${SCHEMA_VERSION})`);
  }
  // Future migrations chain here: if (doc.version === 1) { ...upgrade...; doc.version = 2; }
  return doc;
}

export const DOC_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'Square 4000×4000', w: 4000, h: 4000 },
  { label: 'Classic 3:2 — 6000×4000', w: 6000, h: 4000 },
  { label: '4:3 — 4800×3600', w: 4800, h: 3600 },
  { label: '16:9 — 5120×2880 (5K)', w: 5120, h: 2880 },
  { label: '4K UHD — 3840×2160', w: 3840, h: 2160 },
  { label: 'Poster A — 3508×4961 (A3 300dpi)', w: 3508, h: 4961 },
  { label: 'Social 1080×1080', w: 1080, h: 1080 },
];
