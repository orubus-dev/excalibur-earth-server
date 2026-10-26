/**
 * lib/osm.ts — the single data contract for Excalibur: Earth world chunks.
 * Converts raw OSM XML (api.openstreetmap.org 0.6 /map) into compact chunk JSON.
 * Used by: scripts/bake-city.ts (build-time baking) and /api/world/chunk (on-demand).
 *
 * CHUNK = 80m load unit, internally an 8x8 grid of 10m BLOCKS.
 * All coordinates are chunk-LOCAL meters; client places the group at the chunk origin.
 */

export const CHUNK = 80;          // meters per load chunk
export const BLOCK = 10;          // meters per street block (8x8 per chunk)
export const BLOCKS = CHUNK / BLOCK;

export const LAGOS = {
  name: 'Lagos',
  region: 'Victoria Island',
  lat0: 6.4295,
  lon0: 3.4265,
  bakeRadius: 880                  // meters pre-baked around spawn
};

export const METERS_PER_DEG_LAT = 110574;
export function metersPerDegLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** lat/lon -> local meters relative to origin. x=east, z=south(+). */
export function latLonToLocal(lat: number, lon: number, lat0: number, lon0: number): [number, number] {
  return [(lon - lon0) * metersPerDegLon(lat0), -(lat - lat0) * METERS_PER_DEG_LAT];
}

export interface Bldg {
  p: [number, number][];   // footprint polygon (local meters)
  h: number;               // height meters
  t: string;               // OSM building tag value ('yes' | 'commercial' | ...)
  lv: number;              // levels
  n?: string;              // name
}
export interface Road {
  p: [number, number][];   // centerline polyline (local meters)
  w: number;               // width meters
  t: string;               // highway class
  n?: string;              // name
}
export interface Poly {
  p: [number, number][];
  n?: string;
}
export interface ChunkData {
  k: string;               // "cx_cz"
  b: Bldg[];
  r: Road[];
  w: Poly[];
  g: Poly[];
  d: number;               // raw way count (density signal for replacement fill)
}

/* ---------- road classes ---------- */
const ROAD_W: Record<string, number> = {
  motorway: 16, motorway_link: 9, trunk: 14, trunk_link: 9,
  primary: 12, primary_link: 8, secondary: 10, secondary_link: 7,
  tertiary: 8.5, tertiary_link: 6.5, residential: 6.5, unclassified: 6,
  living_street: 5.5, service: 4, pedestrian: 4, footway: 2.5,
  path: 2, steps: 2, track: 3.5, cycleway: 2.5
};
export function roadWidth(cls: string): number {
  return ROAD_W[cls] ?? 5.5;
}

/* ---------- building heights ---------- */
function parseHeight(tags: Record<string, string>): { h: number; lv: number } {
  let h = 0, lv = 0;
  const rawH = tags['height'] || tags['building:height'];
  if (rawH) {
    const m = parseFloat(rawH.replace(/[^\d.].*$/, ''));
    if (isFinite(m) && m > 0) h = Math.min(m, 320);
  }
  const rawLv = tags['building:levels'] || tags['levels'];
  if (rawLv) {
    const n = parseFloat(rawLv.replace(/[^\d.].*$/, ''));
    if (isFinite(n) && n > 0) lv = Math.min(n, 100);
  }
  if (h > 0 && lv <= 0) lv = Math.round(h / 3.2);
  if (lv > 0 && h <= 0) h = lv * 3.2 + 1.2;
  if (h <= 0) {
    const t = tags['building'] || 'yes';
    h = t === 'house' || t === 'detached' ? 4.2 :
        t === 'hut' || t === 'shed' || t === 'garage' ? 2.8 :
        t === 'apartments' ? 12 : t === 'office' || t === 'commercial' || t === 'retail' ? 9 : 6;
    lv = Math.max(1, Math.round(h / 3.2));
  }
  return { h, lv: lv || Math.max(1, Math.round(h / 3.2)) };
}

/* ---------- XML parsing ---------- */
export interface OsmWay {
  id: string;
  nds: string[];
  tags: Record<string, string>;
  closed: boolean;
}

export function parseOsmXml(xml: string): { nodes: Map<string, [number, number]>; ways: OsmWay[] } {
  const nodes = new Map<string, [number, number]>();
  const ways: OsmWay[] = [];
  const nodeRe = /<node[^>]*?\bid="(\d+)"[^>]*?\blat="([-\d.]+)"[^>]*?\blon="([-\d.]+)"[^>]*?(?:\/>|><\/node>)/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml))) nodes.set(m[1], [parseFloat(m[2]), parseFloat(m[3])]);
  const wayRe = /<way\b[^>]*?\bid="(\d+)"([\s\S]*?)<\/way>/g;
  while ((m = wayRe.exec(xml))) {
    const id = m[1], body = m[2];
    const nds: string[] = [];
    const ndRe = /<nd[^>]*?\bref="(\d+)"/g;
    let nm: RegExpExecArray | null;
    while ((nm = ndRe.exec(body))) nds.push(nm[1]);
    const tags: Record<string, string> = {};
    const tgRe = /<tag[^>]*?\bk="([^"]*)"[^>]*?\bv="([^"]*)"/g;
    let tm: RegExpExecArray | null;
    while ((tm = tgRe.exec(body))) tags[tm[1]] = tm[2];
    if (nds.length >= 2) ways.push({ id, nds, tags, closed: nds[0] === nds[nds.length - 1] && nds.length >= 4 });
  }
  return { nodes, ways };
}

