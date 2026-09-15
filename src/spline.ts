export type Vec2 = {
  x: number;
  y: number;
  z?: number;
};

export type CubicSegment = {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
};

const EPS = 1e-6;
const DEFAULT_ALPHA = 0.5;

function zOf(point: Vec2): number {
  return point.z ?? 0;
}

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
  const m1z = (span * (zOf(p2) - zOf(p0))) / t2;
  const m2x = (span * (p3.x - p1.x)) / (t3 - t1);
  const m2y = (span * (p3.y - p1.y)) / (t3 - t1);
  const m2z = (span * (zOf(p3) - zOf(p1))) / (t3 - t1);

  return {
    p0: { x: p1.x, y: p1.y, z: zOf(p1) },
    c1: { x: p1.x + m1x / 3, y: p1.y + m1y / 3, z: zOf(p1) + m1z / 3 },
    c2: { x: p2.x - m2x / 3, y: p2.y - m2y / 3, z: zOf(p2) - m2z / 3 },
    p1: { x: p2.x, y: p2.y, z: zOf(p2) },
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
    z:
      t2 * t * zOf(segment.p0) +
      3 * t2 * u * zOf(segment.c1) +
      3 * t * u2 * zOf(segment.c2) +
      u2 * u * zOf(segment.p1),
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

export type CurveSample = {
  x: number;
  y: number;
  z: number;
  u: number;
};

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (zOf(a) + zOf(b)) * 0.5,
  };
}

function pointLineDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS * EPS) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / Math.sqrt(lenSq);
}

export function splitCubic(segment: CubicSegment): [CubicSegment, CubicSegment] {
  const p01 = midpoint(segment.p0, segment.c1);
  const p12 = midpoint(segment.c1, segment.c2);
  const p23 = midpoint(segment.c2, segment.p1);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  return [
    { p0: segment.p0, c1: p01, c2: p012, p1: p0123 },
    { p0: p0123, c1: p123, c2: p23, p1: segment.p1 },
  ];
}

export function isCubicFlat(segment: CubicSegment, tolerancePx: number): boolean {
  return (
    pointLineDistance(segment.c1, segment.p0, segment.p1) <= tolerancePx &&
    pointLineDistance(segment.c2, segment.p0, segment.p1) <= tolerancePx
  );
}

function subdivideCubic(
  segment: CubicSegment,
  u0: number,
  u1: number,
  depth: number,
  flatnessPx: number,
  maxDepth: number,
  out: CurveSample[],
): void {
  if (depth >= maxDepth || isCubicFlat(segment, flatnessPx)) {
    out.push({ x: segment.p1.x, y: segment.p1.y, z: zOf(segment.p1), u: u1 });
    return;
  }
  const [left, right] = splitCubic(segment);
  const um = (u0 + u1) * 0.5;
  subdivideCubic(left, u0, um, depth + 1, flatnessPx, maxDepth, out);
  subdivideCubic(right, um, u1, depth + 1, flatnessPx, maxDepth, out);
}

/** Adaptive cubic samples in pixel space. Optionally skip the start (shared joints). */
export function flattenCubic(
  segment: CubicSegment,
  flatnessPx: number,
  maxDepth: number,
  includeStart = true,
): CurveSample[] {
  const out: CurveSample[] = [];
  if (includeStart) {
    out.push({ x: segment.p0.x, y: segment.p0.y, z: zOf(segment.p0), u: 0 });
  }
  subdivideCubic(segment, 0, 1, 0, flatnessPx, maxDepth, out);
  return out;
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
