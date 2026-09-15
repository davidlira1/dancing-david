import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerCallback,
} from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

async function createWithDelegate(
  delegate: "GPU" | "CPU",
): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate,
    },
    // GPU masks are bound to this canvas; without it, mask readback is empty.
    canvas: document.createElement("canvas"),
    runningMode: "VIDEO",
    numPoses: 1,
    outputSegmentationMasks: true,
  });
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
