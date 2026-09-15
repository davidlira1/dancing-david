import { evalCubic, evalCubicDerivative } from "./spline.ts";
import { buildTrailGeometry, type TimedSegment } from "./trail.ts";
import {
  VISUAL_TRAIL_DURATION_MS,
  type VisualSample,
} from "./visual-trajectory.ts";

const SUBDIVISIONS_PER_SEGMENT = 8;
const TANGENT_EPS = 1e-6;

export type Rgb = readonly [number, number, number];

export type RibbonPassStyle = {
  width: number;
  color: Rgb;
  alpha: number;
  shadowBlur: number;
};

export type RibbonStyle = {
  bloom: RibbonPassStyle;
  outer: RibbonPassStyle;
  body: RibbonPassStyle;
  core: RibbonPassStyle;
};

export const DEFAULT_RIBBON_STYLE: RibbonStyle = {
  bloom: {
    width: 32,
    color: [168, 72, 255],
    alpha: 0.12,
    shadowBlur: 28,
  },
  outer: {
    width: 15,
    color: [110, 80, 255],
    alpha: 0.32,
    shadowBlur: 0,
  },
  body: {
    width: 6.5,
    color: [70, 220, 255],
    alpha: 0.75,
    shadowBlur: 0,
  },
  core: {
    width: 2.2,
    color: [240, 250, 255],
    alpha: 0.95,
    shadowBlur: 0,
  },
};

type CenterSample = {
  x: number;
  y: number;
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  life: number;
};

type EdgePoint = {
  x: number;
  y: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function smoothstep(life: number): number {
  const t = clamp01(life);
  return t * t * (3 - 2 * t);
}

function alphaScale(life: number): number {
  return life ** 1.5;
}

function resolveStyle(options?: Partial<RibbonStyle>): RibbonStyle {
  return {
    bloom: { ...DEFAULT_RIBBON_STYLE.bloom, ...options?.bloom },
    outer: { ...DEFAULT_RIBBON_STYLE.outer, ...options?.outer },
    body: { ...DEFAULT_RIBBON_STYLE.body, ...options?.body },
    core: { ...DEFAULT_RIBBON_STYLE.core, ...options?.core },
  };
}

function sizeToVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function sampleCenterline(
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
      samples.push({
        x: point.x,
        y: point.y,
        nx,
        ny,
        tx,
        ty,
        life,
      });
      prevNx = nx;
      prevNy = ny;
      prevTx = tx;
      prevTy = ty;
    }
  }

  return samples;
}

function ribbonEdges(
  samples: CenterSample[],
  passWidth: number,
): { left: EdgePoint[]; right: EdgePoint[] } {
  const left: EdgePoint[] = [];
  const right: EdgePoint[] = [];
  for (const sample of samples) {
    const half = (passWidth * 0.5) * smoothstep(sample.life);
    left.push({
      x: sample.x + sample.nx * half,
      y: sample.y + sample.ny * half,
    });
    right.push({
      x: sample.x - sample.nx * half,
      y: sample.y - sample.ny * half,
    });
  }
  return { left, right };
}

function addClosedRibbonPath(
  path: Path2D,
  samples: CenterSample[],
  left: EdgePoint[],
  right: EdgePoint[],
): void {
  const last = samples.length - 1;
  path.moveTo(left[0].x, left[0].y);
  for (let i = 1; i <= last; i++) {
    path.lineTo(left[i].x, left[i].y);
  }

  const head = samples[last];
  const radius = Math.hypot(left[last].x - head.x, left[last].y - head.y);
  if (radius > 0.5) {
    const start = Math.atan2(left[last].y - head.y, left[last].x - head.x);
    const end = Math.atan2(right[last].y - head.y, right[last].x - head.x);
    path.arc(head.x, head.y, radius, start, end, false);
  } else {
    path.lineTo(right[last].x, right[last].y);
  }

  for (let i = last - 1; i >= 0; i--) {
    path.lineTo(right[i].x, right[i].y);
  }
  path.closePath();
}

function fillClosedStrip(
  ctx: CanvasRenderingContext2D,
  samples: CenterSample[],
  pass: RibbonPassStyle,
): void {
  if (samples.length < 2) {
    return;
  }
  const { left, right } = ribbonEdges(samples, pass.width);
  const path = new Path2D();
  addClosedRibbonPath(path, samples, left, right);
  ctx.fillStyle = rgba(pass.color, pass.alpha);
  ctx.shadowBlur = pass.shadowBlur;
  ctx.shadowColor =
    pass.shadowBlur > 0 ? rgba(pass.color, Math.min(1, pass.alpha * 1.4)) : "transparent";
  ctx.fill(path);
  ctx.shadowBlur = 0;
}

function fillQuadStrip(
  ctx: CanvasRenderingContext2D,
  samples: CenterSample[],
  pass: RibbonPassStyle,
): void {
  if (samples.length < 2) {
    return;
  }
  const { left, right } = ribbonEdges(samples, pass.width);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  for (let i = 0; i < samples.length - 1; i++) {
    const alpha =
      pass.alpha *
      (alphaScale(samples[i].life) + alphaScale(samples[i + 1].life)) *
      0.5;
    if (alpha < 0.004) {
      continue;
    }
    ctx.fillStyle = rgba(pass.color, alpha);
    ctx.beginPath();
    ctx.moveTo(left[i].x, left[i].y);
    ctx.lineTo(left[i + 1].x, left[i + 1].y);
    ctx.lineTo(right[i + 1].x, right[i + 1].y);
    ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawRibbon(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  samples: readonly VisualSample[],
  nowMs: number,
  options?: Partial<RibbonStyle>,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const segments = buildTrailGeometry(
    samples,
    nowMs,
    canvas.width,
    canvas.height,
  );
  if (segments.length === 0) {
    return;
  }

  const centerline = sampleCenterline(segments, nowMs);
  if (centerline.length < 2) {
    return;
  }

  const style = resolveStyle(options);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  fillClosedStrip(ctx, centerline, style.bloom);
  fillClosedStrip(ctx, centerline, style.outer);
  fillQuadStrip(ctx, centerline, style.body);
  fillQuadStrip(ctx, centerline, style.core);
  ctx.restore();
}
