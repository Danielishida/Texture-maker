// Center canvas: WebGL preview with zoom (wheel), pan (space/middle drag),
// fit/100% controls, and a 3×3 seamless-tile preview mode.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compositor } from '../engine/gl/compositor';
import { useStore } from '../state/store';

const MAX_CANVAS_DIM = 2200;

export function CanvasView() {
  const doc = useStore((s) => s.doc);
  const tilePreview = useStore((s) => s.tilePreview);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const [view, setView] = useState({ zoom: 1, cx: 0.5, cy: 0.5 }); // cx/cy: doc-relative center
  const [glError, setGlError] = useState<string | null>(null);
  const spaceDown = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(2, Math.min(Math.round(wrap.clientWidth * dpr), MAX_CANVAS_DIM));
    const ch = Math.max(2, Math.min(Math.round(wrap.clientHeight * dpr), MAX_CANVAS_DIM));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    if (!compRef.current) {
      try {
        compRef.current = new Compositor(canvas);
      } catch (err) {
        setGlError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    const showTiles = tilePreview && doc.tileable;
    const docW = showTiles ? doc.width * 3 : doc.width;
    const docH = showTiles ? doc.height * 3 : doc.height;
    const fitScale = Math.min(cw / docW, ch / docH) * 0.94;
    const scale = fitScale * view.zoom;
    const w = cw / scale;
    const h = ch / scale;
    const cx = (view.cx - (showTiles ? 0 : 0)) * docW - (showTiles ? doc.width : 0);
    const cy = view.cy * docH - (showTiles ? doc.height : 0);
    compRef.current.render(doc, { x: cx - w / 2, y: cy - h / 2, w, h });
  }, [doc, view, tilePreview]);

  useEffect(() => {
    const raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  useEffect(() => {
    const obs = new ResizeObserver(() => requestAnimationFrame(render));
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [render]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => ({ ...v, zoom: Math.max(0.2, Math.min(24, v.zoom * factor)) }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceDown.current || e.button === 2) {
      drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
      (e.target as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const wrap = wrapRef.current;
    if (!d || !wrap) return;
    const span = Math.min(wrap.clientWidth, wrap.clientHeight) * view.zoom;
    setView((v) => ({
      ...v,
      cx: d.cx - (e.clientX - d.x) / span,
      cy: d.cy - (e.clientY - d.y) / span,
    }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  if (glError) {
    return (
      <div className="canvas-wrap error" ref={wrapRef}>
        <p>
          <strong>WebGL2 unavailable.</strong> {glError}
        </p>
      </div>
    );
  }

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="main-canvas" />
      <div className="canvas-hud">
        <button onClick={() => setView({ zoom: 1, cx: 0.5, cy: 0.5 })}>Fit</button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(24, v.zoom * 1.4) }))}>+</button>
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.2, v.zoom / 1.4) }))}>−</button>
        <span className="hud-hint">wheel = zoom · space-drag / right-drag = pan</span>
      </div>
    </div>
  );
}
