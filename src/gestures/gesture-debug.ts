import { GESTURE_CONFIG } from "./gesture-config.ts";
import type {
  GestureEvent,
  GestureHand,
  GestureSnapshot,
  HandGestureState,
} from "./gesture-types.ts";
import type { HandsState } from "../hand-state.ts";

const EVENT_LOG_LIMIT = GESTURE_CONFIG.EVENT_LOG_LIMIT;

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

function mark(on: boolean): string {
  return on ? "[x]" : "[ ]";
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatEventLine(event: GestureEvent, at: Date): string {
  const time = formatClock(at);
  switch (event.type) {
    case "OPEN_START":
    case "FIST_START":
    case "PINCH_START":
    case "PALM_FORWARD_START":
      return `${time} ${event.hand} ${event.type}`;
    case "OPEN_END":
    case "FIST_END":
    case "PINCH_END":
    case "PALM_FORWARD_END":
      return event.reason === "tracking_lost"
        ? `${time} ${event.hand} ${event.type} lost`
        : `${time} ${event.hand} ${event.type}`;
    case "THRUST":
      return `${time} ${event.hand} THRUST speed=${event.speed.toFixed(2)}`;
    case "HANDS_APPROACH_START":
    case "HANDS_SEPARATE_START":
      return `${time} ${event.type}`;
    case "HANDS_APPROACH_END":
    case "HANDS_SEPARATE_END":
      return event.reason === "tracking_lost"
        ? `${time} ${event.type} lost`
        : `${time} ${event.type}`;
  }
}

function formatHandBlock(
  label: GestureHand,
  state: HandGestureState | null,
  signals: GestureSnapshot["signals"]["left"],
): string {
  const pose = state ?? {
    open: false,
    fist: false,
    pinching: false,
    palmForward: false,
    thrusting: false,
  };
  return (
    `${label}\n` +
    `OPEN       ${mark(pose.open)}\n` +
    `FIST       ${mark(pose.fist)}\n` +
    `PINCH      ${mark(pose.pinching)}\n` +
    `PALM FWD   ${mark(pose.palmForward)}\n` +
    `THRUST     ${mark(pose.thrusting)}\n` +
    `openness ${fmt(signals?.openness)}  pinch ${fmt(signals?.pinchDistance)}\n` +
    `align ${fmt(signals?.palmAlignment)}  vz ${fmt(signals?.vz)}`
  );
}

export function formatGestureDebug(
  snapshot: GestureSnapshot,
  log: readonly string[],
): string {
  const two = snapshot.twoHand;
  return (
    `${formatHandBlock("LEFT", snapshot.left, snapshot.signals.left)}\n\n` +
    `${formatHandBlock("RIGHT", snapshot.right, snapshot.signals.right)}\n\n` +
    `TWO HAND\n` +
    `APPROACH   ${mark(two.approaching)}\n` +
    `SEPARATE   ${mark(two.separating)}\n` +
    `palm dist ${fmt(two.palmDistance)}  ` +
    `approach ${fmt(two.approachSpeed)}  ` +
    `separate ${fmt(two.separationSpeed)}\n\n` +
    `EVENTS\n` +
    (log.length === 0 ? "—" : log.join("\n"))
  );
}

export function createGestureEventLog(): {
  push(events: readonly GestureEvent[]): void;
  lines(): readonly string[];
} {
  const lines: string[] = [];
  return {
    push(events: readonly GestureEvent[]): void {
      if (events.length === 0) {
        return;
      }
      const at = new Date();
      for (const event of events) {
        lines.push(formatEventLine(event, at));
      }
      while (lines.length > EVENT_LOG_LIMIT) {
        lines.shift();
      }
    },
    lines(): readonly string[] {
      return lines;
    },
  };
}

function strokeFill(
  ctx: CanvasRenderingContext2D,
  text: string,
  fill: string,
): void {
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 4;
  ctx.fillStyle = fill;
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
}

function palmLabels(state: HandGestureState): string[] {
  const labels: string[] = [];
  if (state.open) {
    labels.push("OPEN");
  }
  if (state.fist) {
    labels.push("FIST");
  }
  if (state.pinching) {
    labels.push("PINCH");
  }
  if (state.palmForward) {
    labels.push("PALM");
  }
  if (state.thrusting) {
    labels.push("THRUST!");
  }
  return labels;
}

function drawPalmAnnotations(
  ctx: CanvasRenderingContext2D,
  hands: HandsState,
  snapshot: GestureSnapshot,
  width: number,
  height: number,
): void {
  const slots: Array<{
    hand: NonNullable<HandsState["left"]>;
    state: HandGestureState;
  }> = [];
  if (hands.left && snapshot.left) {
    slots.push({ hand: hands.left, state: snapshot.left });
  }
  if (hands.right && snapshot.right) {
    slots.push({ hand: hands.right, state: snapshot.right });
  }

  ctx.save();
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  for (const { hand, state } of slots) {
    const labels = palmLabels(state);
    if (labels.length === 0) {
      continue;
    }
    const x = hand.palmCenter.x * width;
    const y = hand.palmCenter.y * height;
    labels.forEach((label, index) => {
      ctx.save();
      ctx.translate(x, y - 22 - index * 18);
      ctx.scale(-1, 1);
      strokeFill(ctx, label, label === "THRUST!" ? "#ffe15c" : "#f2fcff");
      ctx.restore();
    });
  }
  ctx.restore();
}

export function drawGestureDebug(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: HandsState,
  snapshot: GestureSnapshot,
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
  drawPalmAnnotations(ctx, hands, snapshot, canvas.width, canvas.height);
}
