import {
  DrawingUtils,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type PoseOverlay = Pick<PoseLandmarkerResult, "landmarks">;

export function drawPose(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  result: PoseOverlay,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);
    drawingUtils.drawLandmarks(landmarks);
  }
}
