// SVG export for vector-safe documents. Shares placement logic with the
// raster path via displaylist.ts, so vector output matches the preview.
// Text is emitted as <text> elements (outline-to-path conversion is a v2 item).

import { buildFillSpec, type Item } from './displaylist';
import { layerItems } from './canvas2d';
import type { Layer, TFDocument } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => Number(n.toFixed(2));

function itemSvg(it: Item): string {
  const tf = `transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f((it.rot * 180) / Math.PI)})"`;
  const alpha = it.alpha < 1 ? ` opacity="${f(it.alpha)}"` : '';
  if (it.kind === 'text') {
    const paint = it.fill
      ? `fill="${it.color}"`
      : `fill="none" stroke="${it.color}" stroke-width="${f(it.strokeW)}"`;
    return `<text ${tf} font-family="${esc(it.font)}" font-weight="${it.weight}" font-size="${f(it.size)}" text-anchor="middle" dominant-baseline="central" ${paint}${alpha}>${esc(it.text)}</text>`;
  }
  const r = it.size;
  const paint =
    (it.fill ? `fill="${it.color}" ` : 'fill="none" ') +
    (it.stroke ? `stroke="${it.color}" stroke-width="${f(it.strokeW)}"` : '');
  switch (it.shape) {
    case 'circle':
      return `<circle ${tf} r="${f(r)}" ${paint}${alpha}/>`;
    case 'ring':
      return `<circle ${tf} r="${f(r)}" fill="none" stroke="${it.color}" stroke-width="${f(it.strokeW)}"${alpha}/>`;
    case 'rect':
      return `<rect ${tf} x="${f(-r)}" y="${f(-r)}" width="${f(r * 2)}" height="${f(r * 2)}" ${paint}${alpha}/>`;
    case 'bar':
      return `<rect ${tf} x="${f(-r / 2)}" y="${f(-it.strokeW / 2)}" width="${f(r)}" height="${f(it.strokeW)}" fill="${it.color}"${alpha}/>`;
    case 'triangle': {
      const pts = [0, 1, 2]
        .map((i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
          return `${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`;
        })
        .join(' ');
      return `<polygon ${tf} points="${pts}" ${paint}${alpha}/>`;
    }
    case 'blob': {
      const pts = it.pts ?? [1, 1, 1, 1, 1, 1];
      const k = pts.length;
      const px = pts.map((p, i) => Math.cos((i / k) * Math.PI * 2) * r * p);
      const py = pts.map((p, i) => Math.sin((i / k) * Math.PI * 2) * r * p);
      let d = `M ${f((px[0] + px[k - 1]) / 2)} ${f((py[0] + py[k - 1]) / 2)}`;
      for (let i = 0; i < k; i++) {
        const nx = (px[i] + px[(i + 1) % k]) / 2;
        const ny = (py[i] + py[(i + 1) % k]) / 2;
        d += ` Q ${f(px[i])} ${f(py[i])} ${f(nx)} ${f(ny)}`;
      }
      return `<path ${tf} d="${d} Z" ${paint}${alpha}/>`;
    }
    case 'line':
      return `<line ${tf} x1="${f(-r)}" y1="0" x2="${f(r)}" y2="0" stroke="${it.color}" stroke-width="${f(it.strokeW)}"${alpha}/>`;
    case 'arc':
      return `<path ${tf} d="M ${f(r)} 0 A ${f(r)} ${f(r)} 0 1 1 ${f(Math.cos(Math.PI * 1.2) * r)} ${f(Math.sin(Math.PI * 1.2) * r)}" fill="none" stroke="${it.color}" stroke-width="${f(it.strokeW)}"${alpha}/>`;
  }
}

function fillSvg(layer: Layer, doc: TFDocument, defs: string[]): string {
  const spec = buildFillSpec(layer, doc);
  const id = `grad-${layer.id}`;
  const W = doc.width;
  const H = doc.height;
  switch (spec.type) {
    case 'solid':
      return `<rect width="${W}" height="${H}" fill="${spec.stops[0].color}"/>`;
    case 'conic': // SVG has no conic gradients; nearest look-alike is linear.
    case 'linear': {
      const a = ((spec.angle - 90) * Math.PI) / 180;
      const x = Math.cos(a) * 0.5;
      const y = Math.sin(a) * 0.5;
      defs.push(
        `<linearGradient id="${id}" x1="${f(0.5 - x)}" y1="${f(0.5 - y)}" x2="${f(0.5 + x)}" y2="${f(0.5 + y)}">` +
          spec.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('') +
          `</linearGradient>`,
      );
      return `<rect width="${W}" height="${H}" fill="url(#${id})"/>`;
    }
    case 'radial': {
      defs.push(
        `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.71">` +
          spec.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('') +
          `</radialGradient>`,
      );
      return `<rect width="${W}" height="${H}" fill="url(#${id})"/>`;
    }
    case 'blobs': {
      let out = `<rect width="${W}" height="${H}" fill="${spec.stops[0].color}"/>`;
      (spec.blobs ?? []).forEach((b, i) => {
        const bid = `${id}-b${i}`;
        defs.push(
          `<radialGradient id="${bid}"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${b.color}" stop-opacity="0"/></radialGradient>`,
        );
        out += `<circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.r)}" fill="url(#${bid})"/>`;
      });
      return out;
    }
  }
}

export function documentToSvg(doc: TFDocument): string {
  const defs: string[] = [];
  const body: string[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const style =
      layer.blendMode !== 'normal' ? ` style="mix-blend-mode:${layer.blendMode}"` : '';
    const op = layer.opacity < 1 ? ` opacity="${f(layer.opacity)}"` : '';
    let inner: string;
    if (layer.type === 'fill') {
      inner = fillSvg(layer, doc, defs);
    } else if (layer.type === 'noise') {
      continue; // raster-only; excluded from vector-safe documents by the UI
    } else {
      inner = layerItems(layer, doc).map(itemSvg).join('\n');
    }
    body.push(`<g${op}${style}>\n${inner}\n</g>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n` +
    (defs.length ? `<defs>\n${defs.join('\n')}\n</defs>\n` : '') +
    body.join('\n') +
    '\n</svg>'
  );
}
