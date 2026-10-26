/** game/babylon/traffic.ts — danfo vans, sedans and keke flowing on real roads. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh, MeshBuilder } from '@babylonjs/core/Meshes';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { World } from './world';

interface Car {
  g: Mesh;
  path: Array<[number, number]>;
  seg: number;
  t: number;
  speed: number;
  lane: number;
}

const CAR_COLORS = [0xb8bec4, 0x22262c, 0x8a2f2a, 0xe8e4dc, 0x5e7f9c, 0x38513f];

export class Traffic {
  cars: Car[] = [];
  private scene: Scene;
  private world: World;
  private mats: StandardMaterial[] = [];
  private glassM: StandardMaterial;
  private darkM: StandardMaterial;

  constructor(scene: Scene, world: World) {
    this.scene = scene;
    this.world = world;
    for (const c of CAR_COLORS) {
      const m = new StandardMaterial('carM' + c.toString(16), scene);
      m.diffuseColor = Color3.FromHexString('#' + c.toString(16).padStart(6, '0'));
      m.specularColor = new Color3(0.45, 0.42, 0.38);
      m.specularPower = 48;
      this.mats.push(m);
    }
    this.glassM = new StandardMaterial('carGlass', scene);
    this.glassM.diffuseColor = new Color3(0.07, 0.09, 0.11);
    this.glassM.specularColor = new Color3(0.8, 0.78, 0.7);
    this.glassM.specularPower = 96;
    this.darkM = new StandardMaterial('carDark', scene);
    this.darkM.diffuseColor = new Color3(0.06, 0.06, 0.07);
  }

  tick(px: number, pz: number, dt: number): void {
    const want = 9;
    this.cars = this.cars.filter(c => {
      if (Math.hypot(c.g.position.x - px, c.g.position.z - pz) > 300) {
        c.g.dispose();
        return false;
      }
      return true;
    });
    if (this.cars.length < want) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 150;
      const near = this.world.nearestRoad(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist);
      if (near && near.major) this.spawnCar(near.pt, near.dir);
    }
    for (const c of this.cars) {
      const a = c.path[c.seg], b = c.path[c.seg + 1] ?? a;
      const segLen = Math.max(0.5, Math.hypot(b[0] - a[0], b[1] - a[1]));
      c.t += (c.speed * dt) / segLen;
      if (c.t >= 1) {
        c.t = 0;
        c.seg++;
        if (c.seg >= c.path.length - 1) {
          const near = this.world.nearestRoad(b[0], b[1]);
          if (near) {
            const nx = near.pt[0] + near.dir[0] * 60, nz = near.pt[1] + near.dir[1] * 60;
            c.path.push([nx, nz]);
          } else c.seg = 0;
        }
      }
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      const x = ax + (bx - ax) * c.t, z = az + (bz - az) * c.t;
      const dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l;
      c.g.position.set(x - uz * c.lane, 0.03, z + ux * c.lane);
      c.g.rotation.y = Math.atan2(ux, uz);
    }
  }

  private spawnCar(pt: [number, number], dir: [number, number]): void {
    const side = Math.random() > 0.5 ? 1 : -1;
    const lane = 2.4;
    const isDanfo = Math.random() < 0.42;
    const g: Mesh = isDanfo
      ? this.buildDanfo()
      : this.buildSedan(Math.floor(Math.random() * this.mats.length));
    const ux = dir[0], uz = dir[1];
    g.position.set(pt[0] - uz * lane * side, 0.03, pt[1] + ux * lane * side);
    g.rotation.y = Math.atan2(ux * side, uz * side);
    const path: Array<[number, number]> = [[pt[0], pt[1]]];
    let cx = pt[0], cz = pt[1];
    let d: [number, number] = [ux * side, uz * side];
    for (let i = 0; i < 5; i++) {
      const near = this.world.nearestRoad(cx + d[0] * 40, cz + d[1] * 40);
      if (!near) break;
      cx = near.pt[0] + near.dir[0] * 10; cz = near.pt[1] + near.dir[1] * 10;
      path.push([cx, cz]);
      d = near.dir;
    }
    this.cars.push({ g, path, seg: 0, t: 0, speed: 7 + Math.random() * 6, lane });
  }

  private buildSedan(colorIdx: number): Mesh {
    const g = new Mesh('sedan', this.scene);
    g.isPickable = false;
    const mk = (name: string, w: number, h: number, d: number, mat: StandardMaterial, y: number, z = 0): Mesh => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.position.set(0, y, z);
      m.material = mat;
      m.parent = g;
      m.isPickable = false;
      return m;
    };
    mk('body', 1.75, 0.52, 4.1, this.mats[colorIdx], 0.58);
    mk('cabin', 1.6, 0.46, 2.0, this.glassM, 1.06, -0.2);
    mk('hood', 1.7, 0.2, 0.7, this.mats[colorIdx], 0.86, 1.75);
    for (const [wx, wz] of [[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]]) {
      const w = MeshBuilder.CreateCylinder('wheel', { diameter: 0.62, height: 0.22, tessellation: 10 }, this.scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.31, wz);
      w.material = this.darkM;
      w.parent = g;
      w.isPickable = false;
    }
    return g;
  }

  private buildDanfo(): Mesh {
    const g = new Mesh('danfo', this.scene);
    g.isPickable = false;
    const yellow = this.mats.find(() => true);
    const y = new StandardMaterial('danfoY', this.scene);
    y.diffuseColor = Color3.FromHexString('#f2b81a');
    y.specularColor = new Color3(0.4, 0.38, 0.3);
    void yellow;
    const mk = (name: string, w: number, h: number, d: number, mat: StandardMaterial, yy: number, zz = 0): Mesh => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.position.set(0, yy, zz);
      m.material = mat;
      m.parent = g;
      m.isPickable = false;
      return m;
    };
    mk('dfBody', 1.95, 1.55, 4.6, y, 1.05);
    mk('dfBand', 1.97, 0.5, 4.2, this.glassM, 1.55);
    mk('dfFront', 1.9, 0.62, 0.1, this.glassM, 1.5, 2.3);
    mk('dfStripe', 1.99, 0.16, 4.55, this.darkM, 0.72);
    for (const [wx, wz] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]]) {
      const w = MeshBuilder.CreateCylinder('dfWheel', { diameter: 0.68, height: 0.22, tessellation: 10 }, this.scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      w.material = this.darkM;
      w.parent = g;
      w.isPickable = false;
    }
    return g;
  }
}
