/** game/babylon/engine.ts — Excalibur: Earth client engine v2 (Babylon 8 + Havok). */
import { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Vector3 } from '@babylonjs/core/Maths/math';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsAggregate, PhysicsShapeType } from '@babylonjs/core/Physics/v2';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

import { Globe } from './globe';
import { World } from './world';
import { Environment } from './environment';
import { loadCharacterKit, type Actor, type CharacterKit } from './actors';
import { Traffic } from './traffic';
import { Citizens } from './citizens';
import { latLonToLocal } from '@/game/geo';
import { LAGOS } from '@/lib/osm';

export type Mode = 'boot' | 'globe' | 'dive' | 'loading' | 'city';

export interface HudState {
  mode: Mode;
  readyPct: number;
  clock: string;
  location: string;
  nearNpc: string | null;
  fps: number;
  lat: number; lon: number;
  hint: string;
}

export interface EngineHooks {
  onHud: (s: HudState) => void;
}

const SPAWN = latLonToLocal(LAGOS.lat0, LAGOS.lon0);
const CAM_YAW0 = Math.PI * 0.15;

export class GameEngine {
  private engine: Engine;
  private scene: Scene;
  private env: Environment;
  private globe: Globe;
  private world: World;
  private traffic: Traffic;
  private citizens: Citizens | null = null;
  private kit: CharacterKit | null = null;
  private player: Actor | null = null;
  private playerBody: PhysicsAggregate | null = null;
  private pPos = new Vector3(SPAWN[0], 0.15, SPAWN[1]);
  private pVy = 0;
  private grounded = true;
  private camYaw = CAM_YAW0;
  private camPitch = 0.30;
  private camPos = new Vector3(SPAWN[0], 4, SPAWN[1] + 8);
  private mode: Mode = 'boot';
  private hooks: EngineHooks;
  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private lookDrag = { active: false, x: 0, y: 0 };
  private sprint = false;
  private raf = 0;
  private clockObj = { t0: performance.now(), last: performance.now() };
  private hudT = 0; private fpsAcc = 0; private fpsN = 0; private fps = 60;
  private hint = ''; private hintT = 0;
  private canvas: HTMLCanvasElement;
  private disposed = false;
  private isMobile: boolean;
  private shadowProxy: Mesh | null = null;

