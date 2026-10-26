/** game/engine.ts — Excalibur: Earth client engine. Globe -> dive -> Lagos street simulation. */
import * as THREE from 'three';
import { Globe } from './globe';
import { World } from './world';
import { Environment } from './environment';
import { Character, randomPersona } from './character';
import { Citizens, type Citizen } from './citizens';
import { Traffic } from './traffic';
import { seedRng, latLonToLocal } from './geo';
import { LAGOS } from '@/lib/osm';

export type Mode = 'boot' | 'globe' | 'dive' | 'loading' | 'city';

export interface HudState {
  mode: Mode;
  readyPct: number;         // 0..1 city readiness
  clock: string;            // "16:36 WAT"
  location: string;
  nearNpc: string | null;   // name when greetable
  fps: number;
  lat: number; lon: number;
  hint: string;
}

export interface EngineHooks {
  onHud: (s: HudState) => void;
  onNpcTalk: (name: string) => void;
}

const SPAWN = latLonToLocal(LAGOS.lat0, LAGOS.lon0);   // Adeola Odeku-ish, VI

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private env: Environment;
  private globe: Globe;
  private world: World;
  private citizens: Citizens;
  private traffic: Traffic;
  private player: Character;
  private pPos = new THREE.Vector3(SPAWN[0], 0, SPAWN[1]);
  private pHeading = Math.PI;
  private pSpeed = 0;
  private pVy = 0;
  private mode: Mode = 'boot';
  private hooks: EngineHooks;
  private keys = new Set<string>();
  private joy = { x: 0, z: 0 };
  private sprint = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private hudT = 0; private fpsAcc = 0; private fpsN = 0; private fps = 60;
  private camPos = new THREE.Vector3(SPAWN[0], 6, SPAWN[1] + 12);
  private hint = '';
  private hintT = 0;
  private el: HTMLCanvasElement;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, hooks: EngineHooks) {
    this.el = canvas;
    this.hooks = hooks;
    const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: !isMobile, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1200);
    this.camera.position.set(0, R_GLOBE, R_GLOBE * 2.4);

    this.env = new Environment(this.scene, this.camera, this.renderer, isMobile);
    this.env.nightMats.push(this.worldlessWallMat());
    this.globe = new Globe(this.scene, this.camera, canvas.parentElement ?? canvas);
    this.world = new World(this.scene);
    // register shared materials for night sync
    (this.world.mats as unknown as { wallMat: THREE.MeshStandardMaterial }).wallMat.userData.nightMax = 1.2;
    this.env.nightMats.push(this.world.mats.wallMat);
    this.citizens = new Citizens(this.scene, this.world);
    this.traffic = new Traffic(this.scene, this.world);

    this.player = new Character(randomPersona(seedRng('player'), 'You'));
    const pShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    pShadow.rotation.x = -Math.PI / 2;
    pShadow.position.y = 0.015;
    this.player.root.add(pShadow);
    this.player.root.position.copy(this.pPos);
    this.player.root.visible = false;
    this.scene.add(this.player.root);

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.world.onFirstChunks = () => {
      if (this.mode === 'loading') this.setMode('city');
      // snap the player onto the nearest real street (spawn-on-street)
      const near = this.world.nearestRoad(this.pPos.x, this.pPos.z);
      if (near && Math.hypot(near.pt[0] - this.pPos.x, near.pt[1] - this.pPos.z) > 6) {
        this.pPos.x = near.pt[0] + near.dir[1] * 3.4;
        this.pPos.z = near.pt[1] - near.dir[0] * 3.4;
        this.camPos.set(this.pPos.x, 4, this.pPos.z + 8);
      }
    };
    this.setMode('globe');
    this.loop();
    // e2e/debug handle
    (window as unknown as { __ee?: Engine }).__ee = this;
  }

  private worldlessWallMat(): THREE.MeshStandardMaterial {
    // placeholder material so night sync list is never empty pre-world
    return new THREE.MeshStandardMaterial({ emissive: 0x000000, emissiveIntensity: 0 });
  }

  /* ---------- public API (React) ---------- */
  setJoystick(x: number, z: number): void { this.joy.x = x; this.joy.z = z; }
  setSprint(v: boolean): void { this.sprint = v; }
  jump(): void { if (this.mode === 'city' && this.pPos.y <= 0.001) this.pVy = 7.2; }
  requestEnter(): void { if (this.mode === 'globe') void this.enterCity(); }
  get currentMode(): Mode { return this.mode; }

  private setMode(m: Mode): void {
    this.mode = m;
    this.pushHud();
  }

  async enterCity(): Promise<void> {
    if (this.mode !== 'globe') return;
    this.setMode('dive');
    await this.globe.dive();
    this.globe.fadeOut();
    this.setMode('loading');
    this.player.root.visible = true;
    this.hint = 'Streaming Lagos — real streets from Earth data';
    this.hintT = 6;
    // watchdog: never trap the player on the loading screen
    window.setTimeout(() => {
      if (!this.disposed && this.mode === 'loading') this.setMode('city');
    }, 6000);
  }

  /* ---------- input ---------- */
  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.jump();
    if (e.code === 'Enter') this.requestEnter();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };

  private resize = (): void => {
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.env.setSize(w, h);
  };

  /* ---------- main loop ---------- */
  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

    if (this.mode === 'globe' || this.mode === 'boot') {
      this.globe.tick(t);
      this.env.tick(0, 0, 0, this.renderer);
    } else if (this.mode === 'dive') {
      this.globe.tick(t);
    } else if (this.mode === 'loading' || this.mode === 'city') {
      this.cityTick(dt, t);
    }
    this.env.render(this.renderer, this.scene, this.camera);

    // hud @ ~8Hz
    this.hudT += dt;
    if (this.hudT > 0.125) {
      this.hudT = 0;
      if (this.hintT > 0) { this.hintT -= 0.125; if (this.hintT <= 0) this.hint = ''; }
      this.pushHud();
    }
  };

  private cityTick(dt: number, t: number): void {
    // streaming
    this.world.update(this.pPos.x, this.pPos.z);

    // input vector (keyboard OR joystick)
    let ix = this.joy.x, iz = this.joy.z;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sprint;
    const mag = Math.min(1, Math.hypot(ix, iz));
    const running = shift && mag > 0.1;
    const targetSpeed = mag * (running ? 6.4 : 2.6);

    // heading + motion (camera-relative)
    if (mag > 0.06) {
      const camF = new THREE.Vector3();
      this.camera.getWorldDirection(camF); camF.y = 0; camF.normalize();
      const camR = new THREE.Vector3(camF.z, 0, -camF.x);
      const dir = new THREE.Vector3().addScaledVector(camF, -iz).addScaledVector(camR, ix).normalize();
      this.pHeading = Math.atan2(dir.x, dir.z);
      this.pSpeed += (targetSpeed - this.pSpeed) * Math.min(1, dt * 10);
    } else {
      this.pSpeed += (0 - this.pSpeed) * Math.min(1, dt * 14);
    }

    // physics
    const nx = this.pPos.x + Math.sin(this.pHeading) * this.pSpeed * dt;
    const nz = this.pPos.z + Math.cos(this.pHeading) * this.pSpeed * dt;
    const [cx, cz] = this.world.collide(nx, nz, 0.42);
    this.pPos.x = cx; this.pPos.z = cz;
    this.pVy -= 18 * dt;
    this.pPos.y = Math.max(0, this.pPos.y + this.pVy * dt);
    if (this.pPos.y === 0) this.pVy = 0;

    this.player.root.position.copy(this.pPos);
    this.player.root.rotation.y = this.pHeading;
    this.player.animate(this.pSpeed, dt, this.pPos.y <= 0.001);

    // third-person camera spring
    const camDist = running ? 7.6 : 6.4;
    const camH = 3.0 + Math.min(1.4, this.pSpeed * 0.16);
    const desired = new THREE.Vector3(
      this.pPos.x - Math.sin(this.pHeading) * camDist,
      this.pPos.y + camH,
      this.pPos.z - Math.cos(this.pHeading) * camDist
    );
    this.camPos.lerp(desired, Math.min(1, dt * (this.mode === 'loading' ? 1.2 : 4.5)));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pPos.x, this.pPos.y + 1.5, this.pPos.z);

    // world life
    this.env.tick(dt, this.pPos.x, this.pPos.z, this.renderer);
    this.traffic.tick(this.pPos.x, this.pPos.z, this.env);
    const near = this.citizens.tick(this.pPos.x, this.pPos.z, this.env.night);
    if (near && this.mode === 'city' && !near.greeted) {
      near.greeted = true;
      this.hint = `${near.persona.name} is nearby — tap TALK`;
      this.hintT = 3.4;
    }
    void t;
  }

  nearestNpc(): Citizen | null {
    let best: Citizen | null = null, bd = 4.2;
    for (const c of this.citizens.list) {
      const d = Math.hypot(c.pos.x - this.pPos.x, c.pos.z - this.pPos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /* ---------- hud ---------- */
  private pushHud(): void {
    const h = Math.floor(this.env.hour);
    const m = Math.floor((this.env.hour - h) * 60);
    const [lat, lon] = this.pPos ? latLonReverse(this.pPos.x, this.pPos.z) : [LAGOS.lat0, LAGOS.lon0];
    const near = this.mode === 'city' ? this.nearestNpc() : null;
    const ready = Math.min(1, this.world.readyCount / 26);
    this.hooks.onHud({
      mode: this.mode,
      readyPct: this.mode === 'loading' || this.mode === 'city' ? ready : 0,
      clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} WAT`,
      location: 'Victoria Island · Lagos · Earth Server 1',
      nearNpc: near && (Math.hypot(near.pos.x - this.pPos.x, near.pos.z - this.pPos.z) < 3.4) ? near.persona.name : null,
      fps: this.fps,
      lat: +lat.toFixed(5), lon: +lon.toFixed(5),
      hint: this.hint
    });
  }

  minimapDraw(ctx: CanvasRenderingContext2D, size: number): void {
    const span = 260;
    const scale = size / span;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#10151c';
    ctx.fillRect(0, 0, size, size);
    const roads = this.world.minimapData(this.pPos.x, this.pPos.z, span);
    ctx.lineWidth = 2.2;
    for (const r of roads) {
      ctx.strokeStyle = r.major ? 'rgba(255,194,122,0.9)' : 'rgba(150,160,175,0.55)';
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => {
        const sx = (x - this.pPos.x) * scale + size / 2;
        const sy = (z - this.pPos.z) * scale + size / 2;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-this.pHeading + Math.PI);
    ctx.fillStyle = '#7fe3a0';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,214,140,0.4)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.world.dispose();
    this.globe.dispose();
    this.renderer.dispose();
  }
}

const R_GLOBE = 260;
function latLonReverse(x: number, z: number): [number, number] {
  const mLat = 110574;
  const mLon = 111320 * Math.cos((LAGOS.lat0 * Math.PI) / 180);
  return [LAGOS.lat0 - z / mLat, LAGOS.lon0 + x / mLon];
}
