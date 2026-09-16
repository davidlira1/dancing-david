export type GestureHand = "LEFT" | "RIGHT";

export type GestureEndReason = "released" | "tracking_lost";

export type PalmPosition = {
  x: number;
  y: number;
  trackedDepth: number;
};

export type HandGestureState = {
  open: boolean;
  fist: boolean;
  pinching: boolean;
  palmForward: boolean;
  thrusting: boolean;
};

export type TwoHandGestureState = {
  approaching: boolean;
  separating: boolean;
  palmDistance: number | null;
  approachSpeed: number;
  separationSpeed: number;
};

export type GestureSignals = {
  openness: number;
  pinchDistance: number;
  palmAlignment: number | null;
  vz: number;
};

export type GestureSnapshot = {
  left: HandGestureState | null;
  right: HandGestureState | null;
  twoHand: TwoHandGestureState;
  signals: {
    left: GestureSignals | null;
    right: GestureSignals | null;
  };
};

type EventBase = {
  timestamp: number;
};

type HandEventBase = EventBase & {
  hand: GestureHand;
  palmPosition: PalmPosition;
};

export type OpenStartEvent = HandEventBase & {
  type: "OPEN_START";
  openness: number;
};

export type OpenEndEvent = HandEventBase & {
  type: "OPEN_END";
  openness: number;
  reason: GestureEndReason;
};

export type FistStartEvent = HandEventBase & {
  type: "FIST_START";
  openness: number;
};

export type FistEndEvent = HandEventBase & {
  type: "FIST_END";
  openness: number;
  reason: GestureEndReason;
};

export type PinchStartEvent = HandEventBase & {
  type: "PINCH_START";
  pinchDistance: number;
};

export type PinchEndEvent = HandEventBase & {
  type: "PINCH_END";
  pinchDistance: number;
  reason: GestureEndReason;
};

export type PalmForwardStartEvent = HandEventBase & {
  type: "PALM_FORWARD_START";
  alignment: number;
};

export type PalmForwardEndEvent = HandEventBase & {
  type: "PALM_FORWARD_END";
  alignment: number | null;
  reason: GestureEndReason;
};

export type ThrustEvent = HandEventBase & {
  type: "THRUST";
  velocity: { x: number; y: number; z: number };
  speed: number;
  trackedDepth: number;
};

export type HandsApproachStartEvent = EventBase & {
  type: "HANDS_APPROACH_START";
  palmDistance: number;
  approachSpeed: number;
};

export type HandsApproachEndEvent = EventBase & {
  type: "HANDS_APPROACH_END";
  palmDistance: number | null;
  approachSpeed: number;
  reason: GestureEndReason;
};

export type HandsSeparateStartEvent = EventBase & {
  type: "HANDS_SEPARATE_START";
  palmDistance: number;
  separationSpeed: number;
};

export type HandsSeparateEndEvent = EventBase & {
  type: "HANDS_SEPARATE_END";
  palmDistance: number | null;
  separationSpeed: number;
  reason: GestureEndReason;
};

export type GestureEvent =
  | OpenStartEvent
  | OpenEndEvent
  | FistStartEvent
  | FistEndEvent
  | PinchStartEvent
  | PinchEndEvent
  | PalmForwardStartEvent
  | PalmForwardEndEvent
  | ThrustEvent
  | HandsApproachStartEvent
  | HandsApproachEndEvent
  | HandsSeparateStartEvent
  | HandsSeparateEndEvent;

export type GestureUpdate = {
  snapshot: GestureSnapshot;
  events: GestureEvent[];
};
