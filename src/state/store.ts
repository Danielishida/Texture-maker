// App state: current document, undo/redo history, selection, variations,
// and autosave. Every mutation goes through commit() so history stays honest.

import { create } from 'zustand';
import { randomSeed, Rng, uid } from '../engine/prng';
import {
  makeLayer,
  migrateDocument,
  type Effect,
  type Layer,
  type LayerType,
  type ParamValue,
  type TFDocument,
} from '../engine/types';
import {
  addLayerToDoc,
  generateStarterDocument,
  makeEffect,
  randomizeDocument,
  randomizeEffect,
  randomizeLayer,
} from '../engine/randomize';
import { CURATED_PALETTES, generatePalette, rerollPalette, rerollPaletteForMode, type HarmonyRule, type Mood } from '../engine/palette';
import { getStyle } from '../engine/styles';
import { idbGet, idbPut } from './persist';

const HISTORY_LIMIT = 80;
const AUTOSAVE_KEY = 'autosave';

export interface TFState {
  doc: TFDocument;
  past: TFDocument[];
  future: TFDocument[];
  selectedLayerId: string | null;
  variationSeeds: string[];
  starredSeeds: string[];
  showVariations: boolean;
  tilePreview: boolean;
  ready: boolean;

  init(): Promise<void>;
  commit(next: TFDocument): void;
  replace(next: TFDocument): void;
  undo(): void;
  redo(): void;

  randomizeAll(): void;
  setStyle(styleId: string): void;
  randomizeLayerById(id: string): void;
  randomizeEffectById(layerId: string, effectId: string): void;
  setSeed(seed: string): void;
  newRandomDocument(): void;

  selectLayer(id: string | null): void;
  addLayer(type: LayerType): void;
  removeLayer(id: string): void;
  duplicateLayer(id: string): void;
  moveLayer(id: string, dir: 1 | -1): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  setParam(id: string, key: string, value: ParamValue): void;
  toggleParamLock(id: string, key: string): void;

  addEffect(layerId: string, filterType: string): void;
  updateEffect(layerId: string, effectId: string, patch: Partial<Effect>): void;
  setEffectParam(layerId: string, effectId: string, key: string, value: number): void;
  removeEffect(layerId: string, effectId: string): void;
  moveEffect(layerId: string, effectId: string, dir: 1 | -1): void;

  rerollPaletteAction(rule?: HarmonyRule, mood?: Mood): void;
  setSwatch(i: number, hex: string): void;
  toggleSwatchLock(i: number): void;
  applyCuratedPalette(index: number): void;

  setDocMeta(patch: Partial<Pick<TFDocument, 'name' | 'width' | 'height' | 'tileable' | 'colorMode'>>): void;

  rollVariations(): void;
  applyVariation(seed: string): void;
  toggleStar(seed: string): void;
  setShowVariations(v: boolean): void;
  setTilePreview(v: boolean): void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(doc: TFDocument) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    idbPut(AUTOSAVE_KEY, doc).catch(() => undefined);
  }, 800);
}

function mutLayer(doc: TFDocument, id: string, fn: (l: Layer) => Layer): TFDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

