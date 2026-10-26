/** game/babylon/builders.ts — chunk geometry: ground layers, Lagos building archetypes, interiors. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { Mesh, MeshBuilder } from '@babylonjs/core/Meshes';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ChunkData, Bldg } from '@/lib/osm';
import { CHUNK } from '@/game/geo';
import { texAsphalt, texSidewalk, texWindows, texGlassTower, texZinc, texGrass, texWater, texSign } from './tex';
import { decorateAcc, type BillboardPlacement } from './props';

export type MatKey = 'asphalt' | 'gutter' | 'curb' | 'sidewalk' | 'dirt' | 'grass' | 'water' | 'wallPaint' | 'wallWin' | 'glass' | 'zinc' | 'trim' | 'metal' | 'dark' | 'awning' | 'interior' | 'light' | 'frond' | 'umbrella' | 'yellow';
type Bucket = { mat: StandardMaterial; pos: number[]; idx: number[]; uv: number[] };

export interface RoadSeg { pts: [number, number][]; w: number; major: boolean }
export interface Collider { x0: number; z0: number; x1: number; z1: number; h: number }
export interface ChunkBuild {
  root: Mesh;
  colliders: Collider[];
  roads: RoadSeg[];
  signAnchors: { pos: Vector3; rotY: number }[];
}

export interface Kit { mats: Record<MatKey, StandardMaterial>; scene: Scene }

export function makeKit(scene: Scene): Kit {
  const std = (name: string, opts: {
    tex?: Texture; color?: [number, number, number]; rough?: number; metal?: number; em?: [number, number, number];
    u?: number; v?: number; back?: boolean; alpha?: number;
  }): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    if (opts.tex) {
      m.diffuseTexture = opts.tex;
      if (opts.u || opts.v) { opts.tex.uScale = opts.u ?? 1; opts.tex.vScale = opts.v ?? 1; }
    }
    if (opts.color) m.diffuseColor = new Color3(...opts.color);
    const wet = name === 'asphalt' || name === 'gutter';
    m.specularColor = wet ? new Color3(0.05, 0.045, 0.04) : new Color3(opts.metal ? 0.5 : 0.08, opts.metal ? 0.48 : 0.08, opts.metal ? 0.45 : 0.08);
    m.specularPower = wet ? 64 : (opts.metal ? 48 : 16);
    if (opts.em) m.emissiveColor = new Color3(...opts.em);
    m.backFaceCulling = !opts.back;
    if (opts.alpha !== undefined) { m.alpha = opts.alpha; }
    return m;
  };
  const mats: Record<MatKey, StandardMaterial> = {
    asphalt: std('asphalt', { tex: texAsphalt(scene), rough: 0.42, metal: 0.12 }),
    gutter: std('gutter', { color: [0.10, 0.10, 0.11], rough: 0.5, metal: 0.3 }),
    curb: std('curb', { color: [0.52, 0.50, 0.46], rough: 0.85 }),
    sidewalk: std('sidewalk', { tex: texSidewalk(scene), u: 4, v: 4, rough: 0.8 }),
    dirt: std('dirt', { color: [0.38, 0.30, 0.21], rough: 1 }),
    grass: std('grass', { tex: texGrass(scene), u: 6, v: 6, rough: 1 }),
    water: std('water', { tex: texWater(scene), u: 4, v: 4, rough: 0.25, metal: 0.6, alpha: 0.9 }),
    wallPaint: std('wallPaint', { tex: texWindows(scene, false), u: 1, v: 1, rough: 0.85 }),
    wallWin: std('wallWin', { tex: texWindows(scene, true), u: 1, v: 1, rough: 0.8, em: [0.24, 0.17, 0.10] }),
    glass: std('glass', { tex: texGlassTower(scene), rough: 0.18, metal: 0.85, em: [0.10, 0.12, 0.15] }),
    zinc: std('zinc', { tex: texZinc(scene), u: 3, v: 3, rough: 0.55, metal: 0.45 }),
    trim: std('trim', { color: [0.85, 0.83, 0.78], rough: 0.8 }),
    metal: std('metal', { color: [0.45, 0.47, 0.5], rough: 0.5, metal: 0.7 }),
    dark: std('dark', { color: [0.16, 0.16, 0.17], rough: 0.7 }),
    awning: std('awning', { color: [0.72, 0.22, 0.18], rough: 0.9 }),
    interior: std('interior', { color: [0.55, 0.50, 0.44], rough: 0.9 }),
    light: std('light', { color: [1, 1, 1], em: [1.0, 0.82, 0.55], rough: 1 }),
    frond: std('frond', { color: [0.22, 0.48, 0.18], rough: 0.9, back: true }),
    umbrella: std('umbrella', { color: [0.85, 0.25, 0.22], rough: 0.9, back: true }),
    yellow: std('yellow', { color: [0.95, 0.72, 0.10], rough: 0.45, metal: 0.3 })
  };
  return { mats, scene };
}

/* ---------- low-level mesh accumulation ---------- */
export class Acc {
  pos: number[] = []; idx: number[] = []; uv: number[] = [];
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, uRep = 1, vRep = 1): void {
    const i0 = this.pos.length / 3;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    // Babylon is left-handed: CW (viewed from front) = front face. Flip vs RH-rule winding.
    this.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
    this.uv.push(0, 0, uRep, 0, uRep, vRep, 0, vRep);
  }
  mesh(scene: Scene, name: string, mat: StandardMaterial): Mesh | null {
    if (this.idx.length === 0) return null;
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.indices = this.idx; vd.uvs = this.uv;
    const n: number[] = [];
    VertexData.ComputeNormals(this.pos, this.idx, n);
    vd.normals = n;
    vd.applyToMesh(m);
    m.material = mat;
    m.isPickable = false;
    return m;
  }
}

