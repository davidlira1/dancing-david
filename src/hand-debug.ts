import { HAND_CONNECTIONS, INDEX_TIP, FINGER_NAMES } from "./hand-landmarks.ts";
import type {
  HandState,
  HandsState,
  SpatialPoint,
  Vec3,
} from "./hand-state.ts";
import type { VisionTimingSnapshot } from "./hands.ts";

const LANDMARK_RADIUS = 3;
const FINGERTIP_RADIUS = 5;
const INDEX_TIP_RADIUS = 8;
const PALM_RADIUS = 9;
const NORMAL_LENGTH_PX = 70;

const SLOT_COLOR = {
  left: "#4ad6ff",
  right: "#ffd24a",
} as const;

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

function dot(
  ctx: CanvasRenderingContext2D,
  point: SpatialPoint,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: HandState,
  width: number,
  height: number,
  showNormal: boolean,
): void {
  const color = hand.handedness === "LEFT" ? SLOT_COLOR.left : SLOT_COLOR.right;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (const connection of HAND_CONNECTIONS) {
    const from = hand.landmarks[connection.start];
    const to = hand.landmarks[connection.end];
    if (!from || !to) {
      continue;
    }
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
  }
  ctx.stroke();
  ctx.restore();

  for (const point of hand.landmarks) {
    dot(ctx, point, width, height, LANDMARK_RADIUS, "#e8e8f0");
  }
  for (const finger of FINGER_NAMES) {
    dot(ctx, hand.fingertips[finger], width, height, FINGERTIP_RADIUS, color);
  }

  // The index tip is emphasized: proving it moves independently of the wrist
  // is the first validation that hands give us more than pose did.
  const indexTip = hand.landmarks[INDEX_TIP];
  if (indexTip) {
    ctx.save();
    ctx.strokeStyle = "#ff5ce0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      indexTip.x * width,
      indexTip.y * height,
      INDEX_TIP_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }

  const palmX = hand.palmCenter.x * width;
  const palmY = hand.palmCenter.y * height;
  ctx.save();
  ctx.beginPath();
  ctx.arc(palmX, palmY, PALM_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();

  if (showNormal && hand.palmNormal) {
    ctx.save();
    ctx.strokeStyle = "#7dff9b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(palmX, palmY);
    ctx.lineTo(
      palmX + hand.palmNormal.x * NORMAL_LENGTH_PX,
      palmY + hand.palmNormal.y * NORMAL_LENGTH_PX,
    );
    ctx.stroke();
    ctx.restore();
  }

  // Drawn mirrored like everything else on the stage, so flip the glyph back
  // to keep the letter readable.
  ctx.save();
  ctx.translate(palmX, palmY - PALM_RADIUS - 8);
  ctx.scale(-1, 1);
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 4;
  const label = hand.handedness === "LEFT" ? "L" : "R";
  ctx.strokeText(label, 0, 0);
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/**
 * Drawn mirrored like the rest of the stage, so text is flipped back in place.
 */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): void {
  ctx.save();
  ctx.translate(width - 16, 28);
  ctx.scale(-1, 1);
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillStyle = "#ff8a5c";
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function drawHandDebug(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: HandsState,
  options: {
    showNormal: boolean;
    clear: boolean;
    note?: string | null;
    /** Appended when no hand is held, to separate "none" from "not running". */
    diagnostic?: string | null;
  },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  if (options.clear) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  for (const hand of [hands.left, hands.right]) {
    if (hand) {
      drawHand(ctx, hand, canvas.width, canvas.height, options.showNormal);
    }
  }

  // With no hands in frame the overlay is empty, which is indistinguishable
  // from a dead toggle. Say which one it is.
  if (options.note) {
    drawBadge(ctx, options.note, canvas.width);
  } else if (!hands.left && !hands.right) {
    drawBadge(
      ctx,
      `HANDS: none (${hands.status.left.state}/${hands.status.right.state})` +
        (options.diagnostic ? ` · ${options.diagnostic}` : ""),
      canvas.width,
    );
  }
}

function formatVec3(vector: Vec3, digits: number): string {
  return (
    `${vector.x.toFixed(digits)} / ` +
    `${vector.y.toFixed(digits)} / ` +
    `${vector.z.toFixed(digits)}`
  );
}

function formatHand(label: string, hand: HandState | null, status: {
  state: string;
  msSinceSeen: number;
  rawHandedness: string;
}): string {
  if (!hand) {
    return (
      `${label}: ${status.state}\n` +
      `  seen: ${status.msSinceSeen.toFixed(0)} ms ago`
    );
  }
  return (
    `${label}: ${hand.state} (${hand.confidence.toFixed(2)})\n` +
    `  palm: ${hand.palmCenter.x.toFixed(3)}, ${hand.palmCenter.y.toFixed(3)}\n` +
    `  rawZ: ${hand.palmCenter.rawZ.toFixed(3)}  ` +
    `depth: ${hand.palmCenter.trackedDepth.toFixed(3)} (${hand.depthSource})\n` +
    `  vel/s: ${formatVec3(hand.velocity, 2)}\n` +
    `  open: ${hand.openness.toFixed(2)}  pinch: ${hand.pinchDistance.toFixed(2)}\n` +
    (hand.palmNormal
      ? `  normal: ${formatVec3(hand.palmNormal, 2)}\n`
      : "  normal: —\n") +
    `  mp label: ${hand.rawHandedness}`
  );
}

export function formatHandsDebug(
  hands: HandsState,
  timing: VisionTimingSnapshot,
  diagnostic?: string | null,
): string {
  return (
    `Hands: ${timing.inferenceMs.toFixed(1)} ms  ${timing.fps.toFixed(0)} fps\n` +
    (diagnostic ? `${diagnostic}\n` : "") +
    `Palm distance: ${
      hands.palmDistance === null ? "—" : hands.palmDistance.toFixed(2)
    }\n` +
    formatHand("L", hands.left, hands.status.left) +
    "\n" +
    formatHand("R", hands.right, hands.status.right)
  );
}
