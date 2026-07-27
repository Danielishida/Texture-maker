# Build "Texture Forge" — a procedural stock-asset generator (no generative AI)

> This is the master build prompt for this project. Give this entire document to
> Claude Code (or any capable coding agent) and ask it to implement the project,
> following the build order at the bottom.

## What this is

A browser-based creative tool that generates high-quality, print-ready backgrounds,
textures, and abstract digital assets using ONLY procedural techniques: randomized
shapes, gradients, color palettes, typography, and image filters. No generative AI
anywhere in the pipeline — output must be 100% procedurally derived so assets are
clean for stock-site licensing. The user's business goal is producing assets to sell
on Adobe Stock, Shutterstock, Creative Market, and similar marketplaces, so
reproducibility, high-resolution export, and fast iteration are first-class features.

## Tech stack

- Vite + React 18 + TypeScript (strict mode)
- WebGL2 for the raster filter pipeline (GLSL fragment-shader passes, ping-pong FBOs)
- Zustand for app state; zundo or a custom command stack for undo/redo
- IndexedDB (idb) for autosave; File System Access API with download fallback for
  project files and exports
- Web Worker + OffscreenCanvas for full-resolution export rendering
- No backend, no accounts, no telemetry. Everything runs and stays local.
- Keep the rendering engine (`src/engine/`) free of React imports so it can be reused
  headlessly (future CLI batch rendering or desktop wrap).

## Core model: seeded, non-destructive layer stack

A document is a versioned JSON tree:

```ts
Document { id, name, width, height, dpi, colorMode: "raster" | "vector-safe",
           tileable: boolean, seed: string, palette: Palette, layers: Layer[] }
Layer = ShapeLayer | GradientLayer | NoiseFieldLayer | PatternLayer | TypeLayer
// Every layer:
Layer { id, type, name, seed, visible, locked, opacity, blendMode,
        transform, params, effects: Effect[] }
Effect { id, filterType, params, enabled }
```

Filters are non-destructive layer effects, never baked into pixels.

Determinism is a hard requirement: `render(document)` must be a pure function of the
document JSON. Use a seeded PRNG (mulberry32 seeded via a string hash like xmur3).
Every "random" choice — shape placement, palette generation, filter jitter — draws
from a PRNG derived from `(document.seed, layer.seed, param path)`. Same JSON in,
same pixels out (per machine; minor cross-GPU float differences are acceptable).

## Randomization UX (the heart of the tool)

- Global "Randomize" button (spacebar): rerolls the document seed and regenerates
  all UNLOCKED layers/parameters.
- Per-layer randomize (dice icon on each layer) and per-parameter randomize.
- Lock toggles at layer level AND parameter level: locking the palette but rolling
  shapes, locking composition but rolling colors, etc., must be trivial.
- Seed field is always visible and editable; copy/paste a seed to reproduce a result.
- "Variations" drawer: renders an N-up contact sheet (default 12) of the current
  document with different seeds at preview resolution. Click to apply, star to keep;
  starred variants queue for batch export at full resolution.
- Undo/redo (Cmd/Ctrl+Z) covers every change including randomize rolls.

## Layer types (v1)

1. **Solid / Gradient fill** — linear, radial, conic, freeform mesh-like (multi-stop
   blurred blobs); randomizer picks type, angle, stops from the active palette.
2. **Shape scatter** — N instances of a primitive (circle, ring, rect, triangle,
   blob/superellipse, line segment, arc) distributed by a placement strategy: uniform
   random, grid + jitter, ring/orbit, flow-field-guided, recursive subdivision.
   Params: count, size range, rotation range, fill/stroke, palette-slot assignment.
3. **Noise field** — Perlin/simplex/value/worley noise rendered as luminance or mapped
   through the palette; octaves, frequency, contrast; used both as a visible layer
   and as a displacement/mask source for effects.
4. **Pattern** — stripes, checker, dot grid, herringbone, waves, concentric rings,
   with spacing/thickness/phase params.
5. **Type** — decorative typography: single glyphs, words, or repeated text laid out
   as scatter, ring, wave, or grid; font picker from bundled OFL/Google fonts plus
   local font file loading; outline/fill; type participates fully in filters.
   (Not a copy-editing tool: no multi-paragraph text, no kerning UI in v1.)

## Filter/effect library (v1) — each is a GLSL pass with typed params

- **Core:** gaussian blur, radial blur, motion blur, posterize, pixelate/mosaic,
  polar coordinates (rect↔polar both directions), invert, levels/curves-lite
  (brightness/contrast/gamma), hue/saturation.
- **Distortion:** displacement map (driven by any noise), sine wave warp, twirl,
  ripple, fisheye/lens, kaleidoscope (N-fold mirror), flow-field smear.
- **Stylize:** halftone (dots/lines/CMYK angles), ordered + diffusion dither,
  scanlines, chromatic aberration, glow/bloom, drop shadow, duotone/gradient map,
  threshold, edge detect.
- **Texture/grain:** film grain, paper fiber, canvas weave, marble/turbulence,
  voronoi cells (cracked/organic), wood rings, brushed metal (anisotropic streaks),
  subtle vignette.

