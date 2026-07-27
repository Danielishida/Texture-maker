// Bottom drawer: contact sheet of seeded variations. Click applies, star keeps
// for batch export.

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { randomizeDocument } from '../engine/randomize';
import { renderThumb } from './thumbs';

export function VariationsDrawer() {
  const doc = useStore((s) => s.doc);
  const seeds = useStore((s) => s.variationSeeds);
  const starred = useStore((s) => s.starredSeeds);
  const show = useStore((s) => s.showVariations);
  const s = useStore.getState();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!show || !seeds.length) return;
    let cancelled = false;
    setThumbs({});
    // Render thumbnails progressively so the UI stays responsive.
    (async () => {
      for (const seed of seeds) {
        if (cancelled) return;
        const variant = randomizeDocument(doc, seed);
        const url = renderThumb(variant, 220);
        setThumbs((t) => ({ ...t, [seed]: url }));
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally NOT keyed on `doc`: applying a variation would otherwise
    // re-render the whole sheet. Reroll to refresh against the current doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds, show]);

  if (!show) return null;
  return (
    <div className="variations">
      <div className="variations-head">
        <h2>Variations</h2>
        <button className="small-btn" onClick={() => s.rollVariations()}>
          🎲 Reroll sheet
        </button>
        <span className="hint">click = apply · ★ = keep for batch export</span>
        <span className="spacer" />
        <button className="small-btn" onClick={() => s.setShowVariations(false)}>
          ✕
        </button>
      </div>
      <div className="variation-grid">
        {seeds.map((seed) => (
          <figure key={seed} className={starred.includes(seed) ? 'starred' : ''}>
            {thumbs[seed] ? (
              <img src={thumbs[seed]} alt={seed} onClick={() => s.applyVariation(seed)} />
            ) : (
              <span className="thumb-loading">…</span>
            )}
            <figcaption>
              <span className="mono">{seed}</span>
              <button
                className="star-btn"
                title="Keep for batch export"
                onClick={() => s.toggleStar(seed)}
              >
                {starred.includes(seed) ? '★' : '☆'}
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
