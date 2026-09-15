export const RIBBON_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_center;
in vec2 a_normal;
in float a_side;
in float a_life;

uniform vec2 u_resolution;
uniform float u_maxWidth;
uniform float u_minWidthScale;

out float v_side;
out float v_life;

void main() {
  float widthScale = mix(u_minWidthScale, 1.0, smoothstep(0.0, 1.0, a_life));
  float halfWidth = 0.5 * u_maxWidth * widthScale;
  vec2 pos = a_center + a_normal * a_side * halfWidth;
  vec2 clip = vec2(
    (pos.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (pos.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_side = a_side;
  v_life = a_life;
}
`;

export const RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_side;
in float v_life;
out vec4 fragColor;

uniform float u_coreWidth;
uniform float u_tailFadeEnd;
uniform float u_intensity;

void main() {
  float d = abs(v_side);
  vec3 white = vec3(0.95, 0.98, 1.0);
  vec3 cyan = vec3(0.27, 0.86, 1.0);
  vec3 blue = vec3(0.28, 0.38, 1.0);
  vec3 violet = vec3(0.58, 0.22, 1.0);

  float core = 1.0 - smoothstep(0.0, u_coreWidth, d);
  vec3 color = violet;
  color = mix(color, blue, smoothstep(0.88, 0.48, d));
  color = mix(color, cyan, smoothstep(0.42, 0.14, d));
  color = mix(color, white, core);

  float edgeAlpha = 1.0 - smoothstep(0.72, 1.0, d);
  float lifeAlpha = smoothstep(0.0, u_tailFadeEnd, v_life);
  float alpha = edgeAlpha * lifeAlpha * u_intensity;
  fragColor = vec4(color, alpha);
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
