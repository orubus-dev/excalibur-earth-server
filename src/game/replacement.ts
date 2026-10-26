/** game/replacement.ts — where OSM data is sparse, we build Lagos ourselves. Deterministic. */
import type { ChunkData, Bldg, Road } from '@/lib/osm';
import { CHUNK, BLOCK, seedRng } from './geo';

const LAGOS_PAINT = [0xc9b8a3, 0xb7a692, 0xd8c9b4, 0x9fb8a8, 0xc2b39d, 0xb48f7e, 0x9aa7b5];

/** If a chunk has roads but too few buildings, generate plausible infill along its streets. */
export function applyReplacement(cd: ChunkData): ChunkData {
  const rng = seedRng('fill:' + cd.k);
  // density: buildings per road meter heuristic
  let roadLen = 0;
  for (const r of cd.r) roadLen += r.p.length;
  const need = roadLen >= 2 && cd.b.length < Math.max(3, roadLen * 2.2);
  if (!need) return cd;

  const existing = cd.b;
  const tries = 26;
  const minGap = 5.5;
  for (let i = 0; i < tries; i++) {
    const r = cd.r[Math.floor(rng() * cd.r.length)];
    if (!r || r.p.length < 2) continue;
    const seg = Math.floor(rng() * (r.p.length - 1));
    const a = r.p[seg], b = r.p[seg + 1];
    const t = 0.15 + rng() * 0.7;
    const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
    // perpendicular offset (setback from street)
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const side = rng() > 0.5 ? 1 : -1;
    const off = r.w / 2 + 1.6 + rng() * 3.4;
    const cx = px + (dz / l) * off * side, cz = pz - (dx / l) * off * side;
    if (cx < 2 || cx > CHUNK - 2 || cz < 2 || cz > CHUNK - 2) continue;
    // spacing check vs existing footprints
    let close = false;
    for (const eb of existing) {
      const mx = eb.p.reduce((s, q) => s + q[0], 0) / eb.p.length;
      const mz = eb.p.reduce((s, q) => s + q[1], 0) / eb.p.length;
      if (Math.hypot(mx - cx, mz - cz) < minGap + 3) { close = true; break; }
    }
    if (close) continue;
    // plot size aligned to 10m block feel
    const w = 6 + Math.floor(rng() * 3) * (BLOCK / 3);
    const d = 6 + Math.floor(rng() * 3) * (BLOCK / 3);
    const rot = Math.atan2(dz, dx) + (rng() > 0.5 ? Math.PI / 2 : 0);
    const h = 3.4 + rng() * rng() * 16;
    const poly = rectPoly(cx, cz, w, d, rot);
    const bld: Bldg = {
      p: poly,
      h: Math.round(h * 10) / 10,
      t: h > 9 ? 'apartments' : 'yes',
      lv: Math.max(1, Math.round(h / 3.2)),
      n: undefined
    };
    existing.push(bld);
  }
  return cd;
}

function rectPoly(cx: number, cz: number, w: number, d: number, rot: number): Array<[number, number]> {
  const hw = w / 2, hd = d / 2;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pts: Array<[number, number]> = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) {
    pts.push([cx + lx * cr - lz * sr, cz + lx * sr + lz * cr]);
  }
  return pts;
}

export function replacementTint(i: number): number {
  return LAGOS_PAINT[i % LAGOS_PAINT.length];
}
