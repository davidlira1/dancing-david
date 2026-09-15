const GLOW_COLOR = "rgb(255, 240, 200)";
const BLUR_PX = 28;

const silhouette = document.createElement("canvas");
const silhouetteCtx = silhouette.getContext("2d")!;

function sizeToVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

export function drawAura(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  maskCanvas: HTMLCanvasElement | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  sizeToVideo(canvas, video);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!maskCanvas) {
    return;
  }

  sizeToVideo(silhouette, video);
  silhouetteCtx.setTransform(1, 0, 0, 1, 0, 0);
  silhouetteCtx.globalCompositeOperation = "source-over";
  silhouetteCtx.clearRect(0, 0, silhouette.width, silhouette.height);
  silhouetteCtx.drawImage(
    maskCanvas,
    0,
    0,
    silhouette.width,
    silhouette.height,
  );
  silhouetteCtx.globalCompositeOperation = "source-in";
  silhouetteCtx.fillStyle = GLOW_COLOR;
  silhouetteCtx.fillRect(0, 0, silhouette.width, silhouette.height);
  silhouetteCtx.globalCompositeOperation = "source-over";

  ctx.filter = `blur(${BLUR_PX}px)`;
  ctx.drawImage(silhouette, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(silhouette, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}