function V(x: number, y: number, z: number): Vector3 { return new Vector3(x, y, z); }

/* ---------- road ribbons ---------- */
function roadRibbon(acc: Acc, pts: [number, number][], w: number, y: number, uScale: number): void {
  if (pts.length < 2) return;
  let vLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = -dz / len * (w / 2), nz = dx / len * (w / 2);
    const v0 = vLen / 8, v1 = (vLen + len) / 8;
    acc.quad(
      V(ax + nx, y, az + nz), V(bx + nx, y, bz + nz),
      V(bx - nx, y, bz - nz), V(ax - nx, y, az - nz),
      uScale, v1 - v0
    );
    vLen += len;
  }
}

function roadRibbonV(acc: Acc, pts: [number, number][], w: number, y: number): void {
  // u tiles across the width (~every 2.5m), v tiles along (~every 8m)
  if (pts.length < 2) return;
  const uRep = Math.max(1, Math.round(w / 2.5));
  let vLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = -dz / len * (w / 2), nz = dx / len * (w / 2);
    acc.quad(
      V(ax + nx, y, az + nz), V(bx + nx, y, bz + nz),
      V(bx - nx, y, bz - nz), V(ax - nx, y, az - nz),
      uRep, Math.max(0.05, (vLen + len) / 4) - vLen / 4
    );
    vLen += len;
  }
}

function wallStrip(acc: Acc, pts: [number, number][], y0: number, y1: number, offset: number, uPer: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = -dz / len * offset, nz = dx / len * offset;
    acc.quad(
      V(ax + nx, y1, az + nz), V(bx + nx, y1, bz + nz),
      V(bx + nx, y0, bz + nz), V(ax + nx, y0, az + nz),
      Math.max(0.05, len / 4) * uPer, 1
    );
  }
}

function segIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/* ---------- building archetypes ---------- */
interface Arch { kind: 'tower' | 'office' | 'walkup' | 'house' | 'shack'; enterable: boolean }
function archetypeOf(b: Bldg): Arch {
  if (b.h >= 26 || b.lv >= 8) return { kind: 'tower', enterable: true };
  if (b.h >= 11 || b.lv >= 4) return { kind: 'office', enterable: b.t !== 'house' };
  if (b.h >= 5.5) return { kind: 'walkup', enterable: b.t === 'retail' || b.t === 'commercial' || !!b.n };
  if (b.h >= 3.4) return { kind: 'house', enterable: false };
  return { kind: 'shack', enterable: false };
}

const SIGNS: Array<[string, string, string]> = [
  ['#123f6b', '#ffffff', 'BANK PLC'], ['#a31414', '#ffe9b0', 'SUPERMARKET'],
  ['#0f5132', '#ffffff', 'PHARMACY'], ['#7a1010', '#ffd76a', 'PHONE PLAZA'],
  ['#20304a', '#cfe2ff', 'FASHION HOUSE'], ['#5b3a12', '#ffe9b0', 'BAKERY & CAFE'],
  ['#264020', '#d8f0c0', 'LOUNGE'], ['#3a2a55', '#e2ccff', 'TECH HUB']
];

