/** game/babylon/environment.ts — locked golden hour: sky dome, low sun, warm fog, shadows. */
import { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Materials/standardMaterial';

const SUN_DIR = new Vector3(-0.42, 0.16, -0.89).normalize(); // low, warm, down the boulevard

export class Environment {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  shadows: ShadowGenerator;
  sunDisc: Mesh;
  private dome: Mesh;
  private glow: Mesh;
  private sunAnchor = new Vector3(0, 0, 0);

  constructor(scene: Scene, isMobile: boolean) {
    scene.clearColor = new Color4(0.55, 0.38, 0.25, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.93, 0.66, 0.42);
    scene.fogDensity = isMobile ? 0.0042 : 0.0032;
    scene.ambientColor = new Color3(0.35, 0.28, 0.24);

    // ---- gradient sky dome (vertex colors) -------------------------------
    const R = 900;
    const dome = MeshBuilder.CreateSphere('sky', { diameter: R * 2, segments: 16 }, scene);
    dome.isPickable = false;
    dome.infiniteDistance = false;
    const pos = dome.getVerticesData(VertexBuffer.PositionKind)!;
    const cols: number[] = [];
    const top = new Color3(0.19, 0.30, 0.52);
    const mid = new Color3(0.83, 0.52, 0.30);
    const hor = new Color3(1.0, 0.72, 0.42);
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1] / R; // -1..1
      let c: Color3;
      if (y > 0.25) c = Color3.Lerp(mid, top, Math.min(1, (y - 0.25) / 0.75));
      else c = Color3.Lerp(hor, mid, Math.max(0, Math.min(1, (y + 0.15) / 0.4)));
      cols.push(c.r, c.g, c.b);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = dome.getIndices();
    vd.colors = cols;
    vd.applyToMesh(dome);
    const domeMat = new StandardMaterial('skyMat', scene);
    domeMat.emissiveColor = new Color3(1, 1, 1);
    domeMat.diffuseColor = Color3.Black();
    domeMat.specularColor = Color3.Black();
    domeMat.disableLighting = true;
    domeMat.backFaceCulling = false;
    domeMat.fogEnabled = false;
    dome.material = domeMat;
    dome.applyFog = false;
    this.dome = dome;

    // ---- lights ----------------------------------------------------------
    this.hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    this.hemi.intensity = 0.62;
    this.hemi.diffuse = new Color3(0.62, 0.58, 0.55);
    this.hemi.groundColor = new Color3(0.55, 0.36, 0.22);

    this.sun = new DirectionalLight('sun', SUN_DIR.scale(-1), scene);
    this.sun.diffuse = new Color3(1.0, 0.74, 0.46);
    this.sun.specular = new Color3(1.0, 0.82, 0.58);
    this.sun.intensity = 2.6;
    this.sun.shadowMinZ = 8;
    this.sun.shadowMaxZ = 220;
    this.sun.autoUpdateExtends = false;

    this.shadows = new ShadowGenerator(isMobile ? 1024 : 2048, this.sun);
    this.shadows.usePercentageCloserFiltering = !isMobile;
    this.shadows.useExponentialShadowMap = isMobile;
    this.shadows.darkness = 0.42;
    this.shadows.bias = 0.008;
    this.shadows.normalBias = 0.02;

    // ---- sun disc + glow --------------------------------------------------
    const disc = MeshBuilder.CreateDisc('sunDisc', { radius: 34, tessellation: 40 }, scene);
    disc.isPickable = false;
    const discMat = new StandardMaterial('sunDiscMat', scene);
    discMat.emissiveColor = new Color3(1.0, 0.86, 0.55);
    discMat.disableLighting = true;
    discMat.fogEnabled = false;
    discMat.backFaceCulling = false;
    discMat.alpha = 0.95;
    disc.material = discMat;
    disc.applyFog = false;
    this.sunDisc = disc;

    const glow = MeshBuilder.CreateDisc('sunGlow', { radius: 150, tessellation: 32 }, scene);
    glow.isPickable = false;
    const glowMat = new StandardMaterial('sunGlowMat', scene);
    glowMat.emissiveColor = new Color3(1.0, 0.62, 0.3);
    glowMat.disableLighting = true;
    glowMat.fogEnabled = false;
    glowMat.backFaceCulling = false;
    glowMat.alpha = 0.32;
    glowMat.alphaMode = 7; // screen-ish
    glow.material = glowMat;
    glow.applyFog = false;
    this.glow = glow;
  }

  /** keep the sky/sun glued near the player so the shadow frustum stays tight */
  follow(px: number, py: number, pz: number): void {
    this.sunAnchor.set(px, py, pz);
    this.dome.position.set(px, 0, pz);
    const sd = SUN_DIR.scale(620);
    this.sunDisc.position.set(px + sd.x, sd.y, pz + sd.z);
    this.sunDisc.lookAt(new Vector3(px, 12, pz));
    this.glow.position.set(px + sd.x * 0.94, sd.y * 0.94, pz + sd.z * 0.94);
    this.glow.lookAt(new Vector3(px, 12, pz));
    // shadow frustum around player
    this.sun.position.set(px - SUN_DIR.x * 130, 60 + py, pz - SUN_DIR.z * 130);
    this.sun.autoCalcShadowZBounds = false;
    const ortho = 90;
    this.sun.orthoLeft = -ortho; this.sun.orthoRight = ortho;
    this.sun.orthoTop = ortho; this.sun.orthoBottom = -ortho;
  }

  /** register shadow casters (call as world builds) */
  addCaster(m: AbstractMesh, _deep = true): void {
    this.shadows.addShadowCaster(m, false);
  }

  dispose(): void {
    this.shadows.dispose();
    this.dome.dispose(); this.sunDisc.dispose(); this.glow.dispose();
  }
}
