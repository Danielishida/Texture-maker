// Lock-aware randomization. Global randomize rerolls the document seed and
// regenerates every UNLOCKED layer/param; locked layers, locked params and
// locked palette swatches survive untouched. All rolls are deterministic
// functions of the seeds involved.

import { Rng, uid } from './prng';
import {
  BLEND_MODES,
  LAYER_DEFS,
  defaultParams,
  makeLayer,
  SCHEMA_VERSION,
  type Effect,
  type Layer,
  type LayerType,
  type ParamDef,
  type ParamValue,
  type TFDocument,
} from './types';
import { FILTERS, FILTER_MAP, type FilterDef } from './gl/filters';
import { generatePalette, rerollPalette } from './palette';

function rollParam(def: ParamDef, rng: Rng): ParamValue {
  switch (def.kind) {
    case 'number': {
      const lo = def.rmin ?? def.min;
      const hi = def.rmax ?? def.max;
      let v = rng.range(lo, hi);
      if (def.step) v = Math.round(v / def.step) * def.step;
      return v;
    }
    case 'select':
      return rng.pick(def.options).value;
    case 'slot':
      return def.allowMix && rng.chance(0.35) ? -1 : rng.int(0, 4);
    case 'text':
    case 'font':
      return def.def; // text content is authored, not rolled
  }
}

export function rollParams(
  defs: ParamDef[],
  rng: Rng,
  current: Record<string, ParamValue>,
  locks: Record<string, boolean>,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...current };
  for (const d of defs) {
    if (locks[d.key]) continue;
    out[d.key] = rollParam(d, rng);
  }
  // Keep scatter size ranges coherent.
  if (typeof out.minSize === 'number' && typeof out.maxSize === 'number' && out.minSize > out.maxSize) {
    [out.minSize, out.maxSize] = [out.maxSize, out.minSize];
  }
  return out;
}

function rollEffectParams(def: FilterDef, rng: Rng, current: Record<string, ParamValue>): Record<string, ParamValue> {
  return rollParams(def.params, rng, current, {});
}

export function makeEffect(filterType: string, rng: Rng): Effect {
  const def = FILTER_MAP[filterType];
  return {
    id: uid(rng),
    filterType,
    params: rollEffectParams(def, rng, defaultParams(def.params)),
    enabled: true,
    locked: false,
  };
}

/** Weighted pool for auto-added effects: subtle finishers are more likely. */
const EFFECT_POOL: [string, number][] = [
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

function pickWeighted(rng: Rng, pool: [string, number][]): string {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let t = rng.next() * total;
  for (const [type, w] of pool) {
    t -= w;
    if (t <= 0) return type;
  }
  return pool[0][0];
}

function rollLayerEffects(layer: Layer, rng: Rng, vectorSafe: boolean): Effect[] {
  if (vectorSafe) return layer.effects.filter((e) => e.locked);
  const kept = layer.effects.filter((e) => e.locked);
  const n = rng.chance(0.55) ? rng.int(1, 2) : 0;
  const added: Effect[] = [];
  for (let i = 0; i < n; i++) {
    const type = pickWeighted(rng, EFFECT_POOL);
    if (kept.some((e) => e.filterType === type) || added.some((e) => e.filterType === type)) continue;
    added.push(makeEffect(type, rng.fork(`fx${i}`)));
  }
  return [...kept, ...added];
}

export function randomizeLayer(layer: Layer, rng: Rng, vectorSafe: boolean): Layer {
  if (layer.locked) return layer;
  const def = LAYER_DEFS[layer.type];
  const next: Layer = { ...layer, seed: rng.fork('seed').seed.slice(-12) };
  next.params = rollParams(def.params, rng.fork('params'), layer.params, layer.paramLocks);
  if (!layer.paramLocks['__blend']) {
    const br = rng.fork('blend');
    next.blendMode = br.chance(0.35) ? br.pick(BLEND_MODES) : 'normal';
    next.opacity = br.chance(0.3) ? br.range(0.5, 1) : 1;
  }
  next.effects = rollLayerEffects(layer, rng.fork('fx'), vectorSafe).map((e) =>
    e.locked ? e : { ...e, params: rollEffectParams(FILTER_MAP[e.filterType], rng.fork('fxp' + e.id), e.params) },
  );
  return next;
}

export function randomizeDocument(doc: TFDocument, newSeed: string): TFDocument {
  const rng = new Rng(newSeed);
  const paletteLocked = doc.palette.locks.every(Boolean);
  const palette = paletteLocked ? doc.palette : rerollPalette(doc.palette, rng.fork('palette'));
  const vectorSafe = doc.colorMode === 'vector-safe';
  return {
    ...doc,
    seed: newSeed,
    palette,
    layers: doc.layers.map((l) => randomizeLayer(l, rng.fork('layer:' + l.id), vectorSafe)),
  };
}

/** Randomize a single effect's params in place (returns a new doc). */
export function randomizeEffect(doc: TFDocument, layerId: string, effectId: string, seed: string): TFDocument {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        effects: l.effects.map((e) =>
          e.id === effectId ? { ...e, params: rollEffectParams(FILTER_MAP[e.filterType], new Rng(seed), e.params) } : e,
        ),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Starter document: first launch should show a sellable image, not a blank page.
// ---------------------------------------------------------------------------

const STARTER_STACKS: LayerType[][] = [
  ['fill', 'scatter'],
  ['fill', 'noise', 'scatter'],
  ['fill', 'pattern', 'scatter'],
  ['fill', 'noise'],
  ['fill', 'scatter', 'scatter'],
  ['fill', 'noise', 'pattern'],
  ['fill', 'scatter', 'type'],
];

export function generateStarterDocument(seed: string, width = 4000, height = 3000): TFDocument {
  const rng = new Rng(seed);
  const stack = rng.pick(STARTER_STACKS);
  const doc: TFDocument = {
    version: SCHEMA_VERSION,
    id: uid(rng),
    name: 'Untitled',
    width,
    height,
    dpi: 300,
    colorMode: 'raster',
    tileable: false,
    seed,
    palette: generatePalette(rng.fork('palette')),
    layers: stack.map((type, i) => {
      const layer = makeLayer(type, uid(rng.fork('id' + i)), seed + ':' + i);
      if (type === 'fill' && i === 0) {
        layer.name = 'Background';
        layer.params.slotA = 0;
      }
      return layer;
    }),
  };
  return randomizeDocument(doc, seed);
}

export function addLayerToDoc(doc: TFDocument, type: LayerType, seed: string): TFDocument {
  const rng = new Rng(seed);
  let layer = makeLayer(type, uid(), seed);
  layer = randomizeLayer(layer, rng, doc.colorMode === 'vector-safe');
  return { ...doc, layers: [...doc.layers, layer] };
}

export const VALID_FILTERS = FILTERS.map((f) => f.type);
