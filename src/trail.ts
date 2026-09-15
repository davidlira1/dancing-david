import {
  VISUAL_TRAIL_DURATION_MS,
  type VisualSample,
} from "./visual-trajectory.ts";

const TRAIL_COLOR = "180, 230, 255";
const LINE_WIDTH = 4;

const FADE_LAYERS = [
  { startFrac: 0, alpha: 0.18 },
  { startFrac: 0.4, alpha: 0.4 },
  { startFrac: 0.65, alpha: 0.72 },
  { startFrac: 0.84, alpha: 1 },
] as const;

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

function midpoint(a: Point, b: Point): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function addMidpointPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 2) {
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  const firstMid = midpoint(points[0], points[1]);
  ctx.lineTo(firstMid.x, firstMid.y);

  for (let i = 1; i < points.length - 1; i++) {
    const end = midpoint(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
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

  const points = toPixels(alive, canvas.width, canvas.height);

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 4;
  ctx.shadowColor = `rgba(${TRAIL_COLOR}, 0.35)`;

  for (const layer of FADE_LAYERS) {
    const start = Math.floor(points.length * layer.startFrac);
    const slice = points.slice(Math.min(start, points.length - 2));
    if (slice.length < 2) {
      continue;
    }
    ctx.beginPath();
    addMidpointPath(ctx, slice);
    ctx.strokeStyle = `rgba(${TRAIL_COLOR}, ${layer.alpha})`;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}