Every filter param has sensible ranges, a randomize-within-range behavior, and a
lock toggle. Architecture note: define filters declaratively (name, GLSL, param
schema) so adding a new filter is one file.

## Color: harmony engine

- Palette generator producing 3–6 swatch palettes from color-theory rules:
  monochrome, analogous, complementary, split-complementary, triadic, plus
  "dark moody," "pastel," "neon," "earth" mood transforms. Work in OKLCH/HSLuv so
  randomized palettes stay perceptually balanced.
- Curated library of ~40 hand-picked trend palettes as a fallback/starting point.
- Layers reference palette SLOTS (e.g. "accent-2"), not raw hex, so swapping or
  rerolling a palette recolors the whole composition instantly.
- Palette panel: lock individual swatches, reroll the rest; import hex lists.

## Canvas & document

- Center canvas with zoom (wheel/pinch, fit/100% shortcuts) and pan (space-drag).
- Document presets: common stock sizes/ratios (1:1, 4:3, 3:2, 16:9, A-series poster,
  4K/5K/6K wallpaper) plus custom W×H. Preview renders at screen resolution;
  document resolution only matters at export.
- Seamless-tile mode (per document): all noise becomes periodic, scatter placement
  wraps toroidally, and edge-crossing shapes draw on both sides; live 3×3 tiling
  preview toggle to verify seams.

## Export pipeline

- PNG and JPEG (quality slider, sRGB) at document size or scaled multiples
  (1×/2×/4×/custom up to ~12000px long edge).
- Full-res rendering runs in a Web Worker, TILED (e.g. 1024px tiles composited into
  the output) to stay under GPU max-texture-size and keep the UI live; progress bar.
- Batch export: all starred variations rendered at full res with an auto filename
  pattern like `{project}-{seed}-{w}x{h}.{ext}`.
- Vector-safe mode: when `document.colorMode === "vector-safe"`, only vector-
  representable layers/effects are allowed (shapes, gradients, patterns, type,
  transforms, opacity/blend); raster filters show disabled with a tooltip. Export
  generates clean SVG (shapes as paths, gradients as SVG gradients, text as
  outlined paths for licensing safety). Include a help note that Shutterstock
  requires EPS and SVG→EPS can be done in Inkscape/Illustrator.
- Stock helper: optional CSV manifest of exported files (filename, title, keywords
  columns left blank for the user) matching common stock bulk-upload formats.

## Project persistence

- Save/open `.json` project files (versioned schema with a migration hook).
- Autosave to IndexedDB every 30s and on significant actions; on load, offer to
  restore the last session.
- "Save as style recipe": stores the layer stack with parameter ranges but not
  seeds, into a local recipe library; "New from recipe" + Randomize gives infinite
  on-brand variants.

## UI layout (intuitive, dark theme, keyboard-first)

- Top bar: project name, document size, seed field, Randomize (big, primary),
  Variations, Export.
- Left: layer stack (drag reorder, visibility, lock, per-layer dice, blend/opacity).
- Right: inspector for selected layer — parameters grouped, each with slider +
  numeric input + lock + dice; effects list with add/remove/reorder.
- Bottom drawer: variations contact sheet.
- Shortcuts: Space=randomize, Cmd/Ctrl+Z/Shift+Z undo/redo, Cmd/Ctrl+S save,
  Cmd/Ctrl+E export, 1–9 select layer, V variations.
- Onboarding: first launch opens a good-looking randomized document, not a blank
  canvas — the user should see a sellable-quality image within 2 seconds.

## Build order (implement in this sequence, keep the app runnable at every phase)

1. **Scaffold:** Vite/React/TS, canvas shell, document model, seeded PRNG, Zustand
   store, layer stack UI with solid/gradient + shape-scatter layers, global and
   per-layer randomize, undo/redo.
2. **WebGL2 filter pipeline:** effect architecture, ping-pong FBOs, first filters
   (blur, posterize, polar coordinates, noise overlay).
3. **Full filter packs** (distortion, stylize, texture) + noise-field and pattern
   layers + harmony color engine with palette panel.
4. **Type layers** with bundled OFL fonts and local font loading.
5. **Export:** tiled worker-based PNG/JPEG at high res, size presets, project
   save/open + autosave.
6. **Variations contact sheet + batch export;** seamless-tile mode; vector-safe mode
   with SVG export.
7. **Polish:** keyboard shortcuts, recipes library, stock CSV helper, performance
   pass (preview should stay interactive at 60fps on a mid-range laptop).

## Quality bar & testing

- TypeScript strict; ESLint + Prettier.
- Unit tests (Vitest) for: PRNG determinism (same seed → same sequence), document
  schema migration, palette harmony math, SVG export snapshot for a fixture doc.
- A determinism test that renders a fixture document twice and asserts identical
  pixel hashes.
- Manual acceptance per phase: the phase's features work end-to-end in the browser
  (document it in the README as a checklist).
- README with screenshots/GIFs, feature list, and dev setup.

## Explicit non-goals (v1)

- No generative AI or ML models of any kind.
- No backend, accounts, cloud sync, or payments.
- No photo import/manipulation (procedural sources only).
- No EPS writer, no CMYK export, no animation (candidates for v2).
