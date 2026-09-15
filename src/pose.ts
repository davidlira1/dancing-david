import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

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
    runningMode: "VIDEO",
    numPoses: 1,
    outputSegmentationMasks: false,
  });
}

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  try {
    return await createWithDelegate("GPU");
  } catch {
    return createWithDelegate("CPU");
  }
}

export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
) {
  return landmarker.detectForVideo(video, timestampMs);
}
