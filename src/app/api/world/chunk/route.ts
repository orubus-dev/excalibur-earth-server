import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { osmXmlToChunks, fetchOsmBbox, CHUNK, LAGOS, type ChunkData } from '@/lib/osm';

export const runtime = 'nodejs';
export const maxDuration = 30;

const memory = new Map<string, { chunk: ChunkData | null; at: number }>();
const TTL = 1000 * 60 * 60 * 24; // chunks are effectively immutable

const CITY_ORIGIN: Record<string, { lat0: number; lon0: number }> = {
  lagos: { lat0: LAGOS.lat0, lon0: LAGOS.lon0 }
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const city = (req.nextUrl.searchParams.get('city') ?? 'lagos').toLowerCase();
  const x = parseInt(req.nextUrl.searchParams.get('x') ?? '0', 10);
  const z = parseInt(req.nextUrl.searchParams.get('z') ?? '0', 10);
  const origin = CITY_ORIGIN[city];
  if (!origin || !isFinite(x) || !isFinite(z)) {
    return NextResponse.json({ ok: false, error: 'unknown city or coords' }, { status: 400 });
  }
  const key = `${city}:${x}:${z}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ ok: true, chunk: hit.chunk }, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' }
    });
  }

  // static file first (pre-baked)
  try {
    const p = path.join(process.cwd(), 'public', 'world', city, `c.${x}_${z}.json`);
    const raw = await readFile(p, 'utf8');
    const chunk = JSON.parse(raw) as ChunkData;
    memory.set(key, { chunk, at: Date.now() });
    return NextResponse.json({ ok: true, chunk }, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' }
    });
  } catch { /* not baked — fetch live */ }

  // on-demand: fetch this chunk's bbox from OSM and convert
  const mLat = 110574;
  const mLon = 111320 * Math.cos((origin.lat0 * Math.PI) / 180);
  const halfLat = (CHUNK / 2) / mLat;
  const halfLon = (CHUNK / 2) / mLon;
  const lat0 = origin.lat0 - z / mLat, lon0 = origin.lon0 + x / mLon;
  let chunk: ChunkData | null = null;
  try {
    const xml = await fetchOsmBbox(lat0 - halfLat, lon0 - halfLon, lat0 + halfLat, lon0 + halfLon);
    const chunks = osmXmlToChunks(xml, origin.lat0, origin.lon0);
    chunk = chunks.get(`${x}_${z}`) ?? null;
    if (chunk) chunk.k = `${x}_${z}`;
  } catch {
    chunk = null;
  }
  memory.set(key, { chunk, at: Date.now() });
  return NextResponse.json({ ok: true, chunk }, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' }
  });
}
