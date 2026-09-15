import type { MPMask, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

const TINT_R = 91;
const TINT_G = 92;
const TINT_B = 255;
const TINT_ALPHA = 160;

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d")!;

function readConfidence(mask: MPMask): Float32Array {
  if (mask.hasUint8Array()) {
    const bytes = mask.getAsUint8Array();
    const values = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      values[i] = bytes[i] / 255;
    }
    return values;
  }

  return mask.getAsFloat32Array();
}

export function drawSegmentation(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  result: PoseLandmarkerResult,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const mask = result.segmentationMasks?.[0];
  if (!mask) {
    return;
  }

  if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
  }

  const confidence = readConfidence(mask);
  const imageData = maskCtx.createImageData(mask.width, mask.height);
  const pixels = imageData.data;

  for (let i = 0; i < confidence.length; i++) {
    const offset = i * 4;
    pixels[offset] = TINT_R;
    pixels[offset + 1] = TINT_G;
    pixels[offset + 2] = TINT_B;
    pixels[offset + 3] = Math.round(confidence[i] * TINT_ALPHA);
  }

  maskCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
}
