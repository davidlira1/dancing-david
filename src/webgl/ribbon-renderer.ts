import { flattenCubic } from "../spline.ts";
import type { TimedSegment } from "../trail.ts";
import { createBloomRenderer, type BloomRenderer } from "./bloom-renderer.ts";
import {
  disposeFrameTarget,
  ensureFrameTarget,
  type FrameTarget,
} from "./framebuffer.ts";
import {
  compileProgram,
  RIBBON_FRAGMENT_SHADER,
  RIBBON_VERTEX_SHADER,
} from "./shaders.ts";
import {
  CURVE_FLATNESS_PX,
  DEFAULT_RIBBON_VFX_CONFIG,
  hexToRgb,
  MAX_RIBBON_SAMPLES,
  MAX_SUBDIVISION_DEPTH,
  TAIL_FADE_END,
  TARGET_SAMPLE_SPACING_PX,
  type RibbonVfxConfig,
} from "./visual.ts";

const TANGENT_EPS = 1e-6;
const FLOATS_PER_VERTEX = 6;
const MAX_VERTICES = MAX_RIBBON_SAMPLES * 2;

export type CenterSample = {
  x: number;
  y: number;
  nx: number;
  ny: number;
  life: number;
};

export type RibbonStats = {
  sampleCount: number;
  vertexCount: number;
  bloomWidth: number;
  bloomHeight: number;
};

export type RibbonTrails = {
  right: TimedSegment[];
  left: TimedSegment[];
};

export type RibbonRenderer = {
  resize(videoWidth: number, videoHeight: number, dpr: number): void;
  render(trails: RibbonTrails, nowMs: number, vfx: RibbonVfxConfig): void;
  lastHead(): { x: number; y: number } | null;
  stats(): RibbonStats;
  dispose(): void;
};

type PolyPoint = {
  x: number;
  y: number;
  t: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function flattenTrail(segments: TimedSegment[]): PolyPoint[] {
  const points: PolyPoint[] = [];
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const samples = flattenCubic(
      segment,
      CURVE_FLATNESS_PX,
      MAX_SUBDIVISION_DEPTH,
      s === 0,
    );
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      points.push({
        x: sample.x,
        y: sample.y,
        t: lerp(segment.t0, segment.t1, sample.u),
      });
    }
  }
  return points;
}

function interpolateAt(
  points: PolyPoint[],
  prefix: number[],
  dist: number,
): PolyPoint {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid] < dist) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const d0 = prefix[lo];
  const d1 = prefix[lo + 1];
  const span = d1 - d0;
  const u = span > TANGENT_EPS ? (dist - d0) / span : 0;
  const a = points[lo];
  const b = points[lo + 1];
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    t: a.t + (b.t - a.t) * u,
  };
}

function resamplePolyline(points: PolyPoint[]): PolyPoint[] {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [points[0]];
  }

  const prefix: number[] = new Array(points.length);
  prefix[0] = 0;
  for (let i = 1; i < points.length; i++) {
    prefix[i] =
      prefix[i - 1] +
      Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const total = prefix[points.length - 1];
  const head = points[points.length - 1];
  if (total < TANGENT_EPS) {
    return [points[0], head];
  }

  const spacing = TARGET_SAMPLE_SPACING_PX;
  const evenCount = Math.floor(total / spacing) + 1;
  let startDist = 0;
  if (evenCount > MAX_RIBBON_SAMPLES) {
    startDist = Math.max(0, total - (MAX_RIBBON_SAMPLES - 1) * spacing);
  }

  const out: PolyPoint[] = [];
  let dist = startDist;
  while (dist < total - 1e-4 && out.length < MAX_RIBBON_SAMPLES - 1) {
    if (dist <= TANGENT_EPS) {
      out.push(points[0]);
    } else {
      out.push(interpolateAt(points, prefix, dist));
    }
    dist += spacing;
  }

  const tip = out[out.length - 1];
  if (!tip || Math.hypot(head.x - tip.x, head.y - tip.y) > 0.05) {
    if (out.length >= MAX_RIBBON_SAMPLES) {
      out.shift();
    }
    out.push(head);
  } else {
    out[out.length - 1] = head;
  }
  return out;
}

