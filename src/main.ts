import "./style.css";
import { drawAura } from "./aura.ts";
import { startCamera } from "./camera.ts";
import { createEnergySwipeEffect } from "./energy-swipe.ts";
import { drawPose } from "./overlay.ts";
import {
  copyPoseLandmarks,
  createPoseLandmarker,
  detectPose,
} from "./pose.ts";
import {
  createHandLandmarker,
  createVisionTiming,
  detectHands,
  toRawHands,
} from "./hands.ts";
import { createHandsTracker, type HandState } from "./hand-state.ts";
import { drawHandDebug, formatHandsDebug } from "./hand-debug.ts";
import { lastPersonMask, updatePersonMask } from "./segmentation.ts";
import { isWasmFault, nextVideoTimestamp } from "./vision-runtime.ts";
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
import { createRibbonRenderer, type RibbonPass } from "./webgl/ribbon-renderer.ts";
import {
  createRibbonVfxConfig,
  INDEX_TRAIL_COLORS,
  RIGHT_INDEX_TRAIL_COLORS,
} from "./webgl/visual.ts";
import {
  createWristTrail,
  LEFT_WRIST_INDEX,
  RIGHT_WRIST_INDEX,
} from "./wrist-history.ts";
import { createMotionAnalyzer, type MotionSnapshot } from "./motion.ts";
import {
  createVisualTrajectory,
  FINGER_JUMP_DISTANCE,
  FINGER_SMOOTHING_TAU_MS,
} from "./visual-trajectory.ts";

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
const visualLeftIndex = createVisualTrajectory(sceneDepth, {
  smoothingTauMs: FINGER_SMOOTHING_TAU_MS,
  jumpDistance: FINGER_JUMP_DISTANCE,
});
const visualRightIndex = createVisualTrajectory(sceneDepth, {
  smoothingTauMs: FINGER_SMOOTHING_TAU_MS,
  jumpDistance: FINGER_JUMP_DISTANCE,
});
const bodyDepth = createBodyDepthField();
const handsTracker = createHandsTracker(sceneDepth);
const motionAnalyzer = createMotionAnalyzer();
const energySwipe = createEnergySwipeEffect();
const ribbonRenderer = createRibbonRenderer(ribbonCanvas);

type IndexTrajectory = ReturnType<typeof createVisualTrajectory>;

function driveIndexTrail(
  trajectory: IndexTrajectory,
  hand: HandState | null,
  enabled: boolean,
  lastTs: { value: number },
  now: number,
): void {
  if (!enabled) {
    lastTs.value = -1;
    return;
  }
  if (hand?.tracked) {
    const tip = hand.fingertips.index;
    if (hand.timestamp !== lastTs.value) {
      lastTs.value = hand.timestamp;
      trajectory.update({
        x: tip.x,
        y: tip.y,
        trackedDepth: tip.trackedDepth,
        t: hand.timestamp,
        visibility: hand.confidence,
      });
    } else {
      trajectory.prune(now);
    }
    return;
  }
  trajectory.noteMissedFrame(now, hand?.confidence ?? 0);
}
function applyContinuityThresholds(): void {
  const thresholds = {
    minVisibility: vfxConfig.minContinuityVisibility,
    maxGapMs: vfxConfig.continuityGapMs,
    maxReacquireDistancePx: vfxConfig.continuityReacquirePx,
  };
  visualRight.setContinuityThresholds(thresholds);
  visualLeft.setContinuityThresholds(thresholds);
  visualLeftIndex.setContinuityThresholds(thresholds);
  visualRightIndex.setContinuityThresholds(thresholds);
  handsTracker.setContinuityThresholds(thresholds);
}

function applyHandSettings(): void {
  handsTracker.setSwapHandedness(vfxConfig.swapHandedness);
  handsTracker.setMinConfidence(vfxConfig.minHandConfidence);
  handsTracker.setDepthGains({
    scaleDepthGain: vfxConfig.handScaleDepthGain,
    localZGain: vfxConfig.handLocalZGain,
  });
  if (!vfxConfig.handsEnabled) {
    // Turning hand tracking off must not leave a stale hand behind.
    handsTracker.noteMissedFrame(performance.now());
    visualLeftIndex.clear();
    visualRightIndex.clear();
  }
  if (!vfxConfig.leftIndexTrail) {
    visualLeftIndex.clear();
  }
  if (!vfxConfig.rightIndexTrail) {
    visualRightIndex.clear();
  }
  if (!vfxConfig.wristTrail) {
    visualRight.clear();
    visualLeft.clear();
  }
}

