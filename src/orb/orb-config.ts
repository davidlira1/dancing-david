/**
 * Two-hand energy orb knobs.
 *
 * Units:
 *   activate/release distance   HandsState.palmDistance (hand-scale units)
 *   radii                       video pixels, before perspective
 *   dwell / charge / fade / grace   milliseconds
 *   depthStrength               fed to ribbonPerspectiveFromTracked
 *   intensity / bloomStrength   shader multipliers (bloom is the shared pass)
 */
export type EnergyOrbConfig = {
  activateDistance: number;
  releaseDistance: number;
  activateDwellMs: number;
  chargeInMs: number;
  fadeOutMs: number;
  trackLossGraceMs: number;
  minRadius: number;
  maxRadius: number;
  radiusTauMs: number;
  depthStrength: number;
  intensity: number;
  bloomStrength: number;
};

export const DEFAULT_ORB_CONFIG: EnergyOrbConfig = {
  activateDistance: 2.2,
  releaseDistance: 3.6,
  activateDwellMs: 220,
  chargeInMs: 300,
  fadeOutMs: 280,
  trackLossGraceMs: 180,
  minRadius: 25,
  maxRadius: 120,
  radiusTauMs: 40,
  depthStrength: 1,
  intensity: 1,
  bloomStrength: 1.25,
};

export function createEnergyOrbConfig(): EnergyOrbConfig {
  return { ...DEFAULT_ORB_CONFIG };
}
