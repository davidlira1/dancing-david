import type { MPMask, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d")!;

export type PersonMask = {
  width: number;
  height: number;
  confidence: Float32Array;
  canvas: HTMLCanvasElement;
};

let cached: PersonMask | null = null;

function readConfidence(
  mask: MPMask,
  into: Float32Array | null,
): Float32Array {
  if (mask.hasUint8Array()) {
    const bytes = mask.getAsUint8Array();
    const values =
      into && into.length === bytes.length ? into : new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      values[i] = bytes[i] / 255;
    }
    return values;
  }

  const floats = mask.getAsFloat32Array();
  const values =
    into && into.length === floats.length
      ? into
      : new Float32Array(floats.length);
  values.set(floats);
  return values;
}

export function updatePersonMask(
  result: PoseLandmarkerResult,
): PersonMask | null {
  const mask = result.segmentationMasks?.[0];
  if (!mask) {
    cached = null;
    return null;
  }

  const width = mask.width;
  const height = mask.height;
  const prev = cached;
  const confidence = readConfidence(
    mask,
    prev && prev.width === width && prev.height === height
      ? prev.confidence
      : null,
  );

  if (maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas.width = width;
    maskCanvas.height = height;
  }

  const imageData = maskCtx.createImageData(width, height);
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

  cached = {
    width,
    height,
    confidence,
    canvas: maskCanvas,
  };
  return cached;
}

export function lastPersonMask(): PersonMask | null {
  return cached;
}
