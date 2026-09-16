import {
  HandLandmarker,
  type HandLandmarkerResult,
  type Landmark,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { createVisionTask } from "./vision-runtime.ts";

const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const MAX_HANDS = 2;
const MIN_DETECTION_CONFIDENCE = 0.5;
const MIN_PRESENCE_CONFIDENCE = 0.5;
const MIN_TRACKING_CONFIDENCE = 0.5;

/** Weight of each new sample in the inference-time average. */
const TIMING_SMOOTHING = 0.15;

function createWithDelegate(
  delegate: "GPU" | "CPU",
): Promise<HandLandmarker> {
  return createVisionTask((vision) =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate,
      },
      // Unused by the 2D overlay; kept uninitialized so MediaPipe can bind
      // WebGL2 if this task ever falls back to GPU. Never getContext("2d").
      canvas: document.createElement("canvas"),
      runningMode: "VIDEO",
      numHands: MAX_HANDS,
      minHandDetectionConfidence: MIN_DETECTION_CONFIDENCE,
      minHandPresenceConfidence: MIN_PRESENCE_CONFIDENCE,
      minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
    }),
  );
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  try {
    // CPU matches pose and stays off the ribbon's WebGL context. GPU plus
    // another WebGL owner is what was killing _waitUntilIdle after a few
    // frames.
    return await createWithDelegate("CPU");
  } catch {
    return createWithDelegate("GPU");
  }
}

export type HandDetection = {
  result: HandLandmarkerResult;
  inferenceMs: number;
};

/**
 * HandLandmarker.detectForVideo is synchronous, so the call itself is the
 * inference and can be timed directly. Timestamps must increase per instance.
 */
export function detectHands(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): HandDetection {
  const started = performance.now();
  const result = landmarker.detectForVideo(video, timestampMs);
  return { result, inferenceMs: performance.now() - started };
}

/** One detected hand, flattened so no consumer walks the MediaPipe result. */
export type RawHand = {
  landmarks: NormalizedLandmark[];
  world: Landmark[];
  handedness: string;
  score: number;
};

function copyNormalized(point: NormalizedLandmark): NormalizedLandmark {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

function copyWorld(point: Landmark): Landmark {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

export function toRawHands(result: HandLandmarkerResult | null): RawHand[] {
  if (!result) {
    return [];
  }
  const hands: RawHand[] = [];
  for (let i = 0; i < result.landmarks.length; i++) {
    const category = result.handedness[i]?.[0];
    hands.push({
      landmarks: result.landmarks[i].map(copyNormalized),
      world: (result.worldLandmarks[i] ?? []).map(copyWorld),
      handedness: category?.categoryName ?? "",
      score: category?.score ?? 0,
    });
  }
  return hands;
}

export type VisionTimingSnapshot = {
  inferenceMs: number;
  fps: number;
};

export function createVisionTiming() {
  const stamps: number[] = [];
  let inferenceMs = 0;

  return {
    note(ms: number, timestampMs: number): void {
      inferenceMs =
        inferenceMs === 0
          ? ms
          : inferenceMs + (ms - inferenceMs) * TIMING_SMOOTHING;
      stamps.push(timestampMs);
      while (stamps.length > 0 && stamps[0] < timestampMs - 1000) {
        stamps.shift();
      }
    },

    snapshot(timestampMs: number): VisionTimingSnapshot {
      while (stamps.length > 0 && stamps[0] < timestampMs - 1000) {
        stamps.shift();
      }
      return { inferenceMs, fps: stamps.length };
    },
  };
}

export type { HandLandmarker, HandLandmarkerResult };
