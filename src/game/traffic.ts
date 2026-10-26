/** game/traffic.ts — ambient cars flowing on the real major roads. */
import * as THREE from 'three';
import type { World } from './world';
import type { Environment } from './environment';
import { makeGlow } from './textures';

interface Car {
  g: THREE.Group;
  path: Array<[number, number]>;   // world-space waypoints
  seg: number;
  t: number;
  speed: number;
  lane: number;
  dir: THREE.Vector3;
  head: THREE.Sprite;
}

export class Traffic {
  cars: Car[] = [];
  private scene: THREE.Scene;
  private world: World;
  private bodyM: THREE.MeshStandardMaterial;
  private glassM: THREE.MeshStandardMaterial;
  private wheelM: THREE.MeshStandardMaterial;
  private headTex: THREE.Texture;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.bodyM = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.35, metalness: 0.55 });
    this.glassM = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.4 });
    this.wheelM = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 });
    this.headTex = makeGlow('#cfe4ff');
  }

  tick(px: number, pz: number, env: Environment): void {
    const want = 8;
    this.cars = this.cars.filter(c => {
      const p = c.g.position;
      if (Math.hypot(p.x - px, p.z - pz) > 320) {
        this.scene.remove(c.g);
        return false;
      }
      return true;
    });
    if (this.cars.length < want) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 160;
      const near = this.world.nearestRoad(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist);
      if (near && near.major) this.spawnCar(near.pt, near.dir);
    }
    for (const c of this.cars) {
      // advance along path; extend when near end
      const a = c.path[c.seg], b = c.path[c.seg + 1] ?? a;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      c.t += (c.speed * 0.016) / Math.max(segLen, 0.5);
      if (c.t >= 1) {
        c.t = 0;
        c.seg++;
        if (c.seg >= c.path.length - 1) {
          // extend straight ahead by sampling road again
          const near = this.world.nearestRoad(b[0], b[1]);
          if (near) {
            const nx = near.pt[0] + near.dir[0] * 70, nz = near.pt[1] + near.dir[1] * 70;
            c.path.push([nx, nz]);
          } else c.seg = 0;
        }
      }
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      const x = ax + (bx - ax) * c.t, z = az + (bz - az) * c.t;
      c.dir.set(bx - ax, 0, bz - az).normalize();
      // right-lane offset
      const rx = -c.dir.z * c.lane, rz = c.dir.x * c.lane;
      c.g.position.set(x + rx, 0, z + rz);
      c.g.rotation.y = Math.atan2(c.dir.x, c.dir.z);
      c.head.visible = env.night > 0.5;
    }
  }

  private spawnCar(pt: [number, number], dir: [number, number]): void {
    const rng = Math.random;
    const colors = [0xb8bec4, 0x22262c, 0xd8b13c, 0x5e7f9c, 0x8a2f2a, 0xe8e4dc];
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.55, 4.1), this.bodyM.clone());
    (body.material as THREE.MeshStandardMaterial).color.setHex(colors[Math.floor(rng() * colors.length)]);
    body.position.y = 0.62;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.1), this.glassM);
    cabin.position.set(0, 1.1, -0.25);
    const wheels: THREE.Mesh[] = [];
    for (const [wx, wz] of [[-0.82, 1.3], [0.82, 1.3], [-0.82, -1.3], [0.82, -1.3]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10), this.wheelM);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.33, wz);
      wheels.push(w);
    }
    const g = new THREE.Group();
    g.add(body, cabin, ...wheels);
    // right-lane offset vs travel dir
    const lane = 2.6;
    const side = rng() > 0.5 ? 1 : -1;
    const rx = -dir[1] * lane * side, rz = dir[0] * lane * side;
    g.position.set(pt[0] + rx, 0, pt[1] + rz);
    g.rotation.y = Math.atan2(dir[0] * side, dir[1] * side);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.headTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    head.scale.set(3.2, 1.6, 1);
    head.position.set(0, 0.62, 2.6);
    g.add(head);
    this.scene.add(g);
    // path: a few waypoints ahead
    const path: Array<[number, number]> = [];
    let cx = pt[0], cz = pt[1];
    let d: [number, number] = [dir[0] * side, dir[1] * side];
    for (let i = 0; i < 6; i++) {
      const near = this.world.nearestRoad(cx + d[0] * 40, cz + d[1] * 40);
      if (!near) break;
      cx = near.pt[0] + near.dir[0] * 12; cz = near.pt[1] + near.dir[1] * 12;
      path.push([cx, cz]);
      d = near.dir;
    }
    this.cars.push({
      g, path: [[pt[0], pt[1]], ...path], seg: 0, t: 0,
      speed: 8 + rng() * 6, lane, dir: new THREE.Vector3(dir[0], 0, dir[1]), head
    });
  }
}
