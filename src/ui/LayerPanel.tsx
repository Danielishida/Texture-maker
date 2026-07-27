// Left panel: layer stack (top layer first) + palette.

import { useStore } from '../state/store';
import { LAYER_DEFS, type LayerType } from '../engine/types';
import { IconButton } from './controls';
import { PalettePanel } from './PalettePanel';

const ADDABLE: LayerType[] = ['fill', 'scatter', 'noise', 'pattern', 'type'];

export function LayerPanel() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selectedLayerId);
  const s = useStore.getState();
  const vectorSafe = doc.colorMode === 'vector-safe';

  return (
    <div className="panel layer-panel">
      <div className="panel-head">
        <h2>Layers</h2>
        <select
          className="add-layer"
          value=""
          onChange={(e) => {
            if (e.target.value) s.addLayer(e.target.value as LayerType);
            e.target.value = '';
          }}
        >
          <option value="">+ Add layer…</option>
          {ADDABLE.filter((t) => !vectorSafe || LAYER_DEFS[t].vectorSafe).map((t) => (
            <option key={t} value={t}>
              {LAYER_DEFS[t].name}
            </option>
          ))}
        </select>
      </div>
      <ul className="layer-list">
        {[...doc.layers].reverse().map((layer) => {
          const disabled = vectorSafe && !LAYER_DEFS[layer.type].vectorSafe;
          return (
            <li
              key={layer.id}
              className={
                'layer-item' +
                (layer.id === selected ? ' selected' : '') +
                (disabled ? ' disabled' : '')
              }
              onClick={() => s.selectLayer(layer.id)}
              title={disabled ? 'Raster-only layer — hidden in vector-safe mode' : undefined}
            >
              <IconButton
                title={layer.visible ? 'Hide' : 'Show'}
                onClick={() => s.updateLayer(layer.id, { visible: !layer.visible })}
                active={layer.visible}
              >
                {layer.visible ? '👁' : '·'}
              </IconButton>
              <span className="layer-name">{layer.name}</span>
              <span className="layer-tools">
                <IconButton title="Randomize this layer" onClick={() => s.randomizeLayerById(layer.id)}>
                  🎲
                </IconButton>
                <IconButton
                  title={layer.locked ? 'Unlock layer' : 'Lock layer (protect from randomize)'}
                  onClick={() => s.updateLayer(layer.id, { locked: !layer.locked })}
                  active={layer.locked}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </IconButton>
                <IconButton title="Move up" onClick={() => s.moveLayer(layer.id, 1)}>
                  ↑
                </IconButton>
                <IconButton title="Move down" onClick={() => s.moveLayer(layer.id, -1)}>
                  ↓
                </IconButton>
                <IconButton title="Duplicate" onClick={() => s.duplicateLayer(layer.id)}>
                  ⧉
                </IconButton>
                <IconButton title="Delete" onClick={() => s.removeLayer(layer.id)}>
                  ✕
                </IconButton>
              </span>
            </li>
          );
        })}
      </ul>
      <PalettePanel />
    </div>
  );
}
