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
}
`;

export const RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_side;
in float v_life;
in float v_depth;
in float v_perspective;
out vec4 fragColor;

uniform float u_coreWidth;
uniform float u_edgeSoftness;
uniform float u_tailFadeEnd;
uniform float u_intensity;
uniform float u_depthEnabled;
uniform float u_depthViz;
uniform float u_depthBloomStrength;
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

  float edgeStart = max(0.0, 1.0 - u_edgeSoftness);
  float edgeAlpha = 1.0 - smoothstep(edgeStart, 1.0, d);
  float lifeAlpha = smoothstep(0.0, u_tailFadeEnd, v_life);
  float depthGlow = mix(1.0, clamp(v_perspective, 0.72, 1.35), u_depthBloomStrength * u_depthEnabled);
  float alpha = edgeAlpha * lifeAlpha * u_intensity * mix(1.0, 1.2, core) * depthGlow;
  fragColor = vec4(color, alpha);
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
