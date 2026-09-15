import { buildTrailGeometry, type TimedSegment } from "./trail.ts";
import {
  VISUAL_TRAIL_DURATION_MS,
  type VisualSample,
} from "./visual-trajectory.ts";

const AGE_BAND_COUNT = 20;
const BAND_OVERLAP = 1;

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
  bodyHeadColor: Rgb;
  core: RibbonPassStyle;
};

export const DEFAULT_RIBBON_STYLE: RibbonStyle = {
  bloom: {
    width: 32,
    color: [168, 72, 255],
    alpha: 0.14,
    shadowBlur: 30,
  },
  outer: {
    width: 15,
    color: [110, 80, 255],
    alpha: 0.32,
    shadowBlur: 18,
  },
  body: {
    width: 6.5,
    color: [70, 120, 255],
    alpha: 0.75,
    shadowBlur: 11,
  },
  bodyHeadColor: [70, 230, 255],
  core: {
    width: 2.2,
    color: [240, 250, 255],
    alpha: 0.95,
    shadowBlur: 5,
  },
};

type AgeBand = {
  start: number;
  end: number;
  life: number;
  isFirst: boolean;
  isLast: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function resolveStyle(options?: Partial<RibbonStyle>): RibbonStyle {
  return {
    bloom: { ...DEFAULT_RIBBON_STYLE.bloom, ...options?.bloom },
    outer: { ...DEFAULT_RIBBON_STYLE.outer, ...options?.outer },
    body: { ...DEFAULT_RIBBON_STYLE.body, ...options?.body },
    bodyHeadColor: options?.bodyHeadColor ?? DEFAULT_RIBBON_STYLE.bodyHeadColor,
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

function segmentLife(segment: TimedSegment, nowMs: number): number {
  const mid = (segment.t0 + segment.t1) * 0.5;
  const age = clamp01((nowMs - mid) / VISUAL_TRAIL_DURATION_MS);
  return 1 - age;
}

function buildAgeBands(segments: TimedSegment[], nowMs: number): AgeBand[] {
  const count = segments.length;
  if (count === 0) {
    return [];
  }

  const bands: AgeBand[] = [];
  const last = AGE_BAND_COUNT - 1;
  for (let i = 0; i < AGE_BAND_COUNT; i++) {
    const startFrac = i / AGE_BAND_COUNT;
    const endFrac = (i + 1) / AGE_BAND_COUNT;
    const start = Math.max(
      0,
      Math.floor(count * startFrac) - (i === 0 ? 0 : BAND_OVERLAP),
    );
    const end = Math.min(count, Math.ceil(count * endFrac));
    if (end - start < 1) {
      continue;
    }

    const mid = segments[Math.min(count - 1, Math.floor((start + end - 1) / 2))];
    bands.push({
      start,
      end,
      life: segmentLife(mid, nowMs),
      isFirst: i === 0,
      isLast: i === last,
    });
  }

  if (bands.length > 0) {
    bands[0].isFirst = true;
    bands[bands.length - 1].isLast = true;
  }
  return bands;
}

function strokeBand(
  ctx: CanvasRenderingContext2D,
  segments: TimedSegment[],
  start: number,
  end: number,
): void {
  ctx.beginPath();
  ctx.moveTo(segments[start].p0.x, segments[start].p0.y);
  for (let i = start; i < end; i++) {
    const segment = segments[i];
    ctx.bezierCurveTo(
      segment.c1.x,
      segment.c1.y,
      segment.c2.x,
      segment.c2.y,
      segment.p1.x,
      segment.p1.y,
    );
  }
  ctx.stroke();
}

function widthScale(life: number): number {
  return 0.18 + 0.82 * life;
}

function alphaScale(life: number): number {
  return life * life;
}

function drawPass(
  ctx: CanvasRenderingContext2D,
  segments: TimedSegment[],
  bands: AgeBand[],
  pass: RibbonPassStyle,
  colorForLife: (life: number) => Rgb,
  roundEnds: boolean,
): void {
  for (const band of bands) {
    const life = band.life;
    const alpha = pass.alpha * alphaScale(life);
    if (alpha < 0.004) {
      continue;
    }

    const color = colorForLife(life);
    ctx.lineWidth = Math.max(0.5, pass.width * widthScale(life));
    ctx.strokeStyle = rgba(color, alpha);
    ctx.shadowBlur = pass.shadowBlur * (0.45 + 0.55 * life);
    ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.2));
    ctx.lineCap =
      roundEnds && (band.isFirst || band.isLast) ? "round" : "butt";
    strokeBand(ctx, segments, band.start, band.end);
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

  const style = resolveStyle(options);
  const bands = buildAgeBands(segments, nowMs);
  if (bands.length === 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";

  drawPass(
    ctx,
    segments,
    bands,
    style.bloom,
    () => style.bloom.color,
    false,
  );
  drawPass(
    ctx,
    segments,
    bands,
    style.outer,
    () => style.outer.color,
    false,
  );
  drawPass(
    ctx,
    segments,
    bands,
    style.body,
    (life) => lerpRgb(style.body.color, style.bodyHeadColor, life),
    true,
  );
  drawPass(
    ctx,
    segments,
    bands,
    style.core,
    () => style.core.color,
    true,
  );

  ctx.restore();
}
