import { HandLandmarker } from "@mediapipe/tasks-vision";

/**
 * Canonical MediaPipe hand landmark indices. Nothing outside this module
 * should index a hand landmark array by number.
 */
export const WRIST = 0;

export const THUMB_CMC = 1;
export const THUMB_MCP = 2;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;

export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_DIP = 7;
export const INDEX_TIP = 8;

export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_DIP = 11;
export const MIDDLE_TIP = 12;

export const RING_MCP = 13;
export const RING_PIP = 14;
export const RING_DIP = 15;
export const RING_TIP = 16;

export const PINKY_MCP = 17;
export const PINKY_PIP = 18;
export const PINKY_DIP = 19;
export const PINKY_TIP = 20;

export const HAND_LANDMARK_COUNT = 21;

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export const FINGER_NAMES: readonly FingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
];

/** Fingers excluding the thumb, whose tip stays near the wrist even when open. */
export const CURL_FINGERS: readonly FingerName[] = [
  "index",
  "middle",
  "ring",
  "pinky",
];

export const FINGER_TIPS: Readonly<Record<FingerName, number>> = {
  thumb: THUMB_TIP,
  index: INDEX_TIP,
  middle: MIDDLE_TIP,
  ring: RING_TIP,
  pinky: PINKY_TIP,
};

export const FINGER_MCPS: Readonly<Record<FingerName, number>> = {
  thumb: THUMB_MCP,
  index: INDEX_MCP,
  middle: MIDDLE_MCP,
  ring: RING_MCP,
  pinky: PINKY_MCP,
};

/** Base-to-tip chain per finger, for future per-joint work. */
export const FINGER_CHAINS: Readonly<Record<FingerName, readonly number[]>> = {
  thumb: [THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP],
  index: [INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP],
  middle: [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP],
  ring: [RING_MCP, RING_PIP, RING_DIP, RING_TIP],
  pinky: [PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP],
};

/** Landmarks that define the palm plane and centre. */
export const PALM_SITES: readonly number[] = [
  WRIST,
  INDEX_MCP,
  MIDDLE_MCP,
  RING_MCP,
  PINKY_MCP,
];

export type HandConnection = { start: number; end: number };

/** MediaPipe's canonical skeleton pairs, for debug drawing. */
export const HAND_CONNECTIONS: readonly HandConnection[] =
  HandLandmarker.HAND_CONNECTIONS;

export function fingertipIndex(finger: FingerName): number {
  return FINGER_TIPS[finger];
}

export function mcpIndex(finger: FingerName): number {
  return FINGER_MCPS[finger];
}
