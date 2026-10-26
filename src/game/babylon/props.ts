/** game/babylon/props.ts — street life as merged quads: lamps, palms, power lines, billboards, danfo. */
import { Vector3 } from '@babylonjs/core/Maths/math';
import type { ChunkData } from '@/lib/osm';
import type { Kit, RoadSeg, MatKey, Acc } from './builders';

type RNG = () => number;

const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** tube along a segment list (n-gon cross-section), merged as quads */
function tube(acc: Acc, pts: Array<[number, number]>, y0: number, y1: number, r: number, sides = 5): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const ux = dx / len, uz = dz / len;
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2, a1 = ((s + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r;
      const c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
      // NOTE: normal = perpendicular in XZ; approximate tube with 2 vertical quads per side pair
      if (s >= 2) continue; // back faces hidden — cheap tube
      acc.quad(
        V(ax + c0, y1, az + s0), V(bx + c0, y1, az + s0),
        V(bx + c1, y0, bz + s1), V(ax + c1, y0, az + s1), Math.max(0.1, len / 3), 1);
    }
  }
}

function boxQ(acc: Acc, cx: number, y0: number, cz: number, w: number, h: number, d: number, rotY = 0): void {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const cor = (sx: number, sz: number): [number, number] => [cx + sx * c - sz * s, cz + sx * s + sz * c];
  const [x0, z0] = cor(-w / 2, -d / 2), [x1, z1] = cor(w / 2, -d / 2);
  const [x2, z2] = cor(w / 2, d / 2), [x3, z3] = cor(-w / 2, d / 2);
  const y1 = y0 + h;
  // top + 4 sides (skip bottom)
  acc.quad(V(x0, y1, z0), V(x1, y1, z1), V(x2, y1, z2), V(x3, y1, z3), 1, 1);
  acc.quad(V(x0, y1, z0), V(x1, y1, z1), V(x1, y0, z1), V(x0, y0, z0), 1, 1);
  acc.quad(V(x1, y1, z1), V(x2, y1, z2), V(x2, y0, z2), V(x1, y0, z1), 1, 1);
  acc.quad(V(x2, y1, z2), V(x3, y1, z3), V(x3, y0, z3), V(x2, y0, z2), 1, 1);
  acc.quad(V(x3, y1, z3), V(x0, y1, z0), V(x0, y0, z0), V(x3, y0, z3), 1, 1);
}

/* ---------- lamp post ---------- */
function lamp(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, dirX: number, dirZ: number): void {
  tube(out.get('dark')!, [[x, z], [x, z]], 0.15, 5.4, 0.07);
  const ax = x + dirX * 0.75, az = z + dirZ * 0.75;
  boxQ(out.get('dark')!, ax, 5.26, az, 0.09, 0.09, 1.5, Math.atan2(dirX, dirZ));
  boxQ(out.get('light')!, x + dirX * 1.4, 5.2, z + dirZ * 1.4, 0.26, 0.1, 0.52, Math.atan2(dirX, dirZ));
}

