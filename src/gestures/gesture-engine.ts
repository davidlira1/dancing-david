import { GESTURE_CONFIG } from "./gesture-config.ts";
import type {
  FistEndEvent,
  FistStartEvent,
  GestureEvent,
  GestureHand,
  GestureSnapshot,
  GestureUpdate,
  HandGestureState,
  HandsApproachEndEvent,
  HandsApproachStartEvent,
  HandsSeparateEndEvent,
  HandsSeparateStartEvent,
  OpenEndEvent,
  OpenStartEvent,
  PalmForwardEndEvent,
  PalmForwardStartEvent,
  PalmPosition,
  PinchEndEvent,
  PinchStartEvent,
  ThrustEvent,
  TwoHandGestureState,
} from "./gesture-types.ts";
import type { HandState, HandsState } from "../hand-state.ts";

type LatchKind = "high" | "low";

type Latch = {
  active: boolean;
  enterSince: number;
  exitSince: number;
};

type ThrustPhase = "IDLE" | "CANDIDATE" | "COOLDOWN";

type HandRuntime = {
  present: boolean;
  reacquiredAt: number;
  lastPalm: PalmPosition | null;
  lastOpenness: number;
  lastPinch: number;
  lastAlignment: number | null;
  lastVelocity: { x: number; y: number; z: number };
  lastTrackedDepth: number;
  open: Latch;
  fist: Latch;
  pinch: Latch;
  palmForward: Latch;
  thrustPhase: ThrustPhase;
  thrustOriginDepth: number;
  thrustOriginAt: number;
  thrustCooldownUntil: number;
  thrustFlashUntil: number;
};

type TwoHandRuntime = {
  approaching: Latch;
  separating: Latch;
  lastDistance: number | null;
  lastSampleAt: number;
  filteredVelocity: number;
  hadBoth: boolean;
};

const cfg = GESTURE_CONFIG;

const IDLE_TWO_HAND: TwoHandGestureState = {
  approaching: false,
  separating: false,
  palmDistance: null,
  approachSpeed: 0,
  separationSpeed: 0,
};

function createLatch(): Latch {
  return { active: false, enterSince: -1, exitSince: -1 };
}

function resetLatch(latch: Latch): void {
  latch.active = false;
  latch.enterSince = -1;
  latch.exitSince = -1;
}

function createHandRuntime(): HandRuntime {
  return {
    present: false,
    reacquiredAt: -Infinity,
    lastPalm: null,
    lastOpenness: 0,
    lastPinch: 0,
    lastAlignment: null,
    lastVelocity: { x: 0, y: 0, z: 0 },
    lastTrackedDepth: 0,
    open: createLatch(),
    fist: createLatch(),
    pinch: createLatch(),
    palmForward: createLatch(),
    thrustPhase: "IDLE",
    thrustOriginDepth: 0,
    thrustOriginAt: 0,
    thrustCooldownUntil: 0,
    thrustFlashUntil: 0,
  };
}

function palmOf(hand: HandState): PalmPosition {
  return {
    x: hand.palmCenter.x,
    y: hand.palmCenter.y,
    trackedDepth: hand.palmCenter.trackedDepth,
  };
}

function palmAlignment(hand: HandState): number | null {
  if (!hand.palmNormal) {
    return null;
  }
  const sign =
    hand.handedness === "LEFT"
      ? cfg.PALM_FORWARD_SIGN_LEFT
      : cfg.PALM_FORWARD_SIGN_RIGHT;
  return sign * hand.palmNormal.z;
}

function rememberHand(runtime: HandRuntime, hand: HandState): void {
  runtime.lastPalm = palmOf(hand);
  runtime.lastOpenness = hand.openness;
  runtime.lastPinch = hand.pinchDistance;
  runtime.lastAlignment = palmAlignment(hand);
  runtime.lastVelocity = { ...hand.velocity };
  runtime.lastTrackedDepth = hand.palmCenter.trackedDepth;
}

function fallbackPalm(runtime: HandRuntime): PalmPosition {
  return runtime.lastPalm ?? { x: 0, y: 0, trackedDepth: 0 };
}

