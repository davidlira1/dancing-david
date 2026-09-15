import {
  disposeFrameTarget,
  ensureFrameTarget,
  type FrameTarget,
} from "./framebuffer.ts";
import {
  BLUR_FRAGMENT_SHADER,
  compileProgram,
  COMPOSITE_FRAGMENT_SHADER,
  FULLSCREEN_VERTEX_SHADER,
} from "./shaders.ts";
import {
  BLOOM_SCALE,
  BLOOM_THRESHOLD,
  hexToRgb,
  type RibbonVfxConfig,
} from "./visual.ts";

export type BloomRenderer = {
  resize(fullWidth: number, fullHeight: number): void;
  size(): { width: number; height: number };
  /** Blur `source` into the internal ping-pong pair. Returns the bloom texture. */
  blur(source: WebGLTexture, radius: number): WebGLTexture;
  composite(
    ribbonTexture: WebGLTexture,
    bloomTexture: WebGLTexture,
    vfx: RibbonVfxConfig,
  ): void;
  dispose(): void;
};

const FULLSCREEN_VERTS = new Float32Array([-1, -1, 3, -1, -1, 3]);

export function createBloomRenderer(
  gl: WebGL2RenderingContext,
): BloomRenderer {
  const blurProgram = compileProgram(
    gl,
    FULLSCREEN_VERTEX_SHADER,
    BLUR_FRAGMENT_SHADER,
  );
  const compositeProgram = compileProgram(
    gl,
    FULLSCREEN_VERTEX_SHADER,
    COMPOSITE_FRAGMENT_SHADER,
  );

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (!vao || !buffer) {
    gl.deleteProgram(blurProgram);
    gl.deleteProgram(compositeProgram);
    throw new Error("Failed to create bloom geometry.");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_VERTS, gl.STATIC_DRAW);

  const blurPosition = gl.getAttribLocation(blurProgram, "a_position");
  const compositePosition = gl.getAttribLocation(compositeProgram, "a_position");
  gl.enableVertexAttribArray(blurPosition);
  gl.vertexAttribPointer(blurPosition, 2, gl.FLOAT, false, 0, 0);
  if (compositePosition >= 0 && compositePosition !== blurPosition) {
    gl.enableVertexAttribArray(compositePosition);
    gl.vertexAttribPointer(compositePosition, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const uSource = gl.getUniformLocation(blurProgram, "u_source");
  const uTexel = gl.getUniformLocation(blurProgram, "u_texel");
  const uDirection = gl.getUniformLocation(blurProgram, "u_direction");
  const uRadius = gl.getUniformLocation(blurProgram, "u_radius");
  const uThreshold = gl.getUniformLocation(blurProgram, "u_threshold");

  const uRibbon = gl.getUniformLocation(compositeProgram, "u_ribbonTexture");
  const uBloom = gl.getUniformLocation(compositeProgram, "u_bloomTexture");
  const uIntensity = gl.getUniformLocation(compositeProgram, "u_bloomIntensity");
  const uTint = gl.getUniformLocation(compositeProgram, "u_bloomTint");

  let ping: FrameTarget | null = null;
  let pong: FrameTarget | null = null;
  let bloomWidth = 1;
  let bloomHeight = 1;

  function drawFullscreen(): void {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function bindTarget(target: FrameTarget): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * One separable Gaussian into `ping` then `pong`.
   * A second, lower-resolution scale can call this with other targets later.
   */
  function separableBlur(
    source: WebGLTexture,
    destA: FrameTarget,
    destB: FrameTarget,
    radius: number,
  ): void {
    gl.disable(gl.BLEND);
    gl.useProgram(blurProgram);
    gl.uniform1i(uSource, 0);
    gl.uniform1f(uRadius, radius);
    gl.uniform1f(uThreshold, BLOOM_THRESHOLD);
    gl.uniform2f(uTexel, 1 / destA.width, 1 / destA.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform2f(uDirection, 1, 0);
    bindTarget(destA);
    drawFullscreen();

    gl.bindTexture(gl.TEXTURE_2D, destA.texture);
    gl.uniform2f(uDirection, 0, 1);
    bindTarget(destB);
    drawFullscreen();

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  return {
    resize(fullWidth: number, fullHeight: number): void {
      bloomWidth = Math.max(1, Math.floor(fullWidth * BLOOM_SCALE));
      bloomHeight = Math.max(1, Math.floor(fullHeight * BLOOM_SCALE));
      ping = ensureFrameTarget(gl, ping, bloomWidth, bloomHeight);
      pong = ensureFrameTarget(gl, pong, bloomWidth, bloomHeight);
    },

    size(): { width: number; height: number } {
      return { width: bloomWidth, height: bloomHeight };
    },

    blur(source: WebGLTexture, radius: number): WebGLTexture {
      if (!ping || !pong) {
        throw new Error("Bloom targets missing; call resize first.");
      }
      separableBlur(source, ping, pong, radius);
      return pong.texture;
    },

    composite(
      ribbonTexture: WebGLTexture,
      bloomTexture: WebGLTexture,
      vfx: RibbonVfxConfig,
    ): void {
      const tint = hexToRgb(vfx.bloomColor);
      gl.disable(gl.BLEND);
      gl.useProgram(compositeProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ribbonTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTexture);
      gl.uniform1i(uRibbon, 0);
      gl.uniform1i(uBloom, 1);
      gl.uniform1f(uIntensity, vfx.bloomIntensity);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      drawFullscreen();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(): void {
      disposeFrameTarget(gl, ping);
      disposeFrameTarget(gl, pong);
      ping = null;
      pong = null;
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(blurProgram);
      gl.deleteProgram(compositeProgram);
    },
  };
}
