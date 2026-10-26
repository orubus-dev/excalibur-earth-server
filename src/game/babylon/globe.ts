/** game/babylon/globe.ts — Earth level: dot-matrix planet, Lagos beacon, dive transition. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { MeshBuilder, Mesh } from '@babylonjs/core/Meshes';
import { PointsCloudSystem } from '@babylonjs/core/Particles';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { LAGOS_ORIGIN } from '@/game/geo';

interface EarthData { dots: Array<[number, number]>; coasts: Array<Array<[number, number]>> }

const R = 100;

function llToV3(lat: number, lon: number, r = R): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export class Globe {
  camera: UniversalCamera;
  private ocean: Mesh;
  private grat: Mesh[] = [];
  private pcs: PointsCloudSystem | null = null;
  private marker: Mesh;
  private pulse: Mesh;
  private sph = { radius: R * 2.6, theta: 3.55, phi: Math.PI / 2.35 };
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinch0 = 0;
  private el: HTMLElement;
  private off: Array<() => void> = [];

  constructor(scene: Scene, el: HTMLElement) {
    this.el = el;
    this.camera = new UniversalCamera('globeCam', new Vector3(0, 0, R * 2.6), scene);
    this.camera.minZ = 0.5;
    this.camera.maxZ = 3000;

    const oceanMat = new StandardMaterial('ocean', scene);
    oceanMat.diffuseColor = new Color3(0.043, 0.14, 0.19);
    oceanMat.specularColor = new Color3(0.35, 0.4, 0.45);
    oceanMat.specularPower = 42;
    this.ocean = MeshBuilder.CreateSphere('ocean', { diameter: R * 2 - 0.8, segments: 40 }, scene);
    this.ocean.material = oceanMat;
    this.ocean.isPickable = false;

    const gm = new StandardMaterial('grat', scene);
    gm.emissiveColor = new Color3(0.17, 0.35, 0.43);
    gm.disableLighting = true;
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(llToV3(lat, lon, R + 0.1));
      const l = MeshBuilder.CreateLines('gratL', { points: pts }, scene);
      l.color = new Color3(0.17, 0.35, 0.43);
      l.isPickable = false;
      this.grat.push(l);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: Vector3[] = [];
      for (let lat = -85; lat <= 85; lat += 4) pts.push(llToV3(lat, lon, R + 0.1));
      const l = MeshBuilder.CreateLines('gratM', { points: pts }, scene);
      l.color = new Color3(0.17, 0.35, 0.43);
      l.isPickable = false;
      this.grat.push(l);
    }

    // land dots
    fetch('/world/earth.json')
      .then(r => r.json())
      .then((d: EarthData) => {
        const pcs = new PointsCloudSystem('land', 2.4, scene);
        pcs.addPoints(d.dots.length, (particle: { idx: number; position: Vector3; color: Color4 }) => {
          const [lon, lat] = d.dots[particle.idx];
          particle.position = llToV3(lat, lon, R + 0.3);
          particle.color = new Color4(1.0, 0.76, 0.48, 0.95);
        });
        pcs.buildMeshAsync().then(() => {
          const m = pcs.mesh;
          if (m) {
            m.material = new StandardMaterial('landM', scene);
            (m.material as StandardMaterial).emissiveColor = new Color3(1, 0.76, 0.48);
            (m.material as StandardMaterial).disableLighting = true;
            (m.material as StandardMaterial).pointSize = 2.6;
          }
        });
        this.pcs = pcs;
      })
      .catch(() => {});

    // Lagos beacon
    const lagosV = llToV3(LAGOS_ORIGIN.lat, LAGOS_ORIGIN.lon, R + 0.5);
    const markerMat = new StandardMaterial('beacon', scene);
    markerMat.emissiveColor = new Color3(1.0, 0.76, 0.48);
    markerMat.disableLighting = true;
    markerMat.backFaceCulling = false;
    this.marker = MeshBuilder.CreateTorus('beaconT', { diameter: 3.4, thickness: 0.28, tessellation: 40 }, scene);
    this.marker.material = markerMat;
    this.marker.position.copyFrom(lagosV);
    this.marker.lookAt(new Vector3(0, 0, 0));
    this.marker.isPickable = false;

    const pulseMat = markerMat.clone('pulseM');
    pulseMat.alpha = 0.5;
    this.pulse = MeshBuilder.CreateTorus('pulseT', { diameter: 7, thickness: 0.18, tessellation: 40 }, scene);
    this.pulse.material = pulseMat;
    this.pulse.position.copyFrom(lagosV);
    this.pulse.lookAt(new Vector3(0, 0, 0));
    this.pulse.isPickable = false;

    this.bindInput();
  }

  private bindInput(): void {
    const el = this.el;
    const down = (e: PointerEvent): void => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; };
    const up = (): void => { this.dragging = false; };
    const move = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.sph.theta -= (e.clientX - this.lastX) * 0.005;
      this.sph.phi = Math.max(0.4, Math.min(2.6, this.sph.phi - (e.clientY - this.lastY) * 0.004));
      this.lastX = e.clientX; this.lastY = e.clientY;
    };
    const wheel = (e: WheelEvent): void => {
      this.sph.radius = Math.max(R * 1.35, Math.min(R * 5.5, this.sph.radius + e.deltaY * 0.4));
    };
    const ts = (e: TouchEvent): void => {
      if (e.touches.length === 2) this.pinch0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    };
    const tm = (e: TouchEvent): void => {
      if (e.touches.length === 2 && this.pinch0 > 0) {
        const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.sph.radius = Math.max(R * 1.35, Math.min(R * 5.5, this.sph.radius * (this.pinch0 / p)));
      }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { passive: true });
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: true });
    this.off.push(() => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
    });
  }

  tick(t: number): void {
    const c = this.camera;
    const { radius, theta, phi } = this.sph;
    c.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    c.setTarget(Vector3.Zero());
    const pulseK = 1 + Math.sin(t * 2.2) * 0.22;
    this.pulse.scaling.setAll(pulseK);
    (this.pulse.material as StandardMaterial).alpha = 0.35 + Math.sin(t * 2.2) * 0.2;
  }

  setVisible(v: boolean): void {
    this.ocean.setEnabled(v);
    for (const g of this.grat) g.setEnabled(v);
    this.marker.setEnabled(v);
    this.pulse.setEnabled(v);
    if (this.pcs?.mesh) this.pcs.mesh.setEnabled(v);
  }

  /** cinematic dive to the beacon; resolves when done */
  dive(): Promise<void> {
    const lagosV = llToV3(LAGOS_ORIGIN.lat, LAGOS_ORIGIN.lon);
    const target = lagosV.scale(1.28);
    const start = this.camera.position.clone();
    const dur = 2100;
    const t0 = performance.now();
    return new Promise(res => {
      const step = (): void => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.camera.position = Vector3.Lerp(start, target, e);
        this.camera.setTarget(lagosV.scale(0.55));
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }

  dispose(): void {
    for (const f of this.off) f();
    this.ocean.dispose();
    for (const g of this.grat) g.dispose();
    this.marker.dispose();
    this.pulse.dispose();
    this.pcs?.dispose();
  }
}
