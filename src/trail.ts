import {
  TRAIL_DURATION_MS,
  type WristSample,
} from "./wrist-history.ts";

const TRAIL_COLOR = "180, 230, 255";
const LINE_WIDTH = 4;

type Point = {
  x: number;
  y: number;
  t: number;
};

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
  samples: readonly WristSample[],
  width: number,
  height: number,
): Point[] {
  return samples.map((sample) => ({
    x: sample.x * width,
    y: sample.y * height,
    t: sample.t,
  }));
}

function midpoint(a: Point, b: Point): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function alphaFor(nowMs: number, t: number): number {
  return Math.max(0, 1 - (nowMs - t) / TRAIL_DURATION_MS);
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  nowMs: number,
  t: number,
  draw: () => void,
): void {
  ctx.beginPath();
  draw();
  ctx.strokeStyle = `rgba(${TRAIL_COLOR}, ${alphaFor(nowMs, t)})`;
  ctx.stroke();
}

export function drawTrail(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  samples: readonly WristSample[],
  nowMs: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (samples.length < 2) {
    return;
  }

  const points = toPixels(samples, canvas.width, canvas.height);

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (points.length === 2) {
    strokeSegment(ctx, nowMs, points[1].t, () => {
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
    });
    return;
  }

  const firstMid = midpoint(points[0], points[1]);
  strokeSegment(ctx, nowMs, points[1].t, () => {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(firstMid.x, firstMid.y);
  });

  for (let i = 1; i < points.length - 1; i++) {
    const start = midpoint(points[i - 1], points[i]);
    const end = midpoint(points[i], points[i + 1]);
    strokeSegment(ctx, nowMs, points[i].t, () => {
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y);
    });
  }

  const last = points[points.length - 1];
  const lastMid = midpoint(points[points.length - 2], last);
  strokeSegment(ctx, nowMs, last.t, () => {
    ctx.moveTo(lastMid.x, lastMid.y);
    ctx.lineTo(last.x, last.y);
  });
}
