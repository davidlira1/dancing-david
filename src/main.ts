import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import "./style.css";
import { drawAura } from "./aura.ts";
import { startCamera } from "./camera.ts";
import { createEnergySwipeEffect } from "./energy-swipe.ts";
import { drawPose } from "./overlay.ts";
import { createPoseLandmarker, detectPose } from "./pose.ts";
import { lastPersonMask, updatePersonMask } from "./segmentation.ts";
import { createSceneDepth } from "./scene-depth.ts";
import {
  createBodyDepthField,
  formatOcclusionDebug,
  HEAD_ATTACH_MS,
  occlusionFactor,
} from "./body-depth.ts";
import { drawOcclusionDebug } from "./occlusion-debug.ts";
import { buildTrailGeometry } from "./trail.ts";
import {
  drawStrokeDebug,
  drawTrackingDebug,
  formatTrackingDebug,
} from "./tracking-debug.ts";
import { formatContinuityDebug } from "./stroke-continuity.ts";
import { formatDepthDebug } from "./depth.ts";
import { ribbonPerspectiveFromTracked } from "./webgl/projection.ts";
import { createVfxControls } from "./vfx-controls.ts";
import { createRibbonRenderer } from "./webgl/ribbon-renderer.ts";
import { createRibbonVfxConfig } from "./webgl/visual.ts";
import {
  createWristTrail,
  LEFT_WRIST_INDEX,
  RIGHT_WRIST_INDEX,
} from "./wrist-history.ts";
import { createMotionAnalyzer, type MotionSnapshot } from "./motion.ts";
import { createVisualTrajectory } from "./visual-trajectory.ts";

const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const auraCanvas = document.querySelector<HTMLCanvasElement>("#aura")!;
const ribbonCanvas = document.querySelector<HTMLCanvasElement>("#ribbon-gl")!;
const effectsCanvas = document.querySelector<HTMLCanvasElement>("#effects")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const debugEl = document.querySelector<HTMLPreElement>("#motion-debug")!;
const wristTrail = createWristTrail();
const vfxConfig = createRibbonVfxConfig();
const sceneDepth = createSceneDepth({ invertZ: vfxConfig.invertZ });
const visualRight = createVisualTrajectory(sceneDepth);
const visualLeft = createVisualTrajectory(sceneDepth);
const bodyDepth = createBodyDepthField();
const motionAnalyzer = createMotionAnalyzer();
const energySwipe = createEnergySwipeEffect();
const ribbonRenderer = createRibbonRenderer(ribbonCanvas);
function applyContinuityThresholds(): void {
  const thresholds = {
    minVisibility: vfxConfig.minContinuityVisibility,
    maxGapMs: vfxConfig.continuityGapMs,
    maxReacquireDistancePx: vfxConfig.continuityReacquirePx,
  };
  visualRight.setContinuityThresholds(thresholds);
  visualLeft.setContinuityThresholds(thresholds);
}

const vfxControls = createVfxControls({
  config: vfxConfig,
  onChange: () => {
    visualRight.setDurationMs(vfxConfig.trailDurationMs);
    visualLeft.setDurationMs(vfxConfig.trailDurationMs);
    applyContinuityThresholds();
    if (sceneDepth.setInvertZ(vfxConfig.invertZ)) {
      visualRight.handleSceneInvert();
      visualLeft.handleSceneInvert();
    }
  },
  onRecalibrate: () => {
    sceneDepth.recalibrate();
    visualRight.handleSceneRecalibrate();
    visualLeft.handleSceneRecalibrate();
  },
});
visualRight.setDurationMs(vfxConfig.trailDurationMs);
visualLeft.setDurationMs(vfxConfig.trailDurationMs);
applyContinuityThresholds();
let lastSwipeLabel = "—";
let lastMotion: MotionSnapshot | null = null;

const visibility = {
  skeleton: true,
  aura: true,
  energySwipe: true,
  tracking: false,
};

const skeletonToggle =
  document.querySelector<HTMLButtonElement>("#toggle-skeleton")!;
const auraToggle = document.querySelector<HTMLButtonElement>("#toggle-aura")!;
const energyToggle = document.querySelector<HTMLButtonElement>("#toggle-energy")!;
const trackingToggle =
  document.querySelector<HTMLButtonElement>("#toggle-tracking")!;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function syncToggle(
  button: HTMLButtonElement,
  label: string,
  on: boolean,
): void {
  button.textContent = `${label}: ${on ? "ON" : "OFF"}`;
  button.setAttribute("aria-pressed", on ? "true" : "false");
}

skeletonToggle.addEventListener("click", () => {
  visibility.skeleton = !visibility.skeleton;
  syncToggle(skeletonToggle, "Skeleton", visibility.skeleton);
  if (!visibility.skeleton) {
    clearCanvas(overlayCanvas);
  }
});

auraToggle.addEventListener("click", () => {
  visibility.aura = !visibility.aura;
  syncToggle(auraToggle, "Aura", visibility.aura);
  if (!visibility.aura) {
    clearCanvas(auraCanvas);
  }
});

