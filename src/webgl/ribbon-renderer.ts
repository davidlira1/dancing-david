import { flattenCubic } from "../spline.ts";
import type { TimedSegment } from "../trail.ts";
import {
  HEAD_ATTACH_MS,
  TRACKED_DEPTH_PACK_RANGE,
  type BodyDepthField,
} from "../body-depth.ts";
import type { PersonMask } from "../segmentation.ts";
import { createBloomRenderer, type BloomRenderer } from "./bloom-renderer.ts";
import {
  disposeFrameTarget,
  ensureFrameTarget,
  type FrameTarget,
} from "./framebuffer.ts";
import { ribbonPerspectiveFromTracked } from "./projection.ts";
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
const FLOATS_PER_VERTEX = 8;
const MAX_VERTICES = MAX_RIBBON_SAMPLES * 2;

export type CenterSample = {
  x: number;
  y: number;
  z: number;
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

/** One continuous stroke: cubics that are guaranteed not to span a tracking gap. */
export type RibbonStroke = TimedSegment[];

export type RibbonTrails = {
  right: RibbonStroke[];
  left: RibbonStroke[];
};

export type RibbonRenderer = {
  resize(videoWidth: number, videoHeight: number, dpr: number): void;
  setOcclusionSources(
    mask: PersonMask | null,
    body: BodyDepthField | null,
    calibrated: boolean,
  ): void;
  render(trails: RibbonTrails, nowMs: number, vfx: RibbonVfxConfig): void;
  lastHead(): { x: number; y: number; z: number } | null;
  stats(): RibbonStats;
  dispose(): void;
};

type PolyPoint = {
  x: number;
  y: number;
  z: number;
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
        z: sample.z,
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
    z: a.z + (b.z - a.z) * u,
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
      z: point.z,
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
  vfx: RibbonVfxConfig = DEFAULT_RIBBON_VFX_CONFIG,
): number {
  const count = Math.min(samples.length, MAX_RIBBON_SAMPLES);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const sample = samples[i];
    const { perspectiveScale } = ribbonPerspectiveFromTracked(
      sample.z,
      vfx,
    );
    out[offset++] = sample.x;
    out[offset++] = sample.y;
    out[offset++] = sample.nx;
    out[offset++] = sample.ny;
    out[offset++] = -1;
    out[offset++] = sample.life;
    out[offset++] = sample.z;
    out[offset++] = perspectiveScale;
    out[offset++] = sample.x;
    out[offset++] = sample.y;
    out[offset++] = sample.nx;
    out[offset++] = sample.ny;
    out[offset++] = 1;
    out[offset++] = sample.life;
    out[offset++] = sample.z;
    out[offset++] = perspectiveScale;
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
  const aDepth = gpu.getAttribLocation(program, "a_depth");
  const aPerspective = gpu.getAttribLocation(program, "a_perspective");

  gpu.enableVertexAttribArray(aCenter);
  gpu.vertexAttribPointer(aCenter, 2, gpu.FLOAT, false, stride, 0);
  gpu.enableVertexAttribArray(aNormal);
  gpu.vertexAttribPointer(aNormal, 2, gpu.FLOAT, false, stride, 8);
  gpu.enableVertexAttribArray(aSide);
  gpu.vertexAttribPointer(aSide, 1, gpu.FLOAT, false, stride, 16);
  gpu.enableVertexAttribArray(aLife);
  gpu.vertexAttribPointer(aLife, 1, gpu.FLOAT, false, stride, 20);
  gpu.enableVertexAttribArray(aDepth);
  gpu.vertexAttribPointer(aDepth, 1, gpu.FLOAT, false, stride, 24);
  gpu.enableVertexAttribArray(aPerspective);
  gpu.vertexAttribPointer(aPerspective, 1, gpu.FLOAT, false, stride, 28);

  gpu.bindVertexArray(null);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, null);

  const personMaskTexture = gpu.createTexture();
  const bodyDepthTexture = gpu.createTexture();
  if (!personMaskTexture || !bodyDepthTexture) {
    gpu.deleteBuffer(buffer);
    gpu.deleteVertexArray(vao);
    gpu.deleteProgram(program);
    bloom.dispose();
    return null;
  }

  function configureTexture(texture: WebGLTexture): void {
    gpu.bindTexture(gpu.TEXTURE_2D, texture);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MIN_FILTER, gpu.LINEAR);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MAG_FILTER, gpu.LINEAR);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_S, gpu.CLAMP_TO_EDGE);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_T, gpu.CLAMP_TO_EDGE);
  }

  configureTexture(personMaskTexture);
  gpu.texImage2D(
    gpu.TEXTURE_2D,
    0,
    gpu.RGBA,
    1,
    1,
    0,
    gpu.RGBA,
    gpu.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  configureTexture(bodyDepthTexture);
  gpu.texImage2D(
    gpu.TEXTURE_2D,
    0,
    gpu.RGBA,
    1,
    1,
    0,
    gpu.RGBA,
    gpu.UNSIGNED_BYTE,
    new Uint8Array([128, 0, 0, 0]),
  );
  gpu.bindTexture(gpu.TEXTURE_2D, null);

  const uResolution = gpu.getUniformLocation(program, "u_resolution");
  const uMaxWidth = gpu.getUniformLocation(program, "u_maxWidth");
  const uMinWidthScale = gpu.getUniformLocation(program, "u_minWidthScale");
  const uCoreWidth = gpu.getUniformLocation(program, "u_coreWidth");
  const uEdgeSoftness = gpu.getUniformLocation(program, "u_edgeSoftness");
  const uTailFadeEnd = gpu.getUniformLocation(program, "u_tailFadeEnd");
  const uIntensity = gpu.getUniformLocation(program, "u_intensity");
  const uDepthEnabled = gpu.getUniformLocation(program, "u_depthEnabled");
  const uDepthViz = gpu.getUniformLocation(program, "u_depthViz");
  const uDepthBloomStrength = gpu.getUniformLocation(
    program,
    "u_depthBloomStrength",
  );
  const uOcclusionEnabled = gpu.getUniformLocation(program, "u_occlusionEnabled");
  const uOcclusionBias = gpu.getUniformLocation(program, "u_occlusionBias");
  const uOcclusionSoftness = gpu.getUniformLocation(
    program,
    "u_occlusionSoftness",
  );
  const uSegThreshold = gpu.getUniformLocation(program, "u_segThreshold");
  const uHeadAttach = gpu.getUniformLocation(program, "u_headAttach");
  const uHasMask = gpu.getUniformLocation(program, "u_hasMask");
  const uCalibrated = gpu.getUniformLocation(program, "u_calibrated");
  const uOcclusionViz = gpu.getUniformLocation(program, "u_occlusionViz");
  const uDepthPackRange = gpu.getUniformLocation(program, "u_depthPackRange");
  const uPersonMask = gpu.getUniformLocation(program, "u_personMask");
  const uBodyDepth = gpu.getUniformLocation(program, "u_bodyDepth");
  const uCoreColor = gpu.getUniformLocation(program, "u_coreColor");
  const uCyan = gpu.getUniformLocation(program, "u_cyan");
  const uBlue = gpu.getUniformLocation(program, "u_blue");
  const uViolet = gpu.getUniformLocation(program, "u_violet");

  let videoWidth = 1;
  let videoHeight = 1;
  let head: { x: number; y: number; z: number } | null = null;
  let ribbonTarget: FrameTarget | null = null;
  let lastSampleCount = 0;
  let lastVertexCount = 0;
  let activeVfx: RibbonVfxConfig = DEFAULT_RIBBON_VFX_CONFIG;
  let hasMask = false;
  let calibrated = false;

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
    gpu.uniform1f(uDepthEnabled, activeVfx.depthEnabled ? 1 : 0);
    gpu.uniform1f(uDepthViz, activeVfx.depthViz ? 1 : 0);
    gpu.uniform1f(uDepthBloomStrength, activeVfx.depthBloomStrength);
    gpu.uniform1f(uOcclusionEnabled, activeVfx.occlusionEnabled ? 1 : 0);
    gpu.uniform1f(uOcclusionBias, activeVfx.occlusionDepthBias);
    gpu.uniform1f(uOcclusionSoftness, activeVfx.occlusionSoftness);
    gpu.uniform1f(uSegThreshold, activeVfx.segmentationThreshold);
    gpu.uniform1f(
      uHeadAttach,
      Math.max(0.02, HEAD_ATTACH_MS / Math.max(1, activeVfx.trailDurationMs)),
    );
    gpu.uniform1f(uHasMask, hasMask ? 1 : 0);
    gpu.uniform1f(uCalibrated, calibrated ? 1 : 0);
    gpu.uniform1f(uOcclusionViz, activeVfx.occlusionViz ? 1 : 0);
    gpu.uniform1f(uDepthPackRange, TRACKED_DEPTH_PACK_RANGE);
    gpu.uniform1i(uPersonMask, 0);
    gpu.uniform1i(uBodyDepth, 1);
    gpu.activeTexture(gpu.TEXTURE0);
    gpu.bindTexture(gpu.TEXTURE_2D, personMaskTexture);
    gpu.activeTexture(gpu.TEXTURE1);
    gpu.bindTexture(gpu.TEXTURE_2D, bodyDepthTexture);
    gpu.uniform3f(uCoreColor, core[0], core[1], core[2]);
    gpu.uniform3f(uCyan, body[0], body[1], body[2]);
    gpu.uniform3f(uBlue, mid[0], mid[1], mid[2]);
    gpu.uniform3f(uViolet, edge[0], edge[1], edge[2]);
    gpu.bindVertexArray(vao);
    gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, vertexCount);
    gpu.bindVertexArray(null);
    gpu.activeTexture(gpu.TEXTURE1);
    gpu.bindTexture(gpu.TEXTURE_2D, null);
    gpu.activeTexture(gpu.TEXTURE0);
    gpu.bindTexture(gpu.TEXTURE_2D, null);
  }

  function bindDefaultFramebuffer(): void {
    gpu.bindFramebuffer(gpu.FRAMEBUFFER, null);
    gpu.viewport(0, 0, canvas.width, canvas.height);
  }

  function drawStroke(
    segments: TimedSegment[],
    nowMs: number,
    reportHead: boolean,
  ): void {
    if (segments.length === 0) {
      return;
    }

    const samples = sampleRibbonCenterline(
      segments,
      nowMs,
      activeVfx.trailDurationMs,
    );
    lastSampleCount += samples.length;
    if (samples.length < 2) {
      if (reportHead && samples[0]) {
        head = { x: samples[0].x, y: samples[0].y, z: samples[0].z };
      }
      return;
    }

    if (reportHead) {
      const tip = samples[samples.length - 1];
      head = { x: tip.x, y: tip.y, z: tip.z };
    }

    const vertexCount = writeStripVertices(samples, vertices, activeVfx);
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

  /** Each stroke is tessellated, resampled and drawn independently. */
  function drawTrail(
    strokes: RibbonStroke[],
    nowMs: number,
    isRight: boolean,
  ): void {
    if (isRight) {
      head = null;
    }
    for (let i = 0; i < strokes.length; i++) {
      drawStroke(strokes[i], nowMs, isRight && i === strokes.length - 1);
    }
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

    setOcclusionSources(
      mask: PersonMask | null,
      body: BodyDepthField | null,
      sceneCalibrated: boolean,
    ): void {
      calibrated = sceneCalibrated;
      hasMask = Boolean(mask && body);
      gpu.pixelStorei(gpu.UNPACK_FLIP_Y_WEBGL, 0);
      gpu.bindTexture(gpu.TEXTURE_2D, personMaskTexture);
      if (mask) {
        gpu.texImage2D(
          gpu.TEXTURE_2D,
          0,
          gpu.RGBA,
          gpu.RGBA,
          gpu.UNSIGNED_BYTE,
          mask.canvas,
        );
      } else {
        gpu.texImage2D(
          gpu.TEXTURE_2D,
          0,
          gpu.RGBA,
          1,
          1,
          0,
          gpu.RGBA,
          gpu.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 0]),
        );
      }
      gpu.bindTexture(gpu.TEXTURE_2D, bodyDepthTexture);
      if (body) {
        gpu.texImage2D(
          gpu.TEXTURE_2D,
          0,
          gpu.RGBA,
          body.width,
          body.height,
          0,
          gpu.RGBA,
          gpu.UNSIGNED_BYTE,
          body.packed,
        );
      } else {
        gpu.texImage2D(
          gpu.TEXTURE_2D,
          0,
          gpu.RGBA,
          1,
          1,
          0,
          gpu.RGBA,
          gpu.UNSIGNED_BYTE,
          new Uint8Array([128, 0, 0, 0]),
        );
      }
      gpu.bindTexture(gpu.TEXTURE_2D, null);
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

    lastHead(): { x: number; y: number; z: number } | null {
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
      gpu.deleteTexture(personMaskTexture);
      gpu.deleteTexture(bodyDepthTexture);
      gpu.deleteBuffer(buffer);
      gpu.deleteVertexArray(vao);
      gpu.deleteProgram(program);
    },
  };
}