function updateLatch(
  latch: Latch,
  value: number | null,
  kind: LatchKind,
  enter: number,
  exit: number,
  now: number,
  dwellMs: number,
  graceMs: number,
): "start" | "end" | "none" {
  if (value === null) {
    return "none";
  }
  const satisfiesEnter = kind === "high" ? value > enter : value < enter;
  const satisfiesExit = kind === "high" ? value < exit : value > exit;

  if (!latch.active) {
    latch.exitSince = -1;
    if (satisfiesEnter) {
      if (latch.enterSince < 0) {
        latch.enterSince = now;
      }
      if (now - latch.enterSince >= dwellMs) {
        latch.active = true;
        latch.enterSince = -1;
        return "start";
      }
    } else {
      latch.enterSince = -1;
    }
    return "none";
  }

  latch.enterSince = -1;
  if (satisfiesExit) {
    if (latch.exitSince < 0) {
      latch.exitSince = now;
    }
    if (now - latch.exitSince >= graceMs) {
      latch.active = false;
      latch.exitSince = -1;
      return "end";
    }
  } else {
    latch.exitSince = -1;
  }
  return "none";
}

function imageSpeed(hand: HandState): number {
  return Math.hypot(hand.velocity.x, hand.velocity.y);
}

function inReacquireGrace(runtime: HandRuntime, now: number): boolean {
  return now - runtime.reacquiredAt < cfg.REACQUIRE_GRACE_MS;
}

