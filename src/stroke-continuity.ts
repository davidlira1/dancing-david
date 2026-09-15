/**
 * Decides whether a newly observed wrist sample may continue the current
 * ribbon stroke, or whether tracking was interrupted and a new stroke must
 * start. Geometry is never interpolated across a stroke boundary.
 */

export const MIN_CONTINUITY_VISIBILITY = 0.5;
export const MAX_TRACKING_GAP_MS = 150;
export const MAX_REACQUIRE_DISTANCE_PX = 180;
export const MAX_REACQUIRE_DEPTH_JUMP = 0.25;

/** Above this the sample is fully trusted; between this and the minimum it reads as UNCERTAIN. */
const CONTINUITY_CONFIDENT_VISIBILITY = 0.65;

export type ContinuityState = "TRACKING" | "UNCERTAIN" | "LOST" | "REACQUIRED";

export type BreakReason = "none" | "first" | "gap" | "distance" | "depth";

export type ContinuityThresholds = {
  minVisibility: number;
  maxGapMs: number;
  maxReacquireDistancePx: number;
  maxReacquireDepthJump: number;
};

export type ContinuityObservation = {
  x: number;
  y: number;
  trackedDepth: number;
  t: number;
  visibility: number;
};

export type ContinuityVerdict = {
  startNewStroke: boolean;
  strokeId: number;
  reason: BreakReason;
};

export type ContinuityDebug = {
  strokeId: number;
  state: ContinuityState;
  visibility: number;
  msSinceReliable: number;
  reacquireDistancePx: number;
  missedFrames: number;
  reason: BreakReason;
};

export function createStrokeContinuity() {
  const thresholds: ContinuityThresholds = {
    minVisibility: MIN_CONTINUITY_VISIBILITY,
    maxGapMs: MAX_TRACKING_GAP_MS,
    maxReacquireDistancePx: MAX_REACQUIRE_DISTANCE_PX,
    maxReacquireDepthJump: MAX_REACQUIRE_DEPTH_JUMP,
  };

  let viewportWidth = 1;
  let viewportHeight = 1;
  let strokeId = 0;
  let lastReliable: ContinuityObservation | null = null;
  let missedFrames = 0;
  let lastSeenT = 0;
  let state: ContinuityState = "LOST";
  let visibility = 0;
  let reacquireDistancePx = 0;
  let reason: BreakReason = "none";

  function msSinceReliable(): number {
    if (!lastReliable) {
      return 0;
    }
    return Math.max(0, lastSeenT - lastReliable.t);
  }

  function distancePx(observation: ContinuityObservation): number {
    if (!lastReliable) {
      return 0;
    }
    const dx = (observation.x - lastReliable.x) * viewportWidth;
    const dy = (observation.y - lastReliable.y) * viewportHeight;
    return Math.hypot(dx, dy);
  }

  return {
    setViewport(width: number, height: number): void {
      viewportWidth = Math.max(1, width);
      viewportHeight = Math.max(1, height);
    },

    setThresholds(next: Partial<ContinuityThresholds>): void {
      if (typeof next.minVisibility === "number") {
        thresholds.minVisibility = next.minVisibility;
      }
      if (typeof next.maxGapMs === "number") {
        thresholds.maxGapMs = Math.max(1, next.maxGapMs);
      }
      if (typeof next.maxReacquireDistancePx === "number") {
        thresholds.maxReacquireDistancePx = Math.max(
          0,
          next.maxReacquireDistancePx,
        );
      }
      if (typeof next.maxReacquireDepthJump === "number") {
        thresholds.maxReacquireDepthJump = Math.max(
          0,
          next.maxReacquireDepthJump,
        );
      }
    },

    minVisibility(): number {
      return thresholds.minVisibility;
    },

    /** A frame where MediaPipe gave no usable wrist. Never appends geometry. */
    noteMissedFrame(timestampMs: number, sampleVisibility: number): void {
      lastSeenT = Math.max(lastSeenT, timestampMs);
      visibility = sampleVisibility;
      missedFrames += 1;
      state = msSinceReliable() > thresholds.maxGapMs ? "LOST" : "UNCERTAIN";
    },

    /**
     * Evaluate a reliable sample. `recentSpeedNorm` is normalized units per ms
     * and widens the reacquisition allowance so genuinely fast motion that
     * briefly dropped frames stays connected.
     */
    evaluate(
      observation: ContinuityObservation,
      recentSpeedNorm: number,
      depthReady: boolean,
    ): ContinuityVerdict {
      lastSeenT = Math.max(lastSeenT, observation.t);
      visibility = observation.visibility;

      if (!lastReliable) {
        strokeId += 1;
        reason = "first";
        reacquireDistancePx = 0;
        lastReliable = { ...observation };
        missedFrames = 0;
        state = "REACQUIRED";
        return { startNewStroke: true, strokeId, reason };
      }

      const gapMs = Math.max(0, observation.t - lastReliable.t);
      const missed = missedFrames;
      reacquireDistancePx = distancePx(observation);
      let broke: BreakReason = "none";

      if (gapMs > thresholds.maxGapMs) {
        broke = "gap";
      }

      // Only a reacquisition guard: never applied while tracking is continuous,
      // so legitimate fast motion with every frame observed is untouched.
      if (broke === "none" && missed > 0) {
        const speedPx = Math.max(0, recentSpeedNorm) * viewportWidth;
        const allowedPx =
          thresholds.maxReacquireDistancePx + speedPx * gapMs;
        if (reacquireDistancePx > allowedPx) {
          broke = "distance";
        }
      }

      // Supporting evidence only: needs a real gap, and tracked depth is
      // meaningless until the scene baseline is locked.
      if (
        broke === "none" &&
        depthReady &&
        missed > 0 &&
        gapMs >= thresholds.maxGapMs * 0.5
      ) {
        const depthJump = Math.abs(
          observation.trackedDepth - lastReliable.trackedDepth,
        );
        if (depthJump > thresholds.maxReacquireDepthJump) {
          broke = "depth";
        }
      }

      reason = broke;
      if (broke !== "none") {
        strokeId += 1;
        state = "REACQUIRED";
      } else {
        state =
          observation.visibility < CONTINUITY_CONFIDENT_VISIBILITY
            ? "UNCERTAIN"
            : "TRACKING";
      }

      lastReliable = { ...observation };
      missedFrames = 0;
      return { startNewStroke: broke !== "none", strokeId, reason };
    },

    reset(): void {
      lastReliable = null;
      missedFrames = 0;
      state = "LOST";
      visibility = 0;
      reacquireDistancePx = 0;
      reason = "none";
    },

    debug(): ContinuityDebug {
      return {
        strokeId,
        state,
        visibility,
        msSinceReliable: msSinceReliable(),
        reacquireDistancePx,
        missedFrames,
        reason,
      };
    },
  };
}

export function formatContinuityDebug(
  snapshot: ContinuityDebug,
  strokeCount: number,
): string {
  return (
    `Continuity: ${snapshot.state}\n` +
    `Stroke: #${snapshot.strokeId} (${strokeCount} live)\n` +
    `Wrist vis: ${snapshot.visibility.toFixed(2)}\n` +
    `Since reliable: ${snapshot.msSinceReliable.toFixed(0)} ms\n` +
    `Reacquire: ${snapshot.reacquireDistancePx.toFixed(0)} px\n` +
    `Break: ${snapshot.reason}`
  );
}
