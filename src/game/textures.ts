/** game/textures.ts — canvas-generated textures. Zero external assets, production look. */
import * as THREE from 'three';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, opts: Partial<THREE.TextureParameters> = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  Object.assign(t, opts);
  return t;
}

function noise(ctx: CanvasRenderingContext2D, size: number, alpha: number, n = 900): void {
  for (let i = 0; i < n; i++) {
    const g = Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
    const s = 1 + Math.random() * 2.2;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
}

export interface FacadeSet {
  map: THREE.Texture;          // day facade (windows + concrete/panels)
  emissive: THREE.Texture;     // night lit windows
  roughness: THREE.Texture;
}

/** Facade atlas: window grid cell ~ 3.2m vertically, 2.6m horizontally. One shared atlas. */
export function makeFacades(): FacadeSet {
  const S = 512;
  // DAY: warm Lagos tower palette bands
  const [cd, xd] = canvas(S);
  const bands = ['#d8c8b2', '#c6b5a0', '#e6d8c3', '#b8aa98', '#d0c1ab'];
  const bw = 64;
  for (let i = 0; i < S / bw; i++) {
    xd.fillStyle = bands[i % bands.length];
    xd.fillRect(i * bw, 0, bw, S);
    // panel seams
    xd.fillStyle = 'rgba(60,50,40,0.25)';
    xd.fillRect(i * bw, 0, 2, S);
  }
  // windows: 8 cols x 10 rows
  const cw = S / 8, ch = S / 10;
  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const x = gx * cw + cw * 0.22, y = gy * ch + ch * 0.28;
      const w = cw * 0.56, h = ch * 0.44;
      const shade = 34 + Math.random() * 34;
      xd.fillStyle = `rgb(${shade},${shade + 6},${shade + 12})`;
      xd.fillRect(x, y, w, h);
      // glass reflection streak
      xd.fillStyle = 'rgba(190,215,235,0.28)';
      xd.fillRect(x, y, w * 0.42, h * 0.5);
      // frame
      xd.strokeStyle = 'rgba(40,34,28,0.7)';
      xd.lineWidth = 2;
      xd.strokeRect(x, y, w, h);
    }
  }
  noise(xd, S, 0.05, 500);

  // NIGHT emissive: same grid, some windows lit warm
  const [cn, xn] = canvas(S);
  xn.fillStyle = '#000';
  xn.fillRect(0, 0, S, S);
  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      if (Math.random() > 0.42) continue;
      const x = gx * cw + cw * 0.18, y = gy * ch + ch * 0.22;
      const warm = Math.random();
      xn.fillStyle = warm > 0.7 ? '#ffd9a0' : warm > 0.4 ? '#ffedc8' : '#cfe4ff';
      xn.fillRect(x, y, cw * 0.64, ch * 0.52);
    }
  }

  // ROUGHNESS: windows glossy, walls matte
  const [cr, xr] = canvas(S);
  xr.fillStyle = '#c8c8c8';
  xr.fillRect(0, 0, S, S);
  for (let gy = 0; gy < 10; gy++)
    for (let gx = 0; gx < 8; gx++)
      xr.fillStyle = '#3c3c3c', xr.fillRect(gx * cw + cw * 0.18, gy * ch + ch * 0.22, cw * 0.64, ch * 0.52);

  return { map: tex(cd), emissive: tex(cn), roughness: tex(cr) };
}

/** Ground: warm concrete/dirt aggregate. Tile = 8m. */
export function makeGround(): THREE.Texture {
  const S = 512, [c, x] = canvas(S);
  x.fillStyle = '#9a9186';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    const r = Math.random();
    x.fillStyle = r > 0.6 ? 'rgba(140,125,105,0.5)' : r > 0.3 ? 'rgba(80,75,70,0.35)' : 'rgba(200,190,175,0.4)';
    const s = 2 + Math.random() * 5;
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, s, 0, 7);
    x.fill();
  }
  // faint expansion joints every 2m (256px)
  x.strokeStyle = 'rgba(55,50,45,0.35)';
  x.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    x.beginPath(); x.moveTo((i * S) / 2, 0); x.lineTo((i * S) / 2, S); x.stroke();
    x.beginPath(); x.moveTo(0, (i * S) / 2); x.lineTo(S, (i * S) / 2); x.stroke();
  }
  return tex(c);
}

