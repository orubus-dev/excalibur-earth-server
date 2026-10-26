/** game/geo.ts — client-side geo math. Mirrors src/lib/osm.ts constants. */

export const CHUNK = 80;
export const BLOCK = 10;
export const BLOCKS = 8; // 8x8 blocks per chunk

export const LAGOS_ORIGIN = { lat: 6.4295, lon: 3.4265 };
export const LAGOS_BAKE_RADIUS = 880;
const M_LAT = 110574;
const M_LON = 111320 * Math.cos((LAGOS_ORIGIN.lat * Math.PI) / 180);

/** local meters (x east, z south+) from lat/lon */
export function latLonToLocal(lat: number, lon: number): [number, number] {
  return [(lon - LAGOS_ORIGIN.lon) * M_LON, -(lat - LAGOS_ORIGIN.lat) * M_LAT];
}
export function localToLatLon(x: number, z: number): [number, number] {
  return [LAGOS_ORIGIN.lat - z / M_LAT, LAGOS_ORIGIN.lon + x / M_LON];
}
export function chunkOf(x: number, z: number): [number, number] {
  return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
}
export function chunkKey(cx: number, cz: number): string {
  return `${cx}_${cz}`;
}
export function chunkOrigin(cx: number, cz: number): [number, number] {
  return [cx * CHUNK, cz * CHUNK];
}

/** deterministic hash rng from string seed */
export function seedRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
