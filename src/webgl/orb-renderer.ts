import { TRACKED_DEPTH_PACK_RANGE } from "../body-depth.ts";
import {
  compileProgram,
  ORB_FRAGMENT_SHADER,
  ORB_VERTEX_SHADER,
} from "./shaders.ts";
import type { RibbonVfxConfig } from "./visual.ts";

const QUAD_PAD = 2.45;

export type OrbVisual = {
  x: number;
  y: number;
  depth: number;
  displayRadius: number;
  intensity: number;
  charge: number;
  fade: number;
  ageMs: number;
  bloomStrength: number;
};

export type OrbPass = {
  draw(
    orb: OrbVisual,
    nowMs: number,
    videoWidth: number,
    videoHeight: number,
    vfx: RibbonVfxConfig,
    personMask: WebGLTexture,
    bodyDepth: WebGLTexture,
    hasMask: boolean,
    calibrated: boolean,
  ): void;
  dispose(): void;
};

export function createOrbPass(gpu: WebGL2RenderingContext): OrbPass | null {
  let program: WebGLProgram;
  try {
    program = compileProgram(gpu, ORB_VERTEX_SHADER, ORB_FRAGMENT_SHADER);
  } catch (error) {
    console.error("Orb shader failed:", error);
    return null;
  }

  const vao = gpu.createVertexArray();
  const buffer = gpu.createBuffer();
  if (!vao || !buffer) {
    gpu.deleteProgram(program);
    return null;
  }

  const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  gpu.bindVertexArray(vao);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
  gpu.bufferData(gpu.ARRAY_BUFFER, corners, gpu.STATIC_DRAW);
  const aCorner = gpu.getAttribLocation(program, "a_corner");
  gpu.enableVertexAttribArray(aCorner);
  gpu.vertexAttribPointer(aCorner, 2, gpu.FLOAT, false, 0, 0);
  gpu.bindVertexArray(null);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, null);

  const uResolution = gpu.getUniformLocation(program, "u_resolution");
  const uCenter = gpu.getUniformLocation(program, "u_center");
  const uQuadRadius = gpu.getUniformLocation(program, "u_quadRadius");
  const uSphereRadius = gpu.getUniformLocation(program, "u_sphereRadius");
  const uTime = gpu.getUniformLocation(program, "u_time");
  const uIntensity = gpu.getUniformLocation(program, "u_intensity");
  const uCharge = gpu.getUniformLocation(program, "u_charge");
  const uFade = gpu.getUniformLocation(program, "u_fade");
  const uBloomStrength = gpu.getUniformLocation(program, "u_bloomStrength");
  const uDepth = gpu.getUniformLocation(program, "u_depth");
  const uOcclusionEnabled = gpu.getUniformLocation(program, "u_occlusionEnabled");
  const uOcclusionBias = gpu.getUniformLocation(program, "u_occlusionBias");
  const uOcclusionSoftness = gpu.getUniformLocation(
    program,
    "u_occlusionSoftness",
  );
  const uSegThreshold = gpu.getUniformLocation(program, "u_segThreshold");
  const uHasMask = gpu.getUniformLocation(program, "u_hasMask");
  const uCalibrated = gpu.getUniformLocation(program, "u_calibrated");
  const uOcclusionViz = gpu.getUniformLocation(program, "u_occlusionViz");
  const uDepthPackRange = gpu.getUniformLocation(program, "u_depthPackRange");
  const uPersonMask = gpu.getUniformLocation(program, "u_personMask");
  const uBodyDepth = gpu.getUniformLocation(program, "u_bodyDepth");

  return {
    draw(
      orb: OrbVisual,
      _nowMs: number,
      videoWidth: number,
      videoHeight: number,
      vfx: RibbonVfxConfig,
      personMask: WebGLTexture,
      bodyDepth: WebGLTexture,
      hasMask: boolean,
      calibrated: boolean,
    ): void {
      const sphereRadius = Math.max(1, orb.displayRadius);
      gpu.useProgram(program);
      gpu.uniform2f(uResolution, videoWidth, videoHeight);
      gpu.uniform2f(uCenter, orb.x, orb.y);
      gpu.uniform1f(uQuadRadius, sphereRadius * QUAD_PAD);
      gpu.uniform1f(uSphereRadius, sphereRadius);
      gpu.uniform1f(uTime, orb.ageMs * 0.001);
      gpu.uniform1f(uIntensity, orb.intensity);
      gpu.uniform1f(uCharge, orb.charge);
      gpu.uniform1f(uFade, orb.fade);
      gpu.uniform1f(uBloomStrength, orb.bloomStrength);
      gpu.uniform1f(uDepth, orb.depth);
      gpu.uniform1f(uOcclusionEnabled, vfx.occlusionEnabled ? 1 : 0);
      gpu.uniform1f(uOcclusionBias, vfx.occlusionDepthBias);
      gpu.uniform1f(uOcclusionSoftness, vfx.occlusionSoftness);
      gpu.uniform1f(uSegThreshold, vfx.segmentationThreshold);
      gpu.uniform1f(uHasMask, hasMask ? 1 : 0);
      gpu.uniform1f(uCalibrated, calibrated ? 1 : 0);
      gpu.uniform1f(uOcclusionViz, vfx.occlusionViz ? 1 : 0);
      gpu.uniform1f(uDepthPackRange, TRACKED_DEPTH_PACK_RANGE);
      gpu.uniform1i(uPersonMask, 0);
      gpu.uniform1i(uBodyDepth, 1);
      gpu.activeTexture(gpu.TEXTURE0);
      gpu.bindTexture(gpu.TEXTURE_2D, personMask);
      gpu.activeTexture(gpu.TEXTURE1);
      gpu.bindTexture(gpu.TEXTURE_2D, bodyDepth);
      gpu.bindVertexArray(vao);
      gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, 4);
      gpu.bindVertexArray(null);
      gpu.activeTexture(gpu.TEXTURE1);
      gpu.bindTexture(gpu.TEXTURE_2D, null);
      gpu.activeTexture(gpu.TEXTURE0);
      gpu.bindTexture(gpu.TEXTURE_2D, null);
    },
    dispose(): void {
      gpu.deleteBuffer(buffer);
      gpu.deleteVertexArray(vao);
      gpu.deleteProgram(program);
    },
  };
}