/* ---------- palm tree (merged quads) ---------- */
function palm(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, rng: RNG): void {
  const h = 4.5 + rng() * 3.5;
  const lean = 0.1 + rng() * 0.26;
  const leanA = rng() * Math.PI * 2;
  const vx = Math.cos(leanA) * lean, vz = Math.sin(leanA) * lean;
  // trunk: 4 segments of tapered tube
  let px = x, pz = z, py = 0.15;
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs;
    const rB = 0.13 * (1 - i / segs * 0.5), rT = 0.11 * (1 - (i + 1) / segs * 0.6);
    tube(out.get('dark')!, [[px, pz], [px + vx * sh, pz + vz * sh]], py, py + sh, (rB + rT) / 2, 4);
    px += vx * sh; pz += vz * sh; py += sh * 0.96;
  }
  // fronds: curved quads, two-sided via frond material back:true
  const frond = out.get('frond')!;
  const nF = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < nF; i++) {
    const a = (i / nF) * Math.PI * 2 + rng() * 0.5;
    const len = 1.9 + rng() * 0.9;
    const dip = 0.5 + rng() * 0.55;
    const ca = Math.cos(a), sa = Math.sin(a);
    const w = 0.34;
    const mx = px + ca * len * 0.5, mz = pz + sa * len * 0.5;
    const tipX = px + ca * len, tipZ = pz + sa * len;
    frond.quad(
      V(px, py + 0.1, pz), V(px + ca * len * 0.35 - sa * w, py + 0.28, pz + sa * len * 0.35 + ca * w),
      V(mx - sa * w * 0.8, py + 0.1 - dip * 0.35, mz + ca * w * 0.8), V(mx + sa * w * 0.4, py + 0.16 - dip * 0.4, mz - ca * w * 0.4), 1, 1);
    frond.quad(
      V(mx, py + 0.12 - dip * 0.38, mz), V(mx + sa * w * 0.5, py + 0.05 - dip * 0.6, mz - ca * w * 0.5),
      V(tipX, py - dip, tipZ), V(tipX, py - dip + 0.08, tipZ), 1, 1);
  }
}

/* ---------- power pole + sagging wires (quad strips) ---------- */
function powerPole(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, dirX: number, dirZ: number, next: { x: number; z: number } | null): void {
  tube(out.get('dark')!, [[x, z], [x, z]], 0.15, 7.0, 0.085);
  boxQ(out.get('dark')!, x, 6.45, z, 2.0, 0.08, 0.08, Math.atan2(dirX, dirZ) + Math.PI / 2);
  boxQ(out.get('dark')!, x, 5.9, z, 1.4, 0.07, 0.07, Math.atan2(dirX, dirZ) + Math.PI / 2);
  if (!next) return;
  const dark = out.get('dark')!;
  const tops = [
    { x: x - dirZ * 0.85, z: z + dirX * 0.85, y: 6.45 },
    { x, z, y: 6.52 },
    { x: x + dirZ * 0.85, z: z - dirX * 0.85, y: 6.45 }
  ];
  const ntops = [
    { x: next.x - dirZ * 0.85, z: next.z + dirX * 0.85, y: 6.45 },
    { x: next.x, z: next.z, y: 6.52 },
    { x: next.x + dirZ * 0.85, z: next.z - dirX * 0.85, y: 6.45 }
  ];
  for (let w = 0; w < 3; w++) {
    const N = 7;
    let prev = { x: tops[w].x, y: tops[w].y, z: tops[w].z };
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const sag = Math.sin(t * Math.PI) * 0.5;
      const cx = tops[w].x + (ntops[w].x - tops[w].x) * t;
      const cy = tops[w].y + (ntops[w].y - tops[w].y) * t - sag;
      const cz = tops[w].z + (ntops[w].z - tops[w].z) * t;
      dark.quad(V(prev.x, prev.y + 0.02, prev.z), V(cx, cy + 0.02, cz), V(cx, cy - 0.02, cz), V(prev.x, prev.y - 0.02, prev.z), 1, 1);
      prev = { x: cx, y: cy, z: cz };
    }
  }
}

/* ---------- billboard ---------- */
const BILLBOARD_ADS: Array<[string, string, string]> = [
    ['#123a5e', '#ffd76a', 'LAGOS BUILDS DREAMS'],
    ['#0e4d34', '#ffffff', 'EARTH SERVER 1 · ONLINE'],
    ['#5a1420', '#ffe9c4', 'EXCALIBUR IS COMING'],
    ['#233a70', '#cfe2ff', 'MOVE. EARN. EXPLORE.']
  ];

