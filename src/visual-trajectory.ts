export const POSITION_SMOOTHING_TAU_MS = 55;
export const VISUAL_TRAIL_DURATION_MS = 750;
export const MAX_SPACING = 0.01;
export const MAX_INTERP = 10;

export type VisualSample = {
  x: number;
  y: number;
  t: number;
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

export function createVisualTrajectory() {
  const points: VisualSample[] = [];
  let smoothed: { x: number; y: number; t: number } | null = null;

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
        pushFiltered({ x: point.x, y: point.y, t: point.t });
        return;
      }

      const dt = Math.max(0, point.t - smoothed.t);
      const alpha =
        dt === 0 ? 1 : 1 - Math.exp(-dt / POSITION_SMOOTHING_TAU_MS);
      smoothed = {
        x: smoothed.x + alpha * (point.x - smoothed.x),
        y: smoothed.y + alpha * (point.y - smoothed.y),
        t: point.t,
      };
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
    },
  };
}