/** Asphalt with optional center dash. Tile = 10m along road. */
export function makeRoad(kind: 'major' | 'minor' | 'foot'): THREE.Texture {
  const S = 256, [c, x] = canvas(S);
  x.fillStyle = kind === 'foot' ? '#8d867c' : '#3c3c40';
  x.fillRect(0, 0, S, S);
  noise(x, S, 0.10, 700);
  if (kind !== 'foot') {
    // worn patches
    for (let i = 0; i < 14; i++) {
      x.fillStyle = 'rgba(20,20,22,0.25)';
      x.beginPath();
      x.ellipse(Math.random() * S, Math.random() * S, 8 + Math.random() * 26, 4 + Math.random() * 10, Math.random() * 3, 0, 7);
      x.fill();
    }
    if (kind === 'major') {
      // yellow center dashes (v axis = along road)
      x.fillStyle = '#c8a832';
      for (let y = 0; y < S; y += 64) x.fillRect(S / 2 - 3, y + 10, 6, 38);
      // edge lines
      x.fillStyle = 'rgba(220,220,220,0.5)';
      x.fillRect(6, 0, 3, S);
      x.fillRect(S - 9, 0, 3, S);
    }
  }
  return tex(c);
}

export function makeGrass(): THREE.Texture {
  const S = 256, [c, x] = canvas(S);
  x.fillStyle = '#5d7a3e';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1600; i++) {
    x.fillStyle = Math.random() > 0.5 ? 'rgba(90,120,60,0.5)' : 'rgba(60,90,40,0.5)';
    x.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  return tex(c);
}

/** Lagoon/Atlantic water: deep teal, shimmer handled in material. */
export function makeWater(): { map: THREE.Texture; rough: number; metal: number } {
  const S = 256, [c, x] = canvas(S);
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#1d4e5e');
  g.addColorStop(0.5, '#17414f');
  g.addColorStop(1, '#1d4e5e');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    x.strokeStyle = `rgba(200,230,240,${0.04 + Math.random() * 0.07})`;
    x.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * S;
    x.beginPath();
    x.moveTo(0, y);
    x.bezierCurveTo(S * 0.3, y + 6, S * 0.6, y - 6, S, y);
    x.stroke();
  }
  return { map: tex(c), rough: 0.14, metal: 0.55 };
}

/** Retro-tech billboard skins (CRT/consoles/phones vibe) for street ads. */
export function makeBillboard(i: number): THREE.Texture {
  const S = 256, [c, x] = canvas(S);
  const skins: Array<[string, string, string]> = [
    ['#12100e', '#ffb03b', 'GAME ON'],
    ['#1a0f0f', '#ff5f5f', 'PLAY 24/7'],
    ['#0e1412', '#5fd9a0', 'LIVE LAGOS'],
    ['#141018', '#c08bff', 'NEON CITY'],
    ['#101418', '#6fc3ff', 'CONNECT X']
  ];
  const [bg, fg, word] = skins[i % skins.length];
  x.fillStyle = bg;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = fg;
  x.lineWidth = 8;
  x.strokeRect(10, 10, S - 20, S - 20);
  // scanlines
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < S; y += 4) x.fillRect(0, y, S, 2);
  x.fillStyle = fg;
  x.font = `bold ${word.length > 8 ? 34 : 44}px Arial, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(word, S / 2, S / 2 - 14);
  x.font = '22px Arial, sans-serif';
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.fillText('EXCALIBUR · EARTH', S / 2, S / 2 + 34);
  return tex(c);
}

/** Soft round sprite used for glow, marker, headlight halos. */
export function makeGlow(color: string): THREE.Texture {
  const S = 128, [c, x] = canvas(S);
  const g = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color.replace('rgb', 'rgba').replace(')', ',0.35)').replace('#', '#'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  // simpler: draw radial with computed rgba stops
  const g2 = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g2.addColorStop(0, color);
  g2.addColorStop(0.4, color + '66');
  g2.addColorStop(1, color + '00');
  x.fillStyle = g2;
  x.fillRect(0, 0, S, S);
  void g;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
