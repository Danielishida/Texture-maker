// WebGL2 compositor: renders a document region to its canvas.
// Per layer: rasterize/generate content → run effect passes (ping-pong FBOs)
// → blend into the accumulator. Works on HTMLCanvasElement or OffscreenCanvas
// (worker-safe), which is what makes tiled high-res export possible.

import { COMMON_GLSL, NOISE_GLSL, VERT_SRC } from './glsl';
import { FILTER_MAP, type FilterDef } from './filters';
import { renderLayer2D, type Region } from '../canvas2d';
import { hexToRgb01, slotColor } from '../palette';
import { BLEND_MODES, type Layer, type TFDocument } from '../types';

const BLEND_GLSL = `
vec3 blendRGB(vec3 b, vec3 s, int mode) {
  if (mode == 1) return b * s;                                  // multiply
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);            // screen
  if (mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); // overlay
  if (mode == 4) return min(b, s);                              // darken
  if (mode == 5) return max(b, s);                              // lighten
  if (mode == 6) return clamp(b / max(1.0 - s, 1e-4), 0.0, 1.0); // color-dodge
  if (mode == 7) return 1.0 - clamp((1.0 - b) / max(s, 1e-4), 0.0, 1.0); // color-burn
  if (mode == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s)); // hard-light
  if (mode == 9) {                                              // soft-light
    vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  if (mode == 10) return abs(b - s);                            // difference
  if (mode == 11) return b + s - 2.0 * b * s;                   // exclusion
  return s;                                                     // normal
}`;

const BLEND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_base; uniform sampler2D u_layer;
uniform float u_opacity; uniform int u_mode;
${BLEND_GLSL}
void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 s = texture(u_layer, v_uv);
  s.a *= u_opacity;
  vec3 srcCol = mix(s.rgb, blendRGB(clamp(b.rgb,0.0,1.0), clamp(s.rgb,0.0,1.0), u_mode), b.a);
  float outA = s.a + b.a * (1.0 - s.a);
  vec3 outC = (srcCol * s.a + b.rgb * b.a * (1.0 - s.a)) / max(outA, 1e-5);
  outColor = vec4(outC, outA);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex;
void main() { outColor = texture(u_tex, v_uv); }`;

// Noise-field layer generator. Coordinates are document-normalized (divided by
// min dimension) so frequency is resolution- and region-independent.
const NOISE_LAYER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform vec4 u_regionN;   // region x,y,w,h in doc units / minDim
uniform float u_frequency; uniform int u_octaves; uniform float u_contrast;
uniform int u_noiseType; uniform int u_mapMode; uniform float u_warp;
uniform vec3 u_colA; uniform vec3 u_colB; uniform vec3 u_pal[5];
uniform vec2 u_period;    // integer periods for tiling (0 = non-tiling)
uniform float u_seedOff;
${COMMON_GLSL}
${NOISE_GLSL}
void main() {
  vec2 w = u_regionN.xy + vec2(v_uv.x, 1.0 - v_uv.y) * u_regionN.zw;
  vec2 p = w * u_frequency + u_seedOff * 37.7;
  if (u_warp > 0.001) {
    vec2 q = vec2(fbm(p + vec2(1.7, 9.2), 3, u_period), fbm(p + vec2(8.3, 2.8), 3, u_period));
    p += (q - 0.5) * u_warp * 4.0;
  }
  float v;
  if (u_noiseType == 3) {
    v = clamp(worley(p, u_period) * 1.2, 0.0, 1.0);
  } else {
    v = fbm(p, u_octaves, u_period);
    if (u_noiseType == 1) v = abs(2.0 * v - 1.0);            // billow
    else if (u_noiseType == 2) v = 1.0 - abs(2.0 * v - 1.0); // ridged
  }
  v = clamp((v - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 col;
  if (u_mapMode == 0) col = vec3(v);
  else if (u_mapMode == 1) col = mix(u_colA, u_colB, v);
  else {
    float t = v * 4.0;
    int i = int(clamp(floor(t), 0.0, 3.0));
    col = mix(u_pal[i], u_pal[i + 1], fract(t));
  }
  outColor = vec4(col, 1.0);
}`;

