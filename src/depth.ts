const DEPTH_CONFIDENT_VISIBILITY = 0.65;

export const DEPTH_CALIBRATION_MS = 1000;
export const DEPTH_MIN_CALIBRATION_SAMPLES = 10;
export const DEPTH_CALIBRATION_GAP_MS = 400;
export const DEPTH_JUMP = 0.08;
export const DEPTH_JUMP_SPEED_MULT = 8;
export const DEPTH_UNTRUSTED_STEP_SCALE = 0.65;

export type DepthSnapshot = {
  rawZ: number;
  baselineZ: number;
  relativeZ: number;
  trackedDepth: number;
  vz: number;
  visibility: number;
  calibrated: boolean;
  calibrating: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothingFactor(dtSec: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * dtSec;
  return r / (r + 1);
}

function createOneEuroFilter(minCutoff: number, beta: number, dCutoff: number) {
  let xPrev = 0;
  let dxPrev = 0;
  let tPrev = 0;
  let primed = false;

  return {
    reset(): void {
      primed = false;
      xPrev = 0;
      dxPrev = 0;
      tPrev = 0;
    },
    filter(value: number, timestampMs: number): number {
      if (!primed) {
        primed = true;
        xPrev = value;
        dxPrev = 0;
        tPrev = timestampMs;
        return value;
      }
      const dtSec = Math.max((timestampMs - tPrev) / 1000, 1e-4);
      const dx = (value - xPrev) / dtSec;
      const aD = smoothingFactor(dtSec, dCutoff);
      const dxHat = lerp(dxPrev, dx, aD);
      const cutoff = minCutoff + beta * Math.abs(dxHat);
      const a = smoothingFactor(dtSec, cutoff);
      const xHat = lerp(xPrev, value, a);
      xPrev = xHat;
      dxPrev = dxHat;
      tPrev = timestampMs;
      return xHat;
    },
  };
}

export function createDepthTracker(options?: { invertZ?: boolean }) {
  const euro = createOneEuroFilter(1.0, 0.007, 1.0);
  const calSamples: number[] = [];
  let calStartMs = 0;
  let lastCalMs = 0;
  let calibrating = true;
  let calibrated = false;
  let baselineZ = 0;
  let rawZ = 0;
  let relativeZ = 0;
  let trackedDepth = 0;
  let vz = 0;
  let visibility = 0;
  let lastRelative: number | null = null;
  let lastT = 0;
  let invertZ = options?.invertZ ?? true;

  function relativeFromRaw(value: number): number {
    return invertZ ? baselineZ - value : value - baselineZ;
  }

  function finishCalibration(): void {
    if (calSamples.length === 0) {
      return;
    }
    let sum = 0;
    for (let i = 0; i < calSamples.length; i++) {
      sum += calSamples[i];
    }
    baselineZ = sum / calSamples.length;
    calibrated = true;
    calibrating = false;
    euro.reset();
    lastRelative = 0;
    trackedDepth = 0;
    relativeZ = 0;
    vz = 0;
  }

  function snapshot(): DepthSnapshot {
    return {
      rawZ,
      baselineZ,
      relativeZ,
      trackedDepth,
      vz,
      visibility,
      calibrated,
      calibrating,
    };
  }

  return {
    setInvertZ(value: boolean): boolean {
      if (invertZ === value) {
        return false;
      }
      invertZ = value;
      relativeZ = -relativeZ;
      trackedDepth = -trackedDepth;
      vz = -vz;
      if (lastRelative !== null) {
        lastRelative = -lastRelative;
      }
      euro.reset();
      return true;
    },

    recalibrate(): void {
      calSamples.length = 0;
      calStartMs = 0;
      lastCalMs = 0;
      calibrating = true;
      calibrated = false;
      euro.reset();
      lastRelative = null;
      trackedDepth = 0;
      relativeZ = 0;
      vz = 0;
    },

    update(nextRawZ: number, timestampMs: number, nextVisibility: number): DepthSnapshot {
      rawZ = nextRawZ;
      visibility = nextVisibility;
      const trust = clamp01(
        (nextVisibility - 0.5) / Math.max(DEPTH_CONFIDENT_VISIBILITY - 0.5, 1e-4),
      );

      if (calibrating) {
        if (nextVisibility >= DEPTH_CONFIDENT_VISIBILITY) {
          if (
            lastCalMs > 0 &&
            timestampMs - lastCalMs > DEPTH_CALIBRATION_GAP_MS
          ) {
            calSamples.length = 0;
            calStartMs = timestampMs;
          }
          if (calStartMs === 0) {
            calStartMs = timestampMs;
          }
          calSamples.push(nextRawZ);
          lastCalMs = timestampMs;
        }
        const elapsed = calStartMs === 0 ? 0 : lastCalMs - calStartMs;
        if (
          calSamples.length >= DEPTH_MIN_CALIBRATION_SAMPLES &&
          elapsed >= DEPTH_CALIBRATION_MS
        ) {
          finishCalibration();
        } else {
          lastT = timestampMs;
          return snapshot();
        }
      }

      const target = relativeFromRaw(nextRawZ);
      const dt = Math.max(0, timestampMs - lastT);
      let allowed = DEPTH_JUMP * lerp(DEPTH_UNTRUSTED_STEP_SCALE, 1, trust);
      if (lastRelative !== null && dt > 0) {
        allowed = Math.max(
          allowed,
          Math.abs(vz) * dt * DEPTH_JUMP_SPEED_MULT,
        );
      }
      let clamped = target;
      if (lastRelative !== null) {
        const delta = target - lastRelative;
        if (Math.abs(delta) > allowed && allowed > 0) {
          clamped = lastRelative + Math.sign(delta) * allowed;
        }
      }

      const filtered = euro.filter(clamped, timestampMs);
      if (dt > 0) {
        vz = (filtered - trackedDepth) / dt;
      }
      trackedDepth = filtered;
      relativeZ = clamped;
      lastRelative = clamped;
      lastT = timestampMs;
      return snapshot();
    },

    snapshot,
  };
}

export function visualDepthFromTracked(
  trackedDepth: number,
  depthStrength: number,
): number {
  return trackedDepth * depthStrength;
}

export function formatDepthDebug(snapshot: {
  rawZ: number;
  baselineZ: number;
  relativeZ: number;
  trackedDepth: number;
  visualDepth: number;
  perspectiveScale: number;
  vz: number;
  visibility: number;
  calibrated: boolean;
  calibrating: boolean;
}): string {
  const state = snapshot.calibrating
    ? "calibrating"
    : snapshot.calibrated
      ? "locked"
      : "uncalibrated";
  return (
    `Depth: ${state}\n` +
    `Raw Z: ${snapshot.rawZ.toFixed(3)}\n` +
    `Baseline Z: ${snapshot.baselineZ.toFixed(3)}\n` +
    `Relative Z: ${snapshot.relativeZ.toFixed(3)}\n` +
    `Tracked: ${snapshot.trackedDepth.toFixed(3)}\n` +
    `Visual: ${snapshot.visualDepth.toFixed(3)}\n` +
    `Scale: ${snapshot.perspectiveScale.toFixed(3)}\n` +
    `vz: ${snapshot.vz.toFixed(4)}\n` +
    `Visibility: ${snapshot.visibility.toFixed(2)}`
  );
}