function billboard(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, rotY: number, rng: RNG, collect: BillboardPlacement[]): void {
  tube(out.get('dark')!, [[x - 1.1, z], [x - 1.1, z]], 0.15, 6.0, 0.1);
  tube(out.get('dark')!, [[x + 1.1, z], [x + 1.1, z]], 0.15, 6.0, 0.1);
  boxQ(out.get('metal')!, x, 6.0, z, 6.6, 0.18, 0.22, rotY);
  const ad = BILLBOARD_ADS[Math.floor(rng() * BILLBOARD_ADS.length)];
  collect.push({ x, z, rotY, line: ad[2], bg: ad[0], fg: ad[1] });
  void kit;
}

/* ---------- market umbrella ---------- */
function umbrella(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, rng: RNG): void {
  tube(out.get('dark')!, [[x, z], [x, z]], 0.15, 2.0, 0.025);
  const umb = out.get(rng() < 0.5 ? 'umbrella' : 'awning')!;
  const N = 8, R = 1.15, h = 2.1, peak = 2.55;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    umb.quad(
      V(x, peak, z),
      V(x + Math.cos(a0) * R, h, z + Math.sin(a0) * R),
      V(x + Math.cos(a1) * R, h, z + Math.sin(a1) * R),
      V(x, peak, z), 1, 1);
  }
  boxQ(out.get('dark')!, x + 0.1, 0.8, z + 1.4, 1.6, 0.08, 0.9, rng() * 3);
}

/* ---------- parked danfo (merged quads) ---------- */
function danfoQ(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number, rotY: number): void {
  const y = out.get('yellow')!;
  const g = out.get('glass')!;
  const d = out.get('dark')!;
  boxQ(y, x, 0.35, z, 1.95, 1.55, 4.6, rotY);
  boxQ(g, x, 1.25, z, 1.97, 0.55, 4.15, rotY);
  boxQ(d, x, 0.6, z, 1.99, 0.16, 4.5, rotY);
  for (const [wx, wz] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]]) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    tube(d, [[x + wx * c - wz * s, z + wx * s + wz * c], [x + wx * c - wz * s, z + wx * s + wz * c]], 0.12, 0.56, 0.3, 4);
  }
}

/* ---------- bin ---------- */
function bin(kit: Kit, out: Map<MatKey, Acc>, x: number, z: number): void {
  tube(out.get('metal')!, [[x, z], [x, z]], 0.15, 1.0, 0.26, 5);
}

/* ---------- chunk decoration (accumulates into shared buckets) ---------- */
export interface BillboardPlacement { x: number; z: number; rotY: number; line: string; bg: string; fg: string }

