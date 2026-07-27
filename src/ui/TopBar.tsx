// Top bar: project name, size, seed, big Randomize, mode toggles, save/open,
// recipes, and export.

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { DOC_PRESETS } from '../engine/types';
import { openProjectFile, saveProjectFile, loadRecipes, saveRecipes, type Recipe } from '../state/persist';
import { randomSeed, uid } from '../engine/prng';
import { randomizeDocument } from '../engine/randomize';

export function TopBar(props: { onExport: () => void }) {
  const doc = useStore((s) => s.doc);
  const showVariations = useStore((s) => s.showVariations);
  const tilePreview = useStore((s) => s.tilePreview);
  const s = useStore.getState();
  const [seedDraft, setSeedDraft] = useState(doc.seed);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => setSeedDraft(doc.seed), [doc.seed]);
  useEffect(() => {
    loadRecipes().then(setRecipes).catch(() => undefined);
  }, []);

  const presetValue =
    DOC_PRESETS.findIndex((p) => p.w === doc.width && p.h === doc.height) ?? -1;

  return (
    <header className="topbar">
      <span className="brand" title="Texture Forge">
        ⚒ <strong>Texture Forge</strong>
      </span>
      <input
        className="doc-name"
        value={doc.name}
        onChange={(e) => s.setDocMeta({ name: e.target.value })}
      />
      <select
        title="Document size"
        value={presetValue}
        onChange={(e) => {
          const p = DOC_PRESETS[parseInt(e.target.value, 10)];
          if (p) s.setDocMeta({ width: p.w, height: p.h });
        }}
      >
        {presetValue === -1 && <option value={-1}>{doc.width}×{doc.height}</option>}
        {DOC_PRESETS.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
      </select>

      <span className="seed-box" title="Document seed — same seed reproduces the same image">
        <label>seed</label>
        <input
          className="mono"
          value={seedDraft}
          onChange={(e) => setSeedDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') s.setSeed(seedDraft);
          }}
          onBlur={() => {
            if (seedDraft !== doc.seed) s.setSeed(seedDraft);
          }}
        />
        <button className="small-btn" title="Copy seed" onClick={() => navigator.clipboard?.writeText(doc.seed)}>
          ⧉
        </button>
      </span>

      <button className="primary" title="Randomize everything unlocked (Space)" onClick={() => s.randomizeAll()}>
        🎲 Randomize
      </button>
      <button className="small-btn" title="New random document (fresh layer stack)" onClick={() => s.newRandomDocument()}>
        ✦ New random
      </button>
      <button
        className={'small-btn' + (showVariations ? ' active' : '')}
        title="Variations contact sheet (V)"
        onClick={() => (showVariations ? s.setShowVariations(false) : s.rollVariations())}
      >
        ▦ Variations
      </button>

      <span className="toggles">
        <label title="Seamless tile mode: noise becomes periodic and shapes wrap toroidally">
          <input
            type="checkbox"
            checked={doc.tileable}
            onChange={(e) => s.setDocMeta({ tileable: e.target.checked })}
          />
          tileable
        </label>
        {doc.tileable && (
          <label title="Preview a 3×3 tiling to verify seams">
            <input type="checkbox" checked={tilePreview} onChange={(e) => s.setTilePreview(e.target.checked)} />
            3×3
          </label>
        )}
        <label title="Vector-safe: only SVG-representable layers/effects, guarantees faithful SVG export">
          <input
            type="checkbox"
            checked={doc.colorMode === 'vector-safe'}
            onChange={(e) => s.setDocMeta({ colorMode: e.target.checked ? 'vector-safe' : 'raster' })}
          />
          vector-safe
        </label>
      </span>

      <span className="spacer" />

      <select
        className="small-btn"
        title="Style recipes: reusable layer-stack templates"
        value=""
        onChange={async (e) => {
          const v = e.target.value;
          e.target.value = '';
          if (v === '__save') {
            const name = prompt('Recipe name?', doc.name || 'My style');
            if (!name) return;
            const next = [...recipes, { id: uid(), name, doc }];
            setRecipes(next);
            await saveRecipes(next);
          } else if (v.startsWith('__del:')) {
            const next = recipes.filter((r) => r.id !== v.slice(6));
            setRecipes(next);
            await saveRecipes(next);
          } else if (v) {
            const recipe = recipes.find((r) => r.id === v);
            if (recipe) s.commit(randomizeDocument({ ...recipe.doc, name: doc.name }, randomSeed()));
          }
        }}
      >
        <option value="">Recipes…</option>
        <option value="__save">💾 Save current as recipe</option>
        {recipes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
        {recipes.map((r) => (
          <option key={'d' + r.id} value={'__del:' + r.id}>
            🗑 delete “{r.name}”
          </option>
        ))}
      </select>
      <button className="small-btn" title="Save project (.json) — Ctrl/Cmd+S" onClick={() => saveProjectFile(doc)}>
        Save
      </button>
      <button
        className="small-btn"
        title="Open project (.json)"
        onClick={async () => {
          try {
            const opened = await openProjectFile();
            if (opened) s.commit(opened);
          } catch (err) {
            alert('Could not open project: ' + (err instanceof Error ? err.message : err));
          }
        }}
      >
        Open
      </button>
      <button className="primary export" title="Export (Ctrl/Cmd+E)" onClick={props.onExport}>
        ⇩ Export
      </button>
    </header>
  );
}
