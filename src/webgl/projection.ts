import { visualDepthFromTracked } from "../depth.ts";

export function perspectiveScale(
  visualDepth: number,
  perspectiveStrength: number,
  minScale: number,
  maxScale: number,
): number {
  const scale = Math.exp(visualDepth * perspectiveStrength);
  return Math.max(minScale, Math.min(maxScale, scale));
}

export function ribbonPerspectiveFromTracked(
  trackedDepth: number,
  options: {
    depthEnabled: boolean;
    depthStrength: number;
    perspectiveStrength: number;
    minPerspectiveScale: number;
    maxPerspectiveScale: number;
  },
): { visualDepth: number; perspectiveScale: number } {
  const visualDepth = visualDepthFromTracked(
    trackedDepth,
    options.depthStrength,
  );
  if (!options.depthEnabled) {
    return { visualDepth, perspectiveScale: 1 };
  }
  return {
    visualDepth,
    perspectiveScale: perspectiveScale(
      visualDepth,
      options.perspectiveStrength,
      options.minPerspectiveScale,
      options.maxPerspectiveScale,
    ),
  };
}
