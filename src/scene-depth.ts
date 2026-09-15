const DEPTH_CONFIDENT_VISIBILITY = 0.65;

export const DEPTH_CALIBRATION_MS = 1000;
export const DEPTH_MIN_CALIBRATION_SAMPLES = 10;
export const DEPTH_CALIBRATION_GAP_MS = 400;

/**
 * Tracked depth is the app-wide spatial coordinate for occlusion, gesture
 * volume, and future objects. Positive = closer than the locked scene
 * baseline, 0 = calibrated/reference, negative = farther.
 *
 * Convert MediaPipe image-z with SceneDepth.toTracked(); never compare
 * raw landmark z or visualDepth against this value.
 */
export type TrackedDepth = number;

export type SceneDepthSnapshot = {
  baselineZ: number;
  invertZ: boolean;
  calibrated: boolean;
  calibrating: boolean;
};

export type SceneDepth = {
  /** MediaPipe image-z → trackedDepth. Returns 0 until the baseline is locked. */
  toTracked(rawZ: number): TrackedDepth;
  /** Inverse of toTracked (valid once calibrated). */
  toRaw(trackedDepth: TrackedDepth): number;
  offerCalibrationSample(
    rawZ: number,
    timestampMs: number,
    visibility: number,
  ): void;
  setInvertZ(value: boolean): boolean;
  invertZ(): boolean;
  recalibrate(): void;
  isReady(): boolean;
  snapshot(): SceneDepthSnapshot;
};

export function createSceneDepth(options?: { invertZ?: boolean }): SceneDepth {
  const calSamples: number[] = [];
  let calStartMs = 0;
  let lastCalMs = 0;
  let calibrating = true;
  let calibrated = false;
  let baselineZ = 0;
  let invertZ = options?.invertZ ?? true;

  function finishCalibration(): void {
    if (calSamples.length === 0) {
      return;
    }
    let sum = 0;
    for (let i = 0; i < calSamples.length; i++) {
      sum += calSamples[i];
    }
    baselineZ = sum / calSamples.length;
    calibrated = true;
    calibrating = false;
  }

  return {
    toTracked(rawZ: number): TrackedDepth {
      if (!calibrated) {
        return 0;
      }
      return invertZ ? baselineZ - rawZ : rawZ - baselineZ;
    },

    toRaw(trackedDepth: TrackedDepth): number {
      return invertZ ? baselineZ - trackedDepth : baselineZ + trackedDepth;
    },

    offerCalibrationSample(
      rawZ: number,
      timestampMs: number,
      visibility: number,
    ): void {
      if (!calibrating) {
        return;
      }
      if (visibility < DEPTH_CONFIDENT_VISIBILITY) {
        return;
      }
      if (
        lastCalMs > 0 &&
        timestampMs - lastCalMs > DEPTH_CALIBRATION_GAP_MS
      ) {
        calSamples.length = 0;
        calStartMs = timestampMs;
      }
      if (calStartMs === 0) {
        calStartMs = timestampMs;
      }
      calSamples.push(rawZ);
      lastCalMs = timestampMs;
      const elapsed = lastCalMs - calStartMs;
      if (
        calSamples.length >= DEPTH_MIN_CALIBRATION_SAMPLES &&
        elapsed >= DEPTH_CALIBRATION_MS
      ) {
        finishCalibration();
      }
    },

    setInvertZ(value: boolean): boolean {
      if (invertZ === value) {
        return false;
      }
      invertZ = value;
      return true;
    },

    invertZ(): boolean {
      return invertZ;
    },

    recalibrate(): void {
      calSamples.length = 0;
      calStartMs = 0;
      lastCalMs = 0;
      calibrating = true;
      calibrated = false;
    },

    isReady(): boolean {
      return calibrated && !calibrating;
    },

    snapshot(): SceneDepthSnapshot {
      return {
        baselineZ,
        invertZ,
        calibrated,
        calibrating,
      };
    },
  };
}