function buildFilterFrag(def: FilterDef): string {
  let uniforms = '';
  for (const p of def.params) {
    uniforms += `uniform float u_${p.key};\n`;
    if (p.kind === 'slot') uniforms += `uniform vec3 u_${p.key}Col;\n`;
  }
  return `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_passIndex;
${COMMON_GLSL}
${def.needsNoise ? NOISE_GLSL : ''}
${uniforms}
${def.frag}`;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private uniformLocs = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private targets: Target[] = [];
  private width = 0;
  private height = 0;
  private scratch: HTMLCanvasElement | OffscreenCanvas;
  readonly maxTexSize: number;

  constructor(public readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.scratch =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  }

  private program(key: string, frag: string): WebGLProgram {
    let prog = this.programs.get(key);
    if (prog) return prog;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`Shader "${key}" failed: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program "${key}" link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.programs.set(key, prog);
    this.uniformLocs.set(prog, new Map());
    return prog;
  }

  private loc(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    const cache = this.uniformLocs.get(prog)!;
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(prog, name));
    return cache.get(name)!;
  }

  private makeTarget(wrap: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  private ensureSize(w: number, h: number, tileable: boolean) {
    if (w === this.width && h === this.height && this.targets.length === 5) return;
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.width = w;
    this.height = h;
    const wrap = tileable ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    // 0,1: layer ping-pong; 2,3: accumulator ping-pong; 4: layer source upload
    this.targets = [0, 1, 2, 3, 4].map(() => this.makeTarget(wrap));
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Render `region` of the document into the full canvas. */
  render(doc: TFDocument, region?: Region): void {
    const gl = this.gl;
    const canvas = this.canvas;
    const outW = canvas.width;
    const outH = canvas.height;
    const reg: Region = region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    this.ensureSize(outW, outH, doc.tileable);
    gl.viewport(0, 0, outW, outH);

    const [pingA, pingB, accA, accB, srcT] = this.targets;
    let accum = accA;
    let accumOther = accB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vectorSafe = doc.colorMode === 'vector-safe';
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      if (vectorSafe && layer.type === 'noise') continue; // raster-only layer
      let layerTex = this.renderLayerContent(layer, doc, reg, srcT, pingA);
      // Effect chain (ping-pong between pingA/pingB). Skipped in vector-safe
      // mode so the preview matches what SVG export can represent.
      for (const fx of vectorSafe ? [] : layer.effects) {
        if (!fx.enabled) continue;
        const def = FILTER_MAP[fx.filterType];
        if (!def) continue;
        const passes = def.passes ?? 1;
        for (let pass = 0; pass < passes; pass++) {
          const dst = layerTex === pingA.tex ? pingB : pingA;
          this.runFilterPass(def, fx.params as Record<string, number>, doc, layerTex, dst, pass);
          layerTex = dst.tex;
        }
      }
      // Blend into accumulator.
      const prog = this.program('blend', BLEND_FRAG);
      gl.useProgram(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, accumOther.fbo);
      this.bindTex(0, accum.tex);
      this.bindTex(1, layerTex);
      gl.uniform1i(this.loc(prog, 'u_base'), 0);
      gl.uniform1i(this.loc(prog, 'u_layer'), 1);
      gl.uniform1f(this.loc(prog, 'u_opacity'), layer.opacity);
      gl.uniform1i(this.loc(prog, 'u_mode'), Math.max(0, BLEND_MODES.indexOf(layer.blendMode)));
      this.draw();
      [accum, accumOther] = [accumOther, accum];
    }

    // Blit accumulator to the canvas.
    const copy = this.program('copy', COPY_FRAG);
    gl.useProgram(copy);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bindTex(0, accum.tex);
    gl.uniform1i(this.loc(copy, 'u_tex'), 0);
    this.draw();
  }

  private renderLayerContent(layer: Layer, doc: TFDocument, reg: Region, srcT: Target, pingA: Target): WebGLTexture {
    const gl = this.gl;
    if (layer.type === 'noise') {
      const prog = this.program('gen:noise', NOISE_LAYER_FRAG);
      gl.useProgram(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingA.fbo);
      const minDim = Math.min(doc.width, doc.height);
      const p = layer.params as Record<string, number>;
      gl.uniform4f(this.loc(prog, 'u_regionN'), reg.x / minDim, reg.y / minDim, reg.w / minDim, reg.h / minDim);
      let freq = p.frequency ?? 4;
      let period: [number, number] = [0, 0];
      if (doc.tileable) {
        // Periods must be integers for mod-wrapped lattice noise to tile.
        const pw = Math.max(1, Math.round((freq * doc.width) / minDim));
        const ph = Math.max(1, Math.round((freq * doc.height) / minDim));
        period = [pw, ph];
        freq = (pw * minDim) / doc.width; // snap frequency so periods stay integral
      }
      gl.uniform1f(this.loc(prog, 'u_frequency'), freq);
      gl.uniform1i(this.loc(prog, 'u_octaves'), Math.round(p.octaves ?? 4));
      gl.uniform1f(this.loc(prog, 'u_contrast'), p.contrast ?? 1);
      gl.uniform1i(this.loc(prog, 'u_noiseType'), Math.round(p.noiseType ?? 0));
      gl.uniform1i(this.loc(prog, 'u_mapMode'), Math.round(p.mapMode ?? 2));
      gl.uniform1f(this.loc(prog, 'u_warp'), p.warp ?? 0);
      gl.uniform2f(this.loc(prog, 'u_period'), period[0], period[1]);
      // Deterministic per-layer offset so two noise layers differ.
      let h = 0;
      for (const ch of layer.seed) h = (h * 31 + ch.charCodeAt(0)) % 1000;
      gl.uniform1f(this.loc(prog, 'u_seedOff'), h / 37);
      const colA = hexToRgb01(slotColor(doc.palette, p.slotA ?? 0));
      const colB = hexToRgb01(slotColor(doc.palette, p.slotB ?? 3));
      gl.uniform3f(this.loc(prog, 'u_colA'), ...colA);
      gl.uniform3f(this.loc(prog, 'u_colB'), ...colB);
      const pal = new Float32Array(15);
      doc.palette.colors.forEach((c, i) => pal.set(hexToRgb01(c), i * 3));
      gl.uniform3fv(this.loc(prog, 'u_pal'), pal);
      this.draw();
      return pingA.tex;
    }
    // 2D-source layers: rasterize then upload.
    const sc = this.scratch;
    if (sc.width !== this.width || sc.height !== this.height) {
      sc.width = this.width;
      sc.height = this.height;
    }
    renderLayer2D(sc, layer, doc, reg);
    this.bindTex(0, srcT.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sc as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return srcT.tex;
  }

  private runFilterPass(
    def: FilterDef,
    params: Record<string, number>,
    doc: TFDocument,
    srcTex: WebGLTexture,
    dst: Target,
    passIndex: number,
  ) {
    const gl = this.gl;
    const prog = this.program('fx:' + def.type, buildFilterFrag(def));
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    this.bindTex(0, srcTex);
    gl.uniform1i(this.loc(prog, 'u_tex'), 0);
    gl.uniform2f(this.loc(prog, 'u_res'), this.width, this.height);
    gl.uniform1f(this.loc(prog, 'u_passIndex'), passIndex);
    for (const p of def.params) {
      const v = typeof params[p.key] === 'number' ? (params[p.key] as number) : Number(p.kind === 'text' || p.kind === 'font' ? 0 : p.def);
      gl.uniform1f(this.loc(prog, `u_${p.key}`), v);
      if (p.kind === 'slot') {
        const col = hexToRgb01(slotColor(doc.palette, Math.round(v)));
        gl.uniform3f(this.loc(prog, `u_${p.key}Col`), ...col);
      }
    }
    this.draw();
  }

  destroy() {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    for (const p of this.programs.values()) gl.deleteProgram(p);
    this.programs.clear();
    this.targets = [];
  }
}
