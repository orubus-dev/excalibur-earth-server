/** game/builders.ts — chunk JSON -> merged production meshes + collision + prop dressing. */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK, BLOCK, BLOCKS, seedRng } from './geo';
import type { ChunkData } from '@/lib/osm';
import { makeFacades, makeGround, makeRoad, makeGrass, makeWater, makeBillboard, makeGlow, type FacadeSet } from './textures';

export interface ChunkBuild {
  group: THREE.Group;                 // placed at chunk origin
  colliders: Array<{ x0: number; z0: number; x1: number; z1: number }>; // chunk-local AABBs
  roadsForSim: Array<{ pts: Array<[number, number]>; w: number; major: boolean }>;
  dispose(): void;
}

/* ---------- shared material bank (created once per session) ---------- */
export interface MatBank {
  facade: FacadeSet;
  wallMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
  groundMat: THREE.MeshStandardMaterial;
  roadMajor: THREE.MeshStandardMaterial;
  roadMinor: THREE.MeshStandardMaterial;
  roadFoot: THREE.MeshStandardMaterial;
  grassMat: THREE.MeshStandardMaterial;
  waterMat: THREE.MeshStandardMaterial;
  propMat: THREE.MeshStandardMaterial;
  trunkMat: THREE.MeshStandardMaterial;
  frondMat: THREE.MeshStandardMaterial;
  poleMat: THREE.MeshStandardMaterial;
  glowTex: THREE.Texture;
  headTex: THREE.Texture;
}

export function makeMatBank(): MatBank {
  const facade = makeFacades();
  const ground = makeGround();
  ground.repeat.set(CHUNK / 8, CHUNK / 8);
  const water = makeWater();
  const grass = makeGrass();

  const wallMat = new THREE.MeshStandardMaterial({
    map: facade.map, emissiveMap: facade.emissive, roughnessMap: facade.roughness,
    roughness: 1, metalness: 0.08, vertexColors: true,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 0
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.92, metalness: 0.05, vertexColors: true });
  const groundMat = new THREE.MeshStandardMaterial({ map: ground, roughness: 0.96, metalness: 0.02 });
  const rm = (kind: 'major' | 'minor' | 'foot') => {
    const t = makeRoad(kind);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
  };
  return {
    facade, wallMat, roofMat, groundMat,
    roadMajor: rm('major'), roadMinor: rm('minor'), roadFoot: rm('foot'),
    grassMat: new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    waterMat: new THREE.MeshStandardMaterial({ map: water.map, roughness: water.rough, metalness: water.metal, transparent: true, opacity: 0.94, side: THREE.DoubleSide }),
    propMat: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, vertexColors: true }),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.95 }),
    frondMat: new THREE.MeshStandardMaterial({ color: 0x3f7a34, roughness: 0.9, side: THREE.DoubleSide }),
    poleMat: new THREE.MeshStandardMaterial({ color: 0x50565c, roughness: 0.6, metalness: 0.5 }),
    glowTex: makeGlow('#ffd9a0'),
    headTex: makeGlow('#cfe4ff')
  };
}

/* ---------- geometry helpers ---------- */
function triGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
  return merged;
}

