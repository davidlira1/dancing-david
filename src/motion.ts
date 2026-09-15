import type { WristSample } from "./wrist-history.ts";

export const VELOCITY_WINDOW_MS = 100;
export const MIN_DT_MS = 40;
export const SWIPE_SPEED = 1.2;
export const MIN_DISPLACEMENT = 0.12;
export const SWIPE_COOLDOWN_MS = 450;
export const IDLE_SPEED = 0.25;

export type SwipeDirection = "LEFT" | "RIGHT" | "UP" | "DOWN";
export type MotionDirection = SwipeDirection | "NONE";

export type WristSwipeEvent = {
  type: "WRIST_SWIPE";
  direction: SwipeDirection;
  speed: number;
  velocity: { x: number; y: number };
  timestamp: number;
};

export type MotionSnapshot = {
  speed: number;
  velocity: { x: number; y: number };
  direction: MotionDirection;
  event: WristSwipeEvent | null;
};

const ZERO: MotionSnapshot = {
  speed: 0,
  velocity: { x: 0, y: 0 },
  direction: "NONE",
  event: null,
};

function dominantDirection(vx: number, vy: number): SwipeDirection {
  if (Math.abs(vx) >= Math.abs(vy)) {
    return vx >= 0 ? "RIGHT" : "LEFT";
  }
  return vy >= 0 ? "DOWN" : "UP";
}

export function createMotionAnalyzer() {
  let lastSwipeAt = -Infinity;

  return {
    analyze(
      samples: readonly WristSample[],
      nowMs: number,
    ): MotionSnapshot {
      if (samples.length < 2) {
        return ZERO;
      }

      const newest = samples[samples.length - 1];
      const cutoff = nowMs - VELOCITY_WINDOW_MS;
      const inWindow = samples.find((sample) => sample.t >= cutoff);
      const oldest = inWindow ?? samples[0];
      const dtMs = newest.t - oldest.t;

      if (dtMs < MIN_DT_MS) {
        return ZERO;
      }

      const dtSec = dtMs / 1000;
      const dx = newest.x - oldest.x;
      const dy = newest.y - oldest.y;
      const vx = -dx / dtSec;
      const vy = dy / dtSec;
      const speed = Math.hypot(vx, vy);
      const displacement = Math.hypot(dx, dy);
      const direction: MotionDirection =
        speed < IDLE_SPEED ? "NONE" : dominantDirection(vx, vy);

      let event: WristSwipeEvent | null = null;
      if (
        direction !== "NONE" &&
        speed >= SWIPE_SPEED &&
        displacement >= MIN_DISPLACEMENT &&
        nowMs - lastSwipeAt >= SWIPE_COOLDOWN_MS
      ) {
        lastSwipeAt = nowMs;
        event = {
          type: "WRIST_SWIPE",
          direction,
          speed,
          velocity: { x: vx, y: vy },
          timestamp: nowMs,
        };
      }

      return {
        speed,
        velocity: { x: vx, y: vy },
        direction,
        event,
      };
    },
  };
}
