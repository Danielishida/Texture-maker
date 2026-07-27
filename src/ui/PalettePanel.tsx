// Palette: 5 swatches with per-swatch locks, harmony/mood reroll, curated picks.

import { useState } from 'react';
import { useStore } from '../state/store';
import { CURATED_PALETTES, HARMONY_RULES, MOODS, type HarmonyRule, type Mood } from '../engine/palette';
import { IconButton } from './controls';

export function PalettePanel() {
  const doc = useStore((s) => s.doc);
  const s = useStore.getState();
  const [rule, setRule] = useState<'' | HarmonyRule>('');
  const [mood, setMood] = useState<'' | Mood>('');

  return (
    <div className="palette-panel">
      <div className="panel-head">
        <h2>Palette</h2>
        <button
          className="small-btn"
          title="Reroll unlocked swatches"
          onClick={() => s.rerollPaletteAction(rule || undefined, mood || undefined)}
        >
          🎲 Reroll
        </button>
      </div>
      <div className="swatches">
        {doc.palette.colors.map((c, i) => (
          <span key={i} className="swatch">
            <input
              type="color"
              value={c}
              title={`Slot ${i + 1}${i === 0 ? ' (background)' : ''}`}
              onChange={(e) => s.setSwatch(i, e.target.value)}
            />
            <IconButton
              title={doc.palette.locks[i] ? 'Unlock swatch' : 'Lock swatch'}
              onClick={() => s.toggleSwatchLock(i)}
              active={doc.palette.locks[i]}
            >
              {doc.palette.locks[i] ? '🔒' : '🔓'}
            </IconButton>
          </span>
        ))}
      </div>
      <div className="palette-controls">
        <select value={rule} onChange={(e) => setRule(e.target.value as '' | HarmonyRule)}>
          <option value="">any harmony</option>
          {HARMONY_RULES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select value={mood} onChange={(e) => setMood(e.target.value as '' | Mood)}>
          <option value="">any mood</option>
          {MOODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value !== '') s.applyCuratedPalette(parseInt(e.target.value, 10));
            e.target.value = '';
          }}
        >
          <option value="">curated…</option>
          {CURATED_PALETTES.map((p, i) => (
            <option key={i} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
