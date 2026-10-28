// Texturas dibujadas con código (canvas): no se descargan imágenes ni hay licencias de terceros.
// Se generan una sola vez y se comparten entre todas las aperturas de la vista 3D.
import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

// Generador pseudoaleatorio con semilla: las texturas salen iguales cada vez.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
}

/** Asfalto gastado: grano, parches, grietas y manchas de aceite. 1 repetición = 8 m. */
export const asphalt = () => cached('asphalt', () => {
  const { c, ctx } = canvas(512, 512); const r = rng(11);
  ctx.fillStyle = '#3b3b3a'; ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 38; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 9; i++) { ctx.fillStyle = `rgba(20,20,20,${0.25 + r() * 0.3})`; ctx.beginPath(); ctx.ellipse(r() * 512, r() * 512, 20 + r() * 60, 12 + r() * 40, r() * 3, 0, 7); ctx.fill(); }
  for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(80,80,78,${0.35})`; ctx.fillRect(r() * 450, r() * 450, 40 + r() * 70, 30 + r() * 50); }
  ctx.strokeStyle = 'rgba(12,12,12,.8)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) { let x = r() * 512, y = r() * 512; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
  return finish(c);
});

/** Vereda de baldosas sucias. 1 repetición = 4 m. */
export const sidewalk = () => cached('sidewalk', () => {
  const { c, ctx } = canvas(256, 256); const r = rng(5);
  ctx.fillStyle = '#6d6a63'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) { const v = 95 + r() * 25; ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`; ctx.fillRect(x + 2, y + 2, 60, 60); }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(30,25,20,${r() * 0.35})`; ctx.beginPath(); ctx.arc(r() * 256, r() * 256, 4 + r() * 18, 0, 7); ctx.fill(); }
  return finish(c);
});

/**
 * Fachadas de Manta (4 estilos). Cada textura = 9 m de ancho × 12 m de alto (4 pisos).
 * - map: pared con ventanas, rejas, persianas metálicas de local en planta baja y suciedad.
 * - emissive: pocas ventanas encendidas (apagón) o con resplandor de incendio.
 */
export function facades(): Array<{ map: THREE.Texture; emissive: THREE.Texture }> {
  return [0, 1, 2, 3].map(style => ({
    map: cached(`facade${style}`, () => facadeMap(style)),
    emissive: cached(`facadeE${style}`, () => facadeEmissive(style)),
  }));
}

function facadeMap(style: number) {
  const W = 288, H = 384; const { c, ctx } = canvas(W, H); const r = rng(100 + style);
  const wall = ['#d9d3c4', '#c9d6da', '#d8bfa9', '#bdbab1'][style];
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
  // Grano y manchas de humedad que bajan desde las ventanas.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  const floor = H / 4, col = W / 3;
  for (let f = 0; f < 4; f++) {
    const y0 = f * floor;
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, y0 + floor - 5, W, 5); // losa entre pisos
    for (let k = 0; k < 3; k++) {
      const x0 = k * col;
      if (f === 3) {
        // Planta baja: persiana metálica de local (muy común en Manta), algunas forzadas.
        ctx.fillStyle = '#5b5e60'; ctx.fillRect(x0 + 8, y0 + 18, col - 16, floor - 22);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; for (let y = y0 + 22; y < y0 + floor - 4; y += 5) ctx.fillRect(x0 + 8, y, col - 16, 1.5);
        if (r() < 0.35) { ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.moveTo(x0 + 8, y0 + floor - 4); ctx.lineTo(x0 + col - 8, y0 + floor - 4); ctx.lineTo(x0 + col - 8, y0 + floor - 30 - r() * 30); ctx.lineTo(x0 + 8, y0 + floor - 10); ctx.fill(); }
        continue;
      }
      const wx = x0 + 22, wy = y0 + 22, ww = col - 44, wh = floor - 46;
      ctx.fillStyle = '#4a4741'; ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6); // marco
      const broken = r() < 0.3, boarded = !broken && r() < 0.18;
      ctx.fillStyle = broken ? '#050505' : '#1a2228'; ctx.fillRect(wx, wy, ww, wh);
      if (broken) { ctx.fillStyle = '#2b363d'; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + ww * 0.6, wy); ctx.lineTo(wx, wy + wh * 0.5); ctx.fill(); }
      if (boarded) { ctx.fillStyle = '#6b5236'; for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(wx + ww / 2, wy + 10 + i * (wh / 3)); ctx.rotate((r() - 0.5) * 0.4); ctx.fillRect(-ww / 2 - 4, -5, ww + 8, 10); ctx.restore(); } }
      if (!broken && !boarded && style % 2 === 0) { ctx.strokeStyle = '#222'; ctx.lineWidth = 2; for (let x = wx + 6; x < wx + ww; x += 9) { ctx.beginPath(); ctx.moveTo(x, wy); ctx.lineTo(x, wy + wh); ctx.stroke(); } } // rejas
      const grad = ctx.createLinearGradient(0, wy + wh, 0, wy + wh + 40);
      grad.addColorStop(0, 'rgba(40,35,25,.45)'); grad.addColorStop(1, 'rgba(40,35,25,0)');
      ctx.fillStyle = grad; ctx.fillRect(wx + ww * 0.2, wy + wh, ww * 0.6, 40);
    }
  }
  // Hollín de incendios y grafitis de emergencia.
  for (let i = 0; i < 3; i++) { const g = ctx.createRadialGradient(r() * W, r() * H, 5, r() * W, r() * H, 90); g.addColorStop(0, 'rgba(10,8,6,.55)'); g.addColorStop(1, 'rgba(10,8,6,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (style === 1 || style === 3) { ctx.fillStyle = 'rgba(150,20,15,.85)'; ctx.font = 'bold 26px sans-serif'; ctx.save(); ctx.translate(30 + r() * 120, H - floor - 18); ctx.rotate(-0.05); ctx.fillText(style === 1 ? 'AYUDA' : 'NO ENTRAR', 0, 0); ctx.restore(); }
  return finish(c);
}

function facadeEmissive(style: number) {
  const W = 288, H = 384; const { c, ctx } = canvas(W, H); const r = rng(200 + style);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const floor = H / 4, col = W / 3;
  for (let f = 0; f < 3; f++) for (let k = 0; k < 3; k++) {
    const roll = r();
    if (roll > 0.14) continue; // apagón: casi todo a oscuras
    ctx.fillStyle = roll < 0.05 ? '#ff7a2a' : roll < 0.1 ? '#ffd28a' : '#7fb0ff'; // fuego, vela, linterna
    ctx.fillRect(k * col + 22, f * floor + 22, col - 44, floor - 46);
  }
  return finish(c, true);
}

/** Halo circular blanco (bombillas, charcos de luz). */
export const glow = () => cached('glow', () => {
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return finish(c, false, false);
});

/** Llama (sprite aditivo). */
export const flame = () => cached('flame', () => {
  const { c, ctx } = canvas(64, 128);
  const g = ctx.createRadialGradient(32, 92, 2, 32, 80, 60);
  g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.25, 'rgba(255,170,40,.95)'); g.addColorStop(0.6, 'rgba(220,60,10,.5)'); g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(32, 0); ctx.quadraticCurveTo(64, 70, 50, 120); ctx.lineTo(14, 120); ctx.quadraticCurveTo(0, 70, 32, 0); ctx.fill();
  return finish(c, false, false);
});

/** Humo/ceniza (sprite suave gris). */
export const smoke = () => cached('smoke', () => {
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return finish(c, false, false);
});

/** Mancha de sangre seca para el asfalto. */
export const blood = () => cached('blood', () => {
  const { c, ctx } = canvas(128, 128); const r = rng(7);
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(${70 + r() * 40},5,5,${0.5 + r() * 0.4})`; ctx.beginPath(); ctx.arc(64 + (r() - 0.5) * 70 * r(), 64 + (r() - 0.5) * 70 * r(), 3 + r() * 16, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(60,4,4,.7)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(64, 64); ctx.quadraticCurveTo(90, 80, 120, 70); ctx.stroke();
  return finish(c, true, false);
});

