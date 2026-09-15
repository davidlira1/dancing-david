import type { BodyDepthField } from "./body-depth.ts";
import type { PersonMask } from "./segmentation.ts";

const depthCanvas = document.createElement("canvas");
const depthCtx = depthCanvas.getContext("2d")!;
const maskTint = document.createElement("canvas");
const maskTintCtx = maskTint.getContext("2d")!;

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

function depthColor(tracked: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (tracked + 0.22) / 0.44));
  if (t < 0.5) {
    const u = t * 2;
    return [
      Math.round(46 + (46 - 46) * u),
      Math.round(107 + (242 - 107) * u),
      Math.round(255 + (82 - 255) * u),
    ];
  }
  const u = (t - 0.5) * 2;
  return [
    Math.round(46 + (255 - 46) * u),
    Math.round(242 + (41 - 242) * u),
    Math.round(82 + (41 - 82) * u),
  ];
}

export function drawOcclusionDebug(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  options: {
    mask: PersonMask | null;
    field: BodyDepthField | null;
    segmentationDebug: boolean;
    bodyDepthDebug: boolean;
    clear: boolean;
  },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  sizeToVideo(canvas, video);
  if (options.clear) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (
    !options.segmentationDebug &&
    !options.bodyDepthDebug
  ) {
    return;
  }

  if (options.segmentationDebug && options.mask) {
    if (
      maskTint.width !== canvas.width ||
      maskTint.height !== canvas.height
    ) {
      maskTint.width = canvas.width;
      maskTint.height = canvas.height;
    }
    maskTintCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskTintCtx.clearRect(0, 0, maskTint.width, maskTint.height);
    maskTintCtx.drawImage(
      options.mask.canvas,
      0,
      0,
      maskTint.width,
      maskTint.height,
    );
    maskTintCtx.globalCompositeOperation = "source-in";
    maskTintCtx.fillStyle = "rgb(80, 220, 255)";
    maskTintCtx.fillRect(0, 0, maskTint.width, maskTint.height);
    maskTintCtx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(maskTint, 0, 0);
    ctx.restore();
  }

  if (options.bodyDepthDebug && options.field) {
    if (
      depthCanvas.width !== options.field.width ||
      depthCanvas.height !== options.field.height
    ) {
      depthCanvas.width = options.field.width;
      depthCanvas.height = options.field.height;
    }
    const image = depthCtx.createImageData(
      options.field.width,
      options.field.height,
    );
    const pixels = image.data;
    for (let i = 0; i < options.field.coverage.length; i++) {
      const coverage = options.field.coverage[i];
      if (coverage < 0.05) {
        continue;
      }
      const [r, g, b] = depthColor(options.field.trackedDepth[i]);
      const o = i * 4;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
      pixels[o + 3] = Math.round(Math.min(1, coverage) * 180);
    }
    depthCtx.putImageData(image, 0, 0);
    ctx.drawImage(depthCanvas, 0, 0, canvas.width, canvas.height);
  }
}
