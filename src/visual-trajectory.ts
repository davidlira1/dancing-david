import { MIN_VISIBILITY } from "./wrist-history.ts";

export const POSITION_SMOOTHING_TAU_MS = 45;
export const VISUAL_TRAIL_DURATION_MS = 1900;
export const MAX_SPACING = 0.01;
export const MAX_INTERP = 10;
export const VISUAL_JUMP_DISTANCE = 0.1;
export const VISUAL_JUMP_SPEED_MULT = 5;
export const VISUAL_CONFIDENT_VISIBILITY = 0.8;
export const VISUAL_UNTRUSTED_TAU_MULT = 2;
export const VISUAL_UNTRUSTED_STEP_SCALE = 0.4;

export type VisualSample = {
  x: number;
  y: number;
  t: number;
  visibility?: number;
};

function prune(points: VisualSample[], timestampMs: number): void {
  const cutoff = timestampMs - VISUAL_TRAIL_DURATION_MS;
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
): { x: number; y: number } {
  const dx = raw.x - origin.x;
  const dy = raw.y - origin.y;
  const dist = Math.hypot(dx, dy);
  const speedCap = recentSpeed * Math.max(dtMs, 1) * VISUAL_JUMP_SPEED_MULT;
  const maxStep =
    Math.max(VISUAL_JUMP_DISTANCE, speedCap) *
    lerp(VISUAL_UNTRUSTED_STEP_SCALE, 1, trust);

  if (dist <= maxStep || dist === 0) {
    return raw;
  }

  const scale = maxStep / dist;
  return {
    x: origin.x + dx * scale,
    y: origin.y + dy * scale,
  };
}

export function createVisualTrajectory() {
  const points: VisualSample[] = [];
  let smoothed: { x: number; y: number; t: number } | null = null;
  let recentSpeed = 0;

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
        t: prev.t + (point.t - prev.t) * u,
      });
    }

    points.push(point);
  }

  return {
    update(point: VisualSample): void {
      prune(points, point.t);

      if (!smoothed) {
        smoothed = { x: point.x, y: point.y, t: point.t };
        recentSpeed = 0;
        pushFiltered({ x: point.x, y: point.y, t: point.t });
        return;
      }

      const dt = Math.max(0, point.t - smoothed.t);
      const trust = visibilityTrust(point.visibility);
      const clamped = clampVisualJump(
        point,
        smoothed,
        dt,
        recentSpeed,
        trust,
      );
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
        recentSpeed = Math.hypot(next.x - smoothed.x, next.y - smoothed.y) / dt;
      }

      smoothed = next;
      pushFiltered({ x: smoothed.x, y: smoothed.y, t: point.t });
    },

    prune(timestampMs: number): void {
      prune(points, timestampMs);
    },

    samples(): readonly VisualSample[] {
      return points;
    },

    clear(): void {
      points.length = 0;
      smoothed = null;
      recentSpeed = 0;
    },
  };
}