function assignNeighborNormals(samples: CenterSample[]): void {
  if (samples.length === 0) {
    return;
  }
  if (samples.length === 1) {
    samples[0].nx = 0;
    samples[0].ny = 1;
    return;
  }

  let prevNx = 0;
  let prevNy = 1;
  for (let i = 0; i < samples.length; i++) {
    let tx: number;
    let ty: number;
    if (i === 0) {
      tx = samples[1].x - samples[0].x;
      ty = samples[1].y - samples[0].y;
    } else if (i === samples.length - 1) {
      tx = samples[i].x - samples[i - 1].x;
      ty = samples[i].y - samples[i - 1].y;
    } else {
      tx = samples[i + 1].x - samples[i - 1].x;
      ty = samples[i + 1].y - samples[i - 1].y;
    }
    const speed = Math.hypot(tx, ty);
    if (speed > TANGENT_EPS) {
      tx /= speed;
      ty /= speed;
    } else if (i > 0) {
      tx = -samples[i - 1].ny;
      ty = samples[i - 1].nx;
    } else {
      tx = 1;
      ty = 0;
    }
    let nx = -ty;
    let ny = tx;
    if (nx * prevNx + ny * prevNy < 0) {
      nx = -nx;
      ny = -ny;
    }
    samples[i].nx = nx;
    samples[i].ny = ny;
    prevNx = nx;
    prevNy = ny;
  }
}

