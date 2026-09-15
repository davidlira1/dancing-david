import { evalCubic, evalCubicDerivative } from "../spline.ts";
import type { TimedSegment } from "../trail.ts";
import { VISUAL_TRAIL_DURATION_MS } from "../visual-trajectory.ts";
import {
  compileProgram,
  RIBBON_FRAGMENT_SHADER,
  RIBBON_VERTEX_SHADER,
} from "./shaders.ts";

const SUBDIVISIONS_PER_SEGMENT = 12;
const TANGENT_EPS = 1e-6;
const MAX_SAMPLES = 2048;
const FLOATS_PER_VERTEX = 6;
const MAX_VERTICES = MAX_SAMPLES * 2;
const MAX_WIDTH_PX = 32;
const MIN_WIDTH_SCALE = 0.04;
const CORE_WIDTH = 0.16;
const TAIL_FADE_END = 0.12;
const INTENSITY = 1.15;

export type CenterSample = {
  x: number;
  y: number;
  nx: number;
  ny: number;
  life: number;
};

export type RibbonRenderer = {
  resize(videoWidth: number, videoHeight: number, dpr: number): void;
  render(segments: TimedSegment[], nowMs: number): void;
  dispose(): void;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sampleRibbonCenterline(
  segments: TimedSegment[],
  nowMs: number,
): CenterSample[] {
  const samples: CenterSample[] = [];
  let prevNx = 0;
  let prevNy = 1;
  let prevTx = 1;
  let prevTy = 0;

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const start = s === 0 ? 0 : 1;
    for (let i = start; i <= SUBDIVISIONS_PER_SEGMENT; i++) {
      const u = i / SUBDIVISIONS_PER_SEGMENT;
      const point = evalCubic(segment, u);
      const deriv = evalCubicDerivative(segment, u);
      const speed = Math.hypot(deriv.x, deriv.y);
      let tx = prevTx;
      let ty = prevTy;
      if (speed > TANGENT_EPS) {
        tx = deriv.x / speed;
        ty = deriv.y / speed;
      }
      let nx = -ty;
      let ny = tx;
      if (nx * prevNx + ny * prevNy < 0) {
        nx = -nx;
        ny = -ny;
      }
      const time = lerp(segment.t0, segment.t1, u);
      const life = 1 - clamp01((nowMs - time) / VISUAL_TRAIL_DURATION_MS);
      samples.push({ x: point.x, y: point.y, nx, ny, life });
      prevNx = nx;
      prevNy = ny;
      prevTx = tx;
      prevTy = ty;
    }
  }

  if (samples.length > MAX_SAMPLES) {
    samples.length = MAX_SAMPLES;
  }

  averageInteriorNormals(samples);
  return samples;
}

function averageInteriorNormals(samples: CenterSample[]): void {
  if (samples.length < 3) {
    return;
  }

  const averaged: { nx: number; ny: number }[] = new Array(samples.length);
  averaged[0] = { nx: samples[0].nx, ny: samples[0].ny };
  averaged[samples.length - 1] = {
    nx: samples[samples.length - 1].nx,
    ny: samples[samples.length - 1].ny,
  };

  for (let i = 1; i < samples.length - 1; i++) {
    const nx = samples[i - 1].nx + samples[i].nx + samples[i + 1].nx;
    const ny = samples[i - 1].ny + samples[i].ny + samples[i + 1].ny;
    const len = Math.hypot(nx, ny);
    if (len > TANGENT_EPS) {
      averaged[i] = { nx: nx / len, ny: ny / len };
    } else {
      averaged[i] = { nx: samples[i].nx, ny: samples[i].ny };
    }
  }

  for (let i = 1; i < samples.length - 1; i++) {
    samples[i].nx = averaged[i].nx;
    samples[i].ny = averaged[i].ny;
  }
}

export function writeStripVertices(
  samples: CenterSample[],
  out: Float32Array,
): number {
  const count = Math.min(samples.length, MAX_SAMPLES);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const sample = samples[i];
    out[offset++] = sample.x;
    out[offset++] = sample.y;
    out[offset++] = sample.nx;
    out[offset++] = sample.ny;
    out[offset++] = -1;
    out[offset++] = sample.life;
    out[offset++] = sample.x;
    out[offset++] = sample.y;
    out[offset++] = sample.nx;
    out[offset++] = sample.ny;
    out[offset++] = 1;
    out[offset++] = sample.life;
  }
  return count * 2;
}

