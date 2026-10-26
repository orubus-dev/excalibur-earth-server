/** game/world.ts — ChunkManager: static-first fetch, radius streaming, collision, sim graph. */
import * as THREE from 'three';
import { CHUNK, chunkOf, chunkKey } from './geo';
import type { ChunkData } from '@/lib/osm';
import { buildChunk, makeMatBank, type ChunkBuild, type MatBank } from './builders';
import { applyReplacement } from './replacement';

const LOAD_RADIUS = 4;        // chunks around player (full detail)
const CACHE_RADIUS = 7;       // keep built chunks up to this radius
const API_CITY = 'lagos';

export class World {
  scene: THREE.Scene;
  mats: MatBank;
  private built = new Map<string, { build: ChunkBuild; cx: number; cz: number }>();
  private empty = new Set<string>();   // chunks that exist but hold nothing (404 + empty OSM) — never refetch
  private pending = new Set<string>();
  private missing = new Map<string, number>(); // 404 counts (avoid refetch storms)
  private loader: (k: string, cx: number, cz: number) => Promise<ChunkData | null>;
  onFirstChunks?: () => void;
  private firstBatchDone = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.mats = makeMatBank();
    this.loader = this.fetchChunk;
  }

  private async fetchChunk(key: string, cx: number, cz: number): Promise<ChunkData | null> {
    // 1) pre-baked static (instant, zero API)
    try {
      const r = await fetch(`/world/${API_CITY}/c.${key}.json`, { cache: 'force-cache' });
      if (r.ok) return (await r.json()) as ChunkData;
      if (r.status !== 404) throw new Error(String(r.status));
    } catch { /* fall through */ }
    // 2) on-demand server proxy (with server-side cache)
    if ((this.missing.get(key) ?? 0) > 2) return null;
    try {
      const r = await fetch(`/api/world/chunk?city=${API_CITY}&x=${cx}&z=${z0(cx, cz)}`, { cache: 'default' });
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

  private build(cdRaw: ChunkData, cx: number, cz: number): void {
    const cd = applyReplacement(cdRaw);
    const build = buildChunk(cd, this.mats);
    build.group.position.set(cx * CHUNK, 0, cz * CHUNK);
    this.scene.add(build.group);
    this.built.set(cdRaw.k, { build, cx, cz });
  }

  /** resolved chunks (built or known-empty) — loading progress signal */
  get coverage(): number { return this.built.size + this.empty.size; }

  /** per-frame streaming around player position (meters) */
  update(px: number, pz: number): void {
    const [pcx, pcz] = chunkOf(px, pz);
    // unload far
    for (const [k, v] of this.built) {
      if (Math.max(Math.abs(v.cx - pcx), Math.abs(v.cz - pcz)) > CACHE_RADIUS) {
        this.scene.remove(v.build.group);
        v.build.dispose();
        this.built.delete(k);
      }
    }
    // load near (closest first, 1 per frame to keep frame budget)
    const wants: Array<[number, number, number]> = [];
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (this.built.has(k) || this.pending.has(k) || this.empty.has(k)) continue;
        wants.push([dx * dx + dz * dz, cx, cz]);
      }
    }
    wants.sort((a, b) => a[0] - b[0]);
    const budget = this.firstBatchDone ? 1 : 10;
    for (let i = 0; i < Math.min(budget, wants.length); i++) {
      const [, cx, cz] = wants[i];
      const k = chunkKey(cx, cz);
      this.pending.add(k);
      this.loader(k, cx, cz)
        .then(cd => { if (cd) this.build(cd, cx, cz); else this.empty.add(k); })
        .catch(e => console.error('[world] chunk build failed', k, e))
        .finally(() => {
          this.pending.delete(k);
          if (!this.firstBatchDone && this.coverage >= 25) {
            this.firstBatchDone = true;
            this.onFirstChunks?.();
          }
        });
    }
    // near-ring fully resolved? that is enough to enter the city
    if (!this.firstBatchDone) {
      let innerDone = true;
      for (let dx = -1; dx <= 1 && innerDone; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = chunkKey(pcx + dx, pcz + dz);
        if (!this.built.has(k) && !this.empty.has(k) && !this.pending.has(k)) { innerDone = false; break; }
        if (this.pending.has(k)) { innerDone = false; break; }
      }
      if (innerDone && (this.built.size + this.empty.size) >= 6) {
        this.firstBatchDone = true;
        this.onFirstChunks?.();
      }
    }
  }

  get readyCount(): number { return this.built.size; }

  /** circle-vs-building collision resolve; returns corrected position (world meters) */
  collide(px: number, pz: number, r: number): [number, number] {
    const [pcx, pcz] = chunkOf(px, pz);
    let x = px, z = pz;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      for (const c of v.build.colliders) {
        const wx0 = v.cx * CHUNK + c.x0, wx1 = v.cx * CHUNK + c.x1;
        const wz0 = v.cz * CHUNK + c.z0, wz1 = v.cz * CHUNK + c.z1;
        if (x > wx0 - r && x < wx1 + r && z > wz0 - r && z < wz1 + r) {
          // push out along smallest penetration
          const penL = x - (wx0 - r), penR = (wx1 + r) - x;
          const penT = z - (wz0 - r), penB = (wz1 + r) - z;
          const m = Math.min(penL, penR, penT, penB);
          if (m === penL) x = wx0 - r;
          else if (m === penR) x = wx1 + r;
          else if (m === penT) z = wz0 - r;
          else z = wz1 + r;
        }
      }
    }
    return [x, z];
  }

  /** nearest road point + direction for NPC/traffic spawning (world meters) */
  nearestRoad(x: number, z: number): { pt: [number, number]; dir: [number, number]; major: boolean } | null {
    const [pcx, pcz] = chunkOf(x, z);
    let best: { d: number; pt: [number, number]; dir: [number, number]; major: boolean } | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      for (const r of v.build.roadsForSim) {
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

  /** roads near a point for minimap drawing (world-space polylines) */
  minimapData(x: number, z: number, span: number): Array<{ pts: Array<[number, number]>; major: boolean }> {
    const [pcx, pcz] = chunkOf(x, z);
    const out: Array<{ pts: Array<[number, number]>; major: boolean }> = [];
    const rad = Math.ceil(span / CHUNK) + 1;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const v = this.built.get(chunkKey(pcx + dx, pcz + dz));
      if (!v) continue;
      for (const r of v.build.roadsForSim) {
        out.push({ pts: r.pts.map(p => [v.cx * CHUNK + p[0], v.cz * CHUNK + p[1]]), major: r.major });
      }
    }
    return out;
  }

  dispose(): void {
    for (const [, v] of this.built) { this.scene.remove(v.build.group); v.build.dispose(); }
    this.built.clear();
  }
}

function z0(_cx: number, cz: number): number { return cz; }
