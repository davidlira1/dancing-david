/** Tunable ribbon + bloom look. Tracking constants live in visual-trajectory.ts. */

import {
  MAX_REACQUIRE_DISTANCE_PX,
  MAX_TRACKING_GAP_MS,
  MIN_CONTINUITY_VISIBILITY,
} from "../stroke-continuity.ts";
import {
  HAND_LOCAL_Z_GAIN,
  HAND_SCALE_DEPTH_GAIN,
} from "../hand-depth.ts";
import { MIN_HAND_CONFIDENCE } from "../hand-state.ts";

export const RIBBON_WIDTH = 32;
export const CORE_WIDTH = 0.11;
export const EDGE_SOFTNESS = 0.28;
export const MIN_WIDTH_SCALE = 0.04;
export const TAIL_FADE_END = 0.12;
export const INTENSITY = 1.45;

export const DEPTH_STRENGTH = 1;
export const PERSPECTIVE_STRENGTH = 1.15;
export const MIN_PERSPECTIVE_SCALE = 0.55;
export const MAX_PERSPECTIVE_SCALE = 1.85;
export const DEPTH_BLOOM_STRENGTH = 0.22;
export const OCCLUSION_DEPTH_BIAS = 0.04;
export const OCCLUSION_SOFTNESS = 0.05;
export const SEGMENTATION_THRESHOLD = 0.25;
export const BODY_INFLUENCE_RADIUS = 0.18;

export const BLOOM_SCALE = 0.5;
export const BLOOM_RADIUS = 2.4;
export const BLOOM_INTENSITY = 1.05;
export const BLOOM_THRESHOLD = 0;

export const CURVE_FLATNESS_PX = 0.75;
export const MAX_SUBDIVISION_DEPTH = 8;
export const TARGET_SAMPLE_SPACING_PX = 3;
export const MAX_RIBBON_SAMPLES = 4096;

export type RibbonSchemeId = "electric" | "green" | "magenta";

export type RibbonScheme = {
  id: RibbonSchemeId;
  label: string;
  core: readonly [number, number, number];
  inner: readonly [number, number, number];
  mid: readonly [number, number, number];
  outer: readonly [number, number, number];
  bloomTint: readonly [number, number, number];
};

export const RIBBON_SCHEMES: readonly RibbonScheme[] = [
  {
    id: "electric",
    label: "Electric",
    core: [0.95, 0.99, 1.0],
    inner: [0.22, 0.9, 1.0],
    mid: [0.26, 0.4, 1.0],
    outer: [0.62, 0.2, 1.0],
    bloomTint: [0.75, 0.35, 1.15],
  },
  {
    id: "green",
    label: "Neon Green",
    core: [0.9, 1.0, 0.85],
    inner: [0.4, 1.0, 0.18],
    mid: [0.08, 0.82, 0.32],
    outer: [0.02, 0.48, 0.28],
    bloomTint: [0.3, 1.15, 0.4],
  },
  {
    id: "magenta",
    label: "Magenta",
    core: [1.0, 0.95, 0.98],
    inner: [1.0, 0.28, 0.72],
    mid: [0.95, 0.12, 0.82],
    outer: [0.68, 0.1, 1.0],
    bloomTint: [1.15, 0.28, 0.85],
  },
];

export const DEFAULT_SCHEME: RibbonScheme = RIBBON_SCHEMES[0];

