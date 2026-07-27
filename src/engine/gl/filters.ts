// Declarative filter registry: each filter is a GLSL fragment `main` body plus
// a typed param schema. Adding a filter = adding one entry here. Params become
// uniforms u_<key>; 'slot' params additionally get a vec3 uniform u_<key>Col
// resolved from the document palette. Size-like params are fractions of
// min(resolution) so results scale with export resolution.

import type { ParamDef } from '../types';

export interface FilterDef {
  type: string;
  name: string;
  group: 'core' | 'distortion' | 'stylize' | 'texture';
  params: ParamDef[];
  /** Number of ping-pong passes (u_passIndex uniform tells which). */
  passes?: number;
  needsNoise?: boolean;
  frag: string; // body containing void main()
}

const num = (key: string, label: string, min: number, max: number, def: number, extra?: Partial<{ rmin: number; rmax: number; step: number }>): ParamDef => ({
  key,
  label,
  kind: 'number',
  min,
  max,
  def,
  ...extra,
});
const sel = (key: string, label: string, labels: string[], def = 0): ParamDef => ({
  key,
  label,
  kind: 'select',
  options: labels.map((l, value) => ({ value, label: l })),
  def,
});
const slot = (key: string, label: string, def: number): ParamDef => ({ key, label, kind: 'slot', def });