export function sampleRibbonCenterline(
  segments: TimedSegment[],
  nowMs: number,
  trailDurationMs = DEFAULT_RIBBON_VFX_CONFIG.trailDurationMs,
): CenterSample[] {
  const polyline = resamplePolyline(flattenTrail(segments));
  const samples: CenterSample[] = new Array(polyline.length);
  const duration = Math.max(1, trailDurationMs);
  for (let i = 0; i < polyline.length; i++) {
    const point = polyline[i];
    samples[i] = {
      x: point.x,
      y: point.y,
      nx: 0,
      ny: 1,
      life: 1 - clamp01((nowMs - point.t) / duration),
    };
  }

  if (samples.length > MAX_RIBBON_SAMPLES) {
    samples.splice(0, samples.length - MAX_RIBBON_SAMPLES);
  }

  assignNeighborNormals(samples);
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
  const count = Math.min(samples.length, MAX_RIBBON_SAMPLES);
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

  let bloom: BloomRenderer;
  try {
    bloom = createBloomRenderer(gpu);
  } catch {
    gpu.deleteBuffer(buffer);
    gpu.deleteVertexArray(vao);
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
  const uEdgeSoftness = gpu.getUniformLocation(program, "u_edgeSoftness");
  const uTailFadeEnd = gpu.getUniformLocation(program, "u_tailFadeEnd");
  const uIntensity = gpu.getUniformLocation(program, "u_intensity");
  const uCoreColor = gpu.getUniformLocation(program, "u_coreColor");
  const uCyan = gpu.getUniformLocation(program, "u_cyan");
  const uBlue = gpu.getUniformLocation(program, "u_blue");
  const uViolet = gpu.getUniformLocation(program, "u_violet");

  let videoWidth = 1;
  let videoHeight = 1;
  let head: { x: number; y: number } | null = null;
  let ribbonTarget: FrameTarget | null = null;
  let lastSampleCount = 0;
  let lastVertexCount = 0;
  let activeVfx: RibbonVfxConfig = DEFAULT_RIBBON_VFX_CONFIG;

  gpu.disable(gpu.DEPTH_TEST);
  gpu.enable(gpu.BLEND);
  gpu.blendFunc(gpu.SRC_ALPHA, gpu.ONE);
  gpu.clearColor(0, 0, 0, 0);

  function drawRibbonMesh(vertexCount: number): void {
    const core = hexToRgb(activeVfx.coreColor);
    const body = hexToRgb(activeVfx.bodyColor);
    const edge = hexToRgb(activeVfx.edgeColor);
    const mid: [number, number, number] = [
      (body[0] + edge[0]) * 0.5,
      (body[1] + edge[1]) * 0.5,
      (body[2] + edge[2]) * 0.5,
    ];
    gpu.useProgram(program);
    gpu.uniform2f(uResolution, videoWidth, videoHeight);
    gpu.uniform1f(uMaxWidth, activeVfx.ribbonWidth);
    gpu.uniform1f(uMinWidthScale, activeVfx.tailWidthScale);
    gpu.uniform1f(uCoreWidth, activeVfx.coreWidth);
    gpu.uniform1f(uEdgeSoftness, activeVfx.edgeSoftness);
    gpu.uniform1f(uTailFadeEnd, TAIL_FADE_END);
    gpu.uniform1f(uIntensity, activeVfx.ribbonIntensity);
    gpu.uniform3f(uCoreColor, core[0], core[1], core[2]);
    gpu.uniform3f(uCyan, body[0], body[1], body[2]);
    gpu.uniform3f(uBlue, mid[0], mid[1], mid[2]);
    gpu.uniform3f(uViolet, edge[0], edge[1], edge[2]);
    gpu.bindVertexArray(vao);
    gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, vertexCount);
    gpu.bindVertexArray(null);
  }

  function bindDefaultFramebuffer(): void {
    gpu.bindFramebuffer(gpu.FRAMEBUFFER, null);
    gpu.viewport(0, 0, canvas.width, canvas.height);
  }

  function drawTrail(
    segments: TimedSegment[],
    nowMs: number,
    isRight: boolean,
  ): void {
    if (segments.length === 0) {
      if (isRight) {
        head = null;
      }
      return;
    }

    const samples = sampleRibbonCenterline(
      segments,
      nowMs,
      activeVfx.trailDurationMs,
    );
    lastSampleCount += samples.length;
    if (samples.length < 2) {
      if (isRight) {
        head = samples[0]
          ? { x: samples[0].x, y: samples[0].y }
          : null;
      }
      return;
    }

    if (isRight) {
      const tip = samples[samples.length - 1];
      head = { x: tip.x, y: tip.y };
    }

    const vertexCount = writeStripVertices(samples, vertices);
    lastVertexCount += vertexCount;
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferSubData(
      gpu.ARRAY_BUFFER,
      0,
      vertices.subarray(0, vertexCount * FLOATS_PER_VERTEX),
    );
    gpu.bindBuffer(gpu.ARRAY_BUFFER, null);
    drawRibbonMesh(vertexCount);
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
      ribbonTarget = ensureFrameTarget(
        gpu,
        ribbonTarget,
        canvas.width,
        canvas.height,
      );
      bloom.resize(canvas.width, canvas.height);
    },

    render(trails: RibbonTrails, nowMs: number, vfx: RibbonVfxConfig): void {
      if (!ribbonTarget) {
        return;
      }

      activeVfx = vfx;
      lastSampleCount = 0;
      lastVertexCount = 0;
      gpu.bindFramebuffer(gpu.FRAMEBUFFER, ribbonTarget.framebuffer);
      gpu.viewport(0, 0, ribbonTarget.width, ribbonTarget.height);
      gpu.enable(gpu.BLEND);
      gpu.blendFunc(gpu.SRC_ALPHA, gpu.ONE);
      gpu.clear(gpu.COLOR_BUFFER_BIT);

      drawTrail(trails.right, nowMs, true);
      drawTrail(trails.left, nowMs, false);

      const bloomTexture = bloom.blur(ribbonTarget.texture, vfx.bloomRadius);
      bindDefaultFramebuffer();
      gpu.clear(gpu.COLOR_BUFFER_BIT);
      bloom.composite(ribbonTarget.texture, bloomTexture, vfx);
    },

    lastHead(): { x: number; y: number } | null {
      return head;
    },

    stats(): RibbonStats {
      const bloomSize = bloom.size();
      return {
        sampleCount: lastSampleCount,
        vertexCount: lastVertexCount,
        bloomWidth: bloomSize.width,
        bloomHeight: bloomSize.height,
      };
    },

    dispose(): void {
      disposeFrameTarget(gpu, ribbonTarget);
      ribbonTarget = null;
      bloom.dispose();
      gpu.deleteBuffer(buffer);
      gpu.deleteVertexArray(vao);
      gpu.deleteProgram(program);
    },
  };
}
