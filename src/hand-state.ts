import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RawHand } from "./hands.ts";
import {
  createHandDepth,
  associatePoseWrist,
  type HandDepthSource,
  type HandSlot,
  type PoseWristRef,
} from "./hand-depth.ts";
import {
  CURL_FINGERS,
  FINGER_NAMES,
  FINGER_TIPS,
  HAND_LANDMARK_COUNT,
  INDEX_MCP,
  INDEX_TIP,
  MIDDLE_MCP,
  PALM_SITES,
  PINKY_MCP,
  THUMB_TIP,
  WRIST,
  type FingerName,
} from "./hand-landmarks.ts";
import type { SceneDepth, TrackedDepth } from "./scene-depth.ts";
import {
  createStrokeContinuity,
  type ContinuityState,
  type ContinuityThresholds,
} from "./stroke-continuity.ts";

/**
 * CONVENTIONS — read before consuming HandState.
 *
 * Space:   x/y are normalized MediaPipe image coordinates, UNMIRRORED. The
 *          stage is mirrored by CSS only (`.stage { transform: scaleX(-1) }`),
 *          so nothing here flips x. Thresholded distances are converted to
 *          pixels with the viewport, because x and y use different divisors.
 * Depth:   `rawZ` is MediaPipe's wrist-relative hand z. `trackedDepth` is the
 *          shared app convention from SceneDepth: positive = closer, 0 =
 *          calibrated reference. Artistic exaggeration never enters HandState.
 * Metrics: openness, pinchDistance and palmNormal are derived from
 *          `worldLandmarks` (metric, hand-centred) so they are invariant to
 *          camera distance and image aspect.
 * Velocity: image space, units per SECOND. `vx` positive means image-right,
 *          which is viewer-LEFT under the mirror; use `viewerVx()` for
 *          viewer-space reasoning rather than flipping the stored value.
 *
 * Hand landmark `visibility` is not populated by this task; trust comes from
 * the handedness score exposed as `confidence`.
 */

export type Vec3 = { x: number; y: number; z: number };

export type SpatialPoint = {
  x: number;
  y: number;
  rawZ: number;
  trackedDepth: TrackedDepth;
  timestamp: number;
};

export type FingerTips = Record<FingerName, SpatialPoint>;

export type HandState = {
  id: string;
  handedness: "LEFT" | "RIGHT";
  confidence: number;
  tracked: boolean;
  state: ContinuityState;
  wrist: SpatialPoint;
  palmCenter: SpatialPoint;
  fingertips: FingerTips;
  landmarks: SpatialPoint[];
  handScalePx: number;
  openness: number;
  pinchDistance: number;
  palmNormal: Vec3 | null;
  velocity: Vec3;
  depthSource: HandDepthSource;
  depthValid: boolean;
  rawHandedness: string;
  timestamp: number;
};

export type HandTrackStatus = {
  slot: HandSlot;
  state: ContinuityState;
  msSinceSeen: number;
  confidence: number;
  depthSource: HandDepthSource;
  rawHandedness: string;
};

export type HandsState = {
  left: HandState | null;
  right: HandState | null;
  status: Record<HandSlot, HandTrackStatus>;
  /** Palm separation in hand-scale units (depth invariant), or null. */
  palmDistance: number | null;
};

/**
 * MediaPipe derives handedness assuming mirrored (selfie) input, while this app
 * feeds unmirrored frames, so the label is swapped once here. LEFT/RIGHT always
 * mean the performer's own hand, matching pose landmarks 15/16.
 */
export const SWAP_MEDIAPIPE_HANDEDNESS = true;

export const MIN_HAND_CONFIDENCE = 0.5;

/** Weights over PALM_SITES; uniform keeps the centre inside the palm. */
const PALM_WEIGHTS: readonly number[] = [0.2, 0.2, 0.2, 0.2, 0.2];

/** Tip-to-wrist distance over palm length, per finger, closed and open. */
const CURL_RANGE: Readonly<Record<FingerName, { closed: number; open: number }>> =
  {
    thumb: { closed: 0.85, open: 1.35 },
    index: { closed: 0.95, open: 1.95 },
    middle: { closed: 0.9, open: 2.05 },
    ring: { closed: 0.9, open: 1.95 },
    pinky: { closed: 0.85, open: 1.65 },
  };