export function createGestureEngine() {
  const left = createHandRuntime();
  const right = createHandRuntime();
  const twoHand: TwoHandRuntime = {
    approaching: createLatch(),
    separating: createLatch(),
    lastDistance: null,
    lastSampleAt: -1,
    filteredVelocity: 0,
    hadBoth: false,
  };

  function resetThrust(runtime: HandRuntime): void {
    runtime.thrustPhase = "IDLE";
    runtime.thrustOriginDepth = 0;
    runtime.thrustOriginAt = 0;
    runtime.thrustCooldownUntil = 0;
    runtime.thrustFlashUntil = 0;
  }

  function emitLostHand(
    runtime: HandRuntime,
    hand: GestureHand,
    now: number,
    events: GestureEvent[],
  ): void {
    const palm = fallbackPalm(runtime);
    if (runtime.open.active) {
      events.push({
        type: "OPEN_END",
        hand,
        timestamp: now,
        palmPosition: palm,
        openness: runtime.lastOpenness,
        reason: "tracking_lost",
      } satisfies OpenEndEvent);
    }
    if (runtime.fist.active) {
      events.push({
        type: "FIST_END",
        hand,
        timestamp: now,
        palmPosition: palm,
        openness: runtime.lastOpenness,
        reason: "tracking_lost",
      } satisfies FistEndEvent);
    }
    if (runtime.pinch.active) {
      events.push({
        type: "PINCH_END",
        hand,
        timestamp: now,
        palmPosition: palm,
        pinchDistance: runtime.lastPinch,
        reason: "tracking_lost",
      } satisfies PinchEndEvent);
    }
    if (runtime.palmForward.active) {
      events.push({
        type: "PALM_FORWARD_END",
        hand,
        timestamp: now,
        palmPosition: palm,
        alignment: runtime.lastAlignment,
        reason: "tracking_lost",
      } satisfies PalmForwardEndEvent);
    }
    resetLatch(runtime.open);
    resetLatch(runtime.fist);
    resetLatch(runtime.pinch);
    resetLatch(runtime.palmForward);
    resetThrust(runtime);
    runtime.present = false;
  }

  function updateStatic(
    runtime: HandRuntime,
    hand: HandState,
    now: number,
    events: GestureEvent[],
  ): void {
    const slot = hand.handedness;
    const palm = palmOf(hand);
    const alignment = palmAlignment(hand);

    const openChange = updateLatch(
      runtime.open,
      hand.openness,
      "high",
      cfg.OPEN_ENTER,
      cfg.OPEN_EXIT,
      now,
      cfg.STATIC_ENTER_DWELL_MS,
      cfg.STATIC_EXIT_GRACE_MS,
    );
    if (openChange === "start") {
      events.push({
        type: "OPEN_START",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        openness: hand.openness,
      } satisfies OpenStartEvent);
    } else if (openChange === "end") {
      events.push({
        type: "OPEN_END",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        openness: hand.openness,
        reason: "released",
      } satisfies OpenEndEvent);
    }

    const fistChange = updateLatch(
      runtime.fist,
      hand.openness,
      "low",
      cfg.FIST_ENTER,
      cfg.FIST_EXIT,
      now,
      cfg.STATIC_ENTER_DWELL_MS,
      cfg.STATIC_EXIT_GRACE_MS,
    );
    if (fistChange === "start") {
      events.push({
        type: "FIST_START",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        openness: hand.openness,
      } satisfies FistStartEvent);
    } else if (fistChange === "end") {
      events.push({
        type: "FIST_END",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        openness: hand.openness,
        reason: "released",
      } satisfies FistEndEvent);
    }

    const pinchChange = updateLatch(
      runtime.pinch,
      hand.pinchDistance,
      "low",
      cfg.PINCH_ENTER,
      cfg.PINCH_EXIT,
      now,
      cfg.STATIC_ENTER_DWELL_MS,
      cfg.STATIC_EXIT_GRACE_MS,
    );
    if (pinchChange === "start") {
      events.push({
        type: "PINCH_START",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        pinchDistance: hand.pinchDistance,
      } satisfies PinchStartEvent);
    } else if (pinchChange === "end") {
      events.push({
        type: "PINCH_END",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        pinchDistance: hand.pinchDistance,
        reason: "released",
      } satisfies PinchEndEvent);
    }

    if (alignment === null && runtime.palmForward.active) {
      runtime.palmForward.active = false;
      runtime.palmForward.enterSince = -1;
      runtime.palmForward.exitSince = -1;
      events.push({
        type: "PALM_FORWARD_END",
        hand: slot,
        timestamp: now,
        palmPosition: palm,
        alignment: null,
        reason: "released",
      } satisfies PalmForwardEndEvent);
    } else {
      const palmChange = updateLatch(
        runtime.palmForward,
        alignment,
        "high",
        cfg.PALM_FORWARD_ENTER,
        cfg.PALM_FORWARD_EXIT,
        now,
        cfg.STATIC_ENTER_DWELL_MS,
        cfg.STATIC_EXIT_GRACE_MS,
      );
      if (palmChange === "start") {
        events.push({
          type: "PALM_FORWARD_START",
          hand: slot,
          timestamp: now,
          palmPosition: palm,
          alignment: alignment ?? 0,
        } satisfies PalmForwardStartEvent);
      } else if (palmChange === "end") {
        events.push({
          type: "PALM_FORWARD_END",
          hand: slot,
          timestamp: now,
          palmPosition: palm,
          alignment,
          reason: "released",
        } satisfies PalmForwardEndEvent);
      }
    }
  }

  function updateThrust(
    runtime: HandRuntime,
    hand: HandState,
    now: number,
    events: GestureEvent[],
  ): void {
    if (runtime.thrustPhase === "COOLDOWN") {
      if (now >= runtime.thrustCooldownUntil) {
        runtime.thrustPhase = "IDLE";
      }
      return;
    }

    if (inReacquireGrace(runtime, now) || !hand.depthValid) {
      if (runtime.thrustPhase === "CANDIDATE") {
        runtime.thrustPhase = "IDLE";
      }
      return;
    }

    const vz = hand.velocity.z;
    const plane = imageSpeed(hand);
    const forward =
      vz > cfg.THRUST_VELOCITY_THRESHOLD &&
      plane <= cfg.THRUST_MAX_IMAGE_SPEED;

    if (runtime.thrustPhase === "IDLE") {
      if (forward) {
        runtime.thrustPhase = "CANDIDATE";
        runtime.thrustOriginDepth = hand.palmCenter.trackedDepth;
        runtime.thrustOriginAt = now;
      }
      return;
    }

    if (!forward || now - runtime.thrustOriginAt > cfg.THRUST_WINDOW_MS) {
      runtime.thrustPhase = "IDLE";
      return;
    }

    const displacement =
      hand.palmCenter.trackedDepth - runtime.thrustOriginDepth;
    if (displacement < cfg.THRUST_MIN_DISPLACEMENT) {
      return;
    }

    events.push({
      type: "THRUST",
      hand: hand.handedness,
      timestamp: now,
      palmPosition: palmOf(hand),
      velocity: { ...hand.velocity },
      speed: Math.abs(vz),
      trackedDepth: hand.palmCenter.trackedDepth,
    } satisfies ThrustEvent);
    runtime.thrustPhase = "COOLDOWN";
    runtime.thrustCooldownUntil = now + cfg.THRUST_COOLDOWN_MS;
    runtime.thrustFlashUntil = now + cfg.THRUST_FLASH_MS;
  }

  function updateSlot(
    runtime: HandRuntime,
    hand: HandState | null,
    slot: GestureHand,
    now: number,
    events: GestureEvent[],
  ): HandGestureState | null {
    if (!hand) {
      if (runtime.present) {
        emitLostHand(runtime, slot, now, events);
      }
      return null;
    }

    if (!runtime.present) {
      runtime.present = true;
      runtime.reacquiredAt = now;
      resetThrust(runtime);
    }

    rememberHand(runtime, hand);
    updateStatic(runtime, hand, now, events);
    updateThrust(runtime, hand, now, events);

    return {
      open: runtime.open.active,
      fist: runtime.fist.active,
      pinching: runtime.pinch.active,
      palmForward: runtime.palmForward.active,
      thrusting:
        runtime.thrustPhase === "CANDIDATE" || now < runtime.thrustFlashUntil,
    };
  }

  function resetTwoHandHistory(): void {
    twoHand.lastDistance = null;
    twoHand.lastSampleAt = -1;
    twoHand.filteredVelocity = 0;
    twoHand.hadBoth = false;
  }

  function endTwoHand(
    now: number,
    palmDistance: number | null,
    approachSpeed: number,
    separationSpeed: number,
    reason: "released" | "tracking_lost",
    events: GestureEvent[],
  ): void {
    if (twoHand.approaching.active) {
      events.push({
        type: "HANDS_APPROACH_END",
        timestamp: now,
        palmDistance,
        approachSpeed,
        reason,
      } satisfies HandsApproachEndEvent);
    }
    if (twoHand.separating.active) {
      events.push({
        type: "HANDS_SEPARATE_END",
        timestamp: now,
        palmDistance,
        separationSpeed,
        reason,
      } satisfies HandsSeparateEndEvent);
    }
    resetLatch(twoHand.approaching);
    resetLatch(twoHand.separating);
  }

  function updateTwoHand(
    hands: HandsState,
    now: number,
    events: GestureEvent[],
  ): TwoHandGestureState {
    const leftHand = hands.left;
    const rightHand = hands.right;
    if (!leftHand || !rightHand) {
      const reason = twoHand.hadBoth ? "tracking_lost" : "released";
      endTwoHand(now, null, 0, 0, reason, events);
      resetTwoHandHistory();
      return { ...IDLE_TWO_HAND };
    }

    const distance = hands.palmDistance;
    if (distance === null) {
      endTwoHand(now, null, 0, 0, "released", events);
      resetTwoHandHistory();
      return { ...IDLE_TWO_HAND };
    }

    const sampleAt = Math.max(leftHand.timestamp, rightHand.timestamp);
    if (twoHand.lastDistance === null || twoHand.lastSampleAt < 0) {
      twoHand.lastDistance = distance;
      twoHand.lastSampleAt = sampleAt;
      twoHand.filteredVelocity = 0;
      twoHand.hadBoth = true;
    } else if (sampleAt !== twoHand.lastSampleAt) {
      const dtMs = sampleAt - twoHand.lastSampleAt;
      if (dtMs >= cfg.PALM_DISTANCE_MAX_DT_MS) {
        twoHand.filteredVelocity = 0;
      } else if (dtMs >= cfg.PALM_DISTANCE_MIN_DT_MS) {
        const raw = ((distance - twoHand.lastDistance) * 1000) / dtMs;
        twoHand.filteredVelocity +=
          (raw - twoHand.filteredVelocity) * cfg.PALM_DISTANCE_VELOCITY_EMA;
      }
      twoHand.lastDistance = distance;
      twoHand.lastSampleAt = sampleAt;
      twoHand.hadBoth = true;
    }

    const approachSpeed = Math.max(0, -twoHand.filteredVelocity);
    const separationSpeed = Math.max(0, twoHand.filteredVelocity);

    const approachChange = updateLatch(
      twoHand.approaching,
      approachSpeed,
      "high",
      cfg.APPROACH_SPEED_ENTER,
      cfg.APPROACH_SPEED_EXIT,
      now,
      cfg.TWO_HAND_ENTER_DWELL_MS,
      cfg.TWO_HAND_EXIT_GRACE_MS,
    );
    if (approachChange === "start") {
      if (twoHand.separating.active) {
        twoHand.separating.active = false;
        twoHand.separating.enterSince = -1;
        twoHand.separating.exitSince = -1;
        events.push({
          type: "HANDS_SEPARATE_END",
          timestamp: now,
          palmDistance: distance,
          separationSpeed,
          reason: "released",
        } satisfies HandsSeparateEndEvent);
      }
      events.push({
        type: "HANDS_APPROACH_START",
        timestamp: now,
        palmDistance: distance,
        approachSpeed,
      } satisfies HandsApproachStartEvent);
    } else if (approachChange === "end") {
      events.push({
        type: "HANDS_APPROACH_END",
        timestamp: now,
        palmDistance: distance,
        approachSpeed,
        reason: "released",
      } satisfies HandsApproachEndEvent);
    }

    if (!twoHand.approaching.active) {
      const separateChange = updateLatch(
        twoHand.separating,
        separationSpeed,
        "high",
        cfg.SEPARATE_SPEED_ENTER,
        cfg.SEPARATE_SPEED_EXIT,
        now,
        cfg.TWO_HAND_ENTER_DWELL_MS,
        cfg.TWO_HAND_EXIT_GRACE_MS,
      );
      if (separateChange === "start") {
        events.push({
          type: "HANDS_SEPARATE_START",
          timestamp: now,
          palmDistance: distance,
          separationSpeed,
        } satisfies HandsSeparateStartEvent);
      } else if (separateChange === "end") {
        events.push({
          type: "HANDS_SEPARATE_END",
          timestamp: now,
          palmDistance: distance,
          separationSpeed,
          reason: "released",
        } satisfies HandsSeparateEndEvent);
      }
    } else {
      twoHand.separating.enterSince = -1;
    }

    return {
      approaching: twoHand.approaching.active,
      separating: twoHand.separating.active,
      palmDistance: distance,
      approachSpeed,
      separationSpeed,
    };
  }

  function signalsOf(hand: HandState | null): GestureSnapshot["signals"]["left"] {
    if (!hand) {
      return null;
    }
    return {
      openness: hand.openness,
      pinchDistance: hand.pinchDistance,
      palmAlignment: palmAlignment(hand),
      vz: hand.velocity.z,
    };
  }

  return {
    update(hands: HandsState, nowMs: number): GestureUpdate {
      const events: GestureEvent[] = [];
      const leftState = updateSlot(left, hands.left, "LEFT", nowMs, events);
      const rightState = updateSlot(right, hands.right, "RIGHT", nowMs, events);
      const twoHandState = updateTwoHand(hands, nowMs, events);
      return {
        snapshot: {
          left: leftState,
          right: rightState,
          twoHand: twoHandState,
          signals: {
            left: signalsOf(hands.left),
            right: signalsOf(hands.right),
          },
        },
        events,
      };
    },
  };
}
