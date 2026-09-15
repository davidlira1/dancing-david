import type { WristSwipeEvent } from "./motion.ts";

const DURATION_MS = 400;
const BASE_LENGTH = 180;
const MAX_LENGTH = 320;
const BASE_WIDTH = 10;
const MAX_WIDTH = 18;

type Slash = {
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
  createdAt: number;
  duration: number;
  length: number;
  width: number;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function createEnergySwipeEffect() {
  const slashes: Slash[] = [];

  return {
    spawn(event: WristSwipeEvent): void {
      const speedLen = Math.hypot(event.velocity.x, event.velocity.y);
      if (speedLen < 1e-6) {
        return;
      }

      const intensity = clamp((event.speed - 1.2) / 3, 0, 1);
      slashes.push({
        originX: event.origin.x,
        originY: event.origin.y,
        dirX: -event.velocity.x / speedLen,
        dirY: event.velocity.y / speedLen,
        createdAt: event.timestamp,
        duration: DURATION_MS,
        length: BASE_LENGTH + intensity * (MAX_LENGTH - BASE_LENGTH),
        width: BASE_WIDTH + intensity * (MAX_WIDTH - BASE_WIDTH),
      });
    },

    draw(
      canvas: HTMLCanvasElement,
      video: HTMLVideoElement,
      nowMs: number,
    ): void {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      sizeToVideo(canvas, video);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = slashes.length - 1; i >= 0; i--) {
        const slash = slashes[i];
        const progress = (nowMs - slash.createdAt) / slash.duration;
        if (progress >= 1) {
          slashes.splice(i, 1);
          continue;
        }

        const grow = easeOut(Math.min(1, progress / 0.45));
        const alpha = 1 - progress;
        const startX = slash.originX * canvas.width;
        const startY = slash.originY * canvas.height;
        const reach = slash.length * grow;
        const endX = startX + slash.dirX * reach;
        const endY = startY + slash.dirY * reach;

        ctx.lineCap = "round";
        ctx.shadowColor = `rgba(160, 230, 255, ${0.8 * alpha})`;
        ctx.shadowBlur = 18;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = `rgba(120, 210, 255, ${0.35 * alpha})`;
        ctx.lineWidth = slash.width * 2.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = `rgba(230, 250, 255, ${0.95 * alpha})`;
        ctx.lineWidth = slash.width * 0.45;
        ctx.stroke();

        ctx.shadowBlur = 0;
      }
    },
  };
}