/**
 * Sign applied to the palm cross product so a palm facing the camera yields a
 * positive z. World landmark z grows away from the camera.
 */
const PALM_NORMAL_SIGN = -1;
const PALM_DEGENERATE_EPS = 1e-6;

const VELOCITY_WINDOW_MS = 80;
const VELOCITY_HISTORY = 8;
const VELOCITY_SMOOTHING = 0.35;

const IDENTITY_MATCH_PX = 260;
const IDENTITY_SWAP_MARGIN = 0.25;
const POSE_AGREEMENT_WEIGHT = 1;
const HANDEDNESS_WEIGHT = 0.6;
const CONTINUITY_WEIGHT = 0.8;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

function dist3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Palm length in world units; the scale every hand metric divides by. */
export function worldHandScale(world: Landmark[]): number {
  if (world.length < HAND_LANDMARK_COUNT) {
    return 0;
  }
  return dist3(world[MIDDLE_MCP], world[WRIST]);
}

/** Palm length in pixels; the scale for screen-space thresholds. */
export function handScalePx(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): number {
  if (landmarks.length < HAND_LANDMARK_COUNT) {
    return 0;
  }
  const wrist = landmarks[WRIST];
  const mcp = landmarks[MIDDLE_MCP];
  return Math.hypot((mcp.x - wrist.x) * width, (mcp.y - wrist.y) * height);
}

export function palmCenterOf(
  landmarks: NormalizedLandmark[],
): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < PALM_SITES.length; i++) {
    const point = landmarks[PALM_SITES[i]];
    const weight = PALM_WEIGHTS[i];
    x += point.x * weight;
    y += point.y * weight;
    z += point.z * weight;
  }
  return { x, y, z };
}

/** 0 approximately fist, 1 approximately open. Continuous, not a classifier. */
export function opennessOf(world: Landmark[]): number {
  const scale = worldHandScale(world);
  if (scale <= PALM_DEGENERATE_EPS) {
    return 0;
  }
  let total = 0;
  for (const finger of CURL_FINGERS) {
    const ratio = dist3(world[FINGER_TIPS[finger]], world[WRIST]) / scale;
    const range = CURL_RANGE[finger];
    total += clamp01((ratio - range.closed) / (range.open - range.closed));
  }
  return total / CURL_FINGERS.length;
}

/** Thumb-to-index separation in palm-length units. */
export function pinchDistanceOf(world: Landmark[]): number {
  const scale = worldHandScale(world);
  if (scale <= PALM_DEGENERATE_EPS) {
    return 0;
  }
  return dist3(world[THUMB_TIP], world[INDEX_TIP]) / scale;
}

/** Palm facing direction, or null when the palm geometry is degenerate. */
export function palmNormalOf(world: Landmark[]): Vec3 | null {
  if (world.length < HAND_LANDMARK_COUNT) {
    return null;
  }
  const wrist = world[WRIST];
  const middle = world[MIDDLE_MCP];
  const index = world[INDEX_MCP];
  const pinky = world[PINKY_MCP];

  const ax = middle.x - wrist.x;
  const ay = middle.y - wrist.y;
  const az = middle.z - wrist.z;
  const bx = pinky.x - index.x;
  const by = pinky.y - index.y;
  const bz = pinky.z - index.z;

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz);
  if (length <= PALM_DEGENERATE_EPS) {
    return null;
  }

  const scale = PALM_NORMAL_SIGN / length;
  return { x: nx * scale, y: ny * scale, z: nz * scale };
}

/** Viewer-space x velocity. The stored vx is image space and never flipped. */
export function viewerVx(hand: HandState): number {
  return -hand.velocity.x;
}

export function normalizeHandedness(label: string, swap: boolean): HandSlot {
  const isLeftLabel = label.toLowerCase().startsWith("l");
  const left = swap ? !isLeftLabel : isLeftLabel;
  return left ? "left" : "right";
}

type VelocitySample = { x: number; y: number; z: number; t: number };

/**
 * Keyed by point id so fingertip velocities are a later addition rather than a
 * redesign. A median-of-3 prefilter drops single-frame spikes; the window-based
 * difference keeps a genuine thrust intact.
 */