export type RibbonVfxConfig = {
  ribbonWidth: number;
  tailWidthScale: number;
  coreWidth: number;
  edgeSoftness: number;
  ribbonIntensity: number;
  bloomRadius: number;
  bloomIntensity: number;
  trailDurationMs: number;
  coreColor: string;
  bodyColor: string;
  edgeColor: string;
  bloomColor: string;
  depthEnabled: boolean;
  depthStrength: number;
  perspectiveStrength: number;
  minPerspectiveScale: number;
  maxPerspectiveScale: number;
  depthBloomStrength: number;
  depthViz: boolean;
  invertZ: boolean;
  occlusionEnabled: boolean;
  occlusionDepthBias: number;
  occlusionSoftness: number;
  segmentationThreshold: number;
  bodyInfluenceRadius: number;
  segmentationDebug: boolean;
  bodyDepthDebug: boolean;
  occlusionViz: boolean;
  continuityGapMs: number;
  continuityReacquirePx: number;
  minContinuityVisibility: number;
  strokeDebug: boolean;
  handCadence: number;
  handScaleDepthGain: number;
  handLocalZGain: number;
  minHandConfidence: number;
  handsEnabled: boolean;
  handNormalDebug: boolean;
  swapHandedness: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function channelToHex(value: number): string {
  const byte = Math.round(clamp01(value) * 255);
  return byte.toString(16).padStart(2, "0");
}

export function rgbToHex(
  rgb: readonly [number, number, number],
): string {
  return `#${channelToHex(rgb[0])}${channelToHex(rgb[1])}${channelToHex(rgb[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) {
    return [1, 1, 1];
  }
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

export function cloneRibbonVfxConfig(
  config: RibbonVfxConfig,
): RibbonVfxConfig {
  return { ...config };
}

export const DEFAULT_RIBBON_VFX_CONFIG: RibbonVfxConfig = {
  ribbonWidth: RIBBON_WIDTH,
  tailWidthScale: MIN_WIDTH_SCALE,
  coreWidth: CORE_WIDTH,
  edgeSoftness: EDGE_SOFTNESS,
  ribbonIntensity: INTENSITY,
  bloomRadius: BLOOM_RADIUS,
  bloomIntensity: BLOOM_INTENSITY,
  trailDurationMs: 1900,
  coreColor: rgbToHex(DEFAULT_SCHEME.core),
  bodyColor: rgbToHex(DEFAULT_SCHEME.inner),
  edgeColor: rgbToHex(DEFAULT_SCHEME.outer),
  bloomColor: rgbToHex(DEFAULT_SCHEME.bloomTint),
  depthEnabled: true,
  depthStrength: DEPTH_STRENGTH,
  perspectiveStrength: PERSPECTIVE_STRENGTH,
  minPerspectiveScale: MIN_PERSPECTIVE_SCALE,
  maxPerspectiveScale: MAX_PERSPECTIVE_SCALE,
  depthBloomStrength: DEPTH_BLOOM_STRENGTH,
  depthViz: false,
  invertZ: true,
  occlusionEnabled: true,
  occlusionDepthBias: OCCLUSION_DEPTH_BIAS,
  occlusionSoftness: OCCLUSION_SOFTNESS,
  segmentationThreshold: SEGMENTATION_THRESHOLD,
  bodyInfluenceRadius: BODY_INFLUENCE_RADIUS,
  segmentationDebug: false,
  bodyDepthDebug: false,
  occlusionViz: false,
  continuityGapMs: MAX_TRACKING_GAP_MS,
  continuityReacquirePx: MAX_REACQUIRE_DISTANCE_PX,
  minContinuityVisibility: MIN_CONTINUITY_VISIBILITY,
  strokeDebug: false,
  handCadence: 1,
  handScaleDepthGain: HAND_SCALE_DEPTH_GAIN,
  handLocalZGain: HAND_LOCAL_Z_GAIN,
  minHandConfidence: MIN_HAND_CONFIDENCE,
  handsEnabled: true,
  handNormalDebug: true,
  swapHandedness: true,
};

export function createRibbonVfxConfig(): RibbonVfxConfig {
  return cloneRibbonVfxConfig(DEFAULT_RIBBON_VFX_CONFIG);
}

export function applySchemeToVfx(
  config: RibbonVfxConfig,
  scheme: RibbonScheme,
): void {
  config.coreColor = rgbToHex(scheme.core);
  config.bodyColor = rgbToHex(scheme.inner);
  config.edgeColor = rgbToHex(scheme.outer);
  config.bloomColor = rgbToHex(scheme.bloomTint);
}

export function assignRibbonVfxConfig(
  target: RibbonVfxConfig,
  source: RibbonVfxConfig,
): void {
  target.ribbonWidth = source.ribbonWidth;
  target.tailWidthScale = source.tailWidthScale;
  target.coreWidth = source.coreWidth;
  target.edgeSoftness = source.edgeSoftness;
  target.ribbonIntensity = source.ribbonIntensity;
  target.bloomRadius = source.bloomRadius;
  target.bloomIntensity = source.bloomIntensity;
  target.trailDurationMs = source.trailDurationMs;
  target.coreColor = source.coreColor;
  target.bodyColor = source.bodyColor;
  target.edgeColor = source.edgeColor;
  target.bloomColor = source.bloomColor;
  target.depthEnabled = source.depthEnabled;
  target.depthStrength = source.depthStrength;
  target.perspectiveStrength = source.perspectiveStrength;
  target.minPerspectiveScale = source.minPerspectiveScale;
  target.maxPerspectiveScale = source.maxPerspectiveScale;
  target.depthBloomStrength = source.depthBloomStrength;
  target.depthViz = source.depthViz;
  target.invertZ = source.invertZ;
  target.occlusionEnabled = source.occlusionEnabled;
  target.occlusionDepthBias = source.occlusionDepthBias;
  target.occlusionSoftness = source.occlusionSoftness;
  target.segmentationThreshold = source.segmentationThreshold;
  target.bodyInfluenceRadius = source.bodyInfluenceRadius;
  target.segmentationDebug = source.segmentationDebug;
  target.bodyDepthDebug = source.bodyDepthDebug;
  target.occlusionViz = source.occlusionViz;
  target.continuityGapMs = source.continuityGapMs;
  target.continuityReacquirePx = source.continuityReacquirePx;
  target.minContinuityVisibility = source.minContinuityVisibility;
  target.strokeDebug = source.strokeDebug;
  target.handCadence = source.handCadence;
  target.handScaleDepthGain = source.handScaleDepthGain;
  target.handLocalZGain = source.handLocalZGain;
  target.minHandConfidence = source.minHandConfidence;
  target.handsEnabled = source.handsEnabled;
  target.handNormalDebug = source.handNormalDebug;
  target.swapHandedness = source.swapHandedness;
}

export const THIN_RIBBON_VFX_PRESET: RibbonVfxConfig = {
  ...DEFAULT_RIBBON_VFX_CONFIG,
  ribbonWidth: 12,
  tailWidthScale: 0.5,
  coreWidth: 0.08,
  bloomRadius: 1.5,
};

export const MEDIUM_RIBBON_VFX_PRESET: RibbonVfxConfig =
  cloneRibbonVfxConfig(DEFAULT_RIBBON_VFX_CONFIG);

export const THICK_RIBBON_VFX_PRESET: RibbonVfxConfig = {
  ...DEFAULT_RIBBON_VFX_CONFIG,
  ribbonWidth: 44,
  tailWidthScale: 0.85,
  coreWidth: 0.16,
  bloomRadius: 4,
};

export const RIBBON_VFX_PRESETS = {
  thin: THIN_RIBBON_VFX_PRESET,
  medium: MEDIUM_RIBBON_VFX_PRESET,
  thick: THICK_RIBBON_VFX_PRESET,
} as const;
