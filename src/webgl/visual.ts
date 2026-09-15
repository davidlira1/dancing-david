/** Tunable ribbon + bloom look. Tracking constants live in visual-trajectory.ts. */

export const RIBBON_WIDTH = 32;
export const CORE_WIDTH = 0.11;
export const EDGE_SOFTNESS = 0.28;
export const MIN_WIDTH_SCALE = 0.04;
export const TAIL_FADE_END = 0.12;
export const INTENSITY = 1.45;

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