export function createVelocityTracker() {
  const history = new Map<string, VelocitySample[]>();
  const smoothed = new Map<string, Vec3>();

  return {
    sample(key: string, point: VelocitySample): Vec3 {
      const samples = history.get(key) ?? [];
      samples.push(point);
      while (samples.length > VELOCITY_HISTORY) {
        samples.shift();
      }
      history.set(key, samples);

      if (samples.length < 3) {
        const zero = { x: 0, y: 0, z: 0 };
        smoothed.set(key, zero);
        return zero;
      }

      const a = samples[samples.length - 3];
      const b = samples[samples.length - 2];
      const c = samples[samples.length - 1];
      const head: VelocitySample = {
        x: median3(a.x, b.x, c.x),
        y: median3(a.y, b.y, c.y),
        z: median3(a.z, b.z, c.z),
        t: c.t,
      };

      let tail = samples[0];
      for (let i = samples.length - 1; i >= 0; i--) {
        tail = samples[i];
        if (head.t - samples[i].t >= VELOCITY_WINDOW_MS) {
          break;
        }
      }
      const dt = head.t - tail.t;
      const previous = smoothed.get(key) ?? { x: 0, y: 0, z: 0 };
      if (dt <= 0) {
        return previous;
      }

      const perSecond = 1000 / dt;
      const next = {
        x: lerp(previous.x, (head.x - tail.x) * perSecond, VELOCITY_SMOOTHING),
        y: lerp(previous.y, (head.y - tail.y) * perSecond, VELOCITY_SMOOTHING),
        z: lerp(previous.z, (head.z - tail.z) * perSecond, VELOCITY_SMOOTHING),
      };
      smoothed.set(key, next);
      return next;
    },

    reset(key: string): void {
      history.delete(key);
      smoothed.delete(key);
    },
  };
}

type SlotRuntime = {
  slot: HandSlot;
  depth: ReturnType<typeof createHandDepth>;
  continuity: ReturnType<typeof createStrokeContinuity>;
  velocity: ReturnType<typeof createVelocityTracker>;
  hand: HandState | null;
  status: HandTrackStatus;
  lastPalm: { x: number; y: number } | null;
  lastSeenMs: number;
};

type Candidate = {
  raw: RawHand;
  palm: { x: number; y: number; z: number };
  handednessSlot: HandSlot;
  poseWrist: PoseWristRef | null;
  scalePx: number;
};