export const useStore = create<TFState>((set, get) => {
  const commit = (next: TFDocument) => {
    const { doc, past } = get();
    set({ doc: next, past: [...past.slice(-HISTORY_LIMIT), doc], future: [] });
    scheduleAutosave(next);
  };

  return {
    doc: generateStarterDocument('forge'),
    past: [],
    future: [],
    selectedLayerId: null,
    variationSeeds: [],
    starredSeeds: [],
    showVariations: false,
    tilePreview: false,
    ready: false,

    async init() {
      try {
        const saved = await idbGet<TFDocument>(AUTOSAVE_KEY);
        if (saved) {
          const doc = migrateDocument(saved);
          set({ doc, ready: true, selectedLayerId: doc.layers[doc.layers.length - 1]?.id ?? null });
          return;
        }
      } catch {
        // corrupted autosave — fall through to a fresh start
      }
      const doc = generateStarterDocument(randomSeed());
      set({ doc, ready: true, selectedLayerId: doc.layers[doc.layers.length - 1]?.id ?? null });
    },

    commit,
    replace(next) {
      set({ doc: next });
      scheduleAutosave(next);
    },

    undo() {
      const { past, doc, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future] });
      scheduleAutosave(prev);
    },
    redo() {
      const { past, doc, future } = get();
      if (!future.length) return;
      const next = future[0];
      set({ doc: next, past: [...past, doc], future: future.slice(1) });
      scheduleAutosave(next);
    },

    randomizeAll() {
      commit(randomizeDocument(get().doc, randomSeed()));
    },
    randomizeLayerById(id) {
      const { doc } = get();
      const seed = randomSeed();
      commit(mutLayer(doc, id, (l) => randomizeLayer(doc, l, new Rng(seed))));
    },
    randomizeEffectById(layerId, effectId) {
      commit(randomizeEffect(get().doc, layerId, effectId, randomSeed()));
    },
    setSeed(seed) {
      if (!seed.trim()) return;
      commit(randomizeDocument(get().doc, seed.trim()));
    },
    newRandomDocument() {
      const { doc } = get();
      const next = generateStarterDocument(randomSeed(), doc.width, doc.height, doc.style ?? 'freeform');
      next.name = doc.name;
      commit(next);
      set({ selectedLayerId: next.layers[next.layers.length - 1]?.id ?? null });
    },
    setStyle(styleId: string) {
      const { doc } = get();
      if ((doc.style ?? 'freeform') === styleId) return;
      const next = generateStarterDocument(randomSeed(), doc.width, doc.height, styleId);
      next.name = doc.name;
      commit(next);
      set({ selectedLayerId: next.layers[next.layers.length - 1]?.id ?? null });
    },

    selectLayer(id) {
      set({ selectedLayerId: id });
    },
    addLayer(type) {
      const next = addLayerToDoc(get().doc, type, randomSeed());
      commit(next);
      set({ selectedLayerId: next.layers[next.layers.length - 1].id });
    },
    removeLayer(id) {
      const { doc, selectedLayerId } = get();
      commit({ ...doc, layers: doc.layers.filter((l) => l.id !== id) });
      if (selectedLayerId === id) set({ selectedLayerId: null });
    },
    duplicateLayer(id) {
      const { doc } = get();
      const i = doc.layers.findIndex((l) => l.id === id);
      if (i < 0) return;
      const copy: Layer = JSON.parse(JSON.stringify(doc.layers[i]));
      copy.id = uid();
      copy.name += ' copy';
      copy.seed = randomSeed();
      const layers = [...doc.layers];
      layers.splice(i + 1, 0, copy);
      commit({ ...doc, layers });
      set({ selectedLayerId: copy.id });
    },
    moveLayer(id, dir) {
      const { doc } = get();
      const i = doc.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= doc.layers.length) return;
      const layers = [...doc.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      commit({ ...doc, layers });
    },
    updateLayer(id, patch) {
      commit(mutLayer(get().doc, id, (l) => ({ ...l, ...patch })));
    },
    setParam(id, key, value) {
      commit(mutLayer(get().doc, id, (l) => ({ ...l, params: { ...l.params, [key]: value } })));
    },
    toggleParamLock(id, key) {
      commit(
        mutLayer(get().doc, id, (l) => ({
          ...l,
          paramLocks: { ...l.paramLocks, [key]: !l.paramLocks[key] },
        })),
      );
    },

    addEffect(layerId, filterType) {
      commit(
        mutLayer(get().doc, layerId, (l) => ({
          ...l,
          effects: [...l.effects, makeEffect(filterType, new Rng(randomSeed()))],
        })),
      );
    },
    updateEffect(layerId, effectId, patch) {
      commit(
        mutLayer(get().doc, layerId, (l) => ({
          ...l,
          effects: l.effects.map((e) => (e.id === effectId ? { ...e, ...patch } : e)),
        })),
      );
    },
    setEffectParam(layerId, effectId, key, value) {
      commit(
        mutLayer(get().doc, layerId, (l) => ({
          ...l,
          effects: l.effects.map((e) => (e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e)),
        })),
      );
    },
    removeEffect(layerId, effectId) {
      commit(
        mutLayer(get().doc, layerId, (l) => ({ ...l, effects: l.effects.filter((e) => e.id !== effectId) })),
      );
    },
    moveEffect(layerId, effectId, dir) {
      commit(
        mutLayer(get().doc, layerId, (l) => {
          const i = l.effects.findIndex((e) => e.id === effectId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= l.effects.length) return l;
          const effects = [...l.effects];
          [effects[i], effects[j]] = [effects[j], effects[i]];
          return { ...l, effects };
        }),
      );
    },

    rerollPaletteAction(rule, mood) {
      const { doc } = get();
      const mode = getStyle(doc.style).paletteMode;
      // Explicit harmony/mood picks override the style's palette mode.
      const palette =
        !rule && !mood && mode !== 'any'
          ? rerollPaletteForMode(doc.palette, new Rng(randomSeed()), mode)
          : rerollPalette(doc.palette, new Rng(randomSeed()), rule, mood);
      commit({ ...doc, palette });
    },
    setSwatch(i, hex) {
      const { doc } = get();
      const colors = [...doc.palette.colors];
      colors[i] = hex;
      commit({ ...doc, palette: { ...doc.palette, colors } });
    },
    toggleSwatchLock(i) {
      const { doc } = get();
      const locks = [...doc.palette.locks];
      locks[i] = !locks[i];
      commit({ ...doc, palette: { ...doc.palette, locks } });
    },
    applyCuratedPalette(index) {
      const { doc } = get();
      const pal = CURATED_PALETTES[index % CURATED_PALETTES.length];
      commit({ ...doc, palette: { ...pal, locks: [...doc.palette.locks] } });
    },

    setDocMeta(patch) {
      commit({ ...get().doc, ...patch });
    },

    rollVariations() {
      const seeds = Array.from({ length: 12 }, () => randomSeed());
      set({ variationSeeds: seeds, showVariations: true });
    },
    applyVariation(seed) {
      commit(randomizeDocument(get().doc, seed));
    },
    toggleStar(seed) {
      const { starredSeeds } = get();
      set({
        starredSeeds: starredSeeds.includes(seed)
          ? starredSeeds.filter((s) => s !== seed)
          : [...starredSeeds, seed],
      });
    },
    setShowVariations(v) {
      set({ showVariations: v });
    },
    setTilePreview(v) {
      set({ tilePreview: v });
    },
  };
});

export function freshPalette(seed: string) {
  return generatePalette(new Rng(seed));
}

export { makeLayer };
