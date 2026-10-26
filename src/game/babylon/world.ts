/** game/babylon/world.ts — chunk streaming v2: LOD rings, ground-height service, sim graph. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math';
import { PhysicsShapeBox, PhysicsBody, PhysicsMotionType } from '@babylonjs/core/Physics/v2';
import { Quaternion } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { ChunkData } from '@/lib/osm';
import { CHUNK, chunkOf, chunkKey } from '@/game/geo';
import { buildChunk, makeKit, type ChunkBuild, type Kit, type Collider, type RoadSeg } from './builders';
import type { Environment } from './environment';

const NEAR_RADIUS = 2;        // full detail (props/interiors/crossings)
const MID_RADIUS = 4;         // buildings + facades only
const CACHE_RADIUS = 5;
const API_CITY = 'lagos';

interface Entry { build: ChunkBuild; cx: number; cz: number; detail: boolean; bodies: import('@babylonjs/core/Physics/v2/physicsBody').PhysicsBody[] }

export class World {
  kit: Kit;
  private built = new Map<string, Entry>();
  private empty = new Set<string>();
  private pending = new Set<string>();
  private missing = new Map<string, number>();
  private firstBatchDone = false;
  onFirstChunks?: () => void;
  private havok: import('@babylonjs/core/Physics/v2/IPhysicsEnginePlugin').IPhysicsEnginePluginV2 | null = null;

  constructor(private scene: Scene, private env: Environment) {
    this.kit = makeKit(scene);
  }

  setHavok(h: typeof this.havok): void { this.havok = h; }

  private async fetchChunk(key: string, cx: number, cz: number): Promise<ChunkData | null> {
    try {
      const r = await fetch(`/world/${API_CITY}/c.${key}.json`, { cache: 'force-cache' });
      if (r.ok) return (await r.json()) as ChunkData;
      if (r.status !== 404) throw new Error(String(r.status));
    } catch { /* fall through */ }
    if ((this.missing.get(key) ?? 0) > 2) return null;
    try {
      const r = await fetch(`/api/world/chunk?city=${API_CITY}&x=${cx}&z=${cz}`, { cache: 'default' });
      if (r.ok) {
        const j = (await r.json()) as { ok: boolean; chunk: ChunkData | null };
        return j.ok ? j.chunk : null;
      }
      this.missing.set(key, (this.missing.get(key) ?? 0) + 1);
    } catch {
      this.missing.set(key, (this.missing.get(key) ?? 0) + 1);
    }
    return null;
  }

  get coverage(): number { return this.built.size + this.empty.size; }
  get readyCount(): number { return this.built.size; }

  update(px: number, pz: number): void {
    const [pcx, pcz] = chunkOf(px, pz);
    for (const [k, v] of this.built) {
      const d = Math.max(Math.abs(v.cx - pcx), Math.abs(v.cz - pcz));
      if (d > CACHE_RADIUS) {
        v.build.root.dispose(false, true);
        for (const b of v.bodies) b.dispose();
        this.built.delete(k);
      }
    }
    const wants: Array<[number, number, number, boolean]> = [];
    for (let dx = -MID_RADIUS; dx <= MID_RADIUS; dx++) {
      for (let dz = -MID_RADIUS; dz <= MID_RADIUS; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (this.built.has(k) || this.pending.has(k) || this.empty.has(k)) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        wants.push([dx * dx + dz * dz, cx, cz, ring <= NEAR_RADIUS]);
      }
    }
    wants.sort((a, b) => a[0] - b[0]);
    const budget = this.firstBatchDone ? 1 : 8;
    for (let i = 0; i < Math.min(budget, wants.length); i++) {
      const [, cx, cz, detail] = wants[i];
      const k = chunkKey(cx, cz);
      this.pending.add(k);
      this.fetchChunk(k, cx, cz)
        .then(cd => { if (cd) this.build(cd, cx, cz, detail); else this.empty.add(k); })
        .catch(e => console.error('[world] chunk failed', k, e))
        .finally(() => {
          this.pending.delete(k);
          if (!this.firstBatchDone && this.innerReady(pcx, pcz)) {
            this.firstBatchDone = true;
            this.onFirstChunks?.();
          }
        });
    }
    if (!this.firstBatchDone && this.innerReady(pcx, pcz)) {
      this.firstBatchDone = true;
      this.onFirstChunks?.();
    }
  }

  private innerReady(pcx: number, pcz: number): boolean {
    let ok = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = chunkKey(pcx + dx, pcz + dz);
      if (this.built.has(k) || this.empty.has(k)) ok++;
    }
    return ok >= 6 && this.built.size >= 6;
  }

  private build(cdRaw: ChunkData, cx: number, cz: number, detail: boolean): void {
    const build = buildChunk(cdRaw, cx, cz, this.kit, this.env, detail, cdRaw.k);
    const bodies: Entry['bodies'] = [];
    if (this.havok) {
      // static colliders
      for (const c of build.colliders) {
        const w = c.x1 - c.x0, d = c.z1 - c.z0, h = c.h;
        if (w < 0.15 || d < 0.15 || h < 0.5) continue;
        const box = new Mesh('col_' + cdRaw.k, this.scene);
        box.position.set(cx * CHUNK + (c.x0 + c.x1) / 2, h / 2 + 0.1, cz * CHUNK + (c.z0 + c.z1) / 2);
        box.scaling.set(w, h, d);
        box.isVisible = false;
        box.isPickable = false;
        const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(w, h, d), this.scene);
        const body = new PhysicsBody(box, PhysicsMotionType.STATIC, false, this.scene);
        body.shape = shape;
        bodies.push(body);
      }
      // ground slab
      const g = new Mesh('ground_' + cdRaw.k, this.scene);
      g.position.set(cx * CHUNK + CHUNK / 2, 0.075, cz * CHUNK + CHUNK / 2);
      g.isVisible = false;
      const gs = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(CHUNK, 0.15, CHUNK), this.scene);
      const gb = new PhysicsBody(g, PhysicsMotionType.STATIC, false, this.scene);
      gb.shape = gs;
      bodies.push(gb);
    }
    this.built.set(cdRaw.k, { build, cx, cz, detail, bodies });
  }

  /** analytic ground height: roads low, blocks raised */
  groundY(x: number, z: number): number {
    const [pcx, pcz] = chunkOf(x, z);
    const lx = x - pcx * CHUNK, lz = z - pcz * CHUNK;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      const mx = lx + (pcx - v.cx) * CHUNK, mz = lz + (pcz - v.cz) * CHUNK;
      for (const r of v.build.roads) {
        const half = r.w / 2;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const abx = b[0] - a[0], abz = b[1] - a[1];
          const l2 = abx * abx + abz * abz || 1;
          const t = Math.max(0, Math.min(1, ((mx - a[0]) * abx + (mz - a[1]) * abz) / l2));
          const qx = a[0] + abx * t, qz = a[1] + abz * t;
          const d = Math.hypot(mx - qx, mz - qz);
          if (d < half + 0.1) return 0.03;
        }
      }
    }
    return 0.15;
  }

  nearestRoad(x: number, z: number): { pt: [number, number]; dir: [number, number]; major: boolean } | null {
    const [pcx, pcz] = chunkOf(x, z);
    let best: { d: number; pt: [number, number]; dir: [number, number]; major: boolean } | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      for (const r of v.build.roads) {
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const wx = v.cx * CHUNK, wz = v.cz * CHUNK;
          const ax = wx + a[0], az = wz + a[1], bx = wx + b[0], bz = wz + b[1];
          const abx = bx - ax, abz = bz - az;
          const l2 = abx * abx + abz * abz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / l2));
          const qx = ax + abx * t, qz = az + abz * t;
          const d = Math.hypot(x - qx, z - qz);
          if (!best || d < best.d) {
            const l = Math.sqrt(l2);
            best = { d, pt: [qx, qz], dir: [abx / l, abz / l], major: r.major };
          }
        }
      }
    }
    return best ? { pt: best.pt, dir: best.dir, major: best.major } : null;
  }

  /** world-space major road segments (for spawn scoring) */
  majorRoadSegments(): Array<{ x0: number; z0: number; x1: number; z1: number; w: number }> {
    const out: Array<{ x0: number; z0: number; x1: number; z1: number; w: number }> = [];
    for (const [, v] of this.built) {
      for (const r of v.build.roads) {
        if (!r.major) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          out.push({
            x0: v.cx * CHUNK + r.pts[i][0], z0: v.cz * CHUNK + r.pts[i][1],
            x1: v.cx * CHUNK + r.pts[i + 1][0], z1: v.cz * CHUNK + r.pts[i + 1][1],
            w: r.w
          });
        }
      }
    }
    return out;
  }

  /** building count near a point (spawn density score) */
  buildingsNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const [, v] of this.built) {
      for (const c of v.build.colliders) {
        const wx = v.cx * CHUNK, wz = v.cz * CHUNK;
        const cx = wx + (c.x0 + c.x1) / 2, cz = wz + (c.z0 + c.z1) / 2;
        const rx = (c.x1 - c.x0) / 2, rz = (c.z1 - c.z0) / 2;
        const dx = Math.max(0, Math.abs(x - cx) - rx), dz = Math.max(0, Math.abs(z - cz) - rz);
        if (dx * dx + dz * dz < r * r && c.h > 4) n++;
      }
    }
    return n;
  }

  /** buildings strictly on one flank of a line (canyon scoring) */
  buildingsNearSide(x: number, z: number, nx: number, nz: number, along: number, across: number): number {
    let n = 0;
    for (const [, v] of this.built) {
      for (const c of v.build.colliders) {
        if (c.h < 4) continue;
        const cx = v.cx * CHUNK + (c.x0 + c.x1) / 2, cz = v.cz * CHUNK + (c.z0 + c.z1) / 2;
        const dx = cx - x, dz = cz - z;
        const alongD = dx * Math.abs(nz) >= 0 && Math.abs(nx) > Math.abs(nz)
          ? dx * Math.sign(nx || 1)
          : dz * Math.sign(nz || 1);
        void alongD;
        const sideD = dx * nx + dz * nz;            // signed distance across the line
        const alongD2 = dx * Math.abs(nx) * 0 + dx * (Math.abs(nx) >= Math.abs(nz) ? Math.sign(nx) : 0) + dz * (Math.abs(nz) >= Math.abs(nx) ? Math.sign(nz) : 0);
        void alongD2;
        const projAcross = Math.abs(sideD);
        if (projAcross < 2 || projAcross > across) continue;
        const projAlong = Math.abs(dx * (nz === 0 ? 1 : 0) + dz * (nx === 0 ? 1 : 0));
        void projAlong;
        // along-axis distance via dominant axis of the normal
        const aDist = Math.abs(nx) >= Math.abs(nz) ? Math.abs(dz) : Math.abs(dx);
        if (aDist > along) continue;
        if (sideD > 0) n++;
      }
    }
    return n;
  }

  minimapData(x: number, z: number, span: number): Array<{ pts: Array<[number, number]>; major: boolean }> {
    const [pcx, pcz] = chunkOf(x, z);
    const out: Array<{ pts: Array<[number, number]>; major: boolean }> = [];
    const rad = Math.ceil(span / CHUNK) + 1;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      for (const r of v.build.roads) {
        out.push({ pts: r.pts.map(p => [v.cx * CHUNK + p[0], v.cz * CHUNK + p[1]]), major: r.major });
      }
    }
    return out;
  }

  dispose(): void {
    for (const [, v] of this.built) {
      v.build.root.dispose(false, true);
      for (const b of v.bodies) b.dispose();
    }
    this.built.clear();
  }
}

