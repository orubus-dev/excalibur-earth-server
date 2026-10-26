/** game/babylon/tex.ts — procedural canvas textures (no binary assets, all cached). */
import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture, Texture } from '@babylonjs/core/Materials';
import { Color3 } from '@babylonjs/core/Maths/math';

const cache = new Map<string, Texture>();

function make(scene: Scene, name: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, w, h);
  t.update(false);
  t.anisotropicFilteringLevel = 8;
  return t;
}

export function texAsphalt(scene: Scene): Texture {
  const k = 'asphalt';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 512, 512, (x, w, h) => {
    x.fillStyle = '#0e0e10'; x.fillRect(0, 0, w, h);
    const img = x.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26 + (Math.random() < 0.02 ? 34 : 0);
      img.data[i] = Math.max(8, Math.min(255, img.data[i] + n));
      img.data[i + 1] = img.data[i]; img.data[i + 2] = img.data[i] + 2;
    }
    x.putImageData(img, 0, 0);
    // LOW-frequency tonal patches (survive mipmapping — read as real asphalt variation)
    for (let i = 0; i < 16; i++) {
      const g = x.createRadialGradient(Math.random() * w, Math.random() * h, 4, Math.random() * w, Math.random() * h, 60 + Math.random() * 110);
      const lite = Math.random() < 0.5;
      g.addColorStop(0, lite ? 'rgba(70,66,62,0.30)' : 'rgba(4,4,5,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    x.strokeStyle = 'rgba(12,12,14,0.5)'; x.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      x.beginPath(); x.moveTo(Math.random() * w, 0); x.lineTo(Math.random() * w, h); x.stroke();
    }
    x.fillStyle = 'rgba(30,30,34,0.4)';
    for (let i = 0; i < 6; i++) {
      x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 18 + Math.random() * 42, 12 + Math.random() * 30, Math.random() * 3, 0, 7); x.fill();
    }
    // wet sheen streaks
    x.fillStyle = 'rgba(210,180,150,0.05)';
    for (let i = 0; i < 10; i++) x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 40 + Math.random() * 120);
  });
  cache.set(k, t); return t;
}

export function texSidewalk(scene: Scene): Texture {
  const k = 'sidewalk';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 512, 512, (x, w, h) => {
    x.fillStyle = '#8a8378'; x.fillRect(0, 0, w, h);
    const img = x.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9;
    }
    x.putImageData(img, 0, 0);
    x.strokeStyle = 'rgba(60,55,48,0.55)'; x.lineWidth = 2;
    const cell = w / 4;
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * cell, 0); x.lineTo(i * cell, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * cell); x.lineTo(w, i * cell); x.stroke();
    }
    x.fillStyle = 'rgba(96,82,60,0.16)';
    for (let i = 0; i < 10; i++) {
      x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 8 + Math.random() * 22, Math.random() * 3, 0, 7); x.fill();
    }
  });
  cache.set(k, t); return t;
}

export function texWindows(scene: Scene, lit: boolean): Texture {
  const k = 'windows' + (lit ? '_lit' : '');
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 512, 512, (x, w, h) => {
    x.fillStyle = '#b8b0a2'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(120,110,96,0.25)';
    for (let i = 0; i < 40; i++) x.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 10 + Math.random() * 26);
    const cols = 6, rows = 6, gw = w / cols, gh = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const wx = c * gw + gw * 0.18, wy = r * gh + gh * 0.2, ww = gw * 0.64, wh = gh * 0.56;
      const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
      if (lit && Math.random() < 0.55) { g.addColorStop(0, '#ffd9a0'); g.addColorStop(1, '#c98d4a'); }
      else { g.addColorStop(0, '#5e768a'); g.addColorStop(0.5, '#39506a'); g.addColorStop(1, '#6e5a48'); }
      x.fillStyle = g;
      x.fillRect(wx, wy, ww, wh);
      x.strokeStyle = 'rgba(40,38,34,0.7)'; x.lineWidth = 2; x.strokeRect(wx, wy, ww, wh);
    }
  });
  cache.set(k, t); return t;
}

