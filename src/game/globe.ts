/** game/globe.ts — Earth level: dot-matrix planet, coastlines, Lagos beacon, dive transition. */
import * as THREE from 'three';
import { LAGOS_ORIGIN } from './geo';
import { makeGlow } from './textures';

interface EarthData { dots: Array<[number, number]>; coasts: Array<Array<[number, number]>>; }

const R = 100;

function llToV3(lat: number, lon: number, r = R): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export class Globe {
  group = new THREE.Group();
  private marker: THREE.Mesh;
  private pulse: THREE.Sprite;
  private glowTex = makeGlow('#ffc27a');
  camera: THREE.PerspectiveCamera;
  private sph = new THREE.Spherical(R * 2.6, Math.PI / 2.35, 3.55);
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinch0 = 0;
  onEnter?: () => void;
  private el: HTMLElement;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.camera = camera;
    this.el = el;

    // ocean sphere
    const ocean = new THREE.Mesh(
      new THREE.SphereGeometry(R - 0.4, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x0b2431, roughness: 0.35, metalness: 0.6 })
    );
    this.group.add(ocean);

    // graticule (faint)
    const grat = new THREE.Group();
    const gm = new THREE.LineBasicMaterial({ color: 0x2c5a6e, transparent: true, opacity: 0.25 });
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(llToV3(lat, lon, R + 0.1));
      grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -85; lat <= 85; lat += 4) pts.push(llToV3(lat, lon, R + 0.1));
      grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
    }
    this.group.add(grat);

    // land dots + coasts loaded from baked earth.json
    fetch('/world/earth.json')
      .then(r => r.json())
      .then((d: EarthData) => {
        const positions = new Float32Array(d.dots.length * 3);
        d.dots.forEach(([lon, lat], i) => {
          const v = llToV3(lat, lon, R + 0.3);
          positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const dots = new THREE.Points(g, new THREE.PointsMaterial({
          color: 0xffc27a, size: 0.85, sizeAttenuation: true, transparent: true, opacity: 0.9
        }));
        this.group.add(dots);
        void d.coasts; // coastlines stay vector-clean via dots; kept for future detail level
      })
      .catch(() => {});

    // Lagos beacon
    const lagosV = llToV3(LAGOS_ORIGIN.lat, LAGOS_ORIGIN.lon, R + 0.5);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.7, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc27a, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
    );
    this.marker.position.copy(lagosV);
    this.marker.lookAt(0, 0, 0);
    this.group.add(this.marker);
    this.pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pulse.scale.setScalar(9);
    this.pulse.position.copy(lagosV);
    this.group.add(this.pulse);

    scene.add(this.group);
    this.bindInput();
  }

  private bindInput(): void {
    const el = this.el;
    el.addEventListener('pointerdown', e => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      this.sph.theta -= (e.clientX - this.lastX) * 0.005;
      this.sph.phi = Math.max(0.4, Math.min(2.6, this.sph.phi - (e.clientY - this.lastY) * 0.004));
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    el.addEventListener('wheel', e => {
      this.sph.radius = Math.max(R * 1.35, Math.min(R * 5.5, this.sph.radius + e.deltaY * 0.4));
    }, { passive: true });
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 2) this.pinch0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && this.pinch0 > 0) {
        const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.sph.radius = Math.max(R * 1.35, Math.min(R * 5.5, this.sph.radius * (this.pinch0 / p)));
      }
    }, { passive: true });
  }

  tick(t: number): void {
    const p = this.sph.radius / R;
    this.camera.position.setFromSpherical(this.sph);
    this.camera.lookAt(0, 0, 0);
    this.pulse.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.3;
    this.pulse.scale.setScalar(7 + Math.sin(t * 2.2) * 2.4);
    this.marker.scale.setScalar(1 + Math.sin(t * 2.2) * 0.16 * Math.min(1.6, p * 0.5));
  }

  /** cinematic dive from orbit to the beacon (returns when roughly done) */
  async dive(): Promise<void> {
    const lagosV = llToV3(LAGOS_ORIGIN.lat, LAGOS_ORIGIN.lon);
    const target = lagosV.clone().multiplyScalar(1.28);
    const start = this.camera.position.clone();
    const dur = 2.1;
    const t0 = performance.now();
    return new Promise(res => {
      const step = (): void => {
        const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.camera.position.lerpVectors(start, target, e);
        this.camera.lookAt(lagosV.clone().multiplyScalar(0.55));
        this.group.children.forEach(c => {
          const m = (c as THREE.Mesh).material as THREE.Material & { opacity?: number };
          if (m && 'opacity' in m && c !== this.pulse) m.transparent = true, m.opacity = 1 - e * 0.9;
        });
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }

  fadeOut(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) m.geometry?.dispose();
    });
    this.group.removeFromParent();
  }
}
