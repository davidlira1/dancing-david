export type Vec2 = {
  x: number;
  y: number;
};

export type CubicSegment = {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
};

const EPS = 1e-6;
const DEFAULT_ALPHA = 0.5;

function chord(a: Vec2, b: Vec2, alpha: number): number {
  return Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha);
}

function catmullRomSegment(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  alpha: number,
): CubicSegment {
  const t01 = Math.max(chord(p0, p1, alpha), EPS);
  const t12 = Math.max(chord(p1, p2, alpha), EPS);
  const t23 = Math.max(chord(p2, p3, alpha), EPS);
  const t1 = t01;
  const t2 = t01 + t12;
  const t3 = t01 + t12 + t23;
  const span = t2 - t1;

  const m1x = (span * (p2.x - p0.x)) / t2;
  const m1y = (span * (p2.y - p0.y)) / t2;
  const m2x = (span * (p3.x - p1.x)) / (t3 - t1);
  const m2y = (span * (p3.y - p1.y)) / (t3 - t1);

  return {
    p0: { x: p1.x, y: p1.y },
    c1: { x: p1.x + m1x / 3, y: p1.y + m1y / 3 },
    c2: { x: p2.x - m2x / 3, y: p2.y - m2y / 3 },
    p1: { x: p2.x, y: p2.y },
  };
}

export function evalCubic(segment: CubicSegment, u: number): Vec2 {
  const t = 1 - u;
  const t2 = t * t;
  const u2 = u * u;
  return {
    x:
      t2 * t * segment.p0.x +
      3 * t2 * u * segment.c1.x +
      3 * t * u2 * segment.c2.x +
      u2 * u * segment.p1.x,
    y:
      t2 * t * segment.p0.y +
      3 * t2 * u * segment.c1.y +
      3 * t * u2 * segment.c2.y +
      u2 * u * segment.p1.y,
  };
}

export function evalCubicDerivative(segment: CubicSegment, u: number): Vec2 {
  const t = 1 - u;
  return {
    x:
      3 * t * t * (segment.c1.x - segment.p0.x) +
      6 * t * u * (segment.c2.x - segment.c1.x) +
      3 * u * u * (segment.p1.x - segment.c2.x),
    y:
      3 * t * t * (segment.c1.y - segment.p0.y) +
      6 * t * u * (segment.c2.y - segment.c1.y) +
      3 * u * u * (segment.p1.y - segment.c2.y),
  };
}

export function catmullRomToBezierPath(
  points: readonly Vec2[],
  alpha = DEFAULT_ALPHA,
): CubicSegment[] {
  if (points.length < 2) {
    return [];
  }

  const segments: CubicSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    segments.push(catmullRomSegment(p0, p1, p2, p3, alpha));
  }
  return segments;
}
