import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SceneDepth, TrackedDepth } from "./scene-depth.ts";
import type { PersonMask } from "./segmentation.ts";

export const TRACKED_DEPTH_PACK_RANGE = 0.6;
export const DEFAULT_BODY_INFLUENCE_RADIUS = 0.18;
export const MIN_LANDMARK_VISIBILITY = 0.5;
export const MAX_BODY_DEPTH_DIM = 256;

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;

const SITES = [
  NOSE,
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_ELBOW,
  RIGHT_ELBOW,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_KNEE,
  RIGHT_KNEE,
] as const;

const BONES: readonly [number, number][] = [
  [LEFT_SHOULDER, LEFT_ELBOW],
  [LEFT_ELBOW, LEFT_WRIST],
  [RIGHT_SHOULDER, RIGHT_ELBOW],
  [RIGHT_ELBOW, RIGHT_WRIST],
  [LEFT_SHOULDER, RIGHT_SHOULDER],
  [LEFT_SHOULDER, LEFT_HIP],
  [RIGHT_SHOULDER, RIGHT_HIP],
  [LEFT_HIP, RIGHT_HIP],
  [LEFT_SHOULDER, RIGHT_HIP],
  [RIGHT_SHOULDER, LEFT_HIP],
  [LEFT_HIP, LEFT_KNEE],
  [RIGHT_HIP, RIGHT_KNEE],
];

const TORSO = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP] as const;

export type BodyDepthSample = {
  coverage: number;
  trackedDepth: TrackedDepth;
  valid: boolean;
};

export type BodyDepthField = {
  width: number;
  height: number;
  coverage: Float32Array;
  trackedDepth: Float32Array;
  valid: Float32Array;
  packed: Uint8Array;
  torsoDepth: TrackedDepth;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function packTrackedDepth(trackedDepth: TrackedDepth): number {
  return clamp01(
    (trackedDepth + TRACKED_DEPTH_PACK_RANGE) / (2 * TRACKED_DEPTH_PACK_RANGE),
  );
}

export function unpackTrackedDepth(encoded: number): TrackedDepth {
  return encoded * 2 * TRACKED_DEPTH_PACK_RANGE - TRACKED_DEPTH_PACK_RANGE;
}

export const HEAD_ATTACH_MS = 100;

export function occlusionFactor(options: {
  coverage: number;
  ribbonTracked: TrackedDepth;
  bodyTracked: TrackedDepth;
  bodyValid: boolean;
  occlusionEnabled: boolean;
  calibrated: boolean;
  hasMask: boolean;
  bias: number;
  softness: number;
  segThreshold: number;
  headLife: number;
  headAttach: number;
}): number {
  if (!options.occlusionEnabled || !options.calibrated || !options.hasMask) {
    return 1;
  }
  let depthFactor = 1;
  if (options.bodyValid) {
    const delta = options.ribbonTracked - options.bodyTracked;
    const lo = -(options.bias + options.softness);
    const hi = options.bias + options.softness;
    const t = hi === lo ? (delta >= hi ? 1 : 0) : (delta - lo) / (hi - lo);
    depthFactor = clamp01(t);
    depthFactor = depthFactor * depthFactor * (3 - 2 * depthFactor);
  }
  const personAmt = clamp01(
    (options.coverage - options.segThreshold) /
      Math.max(1e-4, 1 - options.segThreshold),
  );
  const personSmooth = personAmt * personAmt * (3 - 2 * personAmt);
  let occ = 1 - personSmooth + depthFactor * personSmooth;
  const attachStart = 1 - options.headAttach;
  const attachT =
    options.headAttach <= 1e-6
      ? options.headLife >= 1
        ? 1
        : 0
      : clamp01((options.headLife - attachStart) / options.headAttach);
  const attach = attachT * attachT * (3 - 2 * attachT);
  return occ * (1 - attach) + attach;
}

function distPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq < 1e-10
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return { dist: Math.hypot(px - qx, py - qy), t };
}

function influence(dist: number, radius: number): number {
  if (radius <= 1e-6 || dist >= radius) {
    return 0;
  }
  const t = 1 - dist / radius;
  return t * t;
}

