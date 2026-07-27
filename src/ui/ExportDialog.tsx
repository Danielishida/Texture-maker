// Export dialog: high-res PNG/JPEG (tiled in a worker), SVG for vector-safe
// docs, batch export of starred variations, and an optional CSV manifest.

import { useState } from 'react';
import { useStore } from '../state/store';
import { buildCsvManifest, downloadBlob, exportDocument, exportFilename } from '../engine/export/exporter';
import { documentToSvg } from '../engine/svg';
import { randomizeDocument } from '../engine/randomize';

const SCALES = [1, 1.5, 2, 3];
const MAX_EDGE = 12000;

export function ExportDialog(props: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const starred = useStore((s) => s.starredSeeds);
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<'png' | 'jpeg'>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [withCsv, setWithCsv] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const outW = Math.round(doc.width * scale);
  const outH = Math.round(doc.height * scale);
  const tooBig = Math.max(outW, outH) > MAX_EDGE;
  const mp = ((outW * outH) / 1e6).toFixed(1);

  const runExport = async (seeds: (string | null)[]) => {
    const manifest: { filename: string }[] = [];
    try {
      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        const target = seed ? randomizeDocument(doc, seed) : doc;
        const label = seeds.length > 1 ? ` ${i + 1}/${seeds.length}` : '';
        const blob = await exportDocument(
          target,
          { width: outW, height: outH, format, quality },
          (done, total) => setProgress(`Rendering${label}: ${Math.round((done / total) * 100)}%`),
        );
        const filename = exportFilename(doc, outW, outH, format === 'png' ? 'png' : 'jpg', target.seed);
        downloadBlob(blob, filename);
        manifest.push({ filename });
      }
      if (withCsv && manifest.length) {
        downloadBlob(buildCsvManifest(manifest), `${doc.name || 'export'}-manifest.csv`);
      }
      setProgress(null);
      props.onClose();
    } catch (err) {
      setProgress(null);
      alert('Export failed: ' + (err instanceof Error ? err.message : err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>
        <div className="param-row">
          <span className="param-label">Scale</span>
          <span>
            {SCALES.map((sc) => (
              <button
                key={sc}
                className={'small-btn' + (scale === sc ? ' active' : '')}
                onClick={() => setScale(sc)}
              >
                {sc}×
              </button>
            ))}
          </span>
        </div>
        <p className="hint">
          Output: {outW} × {outH} px ({mp} MP{Number(mp) >= 4 ? ' — meets 4MP stock minimums' : ' — below the 4MP minimum most stock sites require'})
          {tooBig && ' — exceeds the 12000px edge limit, reduce scale'}
        </p>
        <div className="param-row">
          <span className="param-label">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}>
            <option value="jpeg">JPEG (stock photos/illustrations)</option>
            <option value="png">PNG (lossless, keeps transparency)</option>
          </select>
        </div>
        {format === 'jpeg' && (
          <div className="param-row">
            <span className="param-label">Quality</span>
            <span className="num-field">
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
              />
              <span className="num-readout">{Math.round(quality * 100)}</span>
            </span>
          </div>
        )}
        <div className="param-row">
          <span className="param-label">CSV manifest</span>
          <input type="checkbox" checked={withCsv} onChange={(e) => setWithCsv(e.target.checked)} />
          <span className="hint">filename list for stock bulk-upload sheets</span>
        </div>

        {progress ? (
          <p className="progress">{progress}</p>
        ) : (
          <div className="modal-actions">
            <button className="primary" disabled={tooBig} onClick={() => runExport([null])}>
              Export current
            </button>
            {starred.length > 0 && (
              <button className="primary" disabled={tooBig} onClick={() => runExport(starred)}>
                Batch export {starred.length} starred
              </button>
            )}
            {doc.colorMode === 'vector-safe' && (
              <button
                onClick={() => {
                  const svg = new Blob([documentToSvg(doc)], { type: 'image/svg+xml' });
                  downloadBlob(svg, exportFilename(doc, doc.width, doc.height, 'svg'));
                }}
              >
                Export SVG
              </button>
            )}
            <button onClick={props.onClose}>Cancel</button>
          </div>
        )}
        {doc.colorMode === 'vector-safe' && (
          <p className="hint">
            Shutterstock requires EPS for vectors — convert the SVG with Inkscape or Illustrator (File → Save a Copy → EPS).
          </p>
        )}
      </div>
    </div>
  );
}