export function createRibbonRenderer(
  canvas: HTMLCanvasElement,
): RibbonRenderer | null {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!context) {
    return null;
  }
  const gpu: WebGL2RenderingContext = context;

  const program = compileProgram(
    gpu,
    RIBBON_VERTEX_SHADER,
    RIBBON_FRAGMENT_SHADER,
  );
  const vao = gpu.createVertexArray();
  const buffer = gpu.createBuffer();
  if (!vao || !buffer) {
    gpu.deleteProgram(program);
    return null;
  }

  const vertices = new Float32Array(MAX_VERTICES * FLOATS_PER_VERTEX);
  const stride = FLOATS_PER_VERTEX * 4;

  gpu.bindVertexArray(vao);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
  gpu.bufferData(gpu.ARRAY_BUFFER, vertices.byteLength, gpu.DYNAMIC_DRAW);

  const aCenter = gpu.getAttribLocation(program, "a_center");
  const aNormal = gpu.getAttribLocation(program, "a_normal");
  const aSide = gpu.getAttribLocation(program, "a_side");
  const aLife = gpu.getAttribLocation(program, "a_life");

  gpu.enableVertexAttribArray(aCenter);
  gpu.vertexAttribPointer(aCenter, 2, gpu.FLOAT, false, stride, 0);
  gpu.enableVertexAttribArray(aNormal);
  gpu.vertexAttribPointer(aNormal, 2, gpu.FLOAT, false, stride, 8);
  gpu.enableVertexAttribArray(aSide);
  gpu.vertexAttribPointer(aSide, 1, gpu.FLOAT, false, stride, 16);
  gpu.enableVertexAttribArray(aLife);
  gpu.vertexAttribPointer(aLife, 1, gpu.FLOAT, false, stride, 20);

  gpu.bindVertexArray(null);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, null);

  const uResolution = gpu.getUniformLocation(program, "u_resolution");
  const uMaxWidth = gpu.getUniformLocation(program, "u_maxWidth");
  const uMinWidthScale = gpu.getUniformLocation(program, "u_minWidthScale");
  const uCoreWidth = gpu.getUniformLocation(program, "u_coreWidth");
  const uTailFadeEnd = gpu.getUniformLocation(program, "u_tailFadeEnd");
  const uIntensity = gpu.getUniformLocation(program, "u_intensity");

  let videoWidth = 1;
  let videoHeight = 1;

  gpu.disable(gpu.DEPTH_TEST);
  gpu.enable(gpu.BLEND);
  gpu.blendFunc(gpu.SRC_ALPHA, gpu.ONE);
  gpu.clearColor(0, 0, 0, 0);

  function drawRibbonMesh(vertexCount: number): void {
    gpu.useProgram(program);
    gpu.uniform2f(uResolution, videoWidth, videoHeight);
    gpu.uniform1f(uMaxWidth, MAX_WIDTH_PX);
    gpu.uniform1f(uMinWidthScale, MIN_WIDTH_SCALE);
    gpu.uniform1f(uCoreWidth, CORE_WIDTH);
    gpu.uniform1f(uTailFadeEnd, TAIL_FADE_END);
    gpu.uniform1f(uIntensity, INTENSITY);
    gpu.bindVertexArray(vao);
    gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, vertexCount);
    gpu.bindVertexArray(null);
  }

  return {
    resize(width: number, height: number, dpr: number): void {
      videoWidth = Math.max(1, width);
      videoHeight = Math.max(1, height);
      const pixelRatio = Math.max(1, dpr);
      const bufferWidth = Math.round(videoWidth * pixelRatio);
      const bufferHeight = Math.round(videoHeight * pixelRatio);
      if (canvas.width !== bufferWidth) {
        canvas.width = bufferWidth;
      }
      if (canvas.height !== bufferHeight) {
        canvas.height = bufferHeight;
      }
      gpu.viewport(0, 0, canvas.width, canvas.height);
    },

    render(segments: TimedSegment[], nowMs: number): void {
      // Draw to the currently bound framebuffer (default canvas in M10).
      gpu.viewport(0, 0, canvas.width, canvas.height);
      gpu.clear(gpu.COLOR_BUFFER_BIT);
      if (segments.length === 0) {
        return;
      }

      const samples = sampleRibbonCenterline(segments, nowMs);
      if (samples.length < 2) {
        return;
      }

      const vertexCount = writeStripVertices(samples, vertices);
      gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
      gpu.bufferSubData(
        gpu.ARRAY_BUFFER,
        0,
        vertices.subarray(0, vertexCount * FLOATS_PER_VERTEX),
      );
      gpu.bindBuffer(gpu.ARRAY_BUFFER, null);
      drawRibbonMesh(vertexCount);
    },

    dispose(): void {
      gpu.deleteBuffer(buffer);
      gpu.deleteVertexArray(vao);
      gpu.deleteProgram(program);
    },
  };
}
