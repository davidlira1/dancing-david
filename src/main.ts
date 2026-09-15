import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import "./style.css";
import { drawAura } from "./aura.ts";
import { startCamera } from "./camera.ts";
import { createEnergySwipeEffect } from "./energy-swipe.ts";
import { drawPose } from "./overlay.ts";
import { createPoseLandmarker, detectPose } from "./pose.ts";
import { updatePersonMask } from "./segmentation.ts";
import { buildTrailGeometry } from "./trail.ts";
import {
  drawTrackingDebug,
  formatTrackingDebug,
} from "./tracking-debug.ts";
import { createRibbonRenderer } from "./webgl/ribbon-renderer.ts";
import { createWristTrail, MIN_VISIBILITY, RIGHT_WRIST_INDEX } from "./wrist-history.ts";
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
const visualTrajectory = createVisualTrajectory();
const motionAnalyzer = createMotionAnalyzer();
const energySwipe = createEnergySwipeEffect();
const ribbonRenderer = createRibbonRenderer(ribbonCanvas);
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

      const tick = (): void => {
        const now = performance.now();
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
            if (visibility.aura) {
              const mask = updatePersonMask(result);
              drawAura(auraCanvas, video, mask);
            }
            wristTrail.update(result.landmarks[0], now);
            const wrist = result.landmarks[0]?.[RIGHT_WRIST_INDEX];
            if (wrist && wrist.visibility >= MIN_VISIBILITY) {
              lastRawWrist = { x: wrist.x, y: wrist.y };
              lastVisibility = wrist.visibility;
              visualTrajectory.update({
                x: wrist.x,
                y: wrist.y,
                t: now,
                visibility: wrist.visibility,
              });
            } else {
              lastRawWrist = null;
              lastVisibility = wrist?.visibility ?? 0;
              visualTrajectory.prune(now);
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

        if (ribbonRenderer && video.videoWidth > 0 && video.videoHeight > 0) {
          ribbonRenderer.resize(
            video.videoWidth,
            video.videoHeight,
            window.devicePixelRatio || 1,
          );
          ribbonRenderer.render(
            buildTrailGeometry(
              visualTrajectory.samples(),
              now,
              video.videoWidth,
              video.videoHeight,
            ),
            now,
          );
        }

        if (visibility.skeleton && lastPoseResult) {
          drawPose(overlayCanvas, video, lastPoseResult);
        }

        if (visibility.tracking) {
          const samples = visualTrajectory.samples();
          const filtered = samples[samples.length - 1] ?? null;
          const jump = visualTrajectory.jumpDebug();
          const snapshot = {
            raw: lastRawWrist,
            filtered: filtered
              ? { x: filtered.x, y: filtered.y }
              : null,
            head: ribbonRenderer?.lastHead() ?? null,
            visibility: lastVisibility,
            visionFps: visionTimes.length,
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
            !visibility.skeleton,
          );
          debugEl.textContent = formatTrackingDebug(snapshot);
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
