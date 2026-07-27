// Shared GLSL chunks injected into every filter/generator fragment shader.

export const VERT_SRC = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const COMMON_GLSL = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot2(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
const float TAU = 6.28318530718;
`;

export const NOISE_GLSL = `
float hash1(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash2(vec2 p) {
  float n = hash1(p);
  return vec2(n, hash1(p + n + 17.17));
}
float vnoise(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i00 = i, i10 = i + vec2(1, 0), i01 = i + vec2(0, 1), i11 = i + vec2(1, 1);
  if (period.x > 0.0) {
    i00 = mod(i00, period); i10 = mod(i10, period);
    i01 = mod(i01, period); i11 = mod(i11, period);
  }
  float a = hash1(i00), b = hash1(i10), c = hash1(i01), d = hash1(i11);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct, vec2 period) {
  float v = 0.0, amp = 0.5, norm = 0.0;
  vec2 per = period;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    v += amp * vnoise(p, per);
    norm += amp;
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return v / max(norm, 1e-5);
}
float worley(vec2 p, vec2 period) {
  vec2 i = floor(p);
  float d = 9.0;
  for (int dx = -1; dx <= 1; dx++)
  for (int dy = -1; dy <= 1; dy++) {
    vec2 g = i + vec2(float(dx), float(dy));
    vec2 gw = period.x > 0.0 ? mod(g, period) : g;
    vec2 o = hash2(gw);
    vec2 diff = g + o - p;
    d = min(d, dot(diff, diff));
  }
  return sqrt(d);
}
`;
