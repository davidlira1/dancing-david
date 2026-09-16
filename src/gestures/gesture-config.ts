/**
 * All gesture thresholds live here. Do not scatter magic numbers in the engine.
 *
 * Units:
 *   openness            HandState.openness, 0 ≈ fist, 1 ≈ open
 *   pinchDistance       world palm-lengths (thumb–index / palm length)
 *   palmAlignment       signed palmNormal.z after per-hand sign; 1 ≈ camera
 *   palmDistance        pixel palm gap / avg handScalePx (not pinch units)
 *   approach/separate   d(palmDistance)/dt, hand-scale units per second
 *   thrust vz           trackedDepth per second, positive = closer
 *   image-plane speed   hypot(vx, vy), normalized image units per second
 *
 * OPEN / FIST / PINCH / PALM_FORWARD enter and exit are intentionally split
 * so a jittering measurement does not chatter across a single threshold.
 * Starting values are guesses from the 0–1 curl mapping — tune from Gesture Debug.
 */
export const GESTURE_CONFIG = {
  OPEN_ENTER: 0.62,
  OPEN_EXIT: 0.52,

  FIST_ENTER: 0.28,
  FIST_EXIT: 0.38,

  PINCH_ENTER: 0.22,
  PINCH_EXIT: 0.32,

  PALM_FORWARD_ENTER: 0.55,
  PALM_FORWARD_EXIT: 0.4,
  /** Flip a side if Test D disagrees with physical palm-to-camera. */
  PALM_FORWARD_SIGN_LEFT: 1,
  PALM_FORWARD_SIGN_RIGHT: 1,

  STATIC_ENTER_DWELL_MS: 100,
  STATIC_EXIT_GRACE_MS: 80,

  APPROACH_SPEED_ENTER: 1.2,
  APPROACH_SPEED_EXIT: 0.4,
  SEPARATE_SPEED_ENTER: 1.2,
  SEPARATE_SPEED_EXIT: 0.4,
  TWO_HAND_ENTER_DWELL_MS: 80,
  TWO_HAND_EXIT_GRACE_MS: 80,
  /** Mix toward the latest derivative. 1 = no filter. */
  PALM_DISTANCE_VELOCITY_EMA: 0.35,
  PALM_DISTANCE_MIN_DT_MS: 20,
  PALM_DISTANCE_MAX_DT_MS: 200,

  THRUST_VELOCITY_THRESHOLD: 0.8,
  THRUST_MIN_DISPLACEMENT: 0.08,
  THRUST_WINDOW_MS: 180,
  THRUST_COOLDOWN_MS: 400,
  THRUST_MAX_IMAGE_SPEED: 1.2,
  THRUST_FLASH_MS: 250,

  REACQUIRE_GRACE_MS: 180,

  EVENT_LOG_LIMIT: 16,
} as const;

export type GestureConfig = typeof GESTURE_CONFIG;
