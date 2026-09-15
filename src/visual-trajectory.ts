import { createDepthTracker, type DepthSnapshot } from "./depth.ts";
import { MIN_VISIBILITY } from "./wrist-history.ts";

export const POSITION_SMOOTHING_TAU_MS = 25;
export const VISUAL_TRAIL_DURATION_MS = 1900;
export const MAX_SPACING = 0.01;
export const MAX_INTERP = 10;
export const VISUAL_JUMP_DISTANCE = 0.1;
export const VISUAL_JUMP_SPEED_MULT = 5;
export const VISUAL_CONFIDENT_VISIBILITY = 0.65;
export const VISUAL_UNTRUSTED_TAU_MULT = 1.25;
export const VISUAL_UNTRUSTED_STEP_SCALE = 0.75;

export type VisualSample = {
  x: number;
  y: number;
  z?: number;
  t: number;
  visibility?: number;
};

export type JumpDebug = {
  clamped: boolean;
  requested: number;
  allowed: number;
};

function prune(
  points: VisualSample[],
  timestampMs: number,
  durationMs: number,
): void {
  const cutoff = timestampMs - durationMs;
  while (points.length > 0 && points[0].t < cutoff) {
    points.shift();
  }
}

function distance(a: VisualSample, b: VisualSample): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function visibilityTrust(visibility: number | undefined): number {
  const value = visibility ?? VISUAL_CONFIDENT_VISIBILITY;
  const span = VISUAL_CONFIDENT_VISIBILITY - MIN_VISIBILITY;
  if (span <= 0) {
    return 1;
  }
  return clamp01((value - MIN_VISIBILITY) / span);
}

export function clampVisualJump(
  raw: { x: number; y: number },
  origin: { x: number; y: number },
  dtMs: number,
  recentSpeed: number,
  trust: number,
): { x: number; y: number; requested: number; allowed: number; clamped: boolean } {
  const dx = raw.x - origin.x;
  const dy = raw.y - origin.y;
  const requested = Math.hypot(dx, dy);
  const speedCap = recentSpeed * Math.max(dtMs, 1) * VISUAL_JUMP_SPEED_MULT;
  const allowed =
    Math.max(VISUAL_JUMP_DISTANCE, speedCap) *
    lerp(VISUAL_UNTRUSTED_STEP_SCALE, 1, trust);

  if (requested <= allowed || requested === 0) {
    return { x: raw.x, y: raw.y, requested, allowed, clamped: false };
  }

  const scale = allowed / requested;
  return {
    x: origin.x + dx * scale,
    y: origin.y + dy * scale,
    requested,
    allowed,
    clamped: true,
  };
}

export function createVisualTrajectory() {
  const points: VisualSample[] = [];
  const depth = createDepthTracker();
  let smoothed: { x: number; y: number; t: number } | null = null;
  let recentRawSpeed = 0;
  let durationMs = VISUAL_TRAIL_DURATION_MS;
  let jumpDebug: JumpDebug = { clamped: false, requested: 0, allowed: 0 };

  function pushFiltered(point: VisualSample): void {
    if (points.length === 0) {
      points.push(point);
      return;
    }

    const prev = points[points.length - 1];
    const gap = distance(prev, point);
    const steps = Math.min(MAX_INTERP, Math.floor(gap / MAX_SPACING));

    for (let i = 1; i <= steps; i++) {
      const u = i / (steps + 1);
      points.push({
        x: prev.x + (point.x - prev.x) * u,
        y: prev.y + (point.y - prev.y) * u,
        z: (prev.z ?? 0) + ((point.z ?? 0) - (prev.z ?? 0)) * u,
        t: prev.t + (point.t - prev.t) * u,
      });
    }

    points.push(point);
  }

  return {
    update(point: VisualSample): void {
      prune(points, point.t, durationMs);
      const depthSnap = depth.update(
        point.z ?? 0,
        point.t,
        point.visibility ?? 0,
      );

      if (!smoothed) {
        smoothed = { x: point.x, y: point.y, t: point.t };
        recentRawSpeed = 0;
        jumpDebug = { clamped: false, requested: 0, allowed: VISUAL_JUMP_DISTANCE };
        pushFiltered({
          x: point.x,
          y: point.y,
          z: depthSnap.trackedDepth,
          t: point.t,
          visibility: point.visibility,
        });
        return;
      }

      const dt = Math.max(0, point.t - smoothed.t);
      const trust = visibilityTrust(point.visibility);
      const clamped = clampVisualJump(
        point,
        smoothed,
        dt,
        recentRawSpeed,
        trust,
      );
      jumpDebug = {
        clamped: clamped.clamped,
        requested: clamped.requested,
        allowed: clamped.allowed,
      };
      const tau =
        POSITION_SMOOTHING_TAU_MS *
        lerp(VISUAL_UNTRUSTED_TAU_MULT, 1, trust);
      const alpha = dt === 0 ? 1 : 1 - Math.exp(-dt / tau);
      const next = {
        x: smoothed.x + alpha * (clamped.x - smoothed.x),
        y: smoothed.y + alpha * (clamped.y - smoothed.y),
        t: point.t,
      };

      if (dt > 0) {
        recentRawSpeed = clamped.requested / dt;
      }

      smoothed = next;
      pushFiltered({
        x: smoothed.x,
        y: smoothed.y,
        z: depthSnap.trackedDepth,
        t: point.t,
        visibility: point.visibility,
      });
    },

    prune(timestampMs: number): void {
      prune(points, timestampMs, durationMs);
    },

    setDurationMs(ms: number): void {
      durationMs = Math.max(1, ms);
    },

    setInvertZ(value: boolean): void {
      if (!depth.setInvertZ(value)) {
        return;
      }
      for (let i = 0; i < points.length; i++) {
        points[i].z = -(points[i].z ?? 0);
      }
    },

    recalibrateDepth(): void {
      depth.recalibrate();
      for (let i = 0; i < points.length; i++) {
        points[i].z = 0;
      }
    },

    depthSnapshot(): DepthSnapshot {
      return depth.snapshot();
    },

    samples(): readonly VisualSample[] {
      return points;
    },

    jumpDebug(): JumpDebug {
      return jumpDebug;
    },

    clear(): void {
      points.length = 0;
      smoothed = null;
      recentRawSpeed = 0;
      jumpDebug = { clamped: false, requested: 0, allowed: 0 };
      depth.recalibrate();
    },
  };
}
