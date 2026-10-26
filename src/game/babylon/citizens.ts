/** game/babylon/citizens.ts — rigged Lagosians walking sidewalks, greetable. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { MeshBuilder, Mesh } from '@babylonjs/core/Meshes';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture, Texture } from '@babylonjs/core/Materials';
import type { World } from './world';
import type { Actor, CharacterKit } from './actors';
import { LAGOS_NAMES } from './actors';

interface Citizen {
  actor: Actor;
  pos: Vector3;
  target: Vector3;
  speed: number;
  greeted: boolean;
  name: string;
  label: Mesh;
}

const labelCache = new Map<string, Texture>();

function labelTex(scene: Scene, name: string): Texture {
  const hit = labelCache.get(name);
  if (hit) return hit;
  const t = new DynamicTexture('lbl_' + name, { width: 256, height: 64 }, scene, true);
  t.hasAlpha = true;
  const x = t.getContext() as unknown as CanvasRenderingContext2D;
  x.clearRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(10,10,14,0.74)';
  x.beginPath();
  x.roundRect(10, 10, 236, 44, 22);
  x.fill();
  x.strokeStyle = 'rgba(255,214,140,0.9)';
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = '#ffe9c4';
  x.font = 'bold 26px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(name, 128, 33);
  t.update();
  labelCache.set(name, t);
  return t;
}

export class Citizens {
  list: Citizen[] = [];
  private scene: Scene;
  private world: World;
  private kit: CharacterKit;
  private spawnTries = 0;
  private acc = 0;

  constructor(scene: Scene, world: World, kit: CharacterKit) {
    this.scene = scene;
    this.world = world;
    this.kit = kit;
  }

  get near(): Citizen | null {
    let best: Citizen | null = null;
    let bd = 3.4;
    for (const c of this.list) {
      const d = Vector3.Distance(c.pos, new Vector3(this.px, 0, this.pz));
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  private px = 0; private pz = 0;

  tick(px: number, pz: number, dt: number): void {
    this.px = px; this.pz = pz;
    this.acc += dt;
    const want = 9;
    this.list = this.list.filter(c => {
      const d = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (d > 200) {
        c.label.dispose();
        c.actor.dispose();
        return false;
      }
      return true;
    });
    if (this.list.length < want && this.acc > 0.25) {
      this.acc = 0;
      this.spawnTries++;
      const ang = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 110;
      const near = this.world.nearestRoad(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist);
      if (near) {
        this.spawnTries = 0;
        this.spawn(near.pt[0] + near.dir[1] * (near.major ? 3.6 : 2.4), near.pt[1] - near.dir[0] * (near.major ? 3.6 : 2.4));
      }
      if (this.spawnTries > 5) this.spawnTries = 0;
    }
    for (const c of this.list) {
      const dx = c.target.x - c.pos.x, dz = c.target.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const pd = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (d < 1.4 || pd < 1.6) {
        c.target.copyFrom(this.pickTarget(c.pos));
      } else {
        const vx = (dx / d) * c.speed, vz = (dz / d) * c.speed;
        c.pos.x += vx * dt; c.pos.z += vz * dt;
        c.actor.root.rotation.y = Math.atan2(dx, dz);
        const moving = c.speed > 1.35 ? 'Run' : 'Walk';
        const g = c.actor.groups[moving];
        if (g && !g.isPlaying) c.actor.play(moving, c.speed > 1.35 ? 1.05 : 1);
      }
      const gy = this.world.groundY(c.pos.x, c.pos.z);
      c.actor.root.position.set(c.pos.x, gy, c.pos.z);
      c.label.position.set(c.pos.x, gy + 2.15, c.pos.z);
      c.label.setEnabled(pd < 10);
    }
  }

  private spawn(x: number, z: number): void {
    const name = LAGOS_NAMES[Math.floor(Math.random() * LAGOS_NAMES.length)];
    const actor = this.kit.make({ name: 'cit_' + name, palette: Math.floor(Math.random() * 997) });
    const pos = new Vector3(x, this.world.groundY(x, z), z);
    actor.root.position.copyFrom(pos);
    const target = this.pickTarget(pos);
    const label = MeshBuilder.CreatePlane('lbl', { width: 1.5, height: 0.375 }, this.scene);
    const m = new StandardMaterial('lblM_' + name, this.scene);
    m.diffuseTexture = labelTex(this.scene, name);
    m.emissiveColor = new Color3(0.35, 0.33, 0.3);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.useAlphaFromDiffuseTexture = true;
    label.material = m;
    label.isPickable = false;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.position.set(x, pos.y + 2.15, z);
    const speed = 1.05 + Math.random() * 0.85;
    this.list.push({ actor, pos, target, speed, greeted: false, name, label });
    actor.play(speed > 1.35 ? 'Run' : 'Walk', speed > 1.35 ? 1.05 : 1);
  }

  private pickTarget(from: Vector3): Vector3 {
    const near = this.world.nearestRoad(from.x, from.z);
    if (!near) return from.clone();
    const along = (Math.random() - 0.35) * 44;
    const side = (Math.random() - 0.5) * 3.0;
    return new Vector3(
      near.pt[0] + near.dir[0] * along - near.dir[1] * side,
      0,
      near.pt[1] + near.dir[1] * along + near.dir[0] * side
    );
  }

  /** name of the nearest greetable citizen (for HUD/TALK) */
  nearestName(px: number, pz: number): string | null {
    let best: string | null = null;
    let bd = 3.2;
    for (const c of this.list) {
      const d = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (d < bd) { bd = d; best = c.name; }
    }
    return best;
  }

  dispose(): void {
    for (const c of this.list) { c.label.dispose(); c.actor.dispose(); }
    this.list = [];
  }
}
