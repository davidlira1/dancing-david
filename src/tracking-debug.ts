export type MarkerPoint = {
  x: number;
  y: number;
};

export type TrackingDebugSnapshot = {
  raw: MarkerPoint | null;
  filtered: MarkerPoint | null;
  head: MarkerPoint | null;
  visibility: number;
  visionFps: number;
  renderFps: number;
  ribbonVertices: number;
  bloomWidth: number;
  bloomHeight: number;
  width: number;
  height: number;
  jumpClamped: boolean;
  jumpRequested: number;
  jumpAllowed: number;
};

const MARKER_RADIUS = 6;

function sizeToVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  point: MarkerPoint,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, MARKER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function toPixels(
  point: MarkerPoint,
  width: number,
  height: number,
  normalized: boolean,
): MarkerPoint {
  if (!normalized) {
    return point;
  }
  return { x: point.x * width, y: point.y * height };
}

function pixelDistance(
  a: MarkerPoint | null,
  b: MarkerPoint | null,
  aNormalized: boolean,
  bNormalized: boolean,
  width: number,
  height: number,
): number | null {
  if (!a || !b) {
    return null;
  }
  const pa = toPixels(a, width, height, aNormalized);
  const pb = toPixels(b, width, height, bNormalized);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

export function formatTrackingDebug(snapshot: TrackingDebugSnapshot): string {
  const rawToFiltered = pixelDistance(
    snapshot.raw,
    snapshot.filtered,
    true,
    true,
    snapshot.width,
    snapshot.height,
  );
  const filteredToHead = pixelDistance(
    snapshot.filtered,
    snapshot.head,
    true,
    false,
    snapshot.width,
    snapshot.height,
  );
  const jumpPx = snapshot.jumpRequested * snapshot.width;
  const allowedPx = snapshot.jumpAllowed * snapshot.width;
  return (
    `Render FPS: ${snapshot.renderFps.toFixed(0)}\n` +
    `Vision FPS: ${snapshot.visionFps.toFixed(0)}\n` +
    `Ribbon vertices: ${snapshot.ribbonVertices}\n` +
    `Bloom: ${snapshot.bloomWidth} × ${snapshot.bloomHeight}\n` +
    `Visibility: ${snapshot.visibility.toFixed(2)}\n` +
    `Raw → Filtered: ${rawToFiltered === null ? "—" : `${rawToFiltered.toFixed(0)} px`}\n` +
    `Filtered → Ribbon: ${filteredToHead === null ? "—" : `${filteredToHead.toFixed(0)} px`}\n` +
    `Jump: ${jumpPx.toFixed(0)}px\n` +
    `Allowed: ${allowedPx.toFixed(0)}px\n` +
    (snapshot.jumpClamped ? "CLAMPED" : "Jump clamp: NO")
  );
}

export function drawTrackingDebug(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  snapshot: TrackingDebugSnapshot,
  clear: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  if (clear) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const width = canvas.width;
  const height = canvas.height;
  if (snapshot.raw) {
    drawMarker(ctx, toPixels(snapshot.raw, width, height, true), "#ff3b3b");
  }
  if (snapshot.filtered) {
    drawMarker(
      ctx,
      toPixels(snapshot.filtered, width, height, true),
      "#ffe14a",
    );
  }
  if (snapshot.head) {
    drawMarker(ctx, snapshot.head, "#3dff6b");
  }
}