function buildingMeshes(scene: Scene, kit: Kit, b: Bldg, out: Map<MatKey, Acc>, colliders: Collider[], detail: boolean, rng: () => number, signAnchors: { pos: Vector3; rotY: number }[]): void {
  const arch = archetypeOf(b);
  const p = b.p;
  // footprint bounds
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const baseY = 0.15;
  const floors = Math.max(1, Math.round(b.h / 3.2));
  const wallMat: MatKey = arch.kind === 'tower' ? 'glass' : arch.kind === 'office' ? 'wallWin' : arch.kind === 'walkup' ? 'wallWin' : 'wallPaint';

  // find front edge (closest to chunk roads is unknown here; use longest edge heuristic for shopfronts)
  let fi = 0, flen = -1;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > flen) { flen = l; fi = i; }
  }
  const enter = arch.enterable && flen >= 4 && detail;

  // plinth
  const pl = out.get('curb')!;
  pl.quad(V(x0 - 0.35, baseY, z0 - 0.35), V(x1 + 0.35, baseY, z0 - 0.35), V(x1 + 0.35, baseY, z1 + 0.35), V(x0 - 0.35, baseY, z1 + 0.35), (x1 - x0) / 4, (z1 - z0) / 4);

  // walls per edge (skip most of front edge ground floor if enterable)
  const wallAcc = out.get(wallMat)!;
  const trimAcc = out.get('trim')!;
  const gfH = 3.4;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.3) continue;
    const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
    const uRep = Math.max(1, Math.round(len / 4));
    const isFront = enter && i === fi;
    if (isFront) {
      // ground floor: pilasters + recessed glass shopfront + opening
      const openW = Math.min(3.2, len * 0.55);
      const sideW = (len - openW) / 2;
      const glassAcc = out.get('glass')!;
      // two side pilasters (full gf height)
      for (const [s0, s1] of [[0, sideW], [len - sideW, len]] as const) {
        wallAcc.quad(
          V(a[0] + dx * s0, baseY + gfH, a[1] + dz * s0), V(a[0] + dx * s1, baseY + gfH, a[1] + dz * s1),
          V(a[0] + dx * s1, baseY, a[1] + dz * s1), V(a[0] + dx * s0, baseY, a[1] + dz * s0), 1, 1);
      }
      // header above opening
      wallAcc.quad(
        V(a[0] + dx * sideW, baseY + gfH, a[1] + dz * sideW), V(a[0] + dx * (sideW + openW), baseY + gfH, a[1] + dz * (sideW + openW)),
        V(a[0] + dx * (sideW + openW), baseY + gfH - 0.7, a[1] + dz * (sideW + openW)), V(a[0] + dx * sideW, baseY + gfH - 0.7, a[1] + dz * sideW), 1, 1);
      // recessed glass wall (inset 1.1m) behind opening — visible from street
      const ix = -dz * 1.1, iz = dx * 1.1; // inward normal guess (perp)
      const g0x = a[0] + dx * (sideW + 0.25) + ix * 0.15, g0z = a[1] + dz * (sideW + 0.25) + iz * 0.15;
      const g1x = a[0] + dx * (sideW + openW - 0.25) + ix * 0.15, g1z = a[1] + dz * (sideW + openW - 0.25) + iz * 0.15;
      glassAcc.quad(
        V(g0x, baseY + gfH - 0.7, g0z), V(g1x, baseY + gfH - 0.7, g1z),
        V(g1x, baseY + 0.25, g1z), V(g0x, baseY + 0.25, g0z), 2, 1);
      // interior back wall + side returns + floor + ceiling
      const intAcc = out.get('interior')!;
      const d = Math.min(4.2, Math.max(2.6, (x1 - x0 + z1 - z0) * 0.25));
      const bx = a[0] + dx * (sideW + openW / 2) + ix * d, bz = a[1] + dz * (sideW + openW / 2) + iz * d;
      const half = openW / 2 - 0.25;
      intAcc.quad( // back wall
        V(bx - dx * half, baseY + gfH - 0.7, bz - dz * half), V(bx + dx * half, baseY + gfH - 0.7, bz + dz * half),
        V(bx + dx * half, baseY + 0.15, bz + dz * half), V(bx - dx * half, baseY + 0.15, bz - dz * half), 2, 1);
      for (const sgn of [-1, 1]) { // returns
        intAcc.quad(
          V(bx + dx * half * sgn, baseY + gfH - 0.7, bz + dz * half * sgn), V(a[0] + dx * (sideW + openW / 2 + half * sgn) + ix * 0.2, baseY + gfH - 0.7, a[1] + dz * (sideW + openW / 2 + half * sgn) + iz * 0.2),
          V(a[0] + dx * (sideW + openW / 2 + half * sgn) + ix * 0.2, baseY + 0.15, a[1] + dz * (sideW + openW / 2 + half * sgn) + iz * 0.2), V(bx + dx * half * sgn, baseY + 0.15, bz + dz * half * sgn), 1, 1);
      }
      intAcc.quad( // floor
        V(a[0] + dx * (sideW + 0.25) + ix * 0.2, baseY + 0.16, a[1] + dz * (sideW + 0.25) + iz * 0.2),
        V(a[0] + dx * (sideW + openW - 0.25) + ix * 0.2, baseY + 0.16, a[1] + dz * (sideW + openW - 0.25) + iz * 0.2),
        V(bx + dx * half, baseY + 0.16, bz + dz * half), V(bx - dx * half, baseY + 0.16, bz - dz * half), 2, 2);
      // ceiling slab + light strip
      const slabAcc = out.get('curb')!;
      slabAcc.quad(
        V(a[0] + dx * sideW, baseY + gfH, a[1] + dz * sideW), V(a[0] + dx * (sideW + openW), baseY + gfH, a[1] + dz * (sideW + openW)),
        V(bx + dx * half, baseY + gfH, bz + dz * half), V(bx - dx * half, baseY + gfH, bz - dz * half), 1, 1);
      const litAcc = out.get('light')!;
      litAcc.quad(
        V(bx - dx * half * 0.7, baseY + gfH - 0.06, bz - dz * half * 0.7), V(bx + dx * half * 0.7, baseY + gfH - 0.06, bz + dz * half * 0.7),
        V(bx + dx * half * 0.7, baseY + gfH - 0.10, bz + dz * half * 0.7), V(bx - dx * half * 0.7, baseY + gfH - 0.10, bz - dz * half * 0.7), 1, 1);
      // counter + shelves
      const dAcc = out.get('dark')!;
      const cw = openW * 0.55;
      dAcc.quad(V(bx - dx * cw, 1.15, bz - dz * cw), V(bx + dx * cw, 1.15, bz + dz * cw), V(bx + dx * cw, 0.95, bz + dz * cw), V(bx - dx * cw, 0.95, bz - dz * cw), 1, 1);
      if (rng() < 0.7) {
        for (let s = 0; s < 2; s++) {
          const sy = 0.7 + s * 0.65;
          dAcc.quad(V(bx - dx * (half * 0.8), baseY + sy, bz - dz * (half * 0.8)), V(bx - dx * (half * 0.2), baseY + sy, bz - dz * (half * 0.2)),
            V(bx - dx * (half * 0.2), baseY + sy - 0.06, bz - dz * (half * 0.2)), V(bx - dx * (half * 0.8), baseY + sy - 0.06, bz - dz * (half * 0.8)), 1, 1);
        }
      }
      // awning
      const awAcc = out.get('awning')!;
      const ay = baseY + gfH - 0.55;
      awAcc.quad(
        V(a[0] + dx * (sideW - 0.15), ay, a[1] + dz * (sideW - 0.15)), V(a[0] + dx * (sideW + openW + 0.15), ay, a[1] + dz * (sideW + openW + 0.15)),
        V(a[0] + dx * (sideW + openW + 0.15) - ix * 1.5, ay - 0.22, a[1] + dz * (sideW + openW + 0.15) - iz * 1.5), V(a[0] + dx * (sideW - 0.15) - ix * 1.5, ay - 0.22, a[1] + dz * (sideW - 0.15) - iz * 1.5), 3, 1);
      // colliders: front split around opening + interior sides
      const m = 0.06;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      colliders.push({ x0: x0 + m, z0: z0 + m, x1: x1 - m, z1: a[1] - 0.3 > cz ? cz - 0.4 : cz + 0.4, h: b.h }); // simplified: back half solid
      colliders.push({ x0: x0 + m, z0: cz - 0.2, x1: a[0] - 0.6 > cx ? cx + 0.2 : cx - 0.2, z1: z1 - m, h: b.h });
      colliders.push({ x0: a[0] < cx ? x1 - 0.5 : x0 + 0.5, z0: cz - 0.2, x1: a[0] < cx ? x1 - m : x0 + m, z1: z1 - m, h: b.h });
    } else {
      wallAcc.quad(
        V(a[0], baseY + b.h, a[1]), V(c[0], baseY + b.h, c[1]),
        V(c[0], baseY, c[1]), V(a[0], baseY, a[1]), uRep, Math.max(1, Math.round(b.h / 3.4)));
      if (!enter) colliders.push({ x0: Math.min(a[0], c[0]) - 0.02, z0: Math.min(a[1], c[1]) - 0.02, x1: Math.max(a[0], c[0]) + 0.02, z1: Math.max(a[1], c[1]) + 0.02, h: b.h });
    }
  }

  // roof
  const roofAcc = out.get(arch.kind === 'house' || arch.kind === 'shack' ? 'zinc' : 'curb')!;
  const top = baseY + b.h;
  if (arch.kind === 'house' || arch.kind === 'shack') {
    // gable: ridge along longest axis
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const wide = (x1 - x0) >= (z1 - z0);
    const ridge = top + Math.min(1.6, b.h * 0.35);
    if (wide) {
      roofAcc.quad(V(x0, ridge, cz), V(x1, ridge, cz), V(x1, top, z1), V(x0, top, z1), (x1 - x0) / 3, (z1 - z0) / 3);
      roofAcc.quad(V(x1, ridge, cz), V(x0, ridge, cz), V(x0, top, z0), V(x1, top, z0), (x1 - x0) / 3, (z1 - z0) / 3);
    } else {
      roofAcc.quad(V(cx, ridge, z0), V(cx, ridge, z1), V(x1, top, z1), V(x1, top, z0), (z1 - z0) / 3, (x1 - x0) / 3);
      roofAcc.quad(V(cx, ridge, z1), V(cx, ridge, z0), V(x0, top, z0), V(x0, top, z1), (z1 - z0) / 3, (x1 - x0) / 3);
    }
  } else {
    // flat roof cap (fan)
    for (let i = 1; i < p.length - 1; i++) {
      roofAcc.quad(V(p[0][0], top, p[0][1]), V(p[i][0], top, p[i][1]), V(p[i + 1][0], top, p[i + 1][1]), V(p[0][0], top, p[0][1]), 1, 1);
    }
    // parapet
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      trimAcc.quad(V(a[0], top + 0.5, a[1]), V(c[0], top + 0.5, c[1]), V(c[0], top, c[1]), V(a[0], top, a[1]), 1, 1);
    }
    // roof clutter (tanks/AC)
    if (detail) {
      const nAC = arch.kind === 'tower' ? 2 + Math.floor(rng() * 3) : 1;
      const dAcc = out.get('metal')!;
      for (let i = 0; i < nAC; i++) {
        const bx = x0 + 0.8 + rng() * Math.max(0.5, (x1 - x0 - 1.6));
        const bz = z0 + 0.8 + rng() * Math.max(0.5, (z1 - z0 - 1.6));
        const s = 0.6 + rng() * 0.7;
        dAcc.quad(V(bx - s, top + 0.4 + s * 0.6, bz - s), V(bx + s, top + 0.4 + s * 0.6, bz + s), V(bx + s, top + 0.4, bz + s), V(bx - s, top + 0.4, bz - s), 1, 1);
      }
    }
  }

  // signage: named buildings + shopfronts
  if (detail) {
    const name = b.n || (arch.kind === 'tower' ? '' : SIGNS[Math.floor(rng() * SIGNS.length)][2]);
    const label = b.n ? b.n.split(' ').slice(0, 3).join(' ') : name;
    if (label && (enter || arch.kind === 'tower')) {
      const a = p[fi], c = p[(fi + 1) % p.length];
      const len = Math.max(0.3, Math.hypot(c[0] - a[0], c[1] - a[1]));
      const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const sy = enter ? baseY + gfH + 0.45 : baseY + b.h - 1.6;
      const sw = Math.min(6, Math.max(2, len * 0.6));
      const acc2 = new Acc();
      const pal = SIGNS[Math.floor(rng() * SIGNS.length)];
      const mat = new StandardMaterial('sign_' + label.slice(0, 10), scene);
      mat.diffuseTexture = texSign(scene, enter ? pal[0] : '#1c2733', '#ffffff', label.toUpperCase());
      mat.emissiveColor = new Color3(0.55, 0.5, 0.45);
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      const nx = -dz, nz2 = dx;
      acc2.quad(V(mx - dx * sw / 2, sy, mz - dz * sw / 2), V(mx + dx * sw / 2, sy, mz + dz * sw / 2),
        V(mx + dx * sw / 2 - nx * 0.06, sy - 0.9, mz + dz * sw / 2 - nz2 * 0.06), V(mx - dx * sw / 2 - nx * 0.06, sy - 0.9, mz - dz * sw / 2 - nz2 * 0.06), 1, 1);
      const sm = acc2.mesh(scene, 'sign_' + label.slice(0, 10) + '_m', mat);
      if (sm) signAnchors.push({ pos: sm.position.clone(), rotY: 0 });
      void sm;
    }
  }
}