energyToggle.addEventListener("click", () => {
  visibility.energySwipe = !visibility.energySwipe;
  syncToggle(energyToggle, "Energy Swipe", visibility.energySwipe);
  if (!visibility.energySwipe) {
    clearCanvas(effectsCanvas);
  }
});

trackingToggle.addEventListener("click", () => {
  visibility.tracking = !visibility.tracking;
  syncToggle(trackingToggle, "DEBUG TRACKING", visibility.tracking);
  if (!visibility.tracking) {
    if (!visibility.skeleton) {
      clearCanvas(overlayCanvas);
    }
    if (lastMotion) {
      updateMotionDebug(lastMotion);
    }
  }
});

function updateMotionDebug(motion: MotionSnapshot): void {
  if (motion.event) {
    lastSwipeLabel = `SWIPE ${motion.event.direction}`;
  }
  debugEl.textContent =
    `Speed: ${motion.speed.toFixed(2)}\n` +
    `Direction: ${motion.direction}\n` +
    `Last event: ${lastSwipeLabel}`;
}

async function main(): Promise<void> {
  setStatus("Loading pose model…");
  const landmarker = await createPoseLandmarker();
  setStatus("Pose model ready. Click Start camera.");
  startButton.disabled = false;

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    try {
      setStatus("Starting camera…");
      await startCamera(video);
      setStatus(
        ribbonRenderer
          ? "Camera running."
          : "Camera running. WebGL2 is unavailable, so the neon ribbon is off.",
      );

      let lastVideoTime = -1;
      let lastPoseResult: PoseLandmarkerResult | null = null;
      let lastRawWrist: { x: number; y: number } | null = null;
      let lastVisibility = 0;
      const visionTimes: number[] = [];
      const renderTimes: number[] = [];

      const tick = (): void => {
        const now = performance.now();
        renderTimes.push(now);
        while (renderTimes.length > 0 && renderTimes[0] < now - 1000) {
          renderTimes.shift();
        }
        while (visionTimes.length > 0 && visionTimes[0] < now - 1000) {
          visionTimes.shift();
        }
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          detectPose(landmarker, video, now, (result) => {
            lastPoseResult = result;
            visionTimes.push(now);
            while (visionTimes.length > 0 && visionTimes[0] < now - 1000) {
              visionTimes.shift();
            }
            const mask = updatePersonMask(result);
            if (visibility.aura) {
              drawAura(auraCanvas, video, mask?.canvas ?? null);
            }
            const field = bodyDepth.update(
              result.landmarks[0],
              mask,
              sceneDepth,
              vfxConfig.bodyInfluenceRadius,
            );
            ribbonRenderer?.setOcclusionSources(
              mask,
              field,
              sceneDepth.isReady(),
            );
            wristTrail.update(result.landmarks[0], now);
            const landmarks = result.landmarks[0];
            const rightWrist = landmarks?.[RIGHT_WRIST_INDEX];
            const leftWrist = landmarks?.[LEFT_WRIST_INDEX];
            // Continuity thresholds are in pixels, so it needs the real frame size.
            visualRight.setViewport(video.videoWidth, video.videoHeight);
            visualLeft.setViewport(video.videoWidth, video.videoHeight);
            const minVisibility = vfxConfig.minContinuityVisibility;
            if (rightWrist && rightWrist.visibility >= minVisibility) {
              lastRawWrist = { x: rightWrist.x, y: rightWrist.y };
              lastVisibility = rightWrist.visibility;
              visualRight.update({
                x: rightWrist.x,
                y: rightWrist.y,
                z: rightWrist.z,
                t: now,
                visibility: rightWrist.visibility,
              });
            } else {
              lastRawWrist = null;
              lastVisibility = rightWrist?.visibility ?? 0;
              visualRight.noteMissedFrame(now, lastVisibility);
            }
            if (leftWrist && leftWrist.visibility >= minVisibility) {
              visualLeft.update({
                x: leftWrist.x,
                y: leftWrist.y,
                z: leftWrist.z,
                t: now,
                visibility: leftWrist.visibility,
              });
            } else {
              visualLeft.noteMissedFrame(now, leftWrist?.visibility ?? 0);
            }
            const motion = motionAnalyzer.analyze(wristTrail.samples(), now);
            lastMotion = motion;
            if (!visibility.tracking) {
              updateMotionDebug(motion);
            }
            if (visibility.energySwipe && motion.event) {
              energySwipe.spawn(motion.event);
            }
          });
        }

        visualRight.setDurationMs(vfxConfig.trailDurationMs);
        visualLeft.setDurationMs(vfxConfig.trailDurationMs);
        const depthSnap = visualRight.depthSnapshot();
        const head = ribbonRenderer?.lastHead() ?? null;
        const bodyAtHead =
          head && video.videoWidth > 0
            ? bodyDepth.sample(
                head.x / video.videoWidth,
                head.y / video.videoHeight,
              )
            : null;
        const headAttach =
          HEAD_ATTACH_MS / Math.max(1, vfxConfig.trailDurationMs);
        const occFactor = occlusionFactor({
          coverage: bodyAtHead?.coverage ?? 0,
          ribbonTracked: head?.z ?? depthSnap.trackedDepth,
          bodyTracked: bodyAtHead?.trackedDepth ?? 0,
          bodyValid: bodyAtHead?.valid ?? false,
          occlusionEnabled: vfxConfig.occlusionEnabled,
          calibrated: sceneDepth.isReady(),
          hasMask: Boolean(bodyAtHead),
          bias: vfxConfig.occlusionDepthBias,
          softness: vfxConfig.occlusionSoftness,
          segThreshold: vfxConfig.segmentationThreshold,
          headLife: 0,
          headAttach: Math.max(0.02, headAttach),
        });
        vfxControls.updateDepthMeter(
          depthSnap,
          bodyAtHead
            ? formatOcclusionDebug({
                coverage: bodyAtHead.coverage,
                ribbonTracked: head?.z ?? depthSnap.trackedDepth,
                bodyTracked: bodyAtHead.trackedDepth,
                delta:
                  (head?.z ?? depthSnap.trackedDepth) - bodyAtHead.trackedDepth,
                occlusionFactor: occFactor,
                valid: bodyAtHead.valid,
              })
            : "Occ coverage: —",
        );
        if (ribbonRenderer && video.videoWidth > 0 && video.videoHeight > 0) {
          ribbonRenderer.resize(
            video.videoWidth,
            video.videoHeight,
            window.devicePixelRatio || 1,
          );
          ribbonRenderer.render(
            {
              right: buildTrailGeometry(
                visualRight.samples(),
                now,
                video.videoWidth,
                video.videoHeight,
                vfxConfig.trailDurationMs,
              ),
              left: buildTrailGeometry(
                visualLeft.samples(),
                now,
                video.videoWidth,
                video.videoHeight,
                vfxConfig.trailDurationMs,
              ),
            },
            now,
            vfxConfig,
          );
        }

        let overlayDrawn = false;
        if (visibility.skeleton && lastPoseResult) {
          drawPose(overlayCanvas, video, lastPoseResult);
          overlayDrawn = true;
        }
        if (vfxConfig.segmentationDebug || vfxConfig.bodyDepthDebug) {
          drawOcclusionDebug(overlayCanvas, video, {
            mask: lastPersonMask(),
            field: bodyDepth.last(),
            segmentationDebug: vfxConfig.segmentationDebug,
            bodyDepthDebug: vfxConfig.bodyDepthDebug,
            clear: !overlayDrawn,
          });
          overlayDrawn = true;
        }
        if (vfxConfig.strokeDebug) {
          drawStrokeDebug(
            overlayCanvas,
            video,
            [...visualRight.strokeStarts(), ...visualLeft.strokeStarts()],
            !overlayDrawn,
          );
          overlayDrawn = true;
        }

        if (visibility.tracking) {
          const samples = visualRight.samples();
          const filtered = samples[samples.length - 1] ?? null;
          const jump = visualRight.jumpDebug();
          const ribbonStats = ribbonRenderer?.stats();
          const snapshot = {
            raw: lastRawWrist,
            filtered: filtered
              ? { x: filtered.x, y: filtered.y }
              : null,
            head: ribbonRenderer?.lastHead() ?? null,
            visibility: lastVisibility,
            visionFps: visionTimes.length,
            renderFps: renderTimes.length,
            ribbonVertices: ribbonStats?.vertexCount ?? 0,
            bloomWidth: ribbonStats?.bloomWidth ?? 0,
            bloomHeight: ribbonStats?.bloomHeight ?? 0,
            width: video.videoWidth,
            height: video.videoHeight,
            jumpClamped: jump.clamped,
            jumpRequested: jump.requested,
            jumpAllowed: jump.allowed,
          };
          drawTrackingDebug(
            overlayCanvas,
            video,
            snapshot,
            !overlayDrawn,
          );
          debugEl.textContent =
            formatTrackingDebug(snapshot) +
            "\n" +
            formatDepthDebug({
              ...depthSnap,
              ...ribbonPerspectiveFromTracked(
                depthSnap.trackedDepth,
                vfxConfig,
              ),
            }) +
            (bodyAtHead
              ? "\n" +
                formatOcclusionDebug({
                  coverage: bodyAtHead.coverage,
                  ribbonTracked: head?.z ?? depthSnap.trackedDepth,
                  bodyTracked: bodyAtHead.trackedDepth,
                  delta:
                    (head?.z ?? depthSnap.trackedDepth) -
                    bodyAtHead.trackedDepth,
                  occlusionFactor: occFactor,
                  valid: bodyAtHead.valid,
                })
              : "") +
            "\n" +
            formatContinuityDebug(
              visualRight.continuityDebug(),
              visualRight.strokeCount(),
            );
        }

        if (visibility.energySwipe) {
          energySwipe.draw(effectsCanvas, video, now);
        }
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    } catch (error) {
      startButton.disabled = false;
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Camera error: ${message}`);
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Failed to load pose model: ${message}`);
});