const leftIndexTrailToggle =
  document.querySelector<HTMLButtonElement>("#toggle-left-index-trail")!;
const rightIndexTrailToggle =
  document.querySelector<HTMLButtonElement>("#toggle-right-index-trail")!;
const wristTrailToggle =
  document.querySelector<HTMLButtonElement>("#toggle-wrist-trail")!;

const vfxControls = createVfxControls({
  config: vfxConfig,
  onChange: () => {
    visualRight.setDurationMs(vfxConfig.trailDurationMs);
    visualLeft.setDurationMs(vfxConfig.trailDurationMs);
    visualLeftIndex.setDurationMs(vfxConfig.trailDurationMs);
    visualRightIndex.setDurationMs(vfxConfig.trailDurationMs);
    applyContinuityThresholds();
    applyHandSettings();
    syncToggle(
      leftIndexTrailToggle,
      "Left Index Trail",
      vfxConfig.leftIndexTrail,
    );
    syncToggle(
      rightIndexTrailToggle,
      "Right Index Trail",
      vfxConfig.rightIndexTrail,
    );
    syncToggle(wristTrailToggle, "Wrist Trail", vfxConfig.wristTrail);
    if (sceneDepth.setInvertZ(vfxConfig.invertZ)) {
      visualRight.handleSceneInvert();
      visualLeft.handleSceneInvert();
      visualLeftIndex.handleSceneInvert();
      visualRightIndex.handleSceneInvert();
      handsTracker.handleSceneInvert();
    }
  },
  onRecalibrate: () => {
    sceneDepth.recalibrate();
    visualRight.handleSceneRecalibrate();
    visualLeft.handleSceneRecalibrate();
    visualLeftIndex.handleSceneRecalibrate();
    visualRightIndex.handleSceneRecalibrate();
    handsTracker.handleSceneRecalibrate();
  },
});
visualRight.setDurationMs(vfxConfig.trailDurationMs);
visualLeft.setDurationMs(vfxConfig.trailDurationMs);
visualLeftIndex.setDurationMs(vfxConfig.trailDurationMs);
visualRightIndex.setDurationMs(vfxConfig.trailDurationMs);
applyContinuityThresholds();
applyHandSettings();
syncToggle(leftIndexTrailToggle, "Left Index Trail", vfxConfig.leftIndexTrail);
syncToggle(rightIndexTrailToggle, "Right Index Trail", vfxConfig.rightIndexTrail);
syncToggle(wristTrailToggle, "Wrist Trail", vfxConfig.wristTrail);
let lastSwipeLabel = "—";
let lastMotion: MotionSnapshot | null = null;

const visibility = {
  skeleton: false,
  aura: false,
  energySwipe: false,
  tracking: false,
  hands: false,
};

const skeletonToggle =
  document.querySelector<HTMLButtonElement>("#toggle-skeleton")!;
const auraToggle = document.querySelector<HTMLButtonElement>("#toggle-aura")!;
const energyToggle = document.querySelector<HTMLButtonElement>("#toggle-energy")!;
const trackingToggle =
  document.querySelector<HTMLButtonElement>("#toggle-tracking")!;
const handsToggle = document.querySelector<HTMLButtonElement>("#toggle-hands")!;

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

handsToggle.addEventListener("click", () => {
  visibility.hands = !visibility.hands;
  syncToggle(handsToggle, "Hand Debug", visibility.hands);
  if (!visibility.hands && !visibility.skeleton && !visibility.tracking) {
    clearCanvas(overlayCanvas);
  }
});

leftIndexTrailToggle.addEventListener("click", () => {
  vfxConfig.leftIndexTrail = !vfxConfig.leftIndexTrail;
  syncToggle(leftIndexTrailToggle, "Left Index Trail", vfxConfig.leftIndexTrail);
  vfxControls.syncFromConfig();
  if (!vfxConfig.leftIndexTrail) {
    visualLeftIndex.clear();
  }
});

rightIndexTrailToggle.addEventListener("click", () => {
  vfxConfig.rightIndexTrail = !vfxConfig.rightIndexTrail;
  syncToggle(
    rightIndexTrailToggle,
    "Right Index Trail",
    vfxConfig.rightIndexTrail,
  );
  vfxControls.syncFromConfig();
  if (!vfxConfig.rightIndexTrail) {
    visualRightIndex.clear();
  }
});

