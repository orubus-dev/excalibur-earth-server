/**
 * bake-city.ts — bakes REAL Lagos (Victoria Island) into static chunk JSONs.
 * Fetches from the official OSM API 0.6 in quadrants (50k node cap), converts
 * via src/lib/osm.ts, writes public/world/lagos/c.CX_CZ.json + manifest.
 * Run: bun scripts/bake-city.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { LAGOS, CHUNK, fetchOsmBbox, osmXmlToChunks, metersPerDegLon, METERS_PER_DEG_LAT, type ChunkData } from '../src/lib/osm';

const { lat0, lon0, bakeRadius } = LAGOS;
const mLat = METERS_PER_DEG_LAT, mLon = metersPerDegLon(lat0);
const dLat = bakeRadius / mLat, dLon = bakeRadius / mLon;
const minLat = lat0 - dLat, maxLat = lat0 + dLat;
const minLon = lon0 - dLon, maxLon = lon0 + dLon;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchQuadrant(minLa: number, minLo: number, maxLa: number, maxLo: number, label: string): Promise<string> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      console.log(`  [${label}] attempt ${attempt}: bbox ${minLo.toFixed(5)},${minLa.toFixed(5)} -> ${maxLo.toFixed(5)},${maxLa.toFixed(5)}`);
      const xml = await fetchOsmBbox(minLa, minLo, maxLa, maxLo);
      const bytes = xml.length;
      console.log(`  [${label}] OK ${(bytes / 1e6).toFixed(2)} MB`);
      if (bytes < 2000) console.warn(`  [${label}] WARNING: suspiciously small response`);
      return xml;
    } catch (e) {
      console.warn(`  [${label}] failed: ${(e as Error).message}`);
      if (attempt === 4) throw e;
      await sleep(4000 * attempt);
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const outDir = 'public/world/lagos';
  mkdirSync(outDir, { recursive: true });

  // 2x2 quadrants, paced politely
  const midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2;
  const quads: Array<[number, number, number, number, string]> = [
    [minLat, minLon, midLat, midLon, 'SW'],
    [minLat, midLon, midLat, maxLon, 'SE'],
    [midLat, minLon, maxLat, midLon, 'NW'],
    [midLat, midLon, maxLat, maxLon, 'NE']
  ];

  const merged = new Map<string, ChunkData>();
  for (const [a, b, c, d, label] of quads) {
    const xml = await fetchQuadrant(a, b, c, d, label);
    const chunks = osmXmlToChunks(xml, lat0, lon0);
    for (const [k, cd] of chunks) {
      const ex = merged.get(k);
      if (ex) {
        ex.b.push(...cd.b); ex.r.push(...cd.r); ex.w.push(...cd.w); ex.g.push(...cd.g);
        ex.d += cd.d;
      } else merged.set(k, { ...cd });
    }
    await sleep(2500);
  }

  // only keep chunks inside the bake radius box (dedupe overlaps at quadrant seams)
  const files: string[] = [];
  let totB = 0, totR = 0, totW = 0, totG = 0;
  for (const [k, cd] of merged) {
    if (!cd.b.length && !cd.r.length && !cd.w.length && !cd.g.length) continue;
    const fname = `c.${cd.k}.json`;
    writeFileSync(`${outDir}/${fname}`, JSON.stringify(cd));
    files.push(fname);
    totB += cd.b.length; totR += cd.r.length; totW += cd.w.length; totG += cd.g.length;
  }

  const manifest = {
    city: LAGOS.name,
    region: LAGOS.region,
    origin: { lat: lat0, lon: lon0 },
    chunkSize: CHUNK,
    block: 10,
    radius: bakeRadius,
    files,
    counts: { chunks: files.length, buildings: totB, roads: totR, water: totW, green: totG },
    bakedAt: new Date().toISOString(),
    source: 'OpenStreetMap ( ODbL ) via api.openstreetmap.org'
  };
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(`BAKED LAGOS: ${files.length} chunks | buildings ${totB} | roads ${totR} | water ${totW} | green ${totG}`);
}

main().catch(e => { console.error('BAKE FAILED:', e); process.exit(1); });
