export type FrameTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

function attachTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
}

export function createFrameTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): FrameTarget {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  if (!framebuffer || !texture) {
    if (framebuffer) {
      gl.deleteFramebuffer(framebuffer);
    }
    if (texture) {
      gl.deleteTexture(texture);
    }
    throw new Error("Failed to create framebuffer target.");
  }

  attachTexture(gl, texture, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`Framebuffer incomplete: ${status}`);
  }

  return { framebuffer, texture, width: w, height: h };
}

export function disposeFrameTarget(
  gl: WebGL2RenderingContext,
  target: FrameTarget | null,
): void {
  if (!target) {
    return;
  }
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

export function ensureFrameTarget(
  gl: WebGL2RenderingContext,
  current: FrameTarget | null,
  width: number,
  height: number,
): FrameTarget {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (current && current.width === w && current.height === h) {
    return current;
  }
  disposeFrameTarget(gl, current);
  return createFrameTarget(gl, w, h);
}