export function createHandsTracker(scene: SceneDepth) {
  const slots: Record<HandSlot, SlotRuntime> = {
    left: makeSlot("left"),
    right: makeSlot("right"),
  };
  let viewportWidth = 1;
  let viewportHeight = 1;
  let swapHandedness = SWAP_MEDIAPIPE_HANDEDNESS;
  let minConfidence = MIN_HAND_CONFIDENCE;
  let palmDistance: number | null = null;

  function makeSlot(slot: HandSlot): SlotRuntime {
    return {
      slot,
      depth: createHandDepth(scene),
      continuity: createStrokeContinuity(),
      velocity: createVelocityTracker(),
      hand: null,
      status: {
        slot,
        state: "LOST",
        msSinceSeen: 0,
        confidence: 0,
        depthSource: "none",
        rawHandedness: "—",
      },
      lastPalm: null,
      lastSeenMs: 0,
    };
  }

  function slotScore(
    candidate: Candidate,
    slot: HandSlot,
  ): { total: number; continuity: number } {
    const poseAgreement = candidate.poseWrist
      ? candidate.poseWrist.slot === slot
        ? 1
        : 0
      : 0.5;
    const handedness =
      candidate.handednessSlot === slot ? candidate.raw.score : 0;
    const previous = slots[slot].lastPalm;
    const continuity = previous
      ? clamp01(
          1 -
            Math.hypot(
              (candidate.palm.x - previous.x) * viewportWidth,
              (candidate.palm.y - previous.y) * viewportHeight,
            ) /
              IDENTITY_MATCH_PX,
        )
      : 0;
    return {
      total:
        POSE_AGREEMENT_WEIGHT * poseAgreement +
        HANDEDNESS_WEIGHT * handedness +
        CONTINUITY_WEIGHT * continuity,
      continuity,
    };
  }

  /** One-to-one slot assignment with hysteresis so crossing hands do not swap. */
  function assign(
    candidates: Candidate[],
  ): Record<HandSlot, Candidate | null> {
    const result: Record<HandSlot, Candidate | null> = {
      left: null,
      right: null,
    };
    if (candidates.length === 0) {
      return result;
    }

    if (candidates.length === 1) {
      const only = candidates[0];
      const left = slotScore(only, "left");
      const right = slotScore(only, "right");
      if (left.total >= right.total) {
        result.left = only;
      } else {
        result.right = only;
      }
      return result;
    }

    const [first, second] = candidates;
    const straight = {
      left: slotScore(first, "left"),
      right: slotScore(second, "right"),
    };
    const crossed = {
      left: slotScore(second, "left"),
      right: slotScore(first, "right"),
    };
    const straightTotal = straight.left.total + straight.right.total;
    const crossedTotal = crossed.left.total + crossed.right.total;

    let useStraight = straightTotal >= crossedTotal;
    if (Math.abs(straightTotal - crossedTotal) < IDENTITY_SWAP_MARGIN) {
      // Too close to call on evidence, so keep whichever agrees with the
      // previous frame instead of flickering.
      const straightContinuity =
        straight.left.continuity + straight.right.continuity;
      const crossedContinuity =
        crossed.left.continuity + crossed.right.continuity;
      useStraight = straightContinuity >= crossedContinuity;
    }

    if (useStraight) {
      result.left = first;
      result.right = second;
    } else {
      result.left = second;
      result.right = first;
    }
    return result;
  }

  function buildHand(
    runtime: SlotRuntime,
    candidate: Candidate,
    timestampMs: number,
  ): HandState {
    const { raw } = candidate;
    const anchor = runtime.depth.update({
      handScalePx: candidate.scalePx,
      poseWrist: candidate.poseWrist,
      timestampMs,
    });

    const toSpatial = (
      point: NormalizedLandmark,
    ): SpatialPoint => ({
      x: point.x,
      y: point.y,
      rawZ: point.z,
      trackedDepth: runtime.depth.landmarkDepth(anchor.trackedDepth, point.z),
      timestamp: timestampMs,
    });

    const landmarks = raw.landmarks.map(toSpatial);
    const palm = candidate.palm;
    const palmCenter: SpatialPoint = {
      x: palm.x,
      y: palm.y,
      rawZ: palm.z,
      trackedDepth: runtime.depth.landmarkDepth(anchor.trackedDepth, palm.z),
      timestamp: timestampMs,
    };

    const fingertips = {} as FingerTips;
    for (const finger of FINGER_NAMES) {
      fingertips[finger] = landmarks[FINGER_TIPS[finger]];
    }

    // runtime.hand is still the previous frame here, and continuity wants
    // normalized units per ms while HandState velocity is per second.
    const previousSpeed =
      Math.hypot(
        runtime.hand?.velocity.x ?? 0,
        runtime.hand?.velocity.y ?? 0,
      ) / 1000;
    const verdict = runtime.continuity.evaluate(
      {
        x: palm.x,
        y: palm.y,
        trackedDepth: palmCenter.trackedDepth,
        t: timestampMs,
        visibility: raw.score,
      },
      previousSpeed,
      scene.isReady(),
    );
    if (verdict.startNewStroke) {
      // Unknown movement stays unknown: drop history rather than differentiate
      // across the gap.
      runtime.velocity.reset(runtime.slot);
      runtime.depth.resetFilter();
    }

    const velocity = runtime.velocity.sample(runtime.slot, {
      x: palmCenter.x,
      y: palmCenter.y,
      z: palmCenter.trackedDepth,
      t: timestampMs,
    });
    const debug = runtime.continuity.debug();

    return {
      id: `hand-${runtime.slot}`,
      handedness: runtime.slot === "left" ? "LEFT" : "RIGHT",
      confidence: raw.score,
      tracked: true,
      state: debug.state,
      wrist: landmarks[WRIST],
      palmCenter,
      fingertips,
      landmarks,
      handScalePx: candidate.scalePx,
      openness: opennessOf(raw.world),
      pinchDistance: pinchDistanceOf(raw.world),
      palmNormal: palmNormalOf(raw.world),
      velocity,
      depthSource: anchor.source,
      depthValid: anchor.valid,
      rawHandedness: raw.handedness,
      timestamp: timestampMs,
    };
  }

  function updateHands(
    hands: readonly RawHand[],
    poseLandmarks: NormalizedLandmark[] | undefined,
    timestampMs: number,
  ): void {
    const candidates: Candidate[] = [];
    for (const raw of hands) {
      if (
        raw.landmarks.length < HAND_LANDMARK_COUNT ||
        raw.world.length < HAND_LANDMARK_COUNT ||
        raw.score < minConfidence
      ) {
        continue;
      }
      candidates.push({
        raw,
        palm: palmCenterOf(raw.landmarks),
        handednessSlot: normalizeHandedness(raw.handedness, swapHandedness),
        poseWrist: associatePoseWrist(
          poseLandmarks,
          raw.landmarks[WRIST],
          viewportWidth,
          viewportHeight,
        ),
        scalePx: handScalePx(raw.landmarks, viewportWidth, viewportHeight),
      });
    }

    const assignment = assign(candidates);

    for (const slot of ["left", "right"] as const) {
      const runtime = slots[slot];
      const candidate = assignment[slot];
      if (!candidate) {
        runtime.continuity.noteMissedFrame(timestampMs, 0);
        const debug = runtime.continuity.debug();
        runtime.hand = null;
        // Keep the last palm as identity evidence through a brief dropout;
        // only a real loss forgets which slot this hand belonged to.
        if (debug.state === "LOST") {
          runtime.lastPalm = null;
        }
        runtime.status = {
          slot,
          state: debug.state,
          msSinceSeen:
            runtime.lastSeenMs > 0 ? timestampMs - runtime.lastSeenMs : 0,
          confidence: 0,
          depthSource: "none",
          rawHandedness: "—",
        };
        continue;
      }

      const hand = buildHand(runtime, candidate, timestampMs);
      runtime.hand = hand;
      runtime.lastPalm = { x: hand.palmCenter.x, y: hand.palmCenter.y };
      runtime.lastSeenMs = timestampMs;
      runtime.status = {
        slot,
        state: hand.state,
        msSinceSeen: 0,
        confidence: hand.confidence,
        depthSource: hand.depthSource,
        rawHandedness: hand.rawHandedness,
      };
    }

    const left = slots.left.hand;
    const right = slots.right.hand;
    if (left && right) {
      const scale = (left.handScalePx + right.handScalePx) * 0.5;
      const gapPx = Math.hypot(
        (left.palmCenter.x - right.palmCenter.x) * viewportWidth,
        (left.palmCenter.y - right.palmCenter.y) * viewportHeight,
      );
      palmDistance = scale > 0 ? gapPx / scale : null;
    } else {
      palmDistance = null;
    }
  }

  return {
    setViewport(width: number, height: number): void {
      viewportWidth = Math.max(1, width);
      viewportHeight = Math.max(1, height);
      slots.left.continuity.setViewport(viewportWidth, viewportHeight);
      slots.right.continuity.setViewport(viewportWidth, viewportHeight);
    },

    setSwapHandedness(value: boolean): void {
      swapHandedness = value;
    },

    setMinConfidence(value: number): void {
      minConfidence = value;
    },

    setDepthGains(next: {
      scaleDepthGain?: number;
      localZGain?: number;
    }): void {
      slots.left.depth.setGains(next);
      slots.right.depth.setGains(next);
    },

    setContinuityThresholds(next: Partial<ContinuityThresholds>): void {
      slots.left.continuity.setThresholds(next);
      slots.right.continuity.setThresholds(next);
    },

    update: updateHands,

    /** No hand observed this vision tick, for either hand. */
    noteMissedFrame(timestampMs: number): void {
      updateHands([], undefined, timestampMs);
    },

    handleSceneInvert(): void {
      slots.left.depth.handleSceneInvert();
      slots.right.depth.handleSceneInvert();
    },

    handleSceneRecalibrate(): void {
      slots.left.depth.recalibrateScale();
      slots.right.depth.recalibrateScale();
      slots.left.velocity.reset("left");
      slots.right.velocity.reset("right");
    },

    snapshot(): HandsState {
      return {
        left: slots.left.hand,
        right: slots.right.hand,
        status: {
          left: slots.left.status,
          right: slots.right.status,
        },
        palmDistance,
      };
    },
  };
}

export type HandsTracker = ReturnType<typeof createHandsTracker>;
