// Shared parameter controls: every param gets a lock toggle and (where it
// makes sense) a dice reroll — the core of the lock-and-reroll workflow.

import { useId } from 'react';
import type { ParamDef, ParamValue, TFDocument } from '../engine/types';
import { allFontFamilies, loadLocalFont } from '../engine/fonts';

export function IconButton(props: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={'icon-btn' + (props.active ? ' active' : '')}
      title={props.title}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function ParamControl(props: {
  def: ParamDef;
  value: ParamValue;
  locked: boolean;
  doc: TFDocument;
  onChange: (v: ParamValue) => void;
  onToggleLock?: () => void;
}) {
  const { def, value, locked, doc, onChange, onToggleLock } = props;
  const id = useId();
  let field: React.ReactNode;
  switch (def.kind) {
    case 'number': {
      const v = typeof value === 'number' ? value : def.def;
      field = (
        <span className="num-field">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step ?? (def.max - def.min) / 200}
            value={v}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <input
            className="num-input"
            type="number"
            min={def.min}
            max={def.max}
            step={def.step ?? 0.01}
            value={Number(v.toFixed(3))}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!Number.isNaN(n)) onChange(Math.max(def.min, Math.min(def.max, n)));
            }}
          />
        </span>
      );
      break;
    }
    case 'select': {
      const v = typeof value === 'number' ? Math.round(value) : def.def;
      field = (
        <select value={v} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    }
    case 'slot': {
      const v = typeof value === 'number' ? Math.round(value) : def.def;
      field = (
        <span className="slot-field">
          <select value={v} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
            {def.allowMix || v === -1 ? <option value={-1}>mix</option> : null}
            {doc.palette.colors.map((_, i) => (
              <option key={i} value={i}>
                slot {i + 1}
              </option>
            ))}
          </select>
          <span
            className="swatch-chip"
            style={{
              background:
                v === -1
                  ? `linear-gradient(90deg, ${doc.palette.colors.slice(1).join(',')})`
                  : doc.palette.colors[v] ?? '#888',
            }}
          />
        </span>
      );
      break;
    }
    case 'text':
      field = (
        <input
          className="text-input"
          type="text"
          value={typeof value === 'string' ? value : def.def}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'font': {
      const v = typeof value === 'string' ? value : def.def;
      field = (
        <span className="font-field">
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            {[...new Set([...allFontFamilies(), v])].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <IconButton
            title="Load a local font file (.ttf/.otf/.woff2)"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.ttf,.otf,.woff,.woff2';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (file) onChange(await loadLocalFont(file));
              };
              input.click();
            }}
          >
            +
          </IconButton>
        </span>
      );
      break;
    }
  }
  return (
    <label className="param-row" htmlFor={id}>
      <span className="param-label">{def.label}</span>
      {field}
      {onToggleLock && (
        <IconButton title={locked ? 'Unlock (allow randomize)' : 'Lock (protect from randomize)'} onClick={onToggleLock} active={locked}>
          {locked ? '🔒' : '🔓'}
        </IconButton>
      )}
    </label>
  );
}
