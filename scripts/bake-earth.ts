/**
 * bake-earth.ts — bakes the globe layer: land dot cloud + coastline loops
 * from the world-atlas 110m topojson (bundled devDep, no network at runtime).
 * Writes public/world/earth.json (compact).
 * Run: bun scripts/bake-earth.ts
 */
import { writeFileSync } from 'fs';
import * as topojson from 'topojson-client';

type Ring = [number, number][];
type Geom = { type: string; coordinates?: unknown; arcs?: unknown };

function collectRings(geom: Geom, rings: Ring[]): void {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    for (const r of geom.coordinates as Ring[]) rings.push(r);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates as Ring[][]) for (const r of poly) rings.push(r);
  } else if (geom.type === 'GeometryCollection') {
    for (const g of (geom as unknown as { geometries: Geom[] }).geometries) collectRings(g, rings);
  }
}

function pointInRings(lon: number, lat: number, rings: Ring[]): boolean {
  // even-odd on all rings (holes naturally cancel)
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (((yi > lat) !== (yj > lat)) &&
          (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}

async function main() {
  // world-atlas ships topojson files; land-110m
  const topo = (await import('world-atlas/land-110m.json')).default as unknown as {
    objects: { land: unknown };
    arcs: number[][][][];
    transform?: { scale: [number, number]; translate: [number, number] };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feat = (topojson as any).feature(topo, topo.objects.land) as
    | { type: 'Feature'; geometry: Geom }
    | { type: 'FeatureCollection'; features: Array<{ geometry: Geom }> };
  const rings: Ring[] = [];
  const feats = feat.type === 'FeatureCollection' ? feat.features : [feat];
  for (const f of feats) collectRings(f.geometry, rings);
  console.log(`land rings: ${rings.length}, total pts: ${rings.reduce((s, r) => s + r.length, 0)}`);

  // 1) dot cloud sampled on a lat/lon grid over land
  const dots: [number, number][] = [];
  const STEP = 1.1;
  for (let lat = -83; lat <= 83; lat += STEP) {
    // keep near-uniform density: fewer lon samples toward poles
    const lons = Math.max(6, Math.round(360 / STEP * Math.cos((lat * Math.PI) / 180)));
    for (let k = 0; k < lons; k++) {
      const lon = -180 + ((k + 0.5) * 360) / lons;
      if (pointInRings(lon, lat, rings)) dots.push([lon, lat]);
    }
  }
  console.log(`land dots: ${dots.length}`);

  // 2) coastline loops (decimate big rings for size)
  const coasts: Ring[] = rings
    .filter(r => r.length >= 8)
    .map(r => {
      const stepN = Math.max(1, Math.floor(r.length / 240));
      const out: Ring = [];
      for (let i = 0; i < r.length; i += stepN) out.push([+r[i][0].toFixed(2), +r[i][1].toFixed(2)]);
      return out;
    });

  writeFileSync('public/world/earth.json', JSON.stringify({ dots, coasts }));
  const kb = (JSON.stringify({ dots, coasts }).length / 1024).toFixed(0);
  console.log(`EARTH BAKED: ${dots.length} dots, ${coasts.length} coastlines, ~${kb} KB`);
}

main().catch(e => { console.error('BAKE EARTH FAILED:', e); process.exit(1); });
