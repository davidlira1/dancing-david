import {
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerCallback,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { createVisionTask } from "./vision-runtime.ts";

const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

function createWithDelegate(
  delegate: "GPU" | "CPU",
): Promise<PoseLandmarker> {
  return createVisionTask((vision) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate,
      },
      // GPU masks are bound to this canvas; without it, mask readback is empty.
      canvas: document.createElement("canvas"),
      runningMode: "VIDEO",
      numPoses: 1,
      outputSegmentationMasks: true,
    }),
  );
}

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  try {
    // CPU keeps segmentation masks as readable pixel arrays. GPU often
    // returns an empty texture unless we draw it with the task's WebGL
    // context, which this 2D tint path does not use.
    return await createWithDelegate("CPU");
  } catch {
    return createWithDelegate("GPU");
  }
}

export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
  onResult: PoseLandmarkerCallback,
): void {
  landmarker.detectForVideo(video, timestampMs, onResult);
}

function copyNormalized(point: NormalizedLandmark): NormalizedLandmark {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

/** Landmarks only — masks stay inside the detect callback and die with it. */
export function copyPoseLandmarks(
  result: PoseLandmarkerResult,
): { landmarks: NormalizedLandmark[][] } {
  return {
    landmarks: result.landmarks.map((set) => set.map(copyNormalized)),
  };
}