/* ---------- geometry helpers ---------- */
export type Pt = [number, number];

export function polyCentroid(p: Pt[]): Pt {
  let x = 0, z = 0;
  for (const q of p) { x += q[0]; z += q[1]; }
  return [x / p.length, z / p.length];
}

/** Sutherland–Hodgman: clip polygon to rect [x0,z0,x1,z1]. Returns clipped poly (may be empty). */
export function clipPolyToRect(poly: Pt[], x0: number, z0: number, x1: number, z1: number): Pt[] {
  const edges: Array<{ axis: 0 | 1; dir: 1 | -1; bound: number }> = [
    { axis: 1, dir: 1, bound: z0 },   // keep z >= z0
    { axis: 1, dir: -1, bound: z1 },  // keep z <= z1
    { axis: 0, dir: 1, bound: x0 },   // keep x >= x0
    { axis: 0, dir: -1, bound: x1 }   // keep x <= x1
  ];
  let out = poly;
  for (const e of edges) {
    const inp = out; out = [];
    if (!inp.length) break;
    const inside = (p: Pt): boolean => e.dir > 0 ? p[e.axis] >= e.bound : p[e.axis] <= e.bound;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], nxt = inp[(i + 1) % inp.length];
      const ci = inside(cur), cn = inside(nxt);
      if (ci) out.push(cur);
      if (ci !== cn) {
        const t = (e.bound - cur[e.axis]) / (nxt[e.axis] - cur[e.axis]);
        out.push([
          cur[0] + (nxt[0] - cur[0]) * t,
          cur[1] + (nxt[1] - cur[1]) * t
        ]);
      }
    }
  }
  return out;
}

