// Style profiles: named genres that constrain randomization so every roll
// lands inside a coherent, sellable visual family. 'freeform' preserves the
// original anything-goes behavior. Each profile picks layer stacks, a palette
// mode, effect posture, and per-layer parameter tuning (which always respects
// param locks via the tune() helper).

import { Rng } from './prng';
import type { Layer, LayerType, ParamValue, TFDocument } from './types';
import type { PaletteMode } from './palette';

export interface StyleDef {
  id: string;
  label: string;
  stacks: LayerType[][];
  paletteMode: PaletteMode;
  /** Chance a layer gets randomized effects (uses pool below). */
  effectChance: number;
  /** Weighted effect pool; empty = never add effects. */
  effectPool: [string, number][];
  /** Chance a layer rolls a non-normal blend mode. */
  blendChance: number;
  /** Post-roll parameter tuning per layer (respect locks via set()). */
  tune?: (layer: Layer, rng: Rng, doc: TFDocument, set: (key: string, v: ParamValue) => void) => void;
}

const FREEFORM_POOL: [string, number][] = [
  ['grain', 3],
  ['vignette', 2],
  ['gaussianBlur', 1],
  ['displace', 3],
  ['wave', 2],
  ['twirl', 1],
  ['kaleidoscope', 1],
  ['polar', 1],
  ['posterize', 1],
  ['halftone', 1],
  ['chromatic', 1],
  ['glow', 1],
  ['duotone', 1],
  ['flow', 2],
  ['paper', 2],
  ['scanlines', 1],
  ['dither', 1],
];

const SUBTLE_POOL: [string, number][] = [
  ['grain', 3],
  ['paper', 1],
];

/** Deterministic per-document value shared across layers (e.g. one angle). */
function docShared(doc: TFDocument, label: string, fn: (r: Rng) => number): number {
  return fn(new Rng(`${doc.seed}/${label}`));
}

export const STYLES: StyleDef[] = [
  {
    id: 'freeform',
    label: 'Freeform (anything goes)',
    stacks: [
      ['fill', 'scatter'],
      ['fill', 'noise', 'scatter'],
      ['fill', 'pattern', 'scatter'],
      ['fill', 'noise'],
      ['fill', 'scatter', 'scatter'],
      ['fill', 'noise', 'pattern'],
      ['fill', 'scatter', 'type'],
      ['fill', 'tiles'],
    ],
    paletteMode: 'any',
    effectChance: 0.55,
    effectPool: FREEFORM_POOL,
    blendChance: 0.35,
  },
  {
    id: 'quilt',
    label: 'Mid-century Quilt',
    stacks: [['fill', 'tiles']],
    paletteMode: 'retroWarm',
    effectChance: 0.12,
    effectPool: SUBTLE_POOL,
    blendChance: 0,
    tune(layer, rng, _doc, set) {
      if (layer.type === 'fill') {
        set('fillType', 0);
        set('slotA', 0);
      } else if (layer.type === 'tiles') {
        set('motifSet', 0); // quarter quilt
        set('gridType', 0);
        set('columns', rng.int(4, 9));
        set('rotMode', 1);
        set('colorMode', 1);
        set('cellBg', rng.chance(0.5) ? 2 : 0);
        set('inset', 0);
        set('detail', rng.range(0.3, 0.8));
      }
    },
  },
  {
    id: 'bauhaus',
    label: 'Bauhaus Collage',
    stacks: [['fill', 'tiles']],
    paletteMode: 'retroWarm',
    effectChance: 0.15,
    effectPool: SUBTLE_POOL,
    blendChance: 0,
    tune(layer, rng, _doc, set) {
      if (layer.type === 'fill') {
        set('fillType', 0);
        set('slotA', 0);
      } else if (layer.type === 'tiles') {
        set('motifSet', 1); // bauhaus mix
        set('gridType', 0);
        set('columns', rng.int(3, 7));
        set('rotMode', 1);
        set('colorMode', 2);
        set('cellBg', 2);
        set('inset', rng.range(0, 0.05));
        set('lineW', rng.range(0.03, 0.07));
        set('detail', rng.range(0.5, 1));
      }
    },
  },
  {
    id: 'decoFans',
    label: 'Art Deco Fans',
    stacks: [['fill', 'tiles']],
    paletteMode: 'duo',
    effectChance: 0.1,
    effectPool: SUBTLE_POOL,
    blendChance: 0,
    tune(layer, rng, _doc, set) {
      if (layer.type === 'fill') {
        set('fillType', 0);
        set('slotA', 0);
      } else if (layer.type === 'tiles') {
        set('motifSet', 2); // dot fans
        set('gridType', 1); // staggered
        set('columns', rng.int(4, 8));
        set('rotMode', 0);
        set('colorMode', 0);
        set('cellBg', 0);
        set('inset', 0);
        set('detail', rng.range(0.5, 1));
      }
    },
  },
  {
    id: 'geoCubes',
    label: 'Geo Cubes',
    stacks: [['fill', 'tiles']],
    paletteMode: 'duo',
    effectChance: 0.1,
    effectPool: SUBTLE_POOL,
    blendChance: 0,
    tune(layer, rng, _doc, set) {
      if (layer.type === 'fill') {
        set('fillType', 0);
        set('slotA', 0);
      } else if (layer.type === 'tiles') {
        set('motifSet', 3); // deco cubes
        set('gridType', 1);
        set('columns', rng.int(3, 6));
        set('rotMode', 0);
        set('colorMode', 0);
        set('cellBg', 0);
        set('inset', rng.range(0, 0.04));
        set('lineW', rng.range(0.05, 0.1));
        set('detail', rng.range(0.6, 1));
      }
    },
  },
  {
    id: 'angular',
    label: 'Angular Planes',
    stacks: [
      ['fill', 'scatter', 'scatter'],
      ['fill', 'pattern', 'scatter', 'scatter'],
    ],
    paletteMode: 'tonal',
    effectChance: 0.5,
    effectPool: SUBTLE_POOL,
    blendChance: 0,
    tune(layer, rng, doc, set) {
      const angle = docShared(doc, 'planes-angle', (r) => (r.chance(0.5) ? r.range(25, 55) : r.range(125, 155)));
      if (layer.type === 'fill') {
        set('fillType', rng.chance(0.5) ? 0 : 1);
        set('slotA', 0);
        set('slotB', 1);
        set('useC', 0);
        set('angle', angle + 90);
      } else if (layer.type === 'scatter') {
        set('shape', 2); // rect
        set('placement', 0);
        set('count', rng.int(5, 14));
        set('minSize', rng.range(0.06, 0.12));
        set('maxSize', rng.range(0.18, 0.4));
        set('baseRot', angle);
        set('aspect', rng.range(5, 14));
        set('rotJitter', 0);
        set('jitter', 1);
        set('fillMode', 0);
        // Mix in bright base-color planes so compositions keep negative space.
        set('colorSlot', rng.chance(0.4) ? 0 : -1);
        set('alpha', rng.range(0.6, 0.95));
      } else if (layer.type === 'pattern') {
        set('patType', 0); // stripes
        set('angle', angle);
        set('spacing', rng.range(0.04, 0.12));
        set('thickness', rng.range(0.2, 0.6));
        set('colorSlot', rng.int(1, 3));
      }
    },
  },
];

export const STYLE_MAP: Record<string, StyleDef> = Object.fromEntries(STYLES.map((s) => [s.id, s]));

export function getStyle(id: string | undefined): StyleDef {
  return STYLE_MAP[id ?? 'freeform'] ?? STYLE_MAP.freeform;
}
