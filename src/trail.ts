import { catmullRomToBezierPath, type CubicSegment } from "./spline.ts";
import {
  VISUAL_TRAIL_DURATION_MS,
  type VisualSample,
} from "./visual-trajectory.ts";

const NEIGHBOR_PREV = 0.25;
const NEIGHBOR_CUR = 0.5;
const NEIGHBOR_NEXT = 0.25;

type Point = {
  x: number;
  y: number;
  z: number;
  t: number;
};

export type TimedSegment = CubicSegment & {
  t0: number;
  t1: number;
};

function toPixels(
  samples: readonly VisualSample[],
  width: number,
  height: number,
): Point[] {
  return samples.map((sample) => ({
    x: sample.x * width,
    y: sample.y * height,
    z: sample.z ?? 0,
    t: sample.t,
  }));
}

function neighborhoodSmooth(points: Point[]): Point[] {
  if (points.length < 3) {
    return points;
  }

  const smoothed: Point[] = new Array(points.length);
  smoothed[0] = points[0];
  smoothed[points.length - 1] = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    smoothed[i] = {
      x:
        points[i - 1].x * NEIGHBOR_PREV +
        points[i].x * NEIGHBOR_CUR +
        points[i + 1].x * NEIGHBOR_NEXT,
      y:
        points[i - 1].y * NEIGHBOR_PREV +
        points[i].y * NEIGHBOR_CUR +
        points[i + 1].y * NEIGHBOR_NEXT,
      z:
        points[i - 1].z * NEIGHBOR_PREV +
        points[i].z * NEIGHBOR_CUR +
        points[i + 1].z * NEIGHBOR_NEXT,
      t: points[i].t,
    };
  }

  return smoothed;
}

function buildStroke(
  stroke: VisualSample[],
  width: number,
  height: number,
): TimedSegment[] {
  if (stroke.length < 2) {
    return [];
  }

  const points = neighborhoodSmooth(toPixels(stroke, width, height));
  const cubics = catmullRomToBezierPath(points);
  const timed: TimedSegment[] = [];
  for (let i = 0; i < cubics.length; i++) {
    timed.push({
      ...cubics[i],
      t0: points[i].t,
      t1: points[i + 1].t,
    });
  }
  return timed;
}

/**
 * One cubic list per continuous stroke, oldest first. Samples are grouped by
 * `strokeId` before smoothing so no control point, tangent, or smoothing
 * window ever spans a tracking gap.
 */
export function buildTrailGeometry(
  samples: readonly VisualSample[],
  nowMs: number,
  width: number,
  height: number,
  durationMs = VISUAL_TRAIL_DURATION_MS,
): TimedSegment[][] {
  const strokes: TimedSegment[][] = [];
  let current: VisualSample[] = [];

  function flush(): void {
    const segments = buildStroke(current, width, height);
    if (segments.length > 0) {
      strokes.push(segments);
    }
    current = [];
  }

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (nowMs - sample.t > durationMs) {
      continue;
    }
    const prev = current[current.length - 1];
    if (prev && prev.strokeId !== sample.strokeId) {
      flush();
    }
    current.push(sample);
  }
  flush();

  return strokes;
}
