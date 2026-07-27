# Texture Forge

A browser-based procedural generator for high-quality backgrounds, textures, and
digital assets — built for producing stock-ready artwork with **zero generative AI**.

Everything is created from randomized shapes, gradients, color palettes, decorative
typography, and image filters (noise, polar coordinates, posterize, halftone, warp,
and more), driven by a deterministic seed system so every result is reproducible
and fully adjustable.

## Status

Pre-development. The complete product specification and build instructions live in
[`PROJECT_PROMPT.md`](./PROJECT_PROMPT.md) — hand that file to Claude Code to build
the app phase by phase.

## Planned highlights

- **Layer stack + randomize** — Photoshop-style layers with global, per-layer, and
  per-parameter dice rolls; lock anything and reroll the rest
- **Deterministic seeds** — same seed, same pixels; revisit any winner at full res
- **Variations contact sheet** — roll 12 seeded variants at once, star the keepers,
  batch-export at stock-ready resolution
- **Four filter packs** — core, distortion, stylize, and texture effects as GPU
  shader passes
- **Harmony color engine** — color-theory-based palette randomization that stays
  sellable
- **Stock-focused export** — tiled high-res PNG/JPEG (6000px+), seamless-tile mode,
  vector-safe SVG mode, batch export with filename patterns
- **Local-first** — no accounts, no backend; `.json` projects + browser autosave

## Tech

Vite · React 18 · TypeScript · WebGL2 · Zustand · Web Workers
