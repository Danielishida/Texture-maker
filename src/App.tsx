import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { TopBar } from './ui/TopBar';
import { LayerPanel } from './ui/LayerPanel';
import { CanvasView } from './ui/CanvasView';
import { Inspector } from './ui/Inspector';
import { VariationsDrawer } from './ui/VariationsDrawer';
import { ExportDialog } from './ui/ExportDialog';
import { saveProjectFile } from './state/persist';

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    useStore.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectFile(s.doc);
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowExport(true);
        return;
      }
      if (isTyping()) return;
      if (e.code === 'Space') {
        e.preventDefault();
        s.randomizeAll();
      } else if (e.key.toLowerCase() === 'v') {
        s.showVariations ? s.setShowVariations(false) : s.rollVariations();
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const layers = [...s.doc.layers].reverse();
        if (layers[idx]) s.selectLayer(layers[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="loading">Loading…</div>;
  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} />
      <div className="main">
        <LayerPanel />
        <CanvasView />
        <Inspector />
      </div>
      <VariationsDrawer />
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}
