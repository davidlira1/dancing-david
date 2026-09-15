import type { MPMask, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

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

export function updatePersonMask(
  result: PoseLandmarkerResult,
): HTMLCanvasElement | null {
  const mask = result.segmentationMasks?.[0];
  if (!mask) {
    return null;
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
    const alpha = Math.round(confidence[i] * 255);
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = alpha;
  }

  maskCtx.putImageData(imageData, 0, 0);
  return maskCanvas;
}
