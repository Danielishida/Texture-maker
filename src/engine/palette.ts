// Color harmony engine. Palettes are generated in OKLCH so randomized colors
// stay perceptually balanced, then gamut-mapped to sRGB hex.

import { Rng } from './prng';
import type { Palette } from './types';

// --- OKLCH -> sRGB ---------------------------------------------------------

function gamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklchToRgb(L: number, C: number, H: number): [number, number, number] | null {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const eps = 1e-4;
  if (r < -eps || r > 1 + eps || g < -eps || g > 1 + eps || bb < -eps || bb > 1 + eps) return null;
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(gamma(Math.max(0, Math.min(1, v))) * 255)));
  return [to255(r), to255(g), to255(bb)];
}

/** Gamut-map by walking chroma down until the color fits in sRGB. */
export function oklchToHex(L: number, C: number, H: number): string {
  let c = C;
  let rgb = oklchToRgb(L, c, H);
  let guard = 0;
  while (!rgb && guard++ < 40) {
    c *= 0.88;
    rgb = oklchToRgb(L, c, H);
  }
  if (!rgb) rgb = oklchToRgb(L, 0, H) ?? [128, 128, 128];
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// --- Harmony rules ----------------------------------------------------------

export const HARMONY_RULES = ['monochrome', 'analogous', 'complementary', 'split', 'triadic'] as const;
export type HarmonyRule = (typeof HARMONY_RULES)[number];

export const MOODS = ['balanced', 'dark moody', 'pastel', 'neon', 'earth'] as const;
export type Mood = (typeof MOODS)[number];

const HUE_OFFSETS: Record<HarmonyRule, number[]> = {
  monochrome: [0, 0, 0, 0, 0],
  analogous: [0, 28, -28, 55, -55],
  complementary: [0, 180, 12, 192, -12],
  split: [0, 150, 210, 15, -15],
  triadic: [0, 120, 240, 15, 135],
};

interface MoodSpec {
  bgL: [number, number]; // background slot lightness range (may pick dark or light end)
  L: [number, number];
  C: [number, number];
  hue?: [number, number];
}

const MOOD_SPECS: Record<Mood, MoodSpec> = {
  balanced: { bgL: [0.12, 0.97], L: [0.35, 0.85], C: [0.06, 0.2] },
  'dark moody': { bgL: [0.1, 0.25], L: [0.3, 0.65], C: [0.05, 0.16] },
  pastel: { bgL: [0.9, 0.97], L: [0.75, 0.92], C: [0.03, 0.09] },
  neon: { bgL: [0.08, 0.18], L: [0.6, 0.8], C: [0.2, 0.32] },
  earth: { bgL: [0.15, 0.95], L: [0.35, 0.75], C: [0.04, 0.12], hue: [20, 130] },
};

export function generatePalette(rng: Rng, rule?: HarmonyRule, mood?: Mood): Palette {
  const r = rule ?? rng.pick(HARMONY_RULES);
  const m = mood ?? rng.pick(MOODS);
  const spec = MOOD_SPECS[m];
  const baseHue = spec.hue ? rng.range(spec.hue[0], spec.hue[1]) : rng.range(0, 360);
  const offsets = HUE_OFFSETS[r];
  const colors: string[] = [];
  for (let i = 0; i < 5; i++) {
    const hue = (baseHue + offsets[i] + rng.range(-6, 6) + 360) % 360;
    if (i === 0) {
      // Background slot: pick a light or dark extreme within the mood.
      const dark = spec.bgL[1] < 0.5 || (spec.bgL[0] < 0.3 && rng.chance(0.5));
      const L = dark ? rng.range(spec.bgL[0], Math.min(spec.bgL[1], 0.3)) : rng.range(Math.max(spec.bgL[0], 0.85), spec.bgL[1]);
      colors.push(oklchToHex(L, rng.range(0.01, Math.min(spec.C[1], 0.06)), hue));
    } else {
      // Spread lightness across the remaining slots so they read distinctly.
      const t = (i - 1) / 3;
      const L = spec.L[0] + (spec.L[1] - spec.L[0]) * (t * 0.8 + rng.range(0, 0.2));
      colors.push(oklchToHex(L, rng.range(spec.C[0], spec.C[1]), hue));
    }
  }
  return { name: `${m} ${r}`, colors, locks: [false, false, false, false, false] };
}

/** Reroll only unlocked swatches, keeping locked ones. */
export function rerollPalette(pal: Palette, rng: Rng, rule?: HarmonyRule, mood?: Mood): Palette {
  const fresh = generatePalette(rng, rule, mood);
  return {
    name: fresh.name,
    colors: pal.colors.map((c, i) => (pal.locks[i] ? c : fresh.colors[i])),
    locks: [...pal.locks],
  };
}

// --- Curated trend palettes --------------------------------------------------

export const CURATED_PALETTES: Palette[] = [
  ['Midnight pop', '#0f172a', '#38bdf8', '#818cf8', '#f472b6', '#facc15'],
  ['Terracotta', '#f6efe7', '#c96f4a', '#8a4f38', '#e0a370', '#4a3b34'],
  ['Forest fog', '#e8ede9', '#2f4538', '#5d7d63', '#a3b8a4', '#d9b26a'],
  ['Riso red-blue', '#f5f1e8', '#ff4f30', '#2544c4', '#ffb3a0', '#101820'],
  ['Bauhaus', '#f2e9d8', '#d02e2e', '#1a53a1', '#e8b722', '#191919'],
  ['Lavender dusk', '#241b3a', '#7c5cbf', '#b79ced', '#f2a9c4', '#ffd9a0'],
  ['Ocean glass', '#0a2e36', '#14747e', '#4ecdc4', '#b8e1dd', '#f9f7f0'],
  ['Citrus', '#fff8e7', '#ff8c42', '#ffd23f', '#3bceac', '#0ead69'],
  ['Ink & paper', '#f7f4ed', '#1c1c1c', '#55534e', '#a6a29a', '#c8442d'],
  ['Neon night', '#0d0221', '#ff2079', '#04f5ff', '#ffe74c', '#7b2ff7'],
  ['Sandstone', '#efe6d5', '#c9a227', '#a15c38', '#5f6f52', '#2d2a26'],
  ['Nordic', '#eceff4', '#2e3440', '#5e81ac', '#88c0d0', '#bf616a'],
  ['Rosewood', '#2b1a1f', '#8c2f39', '#c05d63', '#e8b4bc', '#f3e6e8'],
  ['Meadow', '#f4f9e9', '#54b06e', '#2c6e49', '#ffc857', '#4b3f72'],
  ['Slate & coral', '#20303c', '#3b5563', '#8fa6b3', '#ff6b6b', '#ffe8d6'],
  ['Golden hour', '#2a1e33', '#77419d', '#e86a58', '#f4a259', '#f7d488'],
  ['Mint chocolate', '#20261e', '#4a5a40', '#9fd8ab', '#e2f1e4', '#7a4419'],
  ['Ultraviolet', '#10002b', '#5a189a', '#9d4edd', '#c77dff', '#e0aaff'],
  ['Harvest', '#fdf6ec', '#e07a1f', '#9c3812', '#606c38', '#283618'],
  ['Arctic candy', '#f0f7ff', '#7fc8f8', '#3a86ff', '#ff70a6', '#ffd670'],
].map(([name, ...colors]) => ({ name, colors, locks: [false, false, false, false, false] }));

export function slotColor(pal: Palette, slot: number, fallback = 1): string {
  const i = slot >= 0 && slot < pal.colors.length ? slot : fallback;
  return pal.colors[i] ?? '#888888';
}
