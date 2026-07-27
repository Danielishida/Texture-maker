// Deterministic PRNG utilities. render(document) must be a pure function of the
// document JSON, so every random draw flows through seeds via these helpers.

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private fn: () => number;
  constructor(public readonly seed: string) {
    this.fn = mulberry32(xmur3(seed)());
  }
  next(): number {
    return this.fn();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.fn();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.fn() * arr.length)];
  }
  chance(p: number): boolean {
    return this.fn() < p;
  }
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}

const SEED_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Non-deterministic by design: used only when the USER asks for a fresh seed. */
export function randomSeed(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  return s;
}

export function uid(rng?: Rng): string {
  if (rng) {
    let s = '';
    for (let i = 0; i < 10; i++) s += SEED_CHARS[Math.floor(rng.next() * SEED_CHARS.length)];
    return s;
  }
  return randomSeed(10);
}

/** CPU value noise (0..1) with fbm — used for flow-field placement of shapes. */
export function makeNoise2D(seed: string): (x: number, y: number) => number {
  const rand = mulberry32(xmur3(seed)());
  const perm = new Uint8Array(512);
  const p: number[] = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (ix: number, iy: number) => perm[(perm[ix & 255] + iy) & 255] / 255;
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = val(ix, iy);
    const b = val(ix + 1, iy);
    const c = val(ix, iy + 1);
    const d = val(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function fbm2D(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(fx, fy);
    fx *= 2;
    fy *= 2;
    amp *= 0.5;
  }
  return v;
}
