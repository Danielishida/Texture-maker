import { describe, expect, it } from 'vitest';
import { Rng, makeNoise2D, mulberry32, xmur3 } from '../prng';
import { generateDuoPalette, generatePalette, generateRetroWarmPalette, generateTonalPalette, oklchToHex, rerollPalette } from '../palette';
import { generateStarterDocument, randomizeDocument } from '../randomize';
import { makeLayer, migrateDocument, SCHEMA_VERSION } from '../types';
import { buildScatter, buildTiles } from '../displaylist';
import { documentToSvg } from '../svg';
import { STYLES } from '../styles';

const HEX = /^#[0-9a-f]{6}$/;

describe('PRNG determinism', () => {
  it('same seed produces identical sequences', () => {
    const a = mulberry32(xmur3('hello')());
    const b = mulberry32(xmur3('hello')());
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('different seeds diverge', () => {
    const a = new Rng('seed-a');
    const b = new Rng('seed-b');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
  it('forks are independent and deterministic', () => {
    expect(new Rng('x').fork('y').next()).toBe(new Rng('x').fork('y').next());
    expect(new Rng('x').fork('y').next()).not.toBe(new Rng('x').fork('z').next());
  });
  it('cpu noise is deterministic and in range', () => {
    const n1 = makeNoise2D('n');
    const n2 = makeNoise2D('n');
    for (let i = 0; i < 50; i++) {
      const v = n1(i * 0.37, i * 0.71);
      expect(v).toBe(n2(i * 0.37, i * 0.71));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('palette harmony engine', () => {
  it('oklch converts to valid hex with gamut mapping', () => {
    expect(oklchToHex(0.7, 0.15, 30)).toMatch(HEX);
    expect(oklchToHex(0.5, 0.9, 200)).toMatch(HEX); // far out of gamut → mapped
  });
  it('generates 5 valid swatches deterministically', () => {
    const p1 = generatePalette(new Rng('pal'));
    const p2 = generatePalette(new Rng('pal'));
    expect(p1.colors).toHaveLength(5);
    p1.colors.forEach((c) => expect(c).toMatch(HEX));
    expect(p1).toEqual(p2);
  });
  it('reroll respects swatch locks', () => {
    const p = generatePalette(new Rng('pal'));
    p.locks[2] = true;
    const rerolled = rerollPalette(p, new Rng('other'));
    expect(rerolled.colors[2]).toBe(p.colors[2]);
    expect(rerolled.colors[0]).not.toBe(p.colors[0]);
  });
});

describe('document randomization', () => {
  it('starter document is deterministic for a seed', () => {
    expect(generateStarterDocument('abc')).toEqual(generateStarterDocument('abc'));
  });
  it('randomizeDocument is deterministic for a seed', () => {
    const doc = generateStarterDocument('base');
    expect(randomizeDocument(doc, 'roll1')).toEqual(randomizeDocument(doc, 'roll1'));
    expect(randomizeDocument(doc, 'roll1')).not.toEqual(randomizeDocument(doc, 'roll2'));
  });
  it('locked layers survive randomize untouched', () => {
    const doc = generateStarterDocument('base');
    doc.layers[0].locked = true;
    const rolled = randomizeDocument(doc, 'newseed');
    expect(rolled.layers[0]).toEqual(doc.layers[0]);
    expect(rolled.layers[1]).not.toEqual(doc.layers[1]);
  });
  it('locked params survive randomize untouched', () => {
    const doc = generateStarterDocument('base');
    const scatter = doc.layers.find((l) => l.type === 'scatter');
    if (!scatter) return; // stack variant without scatter
    scatter.paramLocks.count = true;
    const before = scatter.params.count;
    const rolled = randomizeDocument(doc, 'zzz');
    expect(rolled.layers.find((l) => l.id === scatter.id)!.params.count).toBe(before);
  });
  it('fully locked palette survives randomize', () => {
    const doc = generateStarterDocument('base');
    doc.palette.locks = [true, true, true, true, true];
    const rolled = randomizeDocument(doc, 'roll');
    expect(rolled.palette.colors).toEqual(doc.palette.colors);
  });
});

describe('schema migration', () => {
  it('passes current-version documents through', () => {
    const doc = generateStarterDocument('m');
    expect(migrateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it('rejects non-documents and future versions', () => {
    expect(() => migrateDocument({})).toThrow();
    expect(() => migrateDocument(null)).toThrow();
    expect(() => migrateDocument({ version: SCHEMA_VERSION + 1 })).toThrow();
  });
});

describe('style profiles', () => {
  it('style palettes produce 5 valid hex swatches', () => {
    const rng = () => new Rng('stylepal');
    for (const pal of [generateDuoPalette(rng()), generateRetroWarmPalette(rng()), generateTonalPalette(rng())]) {
      expect(pal.colors).toHaveLength(5);
      pal.colors.forEach((c) => expect(c).toMatch(HEX));
    }
  });
  it('duo palettes use a single ink across accent slots', () => {
    const pal = generateDuoPalette(new Rng('duo'));
    expect(new Set(pal.colors.slice(1)).size).toBe(1);
    expect(pal.colors[0]).not.toBe(pal.colors[1]);
  });
  it('every style generates deterministic starter documents', () => {
    for (const style of STYLES) {
      const a = generateStarterDocument('st-' + style.id, 2000, 1500, style.id);
      const b = generateStarterDocument('st-' + style.id, 2000, 1500, style.id);
      expect(a).toEqual(b);
      expect(a.style).toBe(style.id);
      expect(a.layers.length).toBeGreaterThan(0);
    }
  });
  it('randomize keeps the document inside its style', () => {
    const doc = generateStarterDocument('q1', 2000, 2000, 'quilt');
    const rolled = randomizeDocument(doc, 'q2');
    expect(rolled.style).toBe('quilt');
    const tiles = rolled.layers.find((l) => l.type === 'tiles');
    expect(tiles).toBeDefined();
    expect(tiles!.params.motifSet).toBe(0); // quarter-circle vocabulary enforced by tune()
    expect(rolled.layers.every((l) => l.blendMode === 'normal')).toBe(true);
  });
});

describe('tile grid layer', () => {
  it('builds deterministic, non-empty display lists for every motif set', () => {
    const doc = generateStarterDocument('tiles', 1200, 900, 'freeform');
    for (let set = 0; set < 6; set++) {
      const layer = makeLayer('tiles', 'tl' + set, 'tileseed' + set);
      layer.params.motifSet = set;
      layer.params.cellBg = set === 0 ? 1 : 0;
      const a = buildTiles(layer, doc);
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(buildTiles(layer, doc));
      for (const it of a) {
        expect(Number.isFinite(it.x)).toBe(true);
        expect(Number.isFinite(it.y)).toBe(true);
        expect(it.size).toBeGreaterThan(0);
      }
    }
  });
  it('tile layers export to SVG', () => {
    const doc = generateStarterDocument('svgtile', 1000, 1000, 'quilt');
    doc.colorMode = 'vector-safe';
    const svg = documentToSvg(doc);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('NaN');
  });
});

describe('display lists & SVG', () => {
  it('scatter placement is deterministic', () => {
    const doc = generateStarterDocument('s');
    const scatter = doc.layers.find((l) => l.type === 'scatter') ?? doc.layers[1];
    scatter.type = 'scatter';
    expect(buildScatter(scatter, doc)).toEqual(buildScatter(scatter, doc));
  });
  it('produces well-formed SVG for a fixture document', () => {
    const doc = generateStarterDocument('svgfix');
    doc.colorMode = 'vector-safe';
    const svg = documentToSvg(doc);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="0 0 ${doc.width} ${doc.height}"`);
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('NaN');
    // Deterministic: same doc, same markup.
    expect(documentToSvg(doc)).toBe(svg);
  });
});