export const FILTERS: FilterDef[] = [
  // ------------------------------------------------------------ core
  {
    type: 'gaussianBlur',
    name: 'Gaussian Blur',
    group: 'core',
    passes: 2,
    params: [num('amount', 'Amount', 0, 0.06, 0.01, { rmax: 0.03 })],
    frag: `void main() {
      float rp = u_amount * min(u_res.x, u_res.y);
      if (rp < 0.5) { outColor = texture(u_tex, v_uv); return; }
      vec2 dir = u_passIndex < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      float sigma = max(rp * 0.5, 0.5);
      float stp = max(rp / 16.0, 1.0);
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int i = -16; i <= 16; i++) {
        float off = float(i) * stp;
        float w = exp(-off * off / (2.0 * sigma * sigma));
        acc += texture(u_tex, v_uv + dir * off / u_res) * w;
        wsum += w;
      }
      outColor = acc / wsum;
    }`,
  },
  {
    type: 'radialBlur',
    name: 'Radial Blur',
    group: 'core',
    params: [num('amount', 'Amount', 0, 0.4, 0.1), num('cx', 'Center X', 0, 1, 0.5), num('cy', 'Center Y', 0, 1, 0.5)],
    frag: `void main() {
      vec2 c = vec2(u_cx, u_cy);
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 24; i++) {
        float t = float(i) / 23.0;
        acc += texture(u_tex, mix(v_uv, c, t * u_amount));
      }
      outColor = acc / 24.0;
    }`,
  },
  {
    type: 'motionBlur',
    name: 'Motion Blur',
    group: 'core',
    params: [num('amount', 'Amount', 0, 0.2, 0.04), num('angle', 'Angle', 0, 360, 0)],
    frag: `void main() {
      float a = radians(u_angle);
      vec2 dir = vec2(cos(a), sin(a)) * u_amount;
      vec4 acc = vec4(0.0);
      for (int i = -12; i <= 12; i++) {
        acc += texture(u_tex, v_uv + dir * (float(i) / 12.0) * 0.5);
      }
      outColor = acc / 25.0;
    }`,
  },
  {
    type: 'posterize',
    name: 'Posterize',
    group: 'core',
    params: [num('levels', 'Levels', 2, 16, 5, { step: 1, rmax: 8 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float n = floor(u_levels + 0.5);
      outColor = vec4(floor(c.rgb * n + 0.5) / n, c.a);
    }`,
  },
  {
    type: 'pixelate',
    name: 'Pixelate',
    group: 'core',
    params: [num('size', 'Cell size', 0.001, 0.15, 0.02, { rmax: 0.06 })],
    frag: `void main() {
      float px = max(u_size * min(u_res.x, u_res.y), 1.0);
      vec2 g = floor(v_uv * u_res / px) * px + px * 0.5;
      outColor = texture(u_tex, g / u_res);
    }`,
  },
  {
    type: 'polar',
    name: 'Polar Coordinates',
    group: 'core',
    params: [sel('dir', 'Direction', ['rect → polar', 'polar → rect']), num('spin', 'Spin', 0, 360, 0)],
    frag: `void main() {
      float sp = radians(u_spin);
      if (u_dir < 0.5) {
        vec2 d = v_uv - 0.5;
        float r = length(d) * 2.0;
        float a = fract((atan(d.y, d.x) + sp) / TAU + 0.5);
        outColor = texture(u_tex, vec2(a, clamp(r, 0.0, 1.0)));
      } else {
        float a = v_uv.x * TAU + sp;
        float r = v_uv.y * 0.5;
        outColor = texture(u_tex, clamp(vec2(0.5) + vec2(cos(a), sin(a)) * r, 0.0, 1.0));
      }
    }`,
  },
  {
    type: 'invert',
    name: 'Invert',
    group: 'core',
    params: [num('amount', 'Amount', 0, 1, 1)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      outColor = vec4(mix(c.rgb, 1.0 - c.rgb, u_amount), c.a);
    }`,
  },
  {
    type: 'levels',
    name: 'Levels',
    group: 'core',
    params: [num('brightness', 'Brightness', -0.5, 0.5, 0, { rmin: -0.15, rmax: 0.15 }), num('contrast', 'Contrast', 0.3, 2.5, 1, { rmin: 0.8, rmax: 1.5 }), num('gamma', 'Gamma', 0.3, 2.5, 1, { rmin: 0.8, rmax: 1.3 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec3 v = (c.rgb - 0.5) * u_contrast + 0.5 + u_brightness;
      v = pow(clamp(v, 0.0, 1.0), vec3(1.0 / u_gamma));
      outColor = vec4(v, c.a);
    }`,
  },
  {
    type: 'hueSat',
    name: 'Hue / Saturation',
    group: 'core',
    params: [num('hue', 'Hue shift', -180, 180, 0), num('sat', 'Saturation', 0, 2, 1, { rmin: 0.6, rmax: 1.5 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float a = radians(u_hue);
      const mat3 toYIQ = mat3(0.299, 0.587, 0.114, 0.596, -0.274, -0.322, 0.211, -0.523, 0.312);
      const mat3 toRGB = mat3(1.0, 0.956, 0.621, 1.0, -0.272, -0.647, 1.0, -1.106, 1.703);
      vec3 yiq = c.rgb * toYIQ;
      float h = atan(yiq.z, yiq.y) + a;
      float chroma = length(yiq.yz) * u_sat;
      vec3 res = vec3(yiq.x, chroma * cos(h), chroma * sin(h)) * toRGB;
      outColor = vec4(clamp(res, 0.0, 1.0), c.a);
    }`,
  },
  // ------------------------------------------------------ distortion
  {
    type: 'displace',
    name: 'Noise Displace',
    group: 'distortion',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 0.4, 0.08, { rmax: 0.25 }), num('scale', 'Scale', 1, 30, 5, { rmax: 15 }), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec2 p = v_uv * u_scale;
      float nx = fbm(p + vec2(u_seed * 13.1, 7.7), 4, vec2(0.0));
      float ny = fbm(p + vec2(3.3, u_seed * 17.9), 4, vec2(0.0));
      outColor = texture(u_tex, v_uv + (vec2(nx, ny) - 0.5) * u_amount);
    }`,
  },
  {
    type: 'wave',
    name: 'Wave Warp',
    group: 'distortion',
    params: [num('ampX', 'Amplitude X', 0, 0.2, 0.03), num('ampY', 'Amplitude Y', 0, 0.2, 0.03), num('freq', 'Frequency', 0.5, 30, 6, { rmax: 14 }), num('phase', 'Phase', 0, 1, 0)],
    frag: `void main() {
      vec2 uv = v_uv;
      uv.x += sin((v_uv.y + u_phase) * u_freq * TAU * 0.5) * u_ampX;
      uv.y += sin((v_uv.x + u_phase) * u_freq * TAU * 0.5) * u_ampY;
      outColor = texture(u_tex, uv);
    }`,
  },
  {
    type: 'twirl',
    name: 'Twirl',
    group: 'distortion',
    params: [num('angle', 'Angle', -720, 720, 180, { rmin: -420, rmax: 420 }), num('radius', 'Radius', 0.1, 1.5, 0.7)],
    frag: `void main() {
      vec2 d = v_uv - 0.5;
      float r = length(d);
      float t = 1.0 - smoothstep(0.0, u_radius, r);
      float a = radians(u_angle) * t * t;
      outColor = texture(u_tex, 0.5 + rot2(a) * d);
    }`,
  },
  {
    type: 'ripple',
    name: 'Ripple',
    group: 'distortion',
    params: [num('amount', 'Amount', 0, 0.1, 0.02), num('freq', 'Frequency', 1, 60, 18), num('phase', 'Phase', 0, 1, 0)],
    frag: `void main() {
      vec2 d = v_uv - 0.5;
      float r = length(d);
      float off = sin(r * u_freq * TAU - u_phase * TAU) * u_amount;
      outColor = texture(u_tex, v_uv + normalize(d + 1e-6) * off);
    }`,
  },
  {
    type: 'lens',
    name: 'Lens / Fisheye',
    group: 'distortion',
    params: [num('amount', 'Amount', -1, 1, 0.4, { rmin: -0.7, rmax: 0.7 })],
    frag: `void main() {
      vec2 d = v_uv - 0.5;
      float r = length(d) * 2.0;
      float f = 1.0 + u_amount * (r * r - 1.0) * 0.5;
      outColor = texture(u_tex, 0.5 + d * f);
    }`,
  },
  {
    type: 'kaleidoscope',
    name: 'Kaleidoscope',
    group: 'distortion',
    params: [num('segments', 'Segments', 2, 24, 6, { step: 1, rmax: 12 }), num('spin', 'Spin', 0, 360, 0)],
    frag: `void main() {
      vec2 d = v_uv - 0.5;
      float seg = TAU / floor(u_segments + 0.5);
      float a = atan(d.y, d.x) + radians(u_spin);
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      outColor = texture(u_tex, clamp(0.5 + vec2(cos(a), sin(a)) * length(d), 0.0, 1.0));
    }`,
  },
  {
    type: 'flow',
    name: 'Flow Smear',
    group: 'distortion',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 0.15, 0.04), num('scale', 'Scale', 1, 20, 4), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec2 uv = v_uv;
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 10; i++) {
        float ang = fbm(uv * u_scale + vec2(u_seed * 7.3, 0.0), 3, vec2(0.0)) * TAU * 2.0;
        uv += vec2(cos(ang), sin(ang)) * u_amount * 0.1;
        acc += texture(u_tex, uv);
      }
      outColor = acc / 10.0;
    }`,
  },
  // -------------------------------------------------------- stylize
  {
    type: 'halftone',
    name: 'Halftone',
    group: 'stylize',
    params: [sel('mode', 'Mode', ['dots', 'lines']), num('size', 'Cell size', 0.002, 0.05, 0.01), num('angle', 'Angle', 0, 180, 45), slot('ink', 'Ink', 0), slot('paper', 'Paper', -1)],
    frag: `void main() {
      float cell = max(u_size * min(u_res.x, u_res.y), 2.0);
      mat2 R = rot2(radians(u_angle));
      vec2 g = (R * (v_uv * u_res)) / cell;
      vec2 center = (floor(g) + 0.5) * cell;
      vec2 suv = (transpose(R) * center) / u_res;
      vec4 src = texture(u_tex, clamp(suv, 0.0, 1.0));
      float l = luma(src.rgb);
      float v;
      if (u_mode < 0.5) {
        float rMax = 0.75;
        v = step(length(fract(g) - 0.5), sqrt(1.0 - l) * rMax);
      } else {
        v = step(abs(fract(g.y) - 0.5) * 2.0, 1.0 - l);
      }
      vec3 paper = u_paper < -0.5 ? vec3(1.0) : u_paperCol;
      outColor = vec4(mix(paper, u_inkCol, v), src.a);
    }`,
  },
  {
    type: 'dither',
    name: 'Ordered Dither',
    group: 'stylize',
    params: [num('levels', 'Levels', 2, 6, 2, { step: 1 }), num('size', 'Dot size', 1, 8, 2, { step: 1 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      vec2 p = floor(v_uv * u_res / max(u_size, 1.0));
      int idx = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
      float t = (b[idx] + 0.5) / 16.0 - 0.5;
      float n = floor(u_levels + 0.5) - 1.0;
      outColor = vec4(clamp(floor((c.rgb + t / n) * n + 0.5) / n, 0.0, 1.0), c.a);
    }`,
  },
  {
    type: 'scanlines',
    name: 'Scanlines',
    group: 'stylize',
    params: [num('size', 'Spacing', 0.001, 0.03, 0.004), num('strength', 'Strength', 0, 1, 0.4), num('angle', 'Angle', 0, 180, 0)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float sp = max(u_size * min(u_res.x, u_res.y), 1.5);
      vec2 p = rot2(radians(u_angle)) * (v_uv * u_res);
      float s = 0.5 + 0.5 * sin(p.y / sp * TAU);
      outColor = vec4(c.rgb * (1.0 - u_strength * s), c.a);
    }`,
  },
  {
    type: 'chromatic',
    name: 'Chromatic Aberration',
    group: 'stylize',
    params: [num('amount', 'Amount', 0, 0.03, 0.006, { rmax: 0.015 })],
    frag: `void main() {
      vec2 d = (v_uv - 0.5) * u_amount * 2.0;
      float r = texture(u_tex, v_uv + d).r;
      vec4 g = texture(u_tex, v_uv);
      float b = texture(u_tex, v_uv - d).b;
      outColor = vec4(r, g.g, b, g.a);
    }`,
  },
  {
    type: 'glow',
    name: 'Glow / Bloom',
    group: 'stylize',
    params: [num('amount', 'Amount', 0, 2, 0.7), num('radius', 'Radius', 0.005, 0.08, 0.03), num('threshold', 'Threshold', 0, 1, 0.6)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec3 acc = vec3(0.0);
      float rp = u_radius;
      for (int i = 0; i < 16; i++) {
        float a = float(i) / 16.0 * TAU;
        float rr = (float(i % 4) + 1.0) / 4.0;
        vec3 s = texture(u_tex, v_uv + vec2(cos(a), sin(a)) * rp * rr).rgb;
        acc += max(s - u_threshold, 0.0);
      }
      outColor = vec4(c.rgb + acc / 16.0 * u_amount * 2.0, c.a);
    }`,
  },
  {
    type: 'duotone',
    name: 'Duotone / Gradient Map',
    group: 'stylize',
    params: [slot('dark', 'Shadows', 0), slot('light', 'Highlights', 3), num('mix', 'Mix', 0, 1, 1)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float l = luma(c.rgb);
      vec3 mapped = mix(u_darkCol, u_lightCol, smoothstep(0.0, 1.0, l));
      outColor = vec4(mix(c.rgb, mapped, u_mix), c.a);
    }`,
  },
  {
    type: 'threshold',
    name: 'Threshold',
    group: 'stylize',
    params: [num('level', 'Level', 0.05, 0.95, 0.5), num('soft', 'Softness', 0, 0.4, 0.02)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float v = smoothstep(u_level - u_soft, u_level + u_soft, luma(c.rgb));
      outColor = vec4(vec3(v), c.a);
    }`,
  },
  {
    type: 'edge',
    name: 'Edge Detect',
    group: 'stylize',
    params: [num('strength', 'Strength', 0, 4, 1.5), sel('mode', 'Mode', ['edges only', 'overlay'])],
    frag: `void main() {
      vec2 t = 1.0 / u_res;
      float tl = luma(texture(u_tex, v_uv + vec2(-t.x, -t.y)).rgb);
      float  l = luma(texture(u_tex, v_uv + vec2(-t.x, 0.)).rgb);
      float bl = luma(texture(u_tex, v_uv + vec2(-t.x, t.y)).rgb);
      float tt = luma(texture(u_tex, v_uv + vec2(0., -t.y)).rgb);
      float bb = luma(texture(u_tex, v_uv + vec2(0., t.y)).rgb);
      float tr = luma(texture(u_tex, v_uv + vec2(t.x, -t.y)).rgb);
      float  r = luma(texture(u_tex, v_uv + vec2(t.x, 0.)).rgb);
      float br = luma(texture(u_tex, v_uv + vec2(t.x, t.y)).rgb);
      float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl;
      float gy = bl + 2.0 * bb + br - tl - 2.0 * tt - tr;
      float e = clamp(length(vec2(gx, gy)) * u_strength, 0.0, 1.0);
      vec4 c = texture(u_tex, v_uv);
      outColor = u_mode < 0.5 ? vec4(vec3(e), c.a) : vec4(mix(c.rgb, vec3(1.0), e), c.a);
    }`,
  },
  // -------------------------------------------------------- texture
  {
    type: 'grain',
    name: 'Film Grain',
    group: 'texture',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 0.5, 0.12, { rmax: 0.25 }), num('size', 'Grain size', 1, 6, 1.5), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 p = floor(v_uv * u_res / max(u_size, 1.0));
      float n = hash1(p + u_seed * 31.7) - 0.5;
      outColor = vec4(clamp(c.rgb + n * u_amount, 0.0, 1.0), c.a);
    }`,
  },
  {
    type: 'paper',
    name: 'Paper Fiber',
    group: 'texture',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 0.6, 0.2), num('scale', 'Scale', 20, 300, 120)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 asp = vec2(u_res.x / u_res.y, 1.0);
      float f = fbm(v_uv * asp * u_scale, 4, vec2(0.0));
      float fibers = fbm(v_uv * asp * vec2(u_scale * 4.0, u_scale * 0.5), 2, vec2(0.0));
      float v = 1.0 - u_amount * (0.6 * (f - 0.5) + 0.4 * (fibers - 0.5) + 0.15);
      outColor = vec4(c.rgb * v, c.a);
    }`,
  },
  {
    type: 'weave',
    name: 'Canvas Weave',
    group: 'texture',
    params: [num('amount', 'Amount', 0, 0.6, 0.2), num('size', 'Thread size', 0.001, 0.02, 0.004)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      float sp = max(u_size * min(u_res.x, u_res.y), 2.0);
      vec2 p = v_uv * u_res / sp;
      float w = sin(p.x * TAU) * sin(p.y * TAU);
      outColor = vec4(c.rgb * (1.0 - u_amount * 0.5 * (w * 0.5 + 0.5)), c.a);
    }`,
  },
  {
    type: 'marble',
    name: 'Marble Veins',
    group: 'texture',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 1, 0.4), num('scale', 'Scale', 1, 20, 4), num('turbulence', 'Turbulence', 0, 8, 3), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 asp = vec2(u_res.x / u_res.y, 1.0);
      vec2 p = v_uv * asp * u_scale + u_seed * 11.3;
      float t = fbm(p, 5, vec2(0.0)) * u_turbulence;
      float veins = abs(sin((p.x + t) * TAU * 0.5));
      veins = pow(veins, 0.3);
      outColor = vec4(mix(c.rgb, c.rgb * veins, u_amount), c.a);
    }`,
  },
  {
    type: 'voronoi',
    name: 'Voronoi Cells',
    group: 'texture',
    needsNoise: true,
    params: [sel('mode', 'Mode', ['cells', 'cracks']), num('amount', 'Amount', 0, 1, 0.4), num('scale', 'Scale', 2, 40, 10), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 asp = vec2(u_res.x / u_res.y, 1.0);
      float w = worley(v_uv * asp * u_scale + u_seed * 7.9, vec2(0.0));
      float v = u_mode < 0.5 ? w : 1.0 - smoothstep(0.0, 0.12, w);
      outColor = vec4(mix(c.rgb, c.rgb * (1.0 - v * 0.8), u_amount), c.a);
    }`,
  },
  {
    type: 'wood',
    name: 'Wood Rings',
    group: 'texture',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 1, 0.4), num('rings', 'Ring count', 4, 60, 20), num('distort', 'Distort', 0, 2, 0.6), num('seed', 'Variant', 0, 100, 0, { step: 1 })],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 d = v_uv - 0.5;
      float n = fbm(v_uv * 6.0 + u_seed * 5.1, 4, vec2(0.0));
      float r = length(d) + n * u_distort * 0.2;
      float rings = 0.5 + 0.5 * sin(r * u_rings * TAU * 0.5);
      rings = pow(rings, 0.5);
      outColor = vec4(mix(c.rgb, c.rgb * (0.6 + 0.4 * rings), u_amount), c.a);
    }`,
  },
  {
    type: 'metal',
    name: 'Brushed Metal',
    group: 'texture',
    needsNoise: true,
    params: [num('amount', 'Amount', 0, 0.8, 0.3), num('angle', 'Angle', 0, 180, 0), num('scale', 'Scale', 20, 400, 150)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 p = rot2(radians(u_angle)) * v_uv;
      float streaks = fbm(vec2(p.x * 2.0, p.y * u_scale), 3, vec2(0.0));
      outColor = vec4(c.rgb * (1.0 - u_amount * (streaks - 0.5)), c.a);
    }`,
  },
  {
    type: 'vignette',
    name: 'Vignette',
    group: 'texture',
    params: [num('amount', 'Amount', 0, 1, 0.35), num('radius', 'Radius', 0.2, 1.2, 0.75), num('soft', 'Softness', 0.05, 1, 0.45)],
    frag: `void main() {
      vec4 c = texture(u_tex, v_uv);
      vec2 d = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.0;
      float v = smoothstep(u_radius, u_radius + u_soft, length(d) * 0.7071);
      outColor = vec4(c.rgb * (1.0 - u_amount * v), c.a);
    }`,
  },
];

export const FILTER_MAP: Record<string, FilterDef> = Object.fromEntries(FILTERS.map((f) => [f.type, f]));

export const FILTER_GROUPS: { id: FilterDef['group']; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'distortion', label: 'Distortion' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'texture', label: 'Texture' },
];
