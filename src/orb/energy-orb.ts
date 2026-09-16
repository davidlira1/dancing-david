import type { HandsState } from "../hand-state.ts";
import type { EnergyOrbConfig } from "./orb-config.ts";

export type EnergyOrbPhase = "INACTIVE" | "HELD" | "FADING";

export type EnergyOrb = {
  state: EnergyOrbPhase;
  x: number;
  y: number;
  depth: number;
  interactionRadius: number;
  intensity: number;
  ageMs: number;
  charge: number;
  fade: number;
  dwellProgress: number;
  palmDistance: number | null;
};

const INACTIVE: EnergyOrb = {
  state: "INACTIVE",
  x: 0,
  y: 0,
  depth: 0,
  interactionRadius: 0,
  intensity: 0,
  ageMs: 0,
  charge: 0,
  fade: 0,
  dwellProgress: 0,
  palmDistance: null,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function radiusFromDistance(
  distance: number,
  config: EnergyOrbConfig,
): number {
  const activate = config.activateDistance;
  const release = Math.max(config.releaseDistance, activate + 0.5);
  const span = Math.max(0.05, release - activate);
  const t = clamp((distance - activate) / span, 0, 1);
  const lo = Math.min(config.minRadius, config.maxRadius);
  const hi = Math.max(config.minRadius, config.maxRadius);
  return lerp(lo, hi, t);
}

export function createEnergyOrbController(config: EnergyOrbConfig) {
  let phase: EnergyOrbPhase = "INACTIVE";
  let x = 0.5;
  let y = 0.5;
  let depth = 0;
  let radius = config.minRadius;
  let radiusReady = false;
  let charge = 0;
  let fade = 0;
  let ageMs = 0;
  let dwellStart = -1;
  let missingSince = -1;
  let lastNow = -1;
  let lastDistance: number | null = null;

  function snapshot(): EnergyOrb {
    if (phase === "INACTIVE") {
      const dwellProgress =
        dwellStart < 0 || lastNow < 0
          ? 0
          : clamp((lastNow - dwellStart) / config.activateDwellMs, 0, 1);
      return {
        ...INACTIVE,
        dwellProgress,
        palmDistance: lastDistance,
      };
    }
    return {
      state: phase,
      x,
      y,
      depth,
      interactionRadius: radius,
      intensity: 1,
      ageMs,
      charge,
      fade,
      dwellProgress: 1,
      palmDistance: lastDistance,
    };
  }

  function enterHeld(
    nx: number,
    ny: number,
    nd: number,
    distance: number,
  ): void {
    phase = "HELD";
    x = nx;
    y = ny;
    depth = nd;
    radius = radiusFromDistance(distance, config);
    radiusReady = true;
    charge = 0;
    fade = 1;
    ageMs = 0;
    dwellStart = -1;
    missingSince = -1;
  }

  function enterFading(): void {
    if (phase === "INACTIVE") {
      return;
    }
    phase = "FADING";
    fade = 1;
    dwellStart = -1;
    missingSince = -1;
  }

  function resetInactive(): void {
    phase = "INACTIVE";
    charge = 0;
    fade = 0;
    ageMs = 0;
    radiusReady = false;
    dwellStart = -1;
    missingSince = -1;
  }

  return {
    update(hands: HandsState, nowMs: number, enabled: boolean): EnergyOrb {
      const dt = lastNow < 0 ? 0 : Math.max(0, nowMs - lastNow);
      lastNow = nowMs;

      const left = hands.left;
      const right = hands.right;
      const both = Boolean(left && right && hands.palmDistance !== null);
      const activate = config.activateDistance;
      const release = Math.max(config.releaseDistance, activate + 0.5);
      lastDistance = both ? hands.palmDistance : null;

      if (!enabled) {
        if (phase === "HELD") {
          enterFading();
        }
      } else if (phase === "INACTIVE") {
        if (both && lastDistance !== null && lastDistance < activate) {
          if (dwellStart < 0) {
            dwellStart = nowMs;
          }
          if (nowMs - dwellStart >= config.activateDwellMs && left && right) {
            enterHeld(
              (left.palmCenter.x + right.palmCenter.x) * 0.5,
              (left.palmCenter.y + right.palmCenter.y) * 0.5,
              (left.palmCenter.trackedDepth + right.palmCenter.trackedDepth) *
                0.5,
              lastDistance,
            );
          }
        } else {
          dwellStart = -1;
        }
      } else if (phase === "HELD") {
        if (both && left && right && lastDistance !== null) {
          missingSince = -1;
          x = (left.palmCenter.x + right.palmCenter.x) * 0.5;
          y = (left.palmCenter.y + right.palmCenter.y) * 0.5;
          depth =
            (left.palmCenter.trackedDepth + right.palmCenter.trackedDepth) *
            0.5;
          const target = radiusFromDistance(lastDistance, config);
          if (!radiusReady) {
            radius = target;
            radiusReady = true;
          } else {
            const tau = Math.max(1, config.radiusTauMs);
            const mix = 1 - Math.exp(-dt / tau);
            radius += (target - radius) * mix;
          }
          if (lastDistance > release) {
            enterFading();
          }
        } else {
          if (missingSince < 0) {
            missingSince = nowMs;
          }
          if (nowMs - missingSince >= config.trackLossGraceMs) {
            enterFading();
          }
        }
      }

      if (phase === "HELD") {
        charge = clamp(charge + dt / Math.max(1, config.chargeInMs), 0, 1);
        ageMs += dt;
      } else if (phase === "FADING") {
        fade = clamp(fade - dt / Math.max(1, config.fadeOutMs), 0, 1);
        ageMs += dt;
        if (fade <= 0) {
          resetInactive();
        }
      }

      return snapshot();
    },
  };
}