wristTrailToggle.addEventListener("click", () => {
  vfxConfig.wristTrail = !vfxConfig.wristTrail;
  syncToggle(wristTrailToggle, "Wrist Trail", vfxConfig.wristTrail);
  vfxControls.syncFromConfig();
  if (!vfxConfig.wristTrail) {
    visualRight.clear();
    visualLeft.clear();
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
  setStatus("Loading vision models…");
  let handModelError: string | null = null;
  // One wasm ModuleFactory at a time: pose first, then hands.
  let poseLandmarker: Awaited<ReturnType<typeof createPoseLandmarker>> | null =
    await createPoseLandmarker();
  let handLandmarker = await createHandLandmarker().catch((error: unknown) => {
    handModelError = error instanceof Error ? error.message : String(error);
    console.error("Hand landmarker unavailable:", error);
    return null;
  });
  setStatus(
    handLandmarker
      ? "Vision models ready. Click Start camera."
      : "Pose model ready (hand model unavailable). Click Start camera.",
  );
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
      let lastPoseOverlay: ReturnType<typeof copyPoseLandmarks> | null = null;
      let lastRawWrist: { x: number; y: number } | null = null;
      let lastVisibility = 0;
      const visionTimes: number[] = [];
      const renderTimes: number[] = [];
      const poseTiming = createVisionTiming();
      const handTiming = createVisionTiming();
      let visionFrameIndex = 0;
      let handsDue = false;
      let handsStarved = false;
      let lastPoseTs = -1;
      let lastHandTs = -1;
      const lastLeftIndexTs = { value: -1 };
      const lastRightIndexTs = { value: -1 };
      let handTicks = 0;
      let handRawCount = 0;
      let poseFault: string | null = null;
      let handFault: string | null = null;
      let stage = "idle";

      const disablePose = (error: unknown): void => {
        poseFault = error instanceof Error ? error.message : String(error);
        poseLandmarker = null;
        console.error("Pose landmarker wasm fault:", error);
      };

      const disableHands = (error: unknown): void => {
        handFault = error instanceof Error ? error.message : String(error);
        handLandmarker = null;
        handsTracker.noteMissedFrame(performance.now());
        console.error("Hand landmarker wasm fault:", error);
      };

      const applyPoseResult = (
        result: Parameters<typeof copyPoseLandmarks>[0],
        timestampMs: number,
      ): void => {
        const mask = updatePersonMask(result);
        const overlay = copyPoseLandmarks(result);
        lastPoseOverlay = overlay;
        const landmarks = overlay.landmarks[0];
        if (visibility.aura) {
          drawAura(auraCanvas, video, mask?.canvas ?? null);
        }
        const field = bodyDepth.update(
          landmarks,
          mask,
          sceneDepth,
          vfxConfig.bodyInfluenceRadius,
        );
        ribbonRenderer?.setOcclusionSources(
          mask,
          field,
          sceneDepth.isReady(),
        );
        wristTrail.update(landmarks, timestampMs);
        const rightWrist = landmarks?.[RIGHT_WRIST_INDEX];
        const leftWrist = landmarks?.[LEFT_WRIST_INDEX];
        visualRight.setViewport(video.videoWidth, video.videoHeight);
        visualLeft.setViewport(video.videoWidth, video.videoHeight);
        visualLeftIndex.setViewport(video.videoWidth, video.videoHeight);
        visualRightIndex.setViewport(video.videoWidth, video.videoHeight);
        const minVisibility = vfxConfig.minContinuityVisibility;
        if (rightWrist && rightWrist.visibility >= minVisibility) {
          lastRawWrist = { x: rightWrist.x, y: rightWrist.y };
          lastVisibility = rightWrist.visibility;
          if (vfxConfig.wristTrail) {
            visualRight.update({
              x: rightWrist.x,
              y: rightWrist.y,
              z: rightWrist.z,
              t: timestampMs,
              visibility: rightWrist.visibility,
            });
          }
        } else {
          lastRawWrist = null;
          lastVisibility = rightWrist?.visibility ?? 0;
          if (vfxConfig.wristTrail) {
            visualRight.noteMissedFrame(timestampMs, lastVisibility);
          }
        }
        if (leftWrist && leftWrist.visibility >= minVisibility) {
          if (vfxConfig.wristTrail) {
            visualLeft.update({
              x: leftWrist.x,
              y: leftWrist.y,
              z: leftWrist.z,
              t: timestampMs,
              visibility: leftWrist.visibility,
            });
          }
        } else if (vfxConfig.wristTrail) {
          visualLeft.noteMissedFrame(timestampMs, leftWrist?.visibility ?? 0);
        }
        const motion = motionAnalyzer.analyze(wristTrail.samples(), timestampMs);
        lastMotion = motion;
        if (!visibility.tracking) {
          updateMotionDebug(motion);
        }
        if (visibility.energySwipe && motion.event) {
          energySwipe.spawn(motion.event);
        }
      };

      const runPose = (now: number): void => {
        if (!poseLandmarker || video.videoWidth === 0) {
          return;
        }
        const timestampMs = nextVideoTimestamp(lastPoseTs, now);
        lastPoseTs = timestampMs;
        const poseStarted = performance.now();
        stage = "pose detect";
        try {
          detectPose(poseLandmarker, video, timestampMs, (result) => {
            stage = "pose callback";
            poseTiming.note(performance.now() - poseStarted, timestampMs);
            visionTimes.push(timestampMs);
            while (
              visionTimes.length > 0 &&
              visionTimes[0] < timestampMs - 1000
            ) {
              visionTimes.shift();
            }
            applyPoseResult(result, timestampMs);
          });
        } catch (error) {
          if (isWasmFault(error)) {
            disablePose(error);
            return;
          }
          throw error;
        }
      };

      const runHands = (now: number): void => {
        if (!handLandmarker || video.videoWidth === 0) {
          return;
        }
        const timestampMs = nextVideoTimestamp(lastHandTs, now);
        lastHandTs = timestampMs;
        handTicks += 1;
        stage = "hands detect";
        let detection;
        try {
          detection = detectHands(handLandmarker, video, timestampMs);
        } catch (error) {
          handsTracker.noteMissedFrame(timestampMs);
          if (isWasmFault(error)) {
            disableHands(error);
            return;
          }
          handFault = error instanceof Error ? error.message : String(error);
          return;
        }
        handRawCount = detection.result.landmarks.length;
        handTiming.note(detection.inferenceMs, timestampMs);
        handsTracker.setViewport(video.videoWidth, video.videoHeight);
        handsTracker.update(
          toRawHands(detection.result),
          lastPoseOverlay?.landmarks[0],
          timestampMs,
        );
      };

      const frame = (): void => {
        stage = "frame start";
        const now = performance.now();
        renderTimes.push(now);
        while (renderTimes.length > 0 && renderTimes[0] < now - 1000) {
          renderTimes.shift();
        }
        while (visionTimes.length > 0 && visionTimes[0] < now - 1000) {
          visionTimes.shift();
        }

        const newFrame = video.currentTime !== lastVideoTime;
        if (newFrame) {
          lastVideoTime = video.currentTime;
          visionFrameIndex += 1;
          const cadence = Math.max(1, Math.round(vfxConfig.handCadence));
          if (
            handLandmarker &&
            vfxConfig.handsEnabled &&
            visionFrameIndex % cadence === 0
          ) {
            handsDue = true;
          }
        }

        // At most one detectForVideo per animation frame. Hands take an idle
        // tick, or steal one pose slot if the camera never skips a frame.
        if (
          handsDue &&
          handLandmarker &&
          vfxConfig.handsEnabled &&
          (!newFrame || handsStarved)
        ) {
          runHands(now);
          handsDue = false;
          handsStarved = false;
        } else if (newFrame && poseLandmarker) {
          runPose(now);
          if (handsDue) {
            handsStarved = true;
          }
        }

        const handsState = handsTracker.snapshot();
        driveIndexTrail(
          visualLeftIndex,
          handsState.left,
          vfxConfig.leftIndexTrail,
          lastLeftIndexTs,
          now,
        );
        driveIndexTrail(
          visualRightIndex,
          handsState.right,
          vfxConfig.rightIndexTrail,
          lastRightIndexTs,
          now,
        );

        visualRight.setDurationMs(vfxConfig.trailDurationMs);
        visualLeft.setDurationMs(vfxConfig.trailDurationMs);
        visualLeftIndex.setDurationMs(vfxConfig.trailDurationMs);
        visualRightIndex.setDurationMs(vfxConfig.trailDurationMs);
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
          const passes: RibbonPass[] = [];
          if (vfxConfig.wristTrail) {
            passes.push(
              {
                strokes: buildTrailGeometry(
                  visualRight.samples(),
                  now,
                  video.videoWidth,
                  video.videoHeight,
                  vfxConfig.trailDurationMs,
                ),
                captureHead: true,
              },
              {
                strokes: buildTrailGeometry(
                  visualLeft.samples(),
                  now,
                  video.videoWidth,
                  video.videoHeight,
                  vfxConfig.trailDurationMs,
                ),
              },
            );
          }
          if (vfxConfig.leftIndexTrail) {
            passes.push({
              strokes: buildTrailGeometry(
                visualLeftIndex.samples(),
                now,
                video.videoWidth,
                video.videoHeight,
                vfxConfig.trailDurationMs,
              ),
              widthScale: vfxConfig.indexWidthScale,
              ...INDEX_TRAIL_COLORS,
            });
          }
          if (vfxConfig.rightIndexTrail) {
            passes.push({
              strokes: buildTrailGeometry(
                visualRightIndex.samples(),
                now,
                video.videoWidth,
                video.videoHeight,
                vfxConfig.trailDurationMs,
              ),
              widthScale: vfxConfig.indexWidthScale,
              ...RIGHT_INDEX_TRAIL_COLORS,
            });
          }
          if (passes.length > 0 && !passes.some((pass) => pass.captureHead)) {
            passes[0].captureHead = true;
          }
          ribbonRenderer.render(passes, now, vfxConfig);
        }

        let overlayDrawn = false;
        if (visibility.skeleton && lastPoseOverlay) {
          drawPose(overlayCanvas, video, lastPoseOverlay);
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
            [
              ...visualRight.strokeStarts(),
              ...visualLeft.strokeStarts(),
              ...visualLeftIndex.strokeStarts(),
              ...visualRightIndex.strokeStarts(),
            ],
            !overlayDrawn,
          );
          overlayDrawn = true;
        }
        if (visibility.hands) {
          drawHandDebug(overlayCanvas, video, handsState, {
            showNormal: vfxConfig.handNormalDebug,
            clear: !overlayDrawn,
            note: !handLandmarker
              ? handFault
                ? `HANDS: wasm fault — using pose only`
                : "HANDS: model unavailable"
              : !vfxConfig.handsEnabled
                ? "HANDS: tracking off"
                : poseFault
                  ? "POSE: wasm fault — hands only"
                  : null,
            diagnostic: `raw ${handRawCount} · ticks ${handTicks}`,
            showLeftIndexSource: vfxConfig.leftIndexTrail,
            showRightIndexSource: vfxConfig.rightIndexTrail,
          });
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
            ) +
            `\nPose: ${poseTiming.snapshot(now).inferenceMs.toFixed(1)} ms` +
            " (call to callback)\n" +
            (handLandmarker
              ? formatHandsDebug(
                  handsState,
                  handTiming.snapshot(now),
                  `ticks: ${handTicks}  raw: ${handRawCount}`,
                )
              : handFault
                ? `Hands: wasm fault — using pose only\n${handFault}`
                : `Hands: model unavailable (${handModelError ?? "unknown"})`) +
            (poseFault ? `\nPose: wasm fault — ${poseFault}` : "");
        }

        if (visibility.energySwipe) {
          energySwipe.draw(effectsCanvas, video, now);
        }
      };

      let loopErrorMessage = "";
      let loopErrorCount = 0;

      /**
       * A throw inside the animation callback would otherwise stop scheduling
       * and freeze every canvas, which looks identical to a dead toggle. Keep
       * the loop running and put the reason where it can be read.
       */
      const tick = (): void => {
        try {
          frame();
        } catch (error) {
          loopErrorCount += 1;
          const message =
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);
          if (isWasmFault(error)) {
            if (stage.startsWith("hands")) {
              disableHands(error);
            } else if (stage.startsWith("pose")) {
              disablePose(error);
            }
          }
          if (message !== loopErrorMessage) {
            loopErrorMessage = message;
            console.error("Render loop error:", error);
          }
          setStatus(`Frame error x${loopErrorCount} @ ${stage} — ${message}`);
          debugEl.textContent =
            `FRAME ERROR x${loopErrorCount}\n` +
            `stage: ${stage}\n${message}`;
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