/** Cielo: noche con resplandor naranja de incendios en el horizonte. */
export const sky = () => cached('sky', () => {
  const { c, ctx } = canvas(16, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#04060a'); g.addColorStop(0.42, '#0b0e14'); g.addColorStop(0.5, '#2a1a12'); g.addColorStop(0.53, '#3a2214'); g.addColorStop(0.6, '#120d0b'); g.addColorStop(1, '#060505');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  return finish(c, true, false);
});

/** Piel de infectado: gris verdosa con venas oscuras, moretones y sangre seca. */
export const infectedSkin = () => cached('skin', () => {
  const { c, ctx } = canvas(256, 256); const r = rng(31);
  ctx.fillStyle = '#7b8470'; ctx.fillRect(0, 0, 256, 256);
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 30; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.8; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 10; i++) { const g = ctx.createRadialGradient(r() * 256, r() * 256, 2, r() * 256, r() * 256, 40); g.addColorStop(0, 'rgba(70,40,60,.5)'); g.addColorStop(1, 'rgba(70,40,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); }
  ctx.strokeStyle = 'rgba(40,50,60,.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) { let x = r() * 256, y = r() * 256; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 22; y += r() * 14; ctx.lineTo(x, y); } ctx.stroke(); }
  for (let i = 0; i < 8; i++) { ctx.fillStyle = `rgba(${60 + r() * 40},8,6,${0.5 + r() * 0.4})`; ctx.beginPath(); ctx.ellipse(r() * 256, r() * 256, 4 + r() * 14, 3 + r() * 24, r() * 3, 0, 7); ctx.fill(); }
  return finish(c);
});

/** Ropa rota: tela sucia con desgarros, barro y salpicaduras de sangre (4 variantes de color). */
export const infectedCloth = (variant: number) => cached(`cloth${variant}`, () => {
  const { c, ctx } = canvas(256, 256); const r = rng(40 + variant);
  ctx.fillStyle = ['#4a3f36', '#33404d', '#5a4a33', '#3b3b3b', '#4d5240'][variant % 5]; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`; ctx.fillRect(0, y, 256, 1); } // trama
  for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(40,30,20,${0.3 + r() * 0.3})`; ctx.beginPath(); ctx.ellipse(r() * 256, 200 + r() * 56, 20 + r() * 40, 8 + r() * 20, 0, 0, 7); ctx.fill(); } // barro abajo
  for (let i = 0; i < 6; i++) { ctx.fillStyle = '#0d0b0a'; ctx.beginPath(); const x = r() * 256, y = r() * 256; ctx.moveTo(x, y); for (let k = 0; k < 7; k++) ctx.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 34); ctx.fill(); } // desgarros
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${90 + r() * 50},6,6,${0.4 + r() * 0.5})`; ctx.beginPath(); ctx.arc(r() * 256, r() * 160, 1 + r() * 9 * r(), 0, 7); ctx.fill(); } // sangre
  return finish(c);
});
