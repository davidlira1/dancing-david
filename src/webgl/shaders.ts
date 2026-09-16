export const RIBBON_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_center;
in vec2 a_normal;
in float a_side;
in float a_life;
in float a_depth;
in float a_perspective;

uniform vec2 u_resolution;
uniform float u_maxWidth;
uniform float u_minWidthScale;

out float v_side;
out float v_life;
out float v_depth;
out float v_perspective;
out vec2 v_uv;

void main() {
  float widthScale = mix(u_minWidthScale, 1.0, smoothstep(0.0, 1.0, a_life));
  float halfWidth = 0.5 * u_maxWidth * widthScale * a_perspective;
  vec2 pos = a_center + a_normal * a_side * halfWidth;
  vec2 clip = vec2(
    (pos.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (pos.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_side = a_side;
  v_life = a_life;
  v_depth = a_depth;
  v_perspective = a_perspective;
  v_uv = vec2(pos.x / u_resolution.x, pos.y / u_resolution.y);
}
`;

export const RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_side;
in float v_life;
in float v_depth;
in float v_perspective;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_coreWidth;
uniform float u_edgeSoftness;
uniform float u_tailFadeEnd;
uniform float u_intensity;
uniform float u_depthEnabled;
uniform float u_depthViz;
uniform float u_depthBloomStrength;
uniform float u_occlusionEnabled;
uniform float u_occlusionBias;
uniform float u_occlusionSoftness;
uniform float u_segThreshold;
uniform float u_headAttach;
uniform float u_hasMask;
uniform float u_calibrated;
uniform float u_occlusionViz;
uniform float u_depthPackRange;
uniform sampler2D u_personMask;
uniform sampler2D u_bodyDepth;
uniform vec3 u_coreColor;
uniform vec3 u_cyan;
uniform vec3 u_blue;
uniform vec3 u_violet;

void main() {
  float d = abs(v_side);
  float core = 1.0 - smoothstep(0.0, u_coreWidth, d);
  vec3 color = u_violet;
  color = mix(color, u_blue, smoothstep(0.88, 0.48, d));
  color = mix(color, u_cyan, smoothstep(0.46, 0.16, d));
  color = mix(color, u_coreColor, core);
  color += u_coreColor * core * 0.55;

  if (u_depthEnabled > 0.5) {
    float near = clamp(v_depth / 0.25, 0.0, 1.0);
    float far = clamp(-v_depth / 0.25, 0.0, 1.0);
    color = mix(color, u_violet, far * 0.18);
    color = mix(color, u_cyan, near * 0.16);
  }

  if (u_depthViz > 0.5) {
    vec3 viz = mix(vec3(0.18, 0.42, 1.0), vec3(0.18, 0.95, 0.32), smoothstep(-0.22, 0.0, v_depth));
    viz = mix(viz, vec3(1.0, 0.22, 0.16), smoothstep(0.0, 0.22, v_depth));
    color = viz + u_coreColor * core * 0.35;
  }

  vec2 maskUv = vec2(v_uv.x, 1.0 - v_uv.y);
  float person = texture(u_personMask, maskUv).a;
  vec4 bodyTex = texture(u_bodyDepth, maskUv);
  float bodyZ = bodyTex.r * 2.0 * u_depthPackRange - u_depthPackRange;
  float bodyValid = bodyTex.g;
  float depthFactor = 1.0;
  if (bodyValid > 0.5) {
    float delta = v_depth - bodyZ;
    float lo = -(u_occlusionBias + u_occlusionSoftness);
    float hi = u_occlusionBias + u_occlusionSoftness;
    depthFactor = smoothstep(lo, hi, delta);
  }
  float personAmt = smoothstep(u_segThreshold, 1.0, person);
  float occ = mix(1.0, depthFactor, personAmt);
  float attach = smoothstep(1.0 - u_headAttach, 1.0, v_life);
  occ = mix(occ, 1.0, attach);
  if (u_occlusionEnabled < 0.5 || u_hasMask < 0.5 || u_calibrated < 0.5) {
    occ = 1.0;
  }

  if (u_occlusionViz > 0.5) {
    vec3 decision = vec3(0.2, 0.95, 0.28);
    decision = mix(vec3(1.0, 0.85, 0.12), decision, smoothstep(0.35, 0.8, depthFactor));
    decision = mix(vec3(1.0, 0.18, 0.16), decision, smoothstep(0.2, 0.55, depthFactor));
    color = mix(color, decision, mix(0.25, 1.0, personAmt));
  }

  float edgeStart = max(0.0, 1.0 - u_edgeSoftness);
  float edgeAlpha = 1.0 - smoothstep(edgeStart, 1.0, d);
  float lifeAlpha = smoothstep(0.0, u_tailFadeEnd, v_life);
  float depthGlow = mix(1.0, clamp(v_perspective, 0.72, 1.35), u_depthBloomStrength * u_depthEnabled);
  float hide = u_occlusionViz > 0.5 ? 1.0 : occ;
  float alpha = edgeAlpha * lifeAlpha * u_intensity * mix(1.0, 1.2, core) * depthGlow * hide;
  fragColor = vec4(color * hide, alpha);
}
`;

export const ORB_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_corner;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_quadRadius;
uniform float u_sphereRadius;

out vec2 v_p;
out vec2 v_uv;

void main() {
  vec2 pos = u_center + a_corner * u_quadRadius;
  vec2 clip = vec2(
    (pos.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (pos.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_p = a_corner * (u_quadRadius / max(u_sphereRadius, 1.0));
  v_uv = vec2(pos.x / u_resolution.x, pos.y / u_resolution.y);
}
`;

export const ORB_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_p;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform float u_intensity;
uniform float u_charge;
uniform float u_fade;
uniform float u_bloomStrength;
uniform float u_depth;
uniform float u_occlusionEnabled;
uniform float u_occlusionBias;
uniform float u_occlusionSoftness;
uniform float u_segThreshold;
uniform float u_hasMask;
uniform float u_calibrated;
uniform float u_occlusionViz;
uniform float u_depthPackRange;
uniform sampler2D u_personMask;
uniform sampler2D u_bodyDepth;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  v += valueNoise(p) * 0.55;
  v += valueNoise(p * 2.07) * 0.30;
  v += valueNoise(p * 4.13) * 0.15;
  return v;
}

void main() {
  float r = length(v_p);
  if (r > 2.45) {
    discard;
  }

  float t = u_time * mix(0.55, 1.35, u_charge);
  float ang = atan(v_p.y, v_p.x);
  float cs = cos(t * 0.7);
  float sn = sin(t * 0.7);
  vec2 swirl = vec2(
    v_p.x * cs - v_p.y * sn,
    v_p.x * sn + v_p.y * cs
  );
  float n = fbm(swirl * 2.4 + vec2(t * 0.22, -t * 0.17));
  float n2 = fbm(swirl * 5.1 - vec2(t * 0.31, t * 0.19));
  float plasma = mix(n, n2, 0.45);

  float sph = sqrt(max(0.0, 1.0 - r * r));
  float core = exp(-pow(r * 3.4, 2.0)) * (0.75 + 0.35 * plasma);
  float body = pow(sph, 0.65) * (0.55 + 0.55 * plasma);
  float rim = pow(sph, 0.25) * smoothstep(0.28, 0.92, r) * (0.7 + 0.5 * n2);
  float filament = pow(
    abs(sin(ang * 3.0 + t * 1.6 + plasma * 6.0)),
    18.0
  ) * sph * (0.35 + 0.65 * n2);
  float edgeNoise = (n - 0.5) * 0.12;
  float disk = 1.0 - smoothstep(0.86 + edgeNoise, 1.06 + edgeNoise, r);
  float halo = exp(-pow(max(r - 0.15, 0.0) * 0.72, 2.0)) * 0.42;

  vec3 coreCol = vec3(0.95, 0.99, 1.0);
  vec3 bodyCol = vec3(0.18, 0.82, 1.0);
  vec3 rimCol = vec3(0.72, 0.18, 1.0);
  vec3 filamentCol = vec3(0.85, 0.95, 1.0);

  vec3 color = bodyCol * body;
  color += coreCol * core * (1.35 + u_bloomStrength * 0.85);
  color += rimCol * rim * 0.95;
  color += filamentCol * filament * 1.1;
  color += rimCol * halo * 0.55;
  color *= disk;

  float spark = mix(1.4, 1.0, u_charge);
  color *= spark;

  vec2 maskUv = vec2(v_uv.x, 1.0 - v_uv.y);
  float person = texture(u_personMask, maskUv).a;
  vec4 bodyTex = texture(u_bodyDepth, maskUv);
  float bodyZ = bodyTex.r * 2.0 * u_depthPackRange - u_depthPackRange;
  float bodyValid = bodyTex.g;
  float depthFactor = 1.0;
  if (bodyValid > 0.5) {
    float delta = u_depth - bodyZ;
    float lo = -(u_occlusionBias + u_occlusionSoftness);
    float hi = u_occlusionBias + u_occlusionSoftness;
    depthFactor = smoothstep(lo, hi, delta);
  }
  float personAmt = smoothstep(u_segThreshold, 1.0, person);
  float occ = mix(1.0, depthFactor, personAmt);
  if (u_occlusionEnabled < 0.5 || u_hasMask < 0.5 || u_calibrated < 0.5) {
    occ = 1.0;
  }
  if (u_occlusionViz > 0.5) {
    vec3 decision = vec3(0.2, 0.95, 0.28);
    decision = mix(vec3(1.0, 0.85, 0.12), decision, smoothstep(0.35, 0.8, depthFactor));
    decision = mix(vec3(1.0, 0.18, 0.16), decision, smoothstep(0.2, 0.55, depthFactor));
    color = mix(color, decision, mix(0.25, 1.0, personAmt));
  }

  float hide = u_occlusionViz > 0.5 ? 1.0 : occ;
  float alpha = (core * 1.15 + body * 0.85 + rim * 0.7 + filament * 0.55 + halo)
    * u_intensity * u_fade * hide;
  fragColor = vec4(color * hide, alpha);
}
`;

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_uv;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}
`;

export const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_texel;
uniform vec2 u_direction;
uniform float u_radius;
uniform float u_threshold;

// 13-tap Gaussian, sigma ~2.5, normalized.
const float W0 = 0.16098;
const float W1 = 0.14860;
const float W2 = 0.11691;
const float W3 = 0.07838;
const float W4 = 0.04476;
const float W5 = 0.02179;
const float W6 = 0.00903;

vec4 tap(vec2 uv) {
  vec4 color = texture(u_source, uv);
  float brightness = max(color.r, max(color.g, color.b));
  float gate = step(u_threshold, brightness);
  return color * gate;
}

void main() {
  vec2 stepDir = u_direction * u_texel * u_radius;
  vec4 acc = tap(v_uv) * W0;
  acc += (tap(v_uv + stepDir) + tap(v_uv - stepDir)) * W1;
  acc += (tap(v_uv + stepDir * 2.0) + tap(v_uv - stepDir * 2.0)) * W2;
  acc += (tap(v_uv + stepDir * 3.0) + tap(v_uv - stepDir * 3.0)) * W3;
  acc += (tap(v_uv + stepDir * 4.0) + tap(v_uv - stepDir * 4.0)) * W4;
  acc += (tap(v_uv + stepDir * 5.0) + tap(v_uv - stepDir * 5.0)) * W5;
  acc += (tap(v_uv + stepDir * 6.0) + tap(v_uv - stepDir * 6.0)) * W6;
  fragColor = acc;
}
`;

export const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_ribbonTexture;
uniform sampler2D u_bloomTexture;
uniform float u_bloomIntensity;
uniform vec3 u_bloomTint;

void main() {
  vec4 ribbon = texture(u_ribbonTexture, v_uv);
  vec4 bloom = texture(u_bloomTexture, v_uv);
  vec3 rgb = ribbon.rgb + bloom.rgb * u_bloomIntensity * u_bloomTint;
  float alpha = ribbon.a + bloom.a * u_bloomIntensity;
  fragColor = vec4(rgb, alpha);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Failed to create program.");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}
