import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export const TRAIL_DURATION_MS = 500;
export const MIN_VISIBILITY = 0.5;
export const LEFT_WRIST_INDEX = 15;
export const RIGHT_WRIST_INDEX = 16;

export type WristSample = {
  x: number;
  y: number;
  t: number;
};

export function createWristTrail() {
  const points: WristSample[] = [];

  function prune(timestampMs: number): void {
    const cutoff = timestampMs - TRAIL_DURATION_MS;
    while (points.length > 0 && points[0].t < cutoff) {
      points.shift();
    }
  }

  return {
    update(
      landmarks: NormalizedLandmark[] | undefined,
      timestampMs: number,
    ): void {
      prune(timestampMs);

      const wrist = landmarks?.[RIGHT_WRIST_INDEX];
      if (!wrist || wrist.visibility < MIN_VISIBILITY) {
        return;
      }

      points.push({ x: wrist.x, y: wrist.y, t: timestampMs });
    },

    samples(): readonly WristSample[] {
      return points;
    },
  };
}