  constructor(canvas: HTMLCanvasElement, hooks: EngineHooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
    this.engine = new Engine(canvas, !this.isMobile, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance' }, false);
    this.engine.setHardwareScalingLevel(this.isMobile ? Math.max(1.15, Math.min(1.6, (window.devicePixelRatio || 1) * 0.66)) : 1 / Math.min(1.6, window.devicePixelRatio || 1));
    this.scene = new Scene(this.engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = true;

    this.env = new Environment(this.scene, this.isMobile);
    this.globe = new Globe(this.scene, canvas.parentElement ?? canvas);
    this.world = new World(this.scene, this.env);
    this.traffic = new Traffic(this.scene, this.world);

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

    this.resize();
    this.setMode('boot');
    void this.boot();
    (window as unknown as { __ee?: GameEngine }).__ee = this;
  }

  /* ---------- boot ---------- */
  private async boot(): Promise<void> {
    try {
      const [havok, kit] = await Promise.all([
        HavokPhysics({ locateFile: () => '/havok/HavokPhysics.wasm' }),
        loadCharacterKit(this.scene)
      ]);
      if (this.disposed) return;
      const havokPlugin = new HavokPlugin(true, havok);
      this.scene.enablePhysics(new Vector3(0, -18, 0), havokPlugin);
      this.world.setHavok(this.scene.getPhysicsEngine()!.getPhysicsPlugin() as import('@babylonjs/core/Physics/v2/IPhysicsEnginePlugin').IPhysicsEnginePluginV2);
      this.kit = kit;

      // player actor
      const player = kit.make({ name: 'player', palette: 0 });
      this.player = player;
      player.root.position.copyFrom(this.pPos);
      player.root.rotation.y = Math.PI;
      player.play('Idle');

      // kinematic capsule
      const cap = MeshBuilder.CreateCapsule('pcap', { radius: 0.36, height: 1.7, tessellation: 8 }, this.scene);
      cap.isVisible = false;
      cap.position.copyFrom(this.pPos);
      cap.position.y += 0.85;
      this.playerBody = new PhysicsAggregate(cap, PhysicsShapeType.CAPSULE, { mass: 0, restitution: 0, friction: 0 }, this.scene);
      this.playerBody.body.setTargetTransform(cap.position, cap.rotationQuaternion!);
      this.playerBody.shape.isTrigger = false;

      // shadow proxy (simple capsule casts the character shadow; skinned meshes skip)
      this.shadowProxy = MeshBuilder.CreateCapsule('pshadow', { radius: 0.3, height: 1.5, tessellation: 6 }, this.scene);
      this.shadowProxy.isVisible = false;
      this.env.addCaster(this.shadowProxy);

      this.citizens = new Citizens(this.scene, this.world, kit);

      this.world.onFirstChunks = () => {
        if (this.mode === 'loading') this.setMode('city');
        const spawn = this.pickSpawn();
        if (spawn) this.spawned = true;
        if (spawn) {
          this.pPos.set(spawn.x, this.world.groundY(spawn.x, spawn.z), spawn.z);
          this.camYaw = spawn.yaw;
          this.camPos.set(
            spawn.x - Math.sin(spawn.yaw + Math.PI) * 6.6,
            this.pPos.y + 3.4,
            spawn.z - Math.cos(spawn.yaw + Math.PI) * 6.6
          );
          if (this.player) this.player.root.position.copyFrom(this.pPos);
        }
      };
      this.setMode('globe');
      this.scene.render();
      this.loop();
    } catch (e) {
      console.error('[engine] boot failed', e);
      this.hint = '3D engine failed to start — reload the page';
      this.hintT = 30;
    }
  }

  /* ---------- public API (React) ---------- */
  setJoystick(x: number, y: number): void { this.joy.x = x; this.joy.y = y; }
  setSprint(v: boolean): void { this.sprint = v; }
  jump(): void {
    if (this.mode === 'city' && this.grounded) { this.pVy = 7.4; this.grounded = false; }
  }
  lookDragStart(x: number, y: number): void { this.lookDrag = { active: true, x, y }; }
  lookDragMove(x: number, y: number): void {
    if (!this.lookDrag.active) return;
    this.camYaw -= (x - this.lookDrag.x) * 0.006;
    this.camPitch = Math.max(-0.15, Math.min(0.85, this.camPitch + (y - this.lookDrag.y) * 0.004));
    this.lookDrag.x = x; this.lookDrag.y = y;
  }
  lookDragEnd(): void { this.lookDrag.active = false; }
  requestEnter(): void { if (this.mode === 'globe') void this.enterCity(); }
  get currentMode(): Mode { return this.mode; }

  private setMode(m: Mode): void { this.mode = m; this.pushHud(); }

  async enterCity(): Promise<void> {
    if (this.mode !== 'globe') return;
    this.setMode('dive');
    this.globe.camera.detachControl();
    await this.globe.dive();
    this.globe.setVisible(false);
    this.setMode('loading');
    this.hint = 'Streaming Lagos — real streets from Earth data';
    this.hintT = 6;
    window.setTimeout(() => { if (!this.disposed && this.mode === 'loading') this.setMode('city'); }, 8000);
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
    this.engine.resize();
  };

  /* ---------- main loop ---------- */
  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.clockObj.last) / 1000);
    this.clockObj.last = now;
    const t = (now - this.clockObj.t0) / 1000;

    this.fps = Math.round(this.engine.getFps());

    if (this.mode === 'globe' || this.mode === 'boot') {
      this.globe.tick(t);
    } else if (this.mode === 'dive') {
      this.globe.tick(t);
    } else if (this.mode === 'loading' || this.mode === 'city') {
      this.cityTick(dt);
    }
    this.scene.render();

