import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createDepthTracker } from "./depth.ts";
import type { SceneDepth, TrackedDepth } from "./scene-depth.ts";
import { LEFT_WRIST_INDEX, RIGHT_WRIST_INDEX } from "./wrist-history.ts";

/**
 * Hand landmark z is wrist-relative (landmark 0 is always 0) and therefore not
 * comparable with pose z, which SceneDepth calibrated against. This adapter
 * produces a hand anchor in the shared trackedDepth convention:
 *
 *   pose wrist z --> SceneDepth.toTracked --> absolute anchor  (source "pose")
 *   apparent hand scale --> locked baseline --> relative anchor (source "scale")
 *
 * The pose source is authoritative; the scale source only carries the hand
 * through frames where pose cannot see the wrist, continuing from the last
 * pose-anchored value so the handoff has no step.
 */

export const POSE_HAND_ASSOC_PX = 170;
export const MIN_POSE_WRIST_VISIBILITY = 0.5;
export const HAND_SCALE_DEPTH_GAIN = 0.45;
export const HAND_LOCAL_Z_GAIN = 1;

const SCALE_CALIBRATION_MS = 800;
const SCALE_MIN_SAMPLES = 8;
const SCALE_CALIBRATION_GAP_MS = 400;

/** Which hand of the performer, matching MediaPipe pose landmark naming. */
export type HandSlot = "left" | "right";

export type HandDepthSource = "pose" | "scale" | "none";

export type PoseWristRef = {
  slot: HandSlot;
  x: number;
  y: number;
  rawZ: number;
  visibility: number;
  distancePx: number;
};

export type HandDepthAnchor = {
  trackedDepth: TrackedDepth;
  rawZ: number;
  source: HandDepthSource;
  valid: boolean;
  handScalePx: number;
  baselineScalePx: number;
};

/**
 * Nearest visible pose wrist to a hand's own wrist landmark, in pixels. Serves
 * both the depth anchor and handedness normalization.
 */
export function associatePoseWrist(
  poseLandmarks: NormalizedLandmark[] | undefined,
  handWrist: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
): PoseWristRef | null {
  if (!poseLandmarks) {
    return null;
  }

  const candidates: [HandSlot, number][] = [
    ["left", LEFT_WRIST_INDEX],
    ["right", RIGHT_WRIST_INDEX],
  ];
  let best: PoseWristRef | null = null;

  for (const [slot, index] of candidates) {
    const wrist = poseLandmarks[index];
    if (!wrist || wrist.visibility < MIN_POSE_WRIST_VISIBILITY) {
      continue;
    }
    const dx = (wrist.x - handWrist.x) * viewportWidth;
    const dy = (wrist.y - handWrist.y) * viewportHeight;
    const distancePx = Math.hypot(dx, dy);
    if (distancePx > POSE_HAND_ASSOC_PX) {
      continue;
    }
    if (!best || distancePx < best.distancePx) {
      best = {
        slot,
        x: wrist.x,
        y: wrist.y,
        rawZ: wrist.z,
        visibility: wrist.visibility,
        distancePx,
      };
    }
  }

  return best;
}

export function createHandDepth(scene: SceneDepth) {
  const poseDepth = createDepthTracker(scene);
  const scaleSamples: number[] = [];
  let scaleStartMs = 0;
  let lastScaleMs = 0;
  let baselineScalePx = 0;
  let scaleLocked = false;
  let scaleOffset = 0;
  let scaleDepthGain = HAND_SCALE_DEPTH_GAIN;
  let localZGain = HAND_LOCAL_Z_GAIN;
  let lastTracked: TrackedDepth = 0;

  function offerScaleSample(handScalePx: number, timestampMs: number): void {
    if (scaleLocked || handScalePx <= 0) {
      return;
    }
    if (
      lastScaleMs > 0 &&
      timestampMs - lastScaleMs > SCALE_CALIBRATION_GAP_MS
    ) {
      scaleSamples.length = 0;
      scaleStartMs = timestampMs;
    }
    if (scaleStartMs === 0) {
      scaleStartMs = timestampMs;
    }
    scaleSamples.push(handScalePx);
    lastScaleMs = timestampMs;
    if (
      scaleSamples.length >= SCALE_MIN_SAMPLES &&
      lastScaleMs - scaleStartMs >= SCALE_CALIBRATION_MS
    ) {
      let sum = 0;
      for (let i = 0; i < scaleSamples.length; i++) {
        sum += scaleSamples[i];
      }
      baselineScalePx = sum / scaleSamples.length;
      scaleLocked = true;
    }
  }

  /** Relative depth implied by apparent size growth since the locked baseline. */
  function depthFromScale(handScalePx: number): number {
    if (!scaleLocked || baselineScalePx <= 0 || handScalePx <= 0) {
      return 0;
    }
    return scaleDepthGain * (handScalePx / baselineScalePx - 1);
  }

  return {
    setGains(next: { scaleDepthGain?: number; localZGain?: number }): void {
      if (typeof next.scaleDepthGain === "number") {
        scaleDepthGain = next.scaleDepthGain;
      }
      if (typeof next.localZGain === "number") {
        localZGain = next.localZGain;
      }
    },

    update(options: {
      handScalePx: number;
      poseWrist: PoseWristRef | null;
      timestampMs: number;
    }): HandDepthAnchor {
      const { handScalePx, poseWrist, timestampMs } = options;
      offerScaleSample(handScalePx, timestampMs);
      const scaleDelta = depthFromScale(handScalePx);

      if (poseWrist && scene.isReady()) {
        const snapshot = poseDepth.update(
          poseWrist.rawZ,
          timestampMs,
          poseWrist.visibility,
        );
        lastTracked = snapshot.trackedDepth;
        // Keep the scale source ready to continue from here without a step.
        scaleOffset = lastTracked - scaleDelta;
        return {
          trackedDepth: lastTracked,
          rawZ: poseWrist.rawZ,
          source: "pose",
          valid: true,
          handScalePx,
          baselineScalePx,
        };
      }

      if (scaleLocked) {
        lastTracked = scaleOffset + scaleDelta;
        return {
          trackedDepth: lastTracked,
          rawZ: 0,
          source: "scale",
          valid: true,
          handScalePx,
          baselineScalePx,
        };
      }

      lastTracked = 0;
      return {
        trackedDepth: 0,
        rawZ: 0,
        source: "none",
        valid: false,
        handScalePx,
        baselineScalePx,
      };
    },

    /** Wrist-relative landmark z folded into the shared convention. */
    landmarkDepth(anchor: TrackedDepth, localZ: number): TrackedDepth {
      const signed = scene.invertZ() ? -localZ : localZ;
      return anchor + localZGain * signed;
    },

    /** Drop filter and continuity state without touching the scene baseline. */
    resetFilter(): void {
      poseDepth.resetFilter();
      lastTracked = 0;
    },

    /** Forget the hand scale baseline, e.g. on an explicit recalibrate. */
    recalibrateScale(): void {
      scaleSamples.length = 0;
      scaleStartMs = 0;
      lastScaleMs = 0;
      baselineScalePx = 0;
      scaleLocked = false;
      scaleOffset = 0;
      poseDepth.resetFilter();
      lastTracked = 0;
    },

    handleSceneInvert(): void {
      poseDepth.negateTracked();
      scaleOffset = -scaleOffset;
      lastTracked = -lastTracked;
    },

    lastTrackedDepth(): TrackedDepth {
      return lastTracked;
    },
  };
}

export type HandDepth = ReturnType<typeof createHandDepth>;
