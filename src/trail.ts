import {
  TRAIL_DURATION_MS,
  type WristSample,
} from "./wrist-history.ts";

const TRAIL_COLOR = "180, 230, 255";
const LINE_WIDTH = 4;

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

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 1; i < samples.length; i++) {
    const age = nowMs - samples[i].t;
    const alpha = Math.max(0, 1 - age / TRAIL_DURATION_MS);
    ctx.beginPath();
    ctx.moveTo(samples[i - 1].x * canvas.width, samples[i - 1].y * canvas.height);
    ctx.lineTo(samples[i].x * canvas.width, samples[i].y * canvas.height);
    ctx.strokeStyle = `rgba(${TRAIL_COLOR}, ${alpha})`;
    ctx.stroke();
  }
}