export function decorateAcc(kit: Kit, cd: ChunkData, roads: RoadSeg[], rng: RNG, out: Map<MatKey, Acc>): BillboardPlacement[] {
  const billboards: BillboardPlacement[] = [];
  for (const r of roads) {
    if (!r.major) continue;
    const half = r.w / 2;
    let acc = rng() * 20;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ux = dx / len, uz = dz / len;
      let t = acc;
      while (t < len) {
        const px = a[0] + ux * t, pz = a[1] + uz * t;
        const side = (Math.floor(t / 26) % 2 === 0) ? 1 : -1;
        lamp(kit, out, px - uz * (half + 0.9) * side, pz + ux * (half + 0.9) * side, -ux * side, -uz * side);
        if (rng() < 0.4) bin(kit, out, px - uz * (half + 1.8) * side, pz + ux * (half + 1.8) * side);
        if (rng() < 0.55) palm(kit, out, px - uz * (half + 0.7) * -side, pz + ux * (half + 0.7) * -side, rng);
        t += 26;
      }
      acc = t - len;
    }
    // power poles
    let accP = rng() * 30;
    const polePts: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ux = dx / len, uz = dz / len;
      let t = accP;
      while (t < len) {
        const side = (Math.floor(t / 52) % 2 === 0) ? -1 : 1;
        polePts.push({ x: a[0] + ux * t - uz * (r.w / 2 + 1.9) * side, z: a[1] + uz * t + ux * (r.w / 2 + 1.9) * side });
        t += 52;
      }
      accP = t - len;
    }
    for (let i = 0; i < polePts.length; i++) {
      const next = polePts[i + 1] ?? null;
      const dir = next ? { x: next.x - polePts[i].x, z: next.z - polePts[i].z } : { x: 1, z: 0 };
      const dl = Math.hypot(dir.x, dir.z) || 1;
      powerPole(kit, out, polePts[i].x, polePts[i].z, dir.x / dl, dir.z / dl, next);
    }
  }
  // palms in green areas
  for (const g of cd.g) {
    const n = Math.min(4, Math.floor(g.p.length / 3));
    for (let i = 0; i < n; i++) {
      const p = g.p[Math.floor(rng() * g.p.length)];
      palm(kit, out, p[0], p[1], rng);
    }
  }
  // billboard
  if (rng() < 0.4 && roads.length) {
    const r = roads[Math.floor(rng() * roads.length)];
    const i = Math.floor(rng() * Math.max(1, r.pts.length - 1));
    const a = r.pts[i], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const side = rng() > 0.5 ? 1 : -1;
    billboard(kit, out, a[0] + dx * 0.5 - dz / l * (r.w / 2 + 3.4) * side, a[1] + dz * 0.5 + dx / l * (r.w / 2 + 3.4) * side, Math.atan2(dx, dz), rng, billboards);
  }
  // umbrella market stall
  if (rng() < 0.5 && roads.length) {
    const r = roads[Math.floor(rng() * roads.length)];
    const i = Math.floor(rng() * Math.max(1, r.pts.length - 1));
    const a = r.pts[i], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const side = rng() > 0.5 ? 1 : -1;
    umbrella(kit, out, a[0] + dx * 0.3 - dz / l * (r.w / 2 + 2.6) * side, a[1] + dz * 0.3 + dx / l * (r.w / 2 + 2.6) * side, rng);
  }
  // block filler: container stacks + zinc shacks on empty compound ground
  const nFill = Math.floor(rng() * 4);
  for (let i = 0; i < nFill; i++) {
    const bx = rng() * 80, bz = rng() * 80;
    let nearRoad = false;
    for (const r of roads) {
      const half = r.w / 2;
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = r.pts[k], b = r.pts[k + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((bx - a[0]) * dx + (bz - a[1]) * dz) / l2));
        if (Math.hypot(bx - (a[0] + dx * t), bz - (a[1] + dz * t)) < half + 4.5) { nearRoad = true; break; }
      }
      if (nearRoad) break;
    }
    if (nearRoad) continue;
    if (rng() < 0.55) {
      // container stack (2-3)
      const cols = [[0.72, 0.16, 0.14], [0.16, 0.36, 0.62], [0.2, 0.5, 0.3], [0.85, 0.6, 0.12]];
      const n = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < n; c++) {
        const col = cols[Math.floor(rng() * cols.length)];
        const acc = out.get(c % 2 === 0 ? 'awning' : 'zinc')!;
        const y = 0.15 + c * 2.6;
        const rot = rng() * Math.PI;
        boxQ(acc, bx, y, bz + c * 0.3, 6.1, 2.6, 2.5, rot);
        void col;
      }
    } else {
      // zinc shack
      boxQ(out.get('zinc')!, bx, 0.15, bz, 3.6 + rng() * 2.4, 2.3 + rng() * 0.8, 3 + rng() * 2, rng() * Math.PI);
    }
  }
  // parked danfo
  if (rng() < 0.3 && roads.length) {
    const r = roads[Math.floor(rng() * roads.length)];
    const i = Math.floor(rng() * Math.max(1, r.pts.length - 2));
    const a = r.pts[i], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const side = rng() > 0.5 ? 1 : -1;
    danfoQ(kit, out, a[0] + dx * 0.5 - dz / l * (r.w / 2 + 1.7) * side, a[1] + dz * 0.5 + dx / l * (r.w / 2 + 1.7) * side, Math.atan2(dx, dz));
  }
  return billboards;
}