export function createBodyDepthField() {
  let field: BodyDepthField | null = null;

  function ensure(width: number, height: number): BodyDepthField {
    const count = width * height;
    if (
      field &&
      field.width === width &&
      field.height === height &&
      field.coverage.length === count
    ) {
      return field;
    }
    field = {
      width,
      height,
      coverage: new Float32Array(count),
      trackedDepth: new Float32Array(count),
      valid: new Float32Array(count),
      packed: new Uint8Array(count * 4),
      torsoDepth: 0,
    };
    return field;
  }

  return {
    update(
      landmarks: readonly NormalizedLandmark[] | undefined,
      mask: PersonMask | null,
      scene: SceneDepth,
      influenceRadius: number,
    ): BodyDepthField | null {
      if (!mask || !landmarks || landmarks.length === 0) {
        field = null;
        return null;
      }

      const srcW = mask.width;
      const srcH = mask.height;
      const scale =
        Math.max(srcW, srcH) > MAX_BODY_DEPTH_DIM
          ? MAX_BODY_DEPTH_DIM / Math.max(srcW, srcH)
          : 1;
      const width = Math.max(1, Math.round(srcW * scale));
      const height = Math.max(1, Math.round(srcH * scale));
      const next = ensure(width, height);

      let torsoSum = 0;
      let torsoWeight = 0;
      for (const index of TORSO) {
        const landmark = landmarks[index];
        if (!landmark || landmark.visibility < MIN_LANDMARK_VISIBILITY) {
          continue;
        }
        const weight = landmark.visibility;
        torsoSum += scene.toTracked(landmark.z) * weight;
        torsoWeight += weight;
      }
      const torsoDepth = torsoWeight > 1e-4 ? torsoSum / torsoWeight : 0;
      next.torsoDepth = torsoDepth;
      const ready = scene.isReady();
      const radius = Math.max(0.04, influenceRadius);

      const packed = next.packed;
      for (let i = 0; i < next.coverage.length; i++) {
        const px = i % next.width;
        const py = (i / next.width) | 0;
        const coverage =
          mask.confidence[
            Math.min(srcH - 1, (((py + 0.5) / height) * srcH) | 0) * srcW +
              Math.min(srcW - 1, (((px + 0.5) / width) * srcW) | 0)
          ];
        const x = (px + 0.5) / next.width;
        const y = (py + 0.5) / next.height;

        let depthSum = 0;
        let weightSum = 0;

        if (ready && coverage > 0.02) {
          for (const index of SITES) {
            const landmark = landmarks[index];
            if (!landmark || landmark.visibility < MIN_LANDMARK_VISIBILITY) {
              continue;
            }
            const dist = Math.hypot(x - landmark.x, y - landmark.y);
            const weight = landmark.visibility * influence(dist, radius);
            if (weight <= 0) {
              continue;
            }
            depthSum += scene.toTracked(landmark.z) * weight;
            weightSum += weight;
          }

          for (const [ia, ib] of BONES) {
            const a = landmarks[ia];
            const b = landmarks[ib];
            if (
              !a ||
              !b ||
              a.visibility < MIN_LANDMARK_VISIBILITY ||
              b.visibility < MIN_LANDMARK_VISIBILITY
            ) {
              continue;
            }
            const { dist, t } = distPointSegment(x, y, a.x, a.y, b.x, b.y);
            const vis = Math.min(a.visibility, b.visibility);
            const weight = vis * influence(dist, radius);
            if (weight <= 0) {
              continue;
            }
            const depth = scene.toTracked(a.z) * (1 - t) + scene.toTracked(b.z) * t;
            depthSum += depth * weight;
            weightSum += weight;
          }
        }

        let tracked = torsoDepth;
        let valid = 0;
        if (!ready || coverage <= 0.02) {
          tracked = 0;
        } else if (weightSum > 1e-4) {
          tracked = depthSum / weightSum;
          valid = 1;
        } else if (torsoWeight > 1e-4) {
          tracked = torsoDepth;
          valid = 1;
        }

        next.coverage[i] = coverage;
        next.trackedDepth[i] = tracked;
        next.valid[i] = valid;
        const o = i * 4;
        packed[o] = Math.round(packTrackedDepth(tracked) * 255);
        packed[o + 1] = Math.round(valid * 255);
        packed[o + 2] = 0;
        packed[o + 3] = Math.round(clamp01(coverage) * 255);
      }

      return next;
    },

    sample(nx: number, ny: number): BodyDepthSample | null {
      if (!field) {
        return null;
      }
      const x = Math.max(0, Math.min(1, nx)) * (field.width - 1);
      const y = Math.max(0, Math.min(1, ny)) * (field.height - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(field.width - 1, x0 + 1);
      const y1 = Math.min(field.height - 1, y0 + 1);
      const tx = x - x0;
      const ty = y - y0;

      function at(ix: number, iy: number): BodyDepthSample {
        const i = iy * field!.width + ix;
        return {
          coverage: field!.coverage[i],
          trackedDepth: field!.trackedDepth[i],
          valid: field!.valid[i] > 0.5,
        };
      }

      const a = at(x0, y0);
      const b = at(x1, y0);
      const c = at(x0, y1);
      const d = at(x1, y1);
      const coverage =
        a.coverage * (1 - tx) * (1 - ty) +
        b.coverage * tx * (1 - ty) +
        c.coverage * (1 - tx) * ty +
        d.coverage * tx * ty;
      const trackedDepth =
        a.trackedDepth * (1 - tx) * (1 - ty) +
        b.trackedDepth * tx * (1 - ty) +
        c.trackedDepth * (1 - tx) * ty +
        d.trackedDepth * tx * ty;
      return {
        coverage,
        trackedDepth,
        valid: a.valid || b.valid || c.valid || d.valid,
      };
    },

    last(): BodyDepthField | null {
      return field;
    },
  };
}

export function formatOcclusionDebug(snapshot: {
  coverage: number;
  ribbonTracked: number;
  bodyTracked: number;
  delta: number;
  occlusionFactor: number;
  valid: boolean;
}): string {
  return (
    `Occ coverage: ${snapshot.coverage.toFixed(2)}\n` +
    `Ribbon tracked: ${snapshot.ribbonTracked.toFixed(3)}\n` +
    `Body tracked: ${snapshot.valid ? snapshot.bodyTracked.toFixed(3) : "—"}\n` +
    `Delta: ${snapshot.valid ? snapshot.delta.toFixed(3) : "—"}\n` +
    `Occlusion: ${snapshot.occlusionFactor.toFixed(2)}`
  );
}