/* ---------- main chunk builder ---------- */
export function buildChunk(cd: ChunkData, cx: number, cz: number, kit: Kit, env: import('./environment').Environment, detail: boolean, seedStr: string): ChunkBuild {
  const scene = kit.scene;
  let s = 0;
  const rng = (): number => { s = (s * 1103515245 + 12345 + seedStr.length * 7919) & 0x7fffffff; return (s % 100000) / 100000; };
  for (let i = 0; i < 7; i++) rng();
  const out = new Map<MatKey, Acc>();
  for (const k of Object.keys(kit.mats) as MatKey[]) out.set(k, new Acc());
  const colliders: Collider[] = [];
  const roads: RoadSeg[] = [];
  const signAnchors: { pos: Vector3; rotY: number }[] = [];

  // dirt base
  const dirt = out.get('dirt')!;
  dirt.quad(V(0, 0.005, 0), V(CHUNK, 0.005, 0), V(CHUNK, 0.005, CHUNK), V(0, 0.005, CHUNK), 10, 10);

  // green + water
  for (const g of cd.g) {
    const acc = out.get('grass')!;
    for (let i = 1; i < g.p.length - 1; i++) {
      acc.quad(V(g.p[0][0], 0.06, g.p[0][1]), V(g.p[i][0], 0.06, g.p[i][1]), V(g.p[i + 1][0], 0.06, g.p[i + 1][1]), V(g.p[0][0], 0.06, g.p[0][1]), 1, 1);
    }
  }
  for (const w of cd.w) {
    const acc = out.get('water')!;
    for (let i = 1; i < w.p.length - 1; i++) {
      acc.quad(V(w.p[0][0], 0.04, w.p[0][1]), V(w.p[i][0], 0.04, w.p[i][1]), V(w.p[i + 1][0], 0.04, w.p[i + 1][1]), V(w.p[0][0], 0.04, w.p[0][1]), 1, 1);
    }
  }

  // roads: asphalt + curbs + gutters + sidewalks
  for (const r of cd.r) {
    const major = ['primary', 'secondary', 'trunk', 'motorway', 'tertiary'].includes(r.t);
    roads.push({ pts: r.p, w: r.w, major });
    const half = r.w / 2;
    roadRibbonV(out.get('asphalt')!, r.p, r.w, 0.03);
    // curbs + gutter
    wallStrip(out.get('curb')!, r.p, 0.03, 0.15, half, 1);
    wallStrip(out.get('curb')!, r.p, 0.03, 0.15, -half, 1);
    roadRibbon(out.get('gutter')!, r.p, r.w + 0.5, 0.035, 1);
    // sidewalks (raised, both sides)
    roadRibbon(out.get('sidewalk')!, offsetLine(r.p, half + 1.15), 2.0, 0.16, 1);
    roadRibbon(out.get('sidewalk')!, offsetLine(r.p, -(half + 1.15)), 2.0, 0.16, 1);
    // center dashes on major
    if (major && detail) {
      const acc = out.get('trim')!;
      let acc2 = 0;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const ux = dx / len, uz = dz / len;
        for (let t = 0; t < len; t += 4.5) {
          if (acc2 % 2 === 0) {
            const t1 = Math.min(t + 2.2, len);
            const nx = -uz * 0.14, nz = ux * 0.14;
            acc.quad(
              V(a[0] + ux * t + nx, 0.045, a[1] + uz * t + nz), V(a[0] + ux * t1 + nx, 0.045, a[1] + uz * t1 + nz),
              V(a[0] + ux * t1 - nx, 0.045, a[1] + uz * t1 - nz), V(a[0] + ux * t - nx, 0.045, a[1] + uz * t - nz), 1, 1);
          }
          acc2++;
        }
      }
    }
  }

  // zebra crossings at internal intersections
  if (detail) {
    let placed = 0;
    for (let i = 0; i < cd.r.length && placed < 6; i++) {
      for (let j = i + 1; j < cd.r.length && placed < 6; j++) {
        const A = cd.r[i], B = cd.r[j];
        for (let a = 0; a < A.p.length - 1 && placed < 6; a++) {
          for (let b = 0; b < B.p.length - 1 && placed < 6; b++) {
            if (segIntersect(A.p[a], A.p[a + 1], B.p[b], B.p[b + 1])) {
              const px = (A.p[a][0] + A.p[a + 1][0]) / 2, pz = (A.p[a][1] + A.p[a + 1][1]) / 2;
              drawCrossing(out.get('trim')!, A, px, pz);
              drawCrossing(out.get('trim')!, B, px, pz);
              placed++;
            }
          }
        }
      }
    }
  }

  // buildings
  for (const b of cd.b) {
    buildingMeshes(scene, kit, b, out, colliders, detail, rng, signAnchors);
  }

  // props (near ring only) — accumulate into the same material buckets (zero extra draw calls)
  let billboards: BillboardPlacement[] = [];
  if (detail) billboards = decorateAcc(kit, cd, roads, rng, out);

  // finalize buckets -> merged meshes
  const root = new Mesh('chunk_' + cd.k, scene);
  root.isPickable = false;
  root.position.set(cx * CHUNK, 0, cz * CHUNK);
  for (const k of Object.keys(kit.mats) as MatKey[]) {
    const m = out.get(k)!.mesh(scene, `c_${cd.k}_${k}`, kit.mats[k]);
    if (m) { m.parent = root; if (k !== 'light' && k !== 'water' && k !== 'trim') env.addCaster(m, false); }
  }
  // billboard sign panels (textured, few per chunk)
  for (const bb of billboards) {
    const ad = bb.line.split('·');
    const mat = new StandardMaterial(`bbm_${cd.k}`, scene);
    mat.diffuseTexture = texSign(scene, bb.bg, bb.fg, ad[0].trim(), ad[1]?.trim());
    mat.emissiveColor = new Color3(0.5, 0.47, 0.42);
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    const panel = MeshBuilder.CreatePlane(`bbp_${cd.k}`, { width: 6.4, height: 3.2 }, scene);
    panel.position.set(bb.x, 7.7, bb.z);
    panel.rotation.y = bb.rotY;
    panel.material = mat;
    panel.parent = root;
    panel.isPickable = false;
    const back = MeshBuilder.CreatePlane(`bbpb_${cd.k}`, { width: 6.4, height: 3.2 }, scene);
    back.position.set(bb.x, 7.7, bb.z);
    back.rotation.y = bb.rotY + Math.PI;
    back.material = kit.mats.dark;
    back.parent = root;
    back.isPickable = false;
  }

  return { root, colliders, roads, signAnchors };
}

