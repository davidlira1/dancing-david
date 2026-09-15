import { catmullRomToBezierPath, type CubicSegment } from "./spline.ts";
import {
  VISUAL_TRAIL_DURATION_MS,
  type VisualSample,
} from "./visual-trajectory.ts";

const TRAIL_COLOR = "180, 230, 255";
const LINE_WIDTH = 4;
const FADE_LAYER_COUNT = 12;
const NEIGHBOR_PREV = 0.25;
const NEIGHBOR_CUR = 0.5;
const NEIGHBOR_NEXT = 0.25;

type Point = {
  x: number;
  y: number;
  t: number;
};

type FadeLayer = {
  startFrac: number;
  alpha: number;
};

function fadeLayers(count: number): FadeLayer[] {
  const last = Math.max(count - 1, 1);
  const layers: FadeLayer[] = [];
  for (let i = 0; i < count; i++) {
    const u = i / last;
    layers.push({
      startFrac: Math.pow(u, 0.85) * 0.88,
      alpha: 0.1 + 0.9 * Math.pow(u, 1.15),
    });
  }
  return layers;
}

const FADE_LAYERS = fadeLayers(FADE_LAYER_COUNT);

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

function toPixels(
  samples: readonly VisualSample[],
  width: number,
  height: number,
): Point[] {
  return samples.map((sample) => ({
    x: sample.x * width,
    y: sample.y * height,
    t: sample.t,
  }));
}

function neighborhoodSmooth(points: Point[]): Point[] {
  if (points.length < 3) {
    return points;
  }

  const smoothed: Point[] = new Array(points.length);
  smoothed[0] = points[0];
  smoothed[points.length - 1] = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    smoothed[i] = {
      x:
        points[i - 1].x * NEIGHBOR_PREV +
        points[i].x * NEIGHBOR_CUR +
        points[i + 1].x * NEIGHBOR_NEXT,
      y:
        points[i - 1].y * NEIGHBOR_PREV +
        points[i].y * NEIGHBOR_CUR +
        points[i + 1].y * NEIGHBOR_NEXT,
      t: points[i].t,
    };
  }

  return smoothed;
}

function strokeSuffix(
  ctx: CanvasRenderingContext2D,
  segments: CubicSegment[],
  startFrac: number,
): void {
  if (segments.length === 0) {
    return;
  }

  const start = Math.min(
    Math.floor(segments.length * startFrac),
    segments.length - 1,
  );
  ctx.beginPath();
  ctx.moveTo(segments[start].p0.x, segments[start].p0.y);
  for (let i = start; i < segments.length; i++) {
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

export function drawTrail(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  samples: readonly VisualSample[],
  nowMs: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const alive = samples.filter(
    (sample) => nowMs - sample.t <= VISUAL_TRAIL_DURATION_MS,
  );
  if (alive.length < 2) {
    return;
  }

  const points = neighborhoodSmooth(
    toPixels(alive, canvas.width, canvas.height),
  );
  const segments = catmullRomToBezierPath(points);
  if (segments.length === 0) {
    return;
  }

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineJoin = "round";
  ctx.shadowBlur = 4;
  ctx.shadowColor = `rgba(${TRAIL_COLOR}, 0.35)`;

  const lastLayer = FADE_LAYERS.length - 1;
  for (let i = 0; i < FADE_LAYERS.length; i++) {
    const layer = FADE_LAYERS[i];
    ctx.lineCap = i === 0 || i === lastLayer ? "round" : "butt";
    ctx.strokeStyle = `rgba(${TRAIL_COLOR}, ${layer.alpha})`;
    strokeSuffix(ctx, segments, layer.startFrac);
  }

  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
}
