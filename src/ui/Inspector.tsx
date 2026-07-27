// Right panel: parameters + effects for the selected layer, all lockable.

import { useStore } from '../state/store';
import { BLEND_MODES, LAYER_DEFS, type Layer } from '../engine/types';
import { FILTERS, FILTER_GROUPS, FILTER_MAP } from '../engine/gl/filters';
import { IconButton, ParamControl } from './controls';

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selectedLayerId);
  const s = useStore.getState();
  const layer = doc.layers.find((l) => l.id === selected);
  if (!layer) {
    return (
      <div className="panel inspector">
        <p className="hint">Select a layer to edit its parameters.</p>
      </div>
    );
  }
  const def = LAYER_DEFS[layer.type];
  const vectorSafe = doc.colorMode === 'vector-safe';
  return (
    <div className="panel inspector">
      <div className="panel-head">
        <input
          className="layer-name-input"
          value={layer.name}
          onChange={(e) => s.updateLayer(layer.id, { name: e.target.value })}
        />
        <IconButton title="Randomize layer" onClick={() => s.randomizeLayerById(layer.id)}>
          🎲
        </IconButton>
      </div>

      <div className="param-row">
        <span className="param-label">Blend</span>
        <select
          value={layer.blendMode}
          onChange={(e) => s.updateLayer(layer.id, { blendMode: e.target.value as Layer['blendMode'] })}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <IconButton
          title="Lock blend/opacity from randomize"
          onClick={() => s.toggleParamLock(layer.id, '__blend')}
          active={!!layer.paramLocks['__blend']}
        >
          {layer.paramLocks['__blend'] ? '🔒' : '🔓'}
        </IconButton>
      </div>
      <div className="param-row">
        <span className="param-label">Opacity</span>
        <span className="num-field">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.opacity}
            onChange={(e) => s.updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
          />
          <span className="num-readout">{Math.round(layer.opacity * 100)}%</span>
        </span>
      </div>
      <div className="param-row">
        <span className="param-label">Seed</span>
        <input
          className="text-input mono"
          value={layer.seed}
          onChange={(e) => s.updateLayer(layer.id, { seed: e.target.value })}
        />
      </div>

      <h3>Parameters</h3>
      {def.params.map((p) => (
        <ParamControl
          key={p.key}
          def={p}
          value={layer.params[p.key]}
          locked={!!layer.paramLocks[p.key]}
          doc={doc}
          onChange={(v) => s.setParam(layer.id, p.key, v)}
          onToggleLock={() => s.toggleParamLock(layer.id, p.key)}
        />
      ))}

      <h3>
        Effects
        {vectorSafe && <span className="hint"> (disabled in vector-safe mode)</span>}
      </h3>
      {!vectorSafe && (
        <select
          className="add-effect"
          value=""
          onChange={(e) => {
            if (e.target.value) s.addEffect(layer.id, e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">+ Add effect…</option>
          {FILTER_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {FILTERS.filter((f) => f.group === g.id).map((f) => (
                <option key={f.type} value={f.type}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {layer.effects.map((fx) => {
        const fdef = FILTER_MAP[fx.filterType];
        if (!fdef) return null;
        return (
          <div key={fx.id} className={'effect-card' + (vectorSafe ? ' disabled' : '')}>
            <div className="effect-head">
              <input
                type="checkbox"
                checked={fx.enabled}
                title="Enable/disable"
                onChange={(e) => s.updateEffect(layer.id, fx.id, { enabled: e.target.checked })}
              />
              <strong>{fdef.name}</strong>
              <span className="layer-tools">
                <IconButton title="Randomize effect" onClick={() => s.randomizeEffectById(layer.id, fx.id)}>
                  🎲
                </IconButton>
                <IconButton
                  title={fx.locked ? 'Unlock effect' : 'Lock effect (protect from randomize)'}
                  onClick={() => s.updateEffect(layer.id, fx.id, { locked: !fx.locked })}
                  active={fx.locked}
                >
                  {fx.locked ? '🔒' : '🔓'}
                </IconButton>
                <IconButton title="Move earlier" onClick={() => s.moveEffect(layer.id, fx.id, -1)}>
                  ↑
                </IconButton>
                <IconButton title="Move later" onClick={() => s.moveEffect(layer.id, fx.id, 1)}>
                  ↓
                </IconButton>
                <IconButton title="Remove" onClick={() => s.removeEffect(layer.id, fx.id)}>
                  ✕
                </IconButton>
              </span>
            </div>
            {fdef.params.map((p) => (
              <ParamControl
                key={p.key}
                def={p}
                value={fx.params[p.key]}
                locked={false}
                doc={doc}
                onChange={(v) => s.setEffectParam(layer.id, fx.id, p.key, typeof v === 'number' ? v : 0)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