function wallGeometry(ptsRaw: Array<[number, number]>, h: number, tint: THREE.Color): { wall: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  // normalize winding: CCW in (x, z) via signed area (shoelace, y-up cross convention)
  let area = 0;
  for (let i = 0; i < ptsRaw.length; i++) {
    const a = ptsRaw[i], b = ptsRaw[(i + 1) % ptsRaw.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area < 0 ? [...ptsRaw].reverse() : ptsRaw;
  // centroid for outward-normal test
  let ccx = 0, ccz = 0;
  for (const q of pts) { ccx += q[0]; ccz += q[1]; }
  ccx /= pts.length; ccz /= pts.length;
  // walls: quads per edge with window-grid UVs (cell 3.2m vertical, 2.6m horizontal)
  // roof: fan triangulation at y=h with per-triangle upward-winding fix
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const rpos: number[] = [], rnor: number[] = [], ruv: number[] = [], rcol: number[] = [], ridx: number[] = [];
  let vi = 0, ri = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ax = a[0], az = a[1], bx = b[0], bz = b[1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -dz / len, nz = dx / len;               // candidate normal
    if (nx * (mx - ccx) + nz * (mz - ccz) < 0) { nx = -nx; nz = -nz; }  // force outward
    const u0 = 0, u1 = len / 2.6, v1 = h / 3.2;
    pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
    for (let k = 0; k < 4; k++) { nor.push(nx, 0, nz); col.push(tint.r, tint.g, tint.b); }
    uv.push(u0, 0, u1, 0, u1, v1, u0, v1);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  // roof triangulation (in shape space z->y); fix each triangle to face +y
  const v2pts = pts.map(p => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v2pts, []);
  const flat = pts.flat();
  const minX = Math.min(...flat.filter((_, i) => i % 2 === 0)), minZ = Math.min(...flat.filter((_, i) => i % 2 === 1));
  for (const t of tris) {
    const P = t.map(pi => pts[pi]);
    // triangle normal in (x,z) plane: cross of (P1-P0, P2-P0) on y-up basis
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
    const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1]];
    const ny = e1[1] * e2[0] - e1[0] * e2[1]; // z-component of (x,y,0)x(x,y,0) mapped to y-up
    const order = ny > 0 ? [t[0], t[2], t[1]] : [t[0], t[1], t[2]];
    for (const pi of order) {
      const x = pts[pi][0], z = pts[pi][1];
      rpos.push(x, h, z);
      rnor.push(0, 1, 0);
      ruv.push((x - minX) / 3.2, (z - minZ) / 3.2);
      rcol.push(tint.r, tint.g, tint.b);
    }
    ridx.push(ri, ri + 1, ri + 2);
    ri += 3;
  }
  const mk = (p: number[], n: number[], u: number[], c: number[], i: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(i);
    return g;
  };
  return { wall: mk(pos, nor, uv, col, idx), roof: mk(rpos, rnor, ruv, rcol, ridx) };
}

function ribbon(ptsRun: Array<[number, number]>, w: number, y: number, texScaleV = 10): THREE.BufferGeometry {
  // triangle strip along polyline with UV v = distance/texScaleV
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let vi = 0, dist = 0;
  for (let i = 0; i < ptsRun.length; i++) {
    const p = ptsRun[i];
    const prev = ptsRun[Math.max(0, i - 1)], next = ptsRun[Math.min(ptsRun.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l; // left normal
    if (i > 0) dist += Math.hypot(p[0] - ptsRun[i - 1][0], p[1] - ptsRun[i - 1][1]);
    pos.push(p[0] + (nx * w) / 2, y, p[1] + (nz * w) / 2);
    pos.push(p[0] - (nx * w) / 2, y, p[1] - (nz * w) / 2);
    nor.push(0, 1, 0, 0, 1, 0);
    const v = dist / texScaleV;
    uv.push(0, v, 1, v);
    if (i > 0) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
    vi += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function polyGeometry(pts: Array<[number, number]>, y: number, uvScale = 8): THREE.BufferGeometry | null {
  const flat = pts.flat();
  const xs = flat.filter((_, i) => i % 2 === 0), zs = flat.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
  if (!tris.length) return null;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let vi = 0;
  for (const t of tris) {
    for (const pi of t) {
      const x = pts[pi][0], z = pts[pi][1];
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      uv.push((x - minX) / uvScale, (z - minZ) / uvScale);
    }
    idx.push(vi, vi + 1, vi + 2);
    vi += 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ---------- props (10m-block deterministic) ---------- */
function colorize(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

function addPalm(parts: THREE.BufferGeometry[], rng: () => number, at: [number, number]): void {
  const h = 4 + rng() * 3.5;
  const bend = (rng() - 0.5) * 1.6;
  const trunk = new THREE.CylinderGeometry(0.14, 0.22, h, 5);
  trunk.translate(at[0] + bend * 0.35, h / 2, at[1]);
  parts.push(colorize(trunk, 0x7a5c3a));
  for (let f = 0; f < 7; f++) {
    const ang = (f / 7) * Math.PI * 2 + rng();
    const fl = 2.1 + rng() * 1.1;
    const frond = new THREE.PlaneGeometry(fl, 0.5, 3, 1);
    const fp = frond.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const fx = fp.getX(i) + fl / 2;
      fp.setZ(i, -Math.pow(fx / fl, 2) * 1.3);
    }
    frond.rotateY(ang);
    frond.rotateZ(-0.45 - rng() * 0.3);
    frond.translate(at[0] + bend * 0.8, h, at[1]);
    parts.push(colorize(frond, 0x3f7a34));
  }
}

function addTree(parts: THREE.BufferGeometry[], rng: () => number, at: [number, number]): void {
  const h = 3 + rng() * 2.5;
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, h, 5);
  trunk.translate(at[0], h / 2, at[1]);
  parts.push(colorize(trunk, 0x6b4d2e));
  const r = 1.4 + rng() * 1.2;
  const crown = new THREE.SphereGeometry(r, 7, 6);
  crown.scale(1, 0.8, 1);
  crown.translate(at[0], h + r * 0.5, at[1]);
  parts.push(colorize(crown, 0x477a36));
}

function addStreetlight(parts: THREE.BufferGeometry[], bulbs: number[], at: [number, number], dirX: number, dirZ: number): void {
  const h = 7;
  const pole = new THREE.CylinderGeometry(0.09, 0.13, h, 5);
  pole.translate(at[0], h / 2, at[1]);
  parts.push(colorize(pole, 0x50565c));
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 4);
  arm.rotateZ(Math.PI / 2);
  arm.rotateY(Math.atan2(dirZ, dirX));
  arm.translate(at[0] + dirX * 0.8, h, at[1] + dirZ * 0.8);
  parts.push(colorize(arm, 0x50565c));
  bulbs.push(at[0] + dirX * 1.6, h - 0.25, at[1] + dirZ * 1.6);
}

function addBoxProp(parts: THREE.BufferGeometry[], at: [number, number], rng: () => number, w: number, d: number, h: number, color: number, rot = 0): void {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(rot);
  g.translate(at[0], h / 2, at[1]);
  parts.push(colorize(g, color));
}

/* ---------- main builder ---------- */
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']);

export function buildChunk(cd: ChunkData, mats: MatBank): ChunkBuild {
  const group = new THREE.Group();
  const rng = seedRng('ee:' + cd.k);
  const geos = {
    wall: [] as THREE.BufferGeometry[], roof: [] as THREE.BufferGeometry[],
    roadMajor: [] as THREE.BufferGeometry[], roadMinor: [] as THREE.BufferGeometry[], roadFoot: [] as THREE.BufferGeometry[],
    water: [] as THREE.BufferGeometry[], green: [] as THREE.BufferGeometry[], props: [] as THREE.BufferGeometry[]
  };
  const bulbs: number[] = [];
  const colliders: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  const roadsForSim: Array<{ pts: Array<[number, number]>; w: number; major: boolean }> = [];

  // ground base
  const gnd = new THREE.PlaneGeometry(CHUNK, CHUNK);
  gnd.rotateX(-Math.PI / 2);
  gnd.translate(CHUNK / 2, 0, CHUNK / 2);
  const groundMesh = new THREE.Mesh(gnd, mats.groundMat);
  group.add(groundMesh);

  // buildings
  for (const b of cd.b) {
    const tint = new THREE.Color().setHSL(0.07 + rng() * 0.06, 0.10 + rng() * 0.14, 0.70 + rng() * 0.2);
    if (b.h > 18) tint.setHSL(0.55 + rng() * 0.05, 0.08, 0.62 + rng() * 0.16); // glass tower cool
    const { wall, roof } = wallGeometry(b.p, b.h, tint);
    geos.wall.push(wall);
    geos.roof.push(roof);
    const xs = b.p.map(p => p[0]), zs = b.p.map(p => p[1]);
    colliders.push({ x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) });
  }

  // roads
  for (const r of cd.r) {
    const major = MAJOR.has(r.t);
    const y = r.t === 'footway' || r.t === 'path' ? 0.055 : major ? 0.03 : 0.04;
    const g = ribbon(r.p, r.w, y);
    const bucket = major ? geos.roadMajor : (r.t === 'footway' || r.t === 'path' || r.t === 'pedestrian') ? geos.roadFoot : geos.roadMinor;
    bucket.push(g);
    if (major || r.t === 'tertiary' || r.t === 'residential') roadsForSim.push({ pts: r.p, w: r.w, major });
  }

  // water + green
  for (const wp of cd.w) { const g = polyGeometry(wp.p, 0.01, 14); if (g) geos.water.push(g); }
  for (const gp of cd.g) { const g = polyGeometry(gp.p, 0.02, 7); if (g) geos.green.push(g); }

  // props per 10m block (deterministic), guided by roads
  const roadPts: Array<[number, number]> = [];
  for (const r of cd.r) for (const p of r.p) roadPts.push(p);
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      const r1 = rng(), r2 = rng(), r3 = rng();
      const bxw = (bx + 0.5) * BLOCK, bzw = (bz + 0.5) * BLOCK;
      // skip if inside a building footprint (rough: any collider contains block center)
      let covered = false;
      for (const c of colliders) {
        if (bxw > c.x0 - 1 && bxw < c.x1 + 1 && bzw > c.z0 - 1 && bzw < c.z1 + 1) { covered = true; break; }
      }
      if (covered) continue;
      // nearest road distance
      let nd = 1e9, ndir: [number, number] = [1, 0];
      for (let i = 0; i < roadPts.length; i += 2) {
        const d = Math.hypot(roadPts[i][0] - bxw, roadPts[i][1] - bzw);
        if (d < nd) {
          nd = d;
          const q = roadPts[Math.min(i + 1, roadPts.length - 1)];
          const dl = Math.hypot(q[0] - roadPts[i][0], q[1] - roadPts[i][1]) || 1;
          ndir = [(q[0] - roadPts[i][0]) / dl, (q[1] - roadPts[i][1]) / dl];
        }
      }
      if (nd < 9 && r1 < 0.30) addStreetlight(geos.props, bulbs, [bxw + ndir[0] * 5.2, bzw + ndir[1] * 5.2], ndir[0], ndir[1]);
      else if (nd < 12 && r1 < 0.42) addPalm(geos.props, rng, [bxw + ndir[1] * (5 + r3 * 3), bzw - ndir[0] * (5 + r3 * 3)]);
      else if (nd < 14 && r2 < 0.22) addTree(geos.props, rng, [bxw, bzw]);
      else if (nd < 11 && r2 < 0.16) {
        // street life: kiosk / generator / crates (Lagos flavor)
        const which = r3;
        if (which < 0.4) addBoxProp(geos.props, [bxw, bzw], rng, 2.6, 2.0, 2.3, 0x8a6b4a, rng() * 3);
        else if (which < 0.7) addBoxProp(geos.props, [bxw, bzw], rng, 1.4, 0.9, 1.0, 0x5c6470, rng() * 3);
        else addBoxProp(geos.props, [bxw, bzw], rng, 0.9, 0.9, 0.7, 0xa3865c, rng() * 3);
      } else if (nd < 10 && r2 > 0.955) {
        // billboard post facing road
        addBoxProp(geos.props, [bxw, bzw], rng, 0.3, 0.3, 6.5, 0x3a3f45);
      }
    }
  }

  // merge + add meshes
  const addMerged = (list: THREE.BufferGeometry[], mat: THREE.Material): void => {
    const g = triGeoms(list);
    if (g) group.add(new THREE.Mesh(g, mat));
  };
  addMerged(geos.wall, mats.wallMat);
  addMerged(geos.roof, mats.roofMat);
  addMerged(geos.roadMajor, mats.roadMajor);
  addMerged(geos.roadMinor, mats.roadMinor);
  addMerged(geos.roadFoot, mats.roadFoot);
  addMerged(geos.water, mats.waterMat);
  addMerged(geos.green, mats.grassMat);
  if (geos.props.length) {
    const pg = triGeoms(geos.props);
    if (pg) group.add(new THREE.Mesh(pg, mats.propMat));
  }

  // light bulbs as one Points cloud (night glow)
  let bulbPoints: THREE.Points | null = null;
  if (bulbs.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    bulbPoints = new THREE.Points(bg, new THREE.PointsMaterial({
      size: 2.2, map: mats.glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffd9a0, sizeAttenuation: true
    }));
    bulbPoints.visible = false;
    group.add(bulbPoints);
  }

  // billboards: real textured planes on tall poles (max 2 per chunk, near major roads)
  let bb = 0;
  for (const r of cd.r) {
    if (!MAJOR.has(r.t) || bb >= 2 || r.p.length < 2) continue;
    if (rng() > 0.22) continue;
    const p = r.p[Math.floor(rng() * (r.p.length - 1))];
    const q = r.p[r.p.length - 1];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    const px = p[0] + (dz / l) * (r.w / 2 + 2.5), pz = p[1] - (dx / l) * (r.w / 2 + 2.5);
    if (px < 2 || px > CHUNK - 2 || pz < 2 || pz > CHUNK - 2) continue;
    const skin = new THREE.MeshStandardMaterial({
      map: makeBillboard(Math.floor(rng() * 5)), emissive: 0xffffff, emissiveIntensity: 0,
      emissiveMap: undefined, roughness: 0.7, side: THREE.DoubleSide
    });
    skin.emissiveMap = skin.map;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.4), skin);
    board.position.set(px, 7.2, pz);
    board.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    group.add(board);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.5, 5), mats.poleMat);
    leg.position.set(px, 2.75, pz);
    group.add(leg);
    board.userData.nightMat = true;
    bb++;
  }

  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) disposables.push(m.geometry);
  });
  return {
    group, colliders, roadsForSim,
    dispose() {
      group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
        if ((o as THREE.Points).isPoints) (o as THREE.Points).geometry.dispose();
      });
      if (bulbPoints) bulbPoints.geometry.dispose();
    }
  };
}