export function texGlassTower(scene: Scene): Texture {
  const k = 'glass';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 512, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7fa8c9'); g.addColorStop(0.45, '#a8b8bf'); g.addColorStop(0.75, '#d9a86c'); g.addColorStop(1, '#8a7260');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(30,40,50,0.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * w / 8, 0); x.lineTo(i * w / 8, h); x.stroke(); }
    for (let i = 0; i <= 12; i++) { x.beginPath(); x.moveTo(0, i * h / 12); x.lineTo(w, i * h / 12); x.stroke(); }
    x.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h * 0.6, 40 + Math.random() * 80, 8 + Math.random() * 14, 0, 0, 7); x.fill(); }
  });
  cache.set(k, t); return t;
}

export function texZinc(scene: Scene): Texture {
  const k = 'zinc';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#8f8578'); g.addColorStop(0.5, '#b5aa99'); g.addColorStop(1, '#8f8578');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { x.fillStyle = 'rgba(70,66,60,0.35)'; x.fillRect(i, 0, 3, h); }
    x.fillStyle = 'rgba(140,80,50,0.18)';
    for (let i = 0; i < 12; i++) x.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 30, 4 + Math.random() * 10);
  });
  cache.set(k, t); return t;
}

export function texGrass(scene: Scene): Texture {
  const k = 'grass';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 256, 256, (x, w, h) => {
    x.fillStyle = '#4d6b33'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const g = 60 + Math.random() * 70;
      x.fillStyle = `rgba(${Math.round(g * 0.55)}, ${Math.round(g)}, ${Math.round(g * 0.4)}, 0.55)`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 2 + Math.random() * 3);
    }
    x.fillStyle = 'rgba(94,78,44,0.25)';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 12 + Math.random() * 26, 0, 0, 7); x.fill(); }
  });
  cache.set(k, t); return t;
}

export function texWater(scene: Scene): Texture {
  const k = 'water';
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#264a56'); g.addColorStop(1, '#17313d');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,200,140,0.22)'; x.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const y = Math.random() * h;
      x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= w; px += 16) x.lineTo(px, y + Math.sin(px * 0.05 + i) * 3);
      x.stroke();
    }
  });
  cache.set(k, t); return t;
}

/** text sign (shop fronts, billboards) */
export function texSign(scene: Scene, bg: string, fg: string, line1: string, line2?: string, accent?: string): Texture {
  const k = `sign:${bg}:${fg}:${line1}:${line2 ?? ''}`;
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 512, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg); g.addColorStop(1, shade(bg, -0.25));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (accent) { x.fillStyle = accent; x.fillRect(0, h - 26, w, 26); }
    x.fillStyle = fg;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (line2) {
      const s1 = Math.min(64, (w * 0.86) / Math.max(4, line1.length) * 1.7);
      x.font = `800 ${s1}px 'Arial Black', system-ui, sans-serif`;
      x.fillText(line1, w / 2, h * 0.36);
      x.font = `600 ${Math.min(44, (w * 0.7) / Math.max(4, line2.length) * 1.6)}px system-ui, sans-serif`;
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.fillText(line2, w / 2, h * 0.68);
    } else {
      const s1 = Math.min(72, (w * 0.8) / Math.max(4, line1.length) * 1.75);
      x.font = `900 ${s1}px 'Arial Black', system-ui, sans-serif`;
      x.fillText(line1, w / 2, h * 0.5);
    }
  });
  cache.set(k, t); return t;
}

export function texGlow(scene: Scene, color: string): Texture {
  const k = 'glow' + color;
  if (cache.has(k)) return cache.get(k)!;
  const t = make(scene, k, 128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, color); g.addColorStop(0.4, color + '88'); g.addColorStop(1, '#00000000');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  t.hasAlpha = true;
  cache.set(k, t); return t;
}

function shade(hex: string, amt: number): string {
  const c = Color3.FromHexString(hex);
  const r = Math.max(0, Math.min(1, c.r + amt)), g = Math.max(0, Math.min(1, c.g + amt)), b = Math.max(0, Math.min(1, c.b + amt));
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
