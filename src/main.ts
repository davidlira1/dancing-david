import "./style.css";
import { drawAura } from "./aura.ts";
import { startCamera } from "./camera.ts";
import { drawPose } from "./overlay.ts";
import { createPoseLandmarker, detectPose } from "./pose.ts";
import { updatePersonMask } from "./segmentation.ts";
import { drawTrail } from "./trail.ts";
import { createWristTrail } from "./wrist-history.ts";

const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const auraCanvas = document.querySelector<HTMLCanvasElement>("#aura")!;
const trailCanvas = document.querySelector<HTMLCanvasElement>("#trail")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const wristTrail = createWristTrail();

function setStatus(message: string): void {
  statusEl.textContent = message;
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
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          detectPose(landmarker, video, performance.now(), (result) => {
            const now = performance.now();
            const mask = updatePersonMask(result);
            drawAura(auraCanvas, video, mask);
            wristTrail.update(result.landmarks[0], now);
            drawTrail(trailCanvas, video, wristTrail.samples(), now);
            drawPose(overlayCanvas, video, result);
          });
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