    this.hudT += dt;
    if (this.hudT > 0.125) {
      this.hudT = 0;
      if (this.hintT > 0) { this.hintT -= 0.125; if (this.hintT <= 0) this.hint = ''; }
      this.pushHud();
    }
  };

  private spawned = false;

  private cityTick(dt: number): void {
    // streaming around player
    this.world.update(this.pPos.x, this.pPos.z);

    // keep hunting for a cinematic spawn until we land one
    if (!this.spawned && (this.world.readyCount > 8 || this.mode === 'city')) {
      const spawn = this.pickSpawn();
      if (spawn) {
        this.spawned = true;
        this.pPos.set(spawn.x, this.world.groundY(spawn.x, spawn.z), spawn.z);
        this.camYaw = spawn.yaw;
        this.camPos.set(
          spawn.x - Math.sin(spawn.yaw + Math.PI) * 6.6,
          this.pPos.y + 3.4,
          spawn.z - Math.cos(spawn.yaw + Math.PI) * 6.6
        );
        if (this.player) this.player.root.position.copyFrom(this.pPos);
        if (this.playerBody) this.playerBody.transformNode.position.set(spawn.x, this.pPos.y + 0.85, spawn.z);
      }
    }

    // input: joystick turns the camera; Y drives forward/back
    let turn = this.joy.x;
    let drive = this.joy.y;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) turn -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) turn += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) drive -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) drive += 1;
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sprint;

    this.camYaw -= turn * dt * 2.4;
    const mag = Math.min(1, Math.abs(drive));
    const moving = Math.abs(drive) > 0.06;
    const running = shift && moving && drive < -0.1;
    const targetSpeed = moving ? mag * (running ? 6.4 : 2.7) : 0;
    const fwdSign = drive <= 0 ? 1 : -1;

    // heading follows camera when moving
    if (moving) {
      const targetHeading = this.camYaw + Math.PI + (drive > 0 ? Math.PI : 0);
      let dh = targetHeading - (this.player?.root.rotation.y ?? 0);
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      if (this.player) this.player.root.rotation.y += dh * Math.min(1, dt * 10);
    }

    // physics move: horizontal target + manual gravity
    const speed = targetSpeed;
    const heading = this.player?.root.rotation.y ?? 0;
    if (this.playerBody) {
      const vy = this.pVy;
      const nx = this.pPos.x + Math.sin(heading) * speed * fwdSign * dt;
      const nz = this.pPos.z + Math.cos(heading) * speed * fwdSign * dt;
      this.pVy -= 18 * dt;
      const gy = this.world.groundY(nx, nz);
      let ny = this.pPos.y + this.pVy * dt;
      if (ny <= gy) { ny = gy; this.pVy = 0; if (!this.grounded) this.grounded = true; }
      else this.grounded = false;
      this.pPos.set(nx, ny, nz);
      this.playerBody.body.setTargetTransform(new Vector3(nx, ny + 0.85, nz), this.playerBody.transformNode.rotationQuaternion!);
      if (this.shadowProxy) this.shadowProxy.position.set(nx, ny + 0.8, nz);
    }

    // animation state
    if (this.player) {
      if (!this.grounded) this.player.play('Jump', 1, false);
      else if (speed > 3.4) this.player.play('Run', 1.05);
      else if (speed > 0.2) this.player.play('Walk', Math.max(0.75, Math.min(1.5, speed / 2.7)));
      else this.player.play('Idle');
    }

    // third-person camera orbit (yaw from joystick, spring follow)
    const dbgFree = (window as unknown as { __eeFreeCam?: boolean }).__eeFreeCam;
    if (dbgFree) return;
    const camDist = running ? 7.2 : 6.0;
    const camH = 2.2 + this.camPitch * 4.4;
    const cx = this.pPos.x - Math.sin(this.camYaw + Math.PI) * camDist;
    const cz = this.pPos.z - Math.cos(this.camYaw + Math.PI) * camDist;
    const desired = new Vector3(cx, this.pPos.y + camH, cz);
    const k = Math.min(1, dt * (this.mode === 'loading' ? 1.4 : 5.5));
    this.camPos = Vector3.Lerp(this.camPos, desired, k);
    const cam = this.scene.activeCamera as import('@babylonjs/core/Cameras/targetCamera').TargetCamera | null;
    if (cam) {
      cam.position.copyFrom(this.camPos);
      cam.setTarget(new Vector3(this.pPos.x, this.pPos.y + 1.35, this.pPos.z));
    }

    // world life
    this.env.follow(this.pPos.x, this.pPos.y, this.pPos.z);
    this.traffic.tick(this.pPos.x, this.pPos.z, dt);
    this.citizens?.tick(this.pPos.x, this.pPos.z, dt);
  }

  /** debug/qa handles */
  get dbg(): { scene: Scene; world: World; pos: Vector3 } {
    return { scene: this.scene, world: this.world, pos: this.pPos };
  }

  /** find the most cinematic spawn: dense major road, camera looking down-street toward the sun */
  private pickSpawn(): { x: number; z: number; yaw: number } | null {
    const w = this.world;
    let best: { score: number; x: number; z: number; yaw: number } | null = null;
    const sunF = { x: -0.43, z: -0.90 };  // sun azimuth (matches environment SUN_DIR)
    const segs = w.majorRoadSegments();
    for (const s of segs) {
      const midX = (s.x0 + s.x1) / 2, midZ = (s.z0 + s.z1) / 2;
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      if (len < 45) continue;
      const ux = (s.x1 - s.x0) / len, uz = (s.z1 - s.z0) / len;
      // canyon: buildings on BOTH flanks
      const left = w.buildingsNearSide(midX, midZ, -uz, ux, 46, 70);
      const right = w.buildingsNearSide(midX, midZ, uz, -ux, 46, 70);
      const canyon = Math.min(left, right);
      for (const sign of [1, -1]) {
        const fx = ux * sign, fz = uz * sign;
        const towardSun = fx * sunF.x + fz * sunF.z;
        const px = midX - fz * (s.w / 2 - 1.6), pz = midZ + fx * (s.w / 2 - 1.6);
        const yaw = Math.atan2(fx, fz);
        const score = canyon * 9 + towardSun * 2 + Math.min(len, 140) * 0.08;
        if (!best || score > best.score) best = { score, x: px, z: pz, yaw };
      }
    }
    return best ? { x: best.x, z: best.z, yaw: best.yaw } : null;
  }

  nearestNpcName(): string | null {
    return this.citizens?.nearestName(this.pPos.x, this.pPos.z) ?? null;
  }

  /* ---------- hud ---------- */
  private pushHud(): void {
    const now = new Date();
    const wat = new Date(now.getTime() + (60 * 60 + now.getTimezoneOffset() * 60) * 1000);
    const h = wat.getUTCHours(), m = wat.getUTCMinutes();
    const M_LAT = 110574, M_LON = 111320 * Math.cos((LAGOS.lat0 * Math.PI) / 180);
    const lat = LAGOS.lat0 - this.pPos.z / M_LAT;
    const lon = LAGOS.lon0 + this.pPos.x / M_LON;
    const ready = Math.min(1, this.world.readyCount / 12);
    const nearNpc = this.mode === 'city' ? this.nearestNpcName() : null;
    this.hooks.onHud({
      mode: this.mode,
      readyPct: this.mode === 'loading' || this.mode === 'city' ? ready : 0,
      clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} WAT`,
      location: 'Victoria Island · Lagos · Earth Server 1',
      nearNpc,
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
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(this.player ? -this.player.root.rotation.y + Math.PI : 0);
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
    this.citizens?.dispose();
    this.world.dispose();
    this.globe.dispose();
    this.env.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
