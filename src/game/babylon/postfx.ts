/** game/babylon/postfx.ts — cinematic post-processing stack (v0.3 "the look").
 * ACES tone mapping, bloom, subtle DOF, SSAO2 contact shadows (desktop),
 * vignette, animated grain, faint chromatic aberration, FXAA. */
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/postProcessRenderPipelineManagerSceneComponent';

export class PostFX {
  private pipeline: DefaultRenderingPipeline;
  private ssao: SSAO2RenderingPipeline | null = null;
  private isMobile: boolean;
  private focusSmooth = 7;

  constructor(scene: Scene, isMobile: boolean) {
    this.isMobile = isMobile;
    this.pipeline = new DefaultRenderingPipeline('esoCinematic', true, scene, scene.cameras as Camera[], true);

    // tone mapping + color
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    try { ip.toneMappingType = 4; /* ACES */ } catch { /* older core */ }
    ip.exposure = 1.22;
    ip.contrast = 1.32;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.4;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new (Vector3 as unknown as { new(x: number, y: number, z: number): Vector3 })(0, 0, 0) as never;
    try { (ip as unknown as { vignetteCameraFov: number }).vignetteCameraFov = 1.5; } catch { /* optional */ }
    // (brightness folded into exposure)

    // bloom (Lagos golden hour + emissive shopfronts + lamps)
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.72;
    this.pipeline.bloomWeight = isMobile ? 0.32 : 0.46;
    this.pipeline.bloomKernel = isMobile ? 48 : 72;
    this.pipeline.bloomScale = 0.5;

    // DOF — shallow when close on the character, off by default on low-end
    this.pipeline.depthOfFieldEnabled = !isMobile;
    this.pipeline.depthOfFieldBlurLevel = 0; // Low
    if (this.pipeline.depthOfField) {
      this.pipeline.depthOfField.fStop = 5.6;
      this.pipeline.depthOfField.focusDistance = 7000;  // mm
      this.pipeline.depthOfField.focalLength = 42;      // mm
    }

    // grain + FXAA
    this.pipeline.grainEnabled = true;
    try {
      this.pipeline.grain.intensity = isMobile ? 5.5 : 7.5;
      this.pipeline.grain.animated = true;
    } catch { /* optional */ }
    this.pipeline.fxaaEnabled = true;

    // faint chromatic aberration on desktop
    if (this.pipeline.chromaticAberrationEnabled !== undefined) {
      this.pipeline.chromaticAberrationEnabled = true;
      try {
        (this.pipeline.chromaticAberration as unknown as { aberrationAmount: number }).aberrationAmount = isMobile ? 6 : 11;
        (this.pipeline.chromaticAberration as unknown as { radialIntensity: number }).radialIntensity = 0.6;
      } catch { /* optional */ }
    }

    // SSAO2 — desktop only (contact shadows under cars, props, people)
    if (!isMobile) {
      try {
        this.ssao = new SSAO2RenderingPipeline('esoSSAO', scene, 0.72, scene.cameras as Camera[], true);
        this.ssao.totalStrength = 1.15;
        this.ssao.radius = 1.6;
        this.ssao.base = 0.42;
        this.ssao.maxZ = 220;
        this.ssao.samples = 10;
        this.ssao.expensiveBlur = false;

      } catch { this.ssao = null; }
    }
    scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('esoCinematic', scene.cameras as Camera[]);
  }

  /** per-frame update: DOF focus rides the player distance; lighten load when fps dips */
  update(camPos: Vector3, targetPos: Vector3, fps: number): void {
    const d = Vector3.Distance(camPos, targetPos);
    this.focusSmooth += (d - this.focusSmooth) * 0.12;
    if (this.pipeline.depthOfFieldEnabled && this.pipeline.depthOfField) {
      // focusDistance in mm; keep character tack sharp, world melts behind
      this.pipeline.depthOfField.focusDistance = this.focusSmooth * 1000;
      const tight = this.focusSmooth < 9;
      this.pipeline.depthOfField.fStop = tight ? 4.5 : 8.0;
    }
    // adaptive: drop DOF + bloom weight if the device is struggling
    if (fps < 24) {
      if (this.pipeline.depthOfFieldEnabled) this.pipeline.depthOfFieldEnabled = false;
      if (this.pipeline.bloomWeight > 0.25) this.pipeline.bloomWeight = 0.25;
    } else if (fps > 45 && !this.isMobile && !this.pipeline.depthOfFieldEnabled) {
      this.pipeline.depthOfFieldEnabled = true;
    }
  }

  dispose(): void {
    this.ssao?.dispose?.();
    this.pipeline.dispose();
  }
}
