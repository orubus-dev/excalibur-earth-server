/** game/citizens.ts — AI Lagosians walking the real road network, greetable. */
import * as THREE from 'three';
import { Character, randomPersona, type Persona } from './character';
import type { World } from './world';
import { seedRng } from './geo';

export interface Citizen {
  ch: Character;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  greeted: boolean;
  persona: Persona;
  label: THREE.Sprite;
}

const LABEL_TEX_CACHE = new Map<string, THREE.Texture>();

function labelTex(name: string): THREE.Texture {
  const hit = LABEL_TEX_CACHE.get(name);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(10,10,14,0.72)';
  x.beginPath();
  x.roundRect(8, 8, 240, 48, 24);
  x.fill();
  x.strokeStyle = 'rgba(255,214,140,0.85)';
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = '#ffe9c4';
  x.font = 'bold 26px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(name, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  LABEL_TEX_CACHE.set(name, t);
  return t;
}

export class Citizens {
  list: Citizen[] = [];
  private scene: THREE.Scene;
  private world: World;
  private spawnTries = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
  }

  /** keep population around player */
  tick(px: number, pz: number, night: number): Citizen | null {
    const want = 14;
    // cull far
    this.list = this.list.filter(c => {
      const d = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (d > 240) {
        this.scene.remove(c.ch.root);
        this.scene.remove(c.label);
        c.ch.dispose();
        return false;
      }
      return true;
    });
    // spawn
    if (this.list.length < want && this.spawnTries < 6) {
      this.spawnTries++;
      const ang = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 130;
      const near = this.world.nearestRoad(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist);
      if (near) {
        this.spawnTries = 0;
        const rng = seedRng('cz:' + Math.random());
        const persona = randomPersona(rng);
        const ch = new Character(persona);
        ch.root.position.set(near.pt[0] + near.dir[1] * 2.6, 0, near.pt[1] - near.dir[0] * 2.6);
        this.scene.add(ch.root);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(persona.name), transparent: true, depthTest: false }));
        label.scale.set(2.6, 0.65, 1);
        label.position.y = 2.15;
        label.visible = false;
        ch.root.add(label);
        const t = this.pickTarget(ch.root.position);
        this.list.push({
          ch, pos: ch.root.position.clone(), target: t, speed: 1.1 + Math.random() * 0.8,
          greeted: false, persona, label
        });
      }
    } else if (this.spawnTries >= 6) this.spawnTries = 0;

    // walk + greet
    let greetCandidate: Citizen | null = null;
    for (const c of this.list) {
      const dx = c.target.x - c.pos.x, dz = c.target.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) c.target.copy(this.pickTarget(c.pos));
      else {
        const vx = (dx / d) * c.speed, vz = (dz / d) * c.speed;
        c.pos.x += vx * 0.016; c.pos.z += vz * 0.016;
        c.ch.root.rotation.y = Math.atan2(dx, dz);
      }
      c.ch.animate(c.speed, 0.016);
      c.ch.root.position.copy(c.pos);
      const pd = Math.hypot(c.pos.x - px, c.pos.z - pz);
      c.label.visible = pd < 9 && night < 0.95;
      if (pd < 3.2) greetCandidate = c;
    }
    return greetCandidate;
  }

  private pickTarget(from: THREE.Vector3): THREE.Vector3 {
    const near = this.world.nearestRoad(from.x, from.z);
    if (!near) return from.clone();
    const along = (Math.random() - 0.35) * 46;
    const side = (Math.random() - 0.5) * 3.4;
    return new THREE.Vector3(
      near.pt[0] + near.dir[0] * along - near.dir[1] * side,
      0,
      near.pt[1] + near.dir[1] * along + near.dir[0] * side
    );
  }
}
