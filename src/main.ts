import "./style.css";
import { drawAura } from "./aura.ts";
import { startCamera } from "./camera.ts";
import { createEnergySwipeEffect } from "./energy-swipe.ts";
import { drawPose } from "./overlay.ts";
import { createPoseLandmarker, detectPose } from "./pose.ts";
import { updatePersonMask } from "./segmentation.ts";
import { drawTrail } from "./trail.ts";
import { createWristTrail, MIN_VISIBILITY, RIGHT_WRIST_INDEX } from "./wrist-history.ts";
import { createMotionAnalyzer, type MotionSnapshot } from "./motion.ts";
import { createVisualTrajectory } from "./visual-trajectory.ts";

const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const auraCanvas = document.querySelector<HTMLCanvasElement>("#aura")!;
const trailCanvas = document.querySelector<HTMLCanvasElement>("#trail")!;
const effectsCanvas = document.querySelector<HTMLCanvasElement>("#effects")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const debugEl = document.querySelector<HTMLPreElement>("#motion-debug")!;
const wristTrail = createWristTrail();
const visualTrajectory = createVisualTrajectory();
const motionAnalyzer = createMotionAnalyzer();
const energySwipe = createEnergySwipeEffect();
let lastSwipeLabel = "—";

function setStatus(message: string): void {
  statusEl.textContent = message;
}

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
      setStatus("Camera running.");

      let lastVideoTime = -1;
      const tick = (): void => {
        const now = performance.now();
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          detectPose(landmarker, video, now, (result) => {
            const mask = updatePersonMask(result);
            drawAura(auraCanvas, video, mask);
            wristTrail.update(result.landmarks[0], now);
            const wrist = result.landmarks[0]?.[RIGHT_WRIST_INDEX];
            if (wrist && wrist.visibility >= MIN_VISIBILITY) {
              visualTrajectory.update({ x: wrist.x, y: wrist.y, t: now });
            } else {
              visualTrajectory.prune(now);
            }
            const motion = motionAnalyzer.analyze(wristTrail.samples(), now);
            updateMotionDebug(motion);
            if (motion.event) {
              energySwipe.spawn(motion.event);
            }
            drawTrail(trailCanvas, video, visualTrajectory.samples(), now);
            drawPose(overlayCanvas, video, result);
          });
        }
        energySwipe.draw(effectsCanvas, video, now);
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