function drawCrossing(acc: Acc, road: { p: [number, number][]; w: number }, px: number, pz: number): void {
  // nearest point on road centerline
  let bx = road.p[0][0], bz = road.p[0][1], bd = 1e9;
  let bdx = 0, bdz = 0;
  for (let i = 0; i < road.p.length - 1; i++) {
    const a = road.p[i], b = road.p[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
    const qx = a[0] + dx * t, qz = a[1] + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < bd) { bd = d; bx = qx; bz = qz; bdx = dx / Math.sqrt(l2); bdz = dz / Math.sqrt(l2); }
  }
  if (bd > 14) return;
  const w = road.w - 1.0;
  const nx = -bdz, nz = bdx;
  for (let s = -2; s <= 2; s++) {
    const o = s * 1.1;
    const sw = 0.55;
    acc.quad(
      V(bx + nx * (o - sw) - bdx * (w / 2), 0.05, bz + nz * (o - sw) - bdz * (w / 2)),
      V(bx + nx * (o - sw) + bdx * (w / 2), 0.05, bz + nz * (o - sw) + bdz * (w / 2)),
      V(bx + nx * (o + sw) + bdx * (w / 2), 0.05, bz + nz * (o + sw) + bdz * (w / 2)),
      V(bx + nx * (o + sw) - bdx * (w / 2), 0.05, bz + nz * (o + sw) - bdz * (w / 2)), 1, 1);
  }
}

function offsetLine(pts: [number, number][], off: number): [number, number][] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / l * off, p[1] + dx / l * off] as [number, number];
  });
}

// roadRibbon legacy replaced by roadRibbonV
void roadRibbon;