/** Clip open polyline to rect; returns contiguous runs that lie inside (inflated by caller). */
export function clipLineToRect(line: Pt[], x0: number, z0: number, x1: number, z1: number): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const inside = (p: Pt): boolean => p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1;
  const xAxis = (a: Pt, b: Pt, x: number): Pt | null => {
    const dx = b[0] - a[0]; if (Math.abs(dx) < 1e-12) return null;
    const t = (x - a[0]) / dx; if (t < 0 || t > 1) return null;
    const z = a[1] + (b[1] - a[1]) * t;
    return (z >= z0 && z <= z1) ? [x, z] : null;
  };
  const zAxis = (a: Pt, b: Pt, z: number): Pt | null => {
    const dz = b[1] - a[1]; if (Math.abs(dz) < 1e-12) return null;
    const t = (z - a[1]) / dz; if (t < 0 || t > 1) return null;
    const x = a[0] + (b[0] - a[0]) * t;
    return (x >= x0 && x <= x1) ? [x, z] : null;
  };
  const crossings = (a: Pt, b: Pt): Pt[] => {
    const out: Pt[] = [];
    for (const x of [x0, x1]) { const p = xAxis(a, b, x); if (p) out.push(p); }
    for (const z of [z0, z1]) { const p = zAxis(a, b, z); if (p) out.push(p); }
    return out;
  };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const ia = inside(a), ib = inside(b);
    if (ia && ib) {
      if (!cur.length) cur.push(a);
      cur.push(b);
    } else if (ia && !ib) {
      if (!cur.length) cur.push(a);
      const xs = crossings(a, b);
      if (xs.length) cur.push(xs[0]);
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    } else if (!ia && ib) {
      const xs = crossings(a, b);
      cur = xs.length ? [xs[0]] : [];
      cur.push(b);
    } else {
      const xs = crossings(a, b);
      if (xs.length >= 2) runs.push([xs[0], xs[1]]);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/* ---------- ways -> classified geometry ---------- */
const WATER_TAGS = new Set(['water', 'riverbank', 'bay', 'pond', 'lake', 'reservoir', 'basin']);
const GREEN_RE = /^(park|garden|pitch|golf_course|playground|common)$/;

export function classifyWays(
  nodes: Map<string, [number, number]>,
  ways: OsmWay[],
  lat0: number,
  lon0: number
): { buildings: Bldg[]; roads: Road[]; water: Poly[]; green: Poly[] } {
  const buildings: Bldg[] = [];
  const roads: Road[] = [];
  const water: Poly[] = [];
  const green: Poly[] = [];
  for (const w of ways) {
    const t = w.tags;
    const pts: Pt[] = [];
    let ok = true;
    for (const nd of w.nds) {
      const ll = nodes.get(nd);
      if (!ll) { ok = false; break; }
      pts.push(latLonToLocal(ll[0], ll[1], lat0, lon0));
    }
    if (!ok || pts.length < 2) continue;
    if (t['building'] && w.closed) {
      const { h, lv } = parseHeight(t);
      buildings.push({ p: pts.slice(0, -1), h, t: t['building'], lv, n: t['name'] });
    } else if (t['highway'] && !w.closed) {
      const cls = t['highway'];
      if (cls === 'proposed' || cls === 'construction') continue;
      roads.push({ p: pts, w: roadWidth(cls), t: cls, n: t['name'] });
    } else if (w.closed && (WATER_TAGS.has(t['natural'] || '') || WATER_TAGS.has(t['water'] || '') || t['waterway'] === 'riverbank')) {
      water.push({ p: pts.slice(0, -1), n: t['name'] });
    } else if (w.closed && (GREEN_RE.test(t['leisure'] || '') || GREEN_RE.test(t['landuse'] || '') || t['landuse'] === 'forest' || t['landuse'] === 'grass')) {
      green.push({ p: pts.slice(0, -1), n: t['name'] });
    }
  }
  return { buildings, roads, water, green };
}

/* ---------- distribute classified geometry into chunks ---------- */
export function bucketIntoChunks(
  geo: ReturnType<typeof classifyWays>
): Map<string, ChunkData> {
  const chunks = new Map<string, ChunkData>();
  const ensure = (cx: number, cz: number): ChunkData => {
    const k = `${cx}_${cz}`;
    let c = chunks.get(k);
    if (!c) { c = { k, b: [], r: [], w: [], g: [], d: 0 }; chunks.set(k, c); }
    return c;
  };

  for (const b of geo.buildings) {
    const [mx, mz] = polyCentroid(b.p);
    const cx = Math.floor(mx / CHUNK), cz = Math.floor(mz / CHUNK);
    const rect = [cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK] as const;
    const clipped = clipPolyToRect(b.p, rect[0], rect[1], rect[2], rect[3]);
    if (clipped.length >= 3) {
      const c = ensure(cx, cz);
      c.b.push({ ...b, p: clipped.map(([x, z]) => [x - rect[0], z - rect[1]] as [number, number]) });
      c.d++;
    }
  }
  // water can span many chunks: clip into every intersecting chunk (search 1km box around centroid)
  for (const wp of geo.water) {
    const [mx, mz] = polyCentroid(wp.p);
    const c0x = Math.floor((mx - 1000) / CHUNK), c1x = Math.floor((mx + 1000) / CHUNK);
    const c0z = Math.floor((mz - 1000) / CHUNK), c1z = Math.floor((mz + 1000) / CHUNK);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const rect = [cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK] as const;
      const clipped = clipPolyToRect(wp.p, rect[0], rect[1], rect[2], rect[3]);
      if (clipped.length >= 3) {
        const c = ensure(cx, cz);
        c.w.push({ n: wp.n, p: clipped.map(([x, z]) => [x - rect[0], z - rect[1]] as [number, number]) });
      }
    }
  }
  for (const gp of geo.green) {
    const [mx, mz] = polyCentroid(gp.p);
    const c0x = Math.floor((mx - 400) / CHUNK), c1x = Math.floor((mx + 400) / CHUNK);
    const c0z = Math.floor((mz - 400) / CHUNK), c1z = Math.floor((mz + 400) / CHUNK);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const rect = [cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK] as const;
      const clipped = clipPolyToRect(gp.p, rect[0], rect[1], rect[2], rect[3]);
      if (clipped.length >= 3) {
        const c = ensure(cx, cz);
        c.g.push({ n: gp.n, p: clipped.map(([x, z]) => [x - rect[0], z - rect[1]] as [number, number]) });
      }
    }
  }
  for (const rd of geo.roads) {
    for (let i = 0; i < rd.p.length - 1; i++) {
      const mx = (rd.p[i][0] + rd.p[i + 1][0]) / 2, mz = (rd.p[i][1] + rd.p[i + 1][1]) / 2;
      const cx = Math.floor(mx / CHUNK), cz = Math.floor(mz / CHUNK);
      const rect = [cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK] as const;
      const runs = clipLineToRect([rd.p[i], rd.p[i + 1]], rect[0] - rd.w, rect[1] - rd.w, rect[2] + rd.w, rect[3] + rd.w);
      for (const run of runs) {
        if (run.length < 2) continue;
        const c = ensure(cx, cz);
        c.r.push({ w: rd.w, t: rd.t, n: rd.n, p: run.map(([x, z]) => [x - rect[0], z - rect[1]] as [number, number]) });
      }
    }
  }
  return chunks;
}

/* ---------- full pipeline: bbox -> chunks ---------- */
export async function fetchOsmBbox(minLat: number, minLon: number, maxLat: number, maxLon: number): Promise<string> {
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${minLon},${minLat},${maxLon},${maxLat}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ExcaliburEarth/0.1 (world streaming; contact: orubus-dev)', Accept: 'application/xml' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  return await res.text();
}

export function osmXmlToChunks(xml: string, lat0: number, lon0: number): Map<string, ChunkData> {
  const { nodes, ways } = parseOsmXml(xml);
  const geo = classifyWays(nodes, ways, lat0, lon0);
  return bucketIntoChunks(geo);
}
