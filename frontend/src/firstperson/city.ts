// Escena 3D de Manta construida a partir del MISMO grafo del simulador.
// - Calles: asfalto con textura, veredas con bordillo, líneas pintadas, puentes con baranda.
// - Edificios: huellas reales de OSM si existen (public/manta/ciudad.json); si no, procedurales
//   con fachadas de 4 estilos (ventanas, rejas, persianas de local), tinacos y varillas en
//   los techos (casas "sin terminar", muy comunes en Manabí).
// - Mar al norte, palmeras en las avenidas y alumbrado público.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point, PreparedMap } from '../types/visual';
import { asphalt, facades, glow, sidewalk } from './textures';

export type Project = (p: Point) => THREE.Vector3;

/** Lat/lng -> metros locales (x = este, z = sur) alrededor de un origen. */
export function makeProjector(origin: Point): Project {
  const [lat0, lng0] = origin;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const kz = 110540;
  return p => new THREE.Vector3((p[1] - lng0) * kx, 0, -(p[0] - lat0) * kz);
}

export const STREET_WIDTH: Record<string, number> = { avenida: 13, calle: 8, 'callejón': 4.5, callejon: 4.5, puente: 8 };
const SIDEWALK = 2.4;
const CURB = 0.15;

/** Número pseudoaleatorio estable a partir de un texto (misma ciudad en cada visita). */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export interface Segment { a: THREE.Vector3; b: THREE.Vector3; half: number; type: string }
export interface City {
  group: THREE.Group; segments: Segment[]; distToStreet: (p: THREE.Vector3) => number;
  lamps: THREE.Vector3[]; dispose: () => void;
}
export interface RealCity { buildings: Array<{ p: Point[]; h: number }>; coast: Point[][] }

/** Línea de costa aproximada (z más al norte de la tierra) para cada x local.
 *  Manta mira al Pacífico por el norte: se toma la calle más al norte en una ventana
 *  amplia (±1,2 km) para no meter mar en los huecos del mapa. */
export function approximateCoast(map: PreparedMap, project: Project): (x: number) => number {
  const BIN = 50, WINDOW = 24;
  const north = new Map<number, number>();
  for (const p of map.nodes.values()) {
    const v = project(p); const b = Math.round(v.x / BIN);
    north.set(b, Math.min(north.get(b) ?? Infinity, v.z));
  }
  const bins = [...north.keys()];
  const minBin = Math.min(...bins), maxBin = Math.max(...bins);
  const coast = new Map<number, number>();
  for (let b = minBin - WINDOW; b <= maxBin + WINDOW; b++) {
    let best = Infinity;
    for (let k = b - WINDOW; k <= b + WINDOW; k++) best = Math.min(best, north.get(k) ?? Infinity);
    coast.set(b, best - 45);
  }
  return x => coast.get(Math.round(x / BIN)) ?? -Infinity;
}

/** Material con la textura proyectada en coordenadas del mundo (no se estira con el tamaño).
 *  mode 'ground': uv = xz / scale.   mode 'wall': uv = ((x+z)/scale, y/height); techo sin textura. */
function worldMaterial(params: THREE.MeshStandardMaterialParameters, mode: 'ground' | 'wall', scale: number, height = 12) {
  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nvarying float vRoof;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wp = instanceMatrix * wp;
#endif
vWorldP = (modelMatrix * wp).xyz;
vRoof = step(0.5, abs(normal.y));`);
    const uv = mode === 'ground' ? `vWorldP.xz / ${scale.toFixed(2)}` : `vec2((vWorldP.x + vWorldP.z) / ${scale.toFixed(2)}, vWorldP.y / ${height.toFixed(2)})`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nvarying float vRoof;')
      .replace('#include <map_fragment>', mode === 'ground'
        ? `#ifdef USE_MAP\n diffuseColor *= texture2D(map, ${uv});\n#endif`
        : `#ifdef USE_MAP\n vec4 fac = texture2D(map, ${uv});\n diffuseColor.rgb *= mix(fac.rgb, vec3(0.42), vRoof);\n#endif`)
      .replace('#include <emissivemap_fragment>', mode === 'ground'
        ? '#include <emissivemap_fragment>'
        : `#ifdef USE_EMISSIVEMAP\n totalEmissiveRadiance *= texture2D(emissiveMap, ${uv}).rgb * (1.0 - vRoof);\n#endif`);
  };
  return material;
}

function ribbon(target: number[], a: THREE.Vector3, b: THREE.Vector3, from: number, to: number, yFrom: number, yTo: number) {
  // Franja paralela a a→b entre las distancias laterales from..to (positivas a la izquierda).
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const n = new THREE.Vector3(-dir.z, 0, dir.x);
  const p = (base: THREE.Vector3, d: number, y: number) => base.clone().addScaledVector(n, d).setY(y);
  const q = [p(a, to, yTo), p(a, from, yFrom), p(b, to, yTo), p(b, from, yFrom)];
  for (const v of [q[0], q[1], q[2], q[1], q[3], q[2]]) target.push(v.x, v.y, v.z);
}

function meshFrom(positions: number[], material: THREE.Material, disposables: Array<{ dispose: () => void }>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  disposables.push(geometry);
  return new THREE.Mesh(geometry, material);
}

export function buildCity(map: PreparedMap, project: Project, blocked: Set<string>, center: THREE.Vector3, radius = 1500,
  coastZ: (x: number) => number = () => -Infinity, real: RealCity | null = null): City {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const near = (v: THREE.Vector3, r = radius) => Math.hypot(v.x - center.x, v.z - center.z) < r;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  // ---------- Calles ----------
  const segments: Segment[] = [];
  const road: number[] = [], walk: number[] = [], curb: number[] = [], deck: number[] = [];
  const corners: Array<{ p: THREE.Vector3; r: number }> = [];
  for (const street of map.streets) {
    if (street.blocked || blocked.has(street.id) || street.points.length < 2) continue; // la arista bloqueada desaparece
    const pts = street.points.map(project);
    if (!pts.some(v => near(v))) continue;
    const half = (STREET_WIDTH[street.type] ?? 8) / 2;
    const bridge = street.type === 'puente';
    const trim = half + SIDEWALK; // las veredas se cortan antes de cada esquina (no cruzan la calzada)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.distanceToSquared(b) < 0.01) continue;
      segments.push({ a, b, half, type: street.type });
      if (bridge) { ribbon(deck, a, b, -half - 1, half + 1, 0.4, 0.4); continue; }
      ribbon(road, a, b, -half, half, 0.02, 0.02);
      if (half < 3) continue;
      const dir = new THREE.Vector3().subVectors(b, a); const length = dir.length(); dir.normalize();
      const start = i === 0 ? trim : 0, end = i === pts.length - 2 ? length - trim : length;
      if (end - start < 0.5) continue;
      const wa = a.clone().addScaledVector(dir, start), wb = a.clone().addScaledVector(dir, end);
      for (const side of [1, -1]) {
        ribbon(walk, wa, wb, side * half, side * (half + SIDEWALK), CURB, CURB);       // vereda
        ribbon(curb, wa, wb, side * half, side * half, 0.0, CURB);                    // cara del bordillo
      }
    }
    corners.push({ p: pts[0], r: half }, { p: pts[pts.length - 1], r: half });
  }
  const asphaltMaterial = worldMaterial({ color: 0x8a8a88, map: asphalt(), roughness: 0.88, metalness: 0.05 }, 'ground', 8);
  const walkMaterial = worldMaterial({ color: 0x9a978f, map: sidewalk(), roughness: 0.95 }, 'ground', 4);
  const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.9, side: THREE.DoubleSide });
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x55524b, roughness: 0.9 });
  disposables.push(asphaltMaterial, walkMaterial, curbMaterial, deckMaterial);
  group.add(meshFrom(walk, walkMaterial, disposables), meshFrom(curb, curbMaterial, disposables), meshFrom(road, asphaltMaterial, disposables));
  if (deck.length) group.add(meshFrom(deck, deckMaterial, disposables));
  // Esquinas: disco de asfalto que tapa la unión de calles (vereda debajo).
  const disc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const discs = new THREE.InstancedMesh(disc, asphaltMaterial, corners.length);
  corners.forEach(({ p, r }, i) => { m.makeScale(r * 1.15, 1, r * 1.15).setPosition(p.x, 0.025, p.z); discs.setMatrixAt(i, m); });
  group.add(discs);
  disposables.push(disc, { dispose: () => discs.dispose() });

  // Líneas pintadas (amarillo gastado) en el centro de avenidas y calles; baranda en puentes.
  const dashes: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [];
  for (const s of segments) {
    const length = s.a.distanceTo(s.b);
    const angle = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
    q.setFromAxisAngle(UP, angle);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    if (s.type === 'puente') {
      const n = new THREE.Vector3(-dir.z, 0, dir.x);
      for (const side of [1, -1]) {
        const mid = s.a.clone().lerp(s.b, 0.5).addScaledVector(n, side * (s.half + 0.8));
        rails.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x, 0.95, mid.z), q, new THREE.Vector3(0.25, 1.1, length)));
      }
    } else if (s.half >= 4) {
      for (let t = 2; t < length - 2; t += 7) {
        const p = s.a.clone().addScaledVector(dir, t);
        if (near(p, 500)) dashes.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0.035, p.z), q, new THREE.Vector3(0.14, 1, 3)));
      }
    }
  }
  const dashGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0x9c8a45, roughness: 0.8 });
  const dashMesh = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashes.length);
  dashes.forEach((mx, i) => dashMesh.setMatrixAt(i, mx));
  const railGeometry = new THREE.BoxGeometry(1, 1, 1);
  const railMesh = new THREE.InstancedMesh(railGeometry, deckMaterial, rails.length);
  rails.forEach((mx, i) => railMesh.setMatrixAt(i, mx));
  group.add(dashMesh, railMesh);
  disposables.push(dashGeometry, dashMaterial, railGeometry, { dispose: () => { dashMesh.dispose(); railMesh.dispose(); } });

  // Suelo de tierra/lotes.
  const groundGeometry = new THREE.PlaneGeometry(radius * 2.6, radius * 2.6).rotateX(-Math.PI / 2);
  const groundMaterial = worldMaterial({ color: 0x4a4436, map: sidewalk(), roughness: 1 }, 'ground', 13);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(center.x, -0.01, center.z);
  group.add(ground);
  disposables.push(groundGeometry, groundMaterial);

  // ---------- Búsqueda rápida de "¿qué tan cerca estoy de una calle?" ----------
  const CELL = 40;
  const grid = new Map<string, Segment[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const s of segments) {
    const steps = Math.ceil(s.a.distanceTo(s.b) / CELL) + 1;
    const seen = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const p = s.a.clone().lerp(s.b, i / steps); const k = key(p.x, p.z);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(s);
    }
  }
  const distToStreet = (p: THREE.Vector3) => {
    let best = Infinity;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const s of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const ab = new THREE.Vector3().subVectors(s.b, s.a);
        const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, s.a).dot(ab) / ab.lengthSq()));
        best = Math.min(best, Math.hypot(p.x - (s.a.x + ab.x * t), p.z - (s.a.z + ab.z * t)) - s.half - (s.half >= 3 ? SIDEWALK : 0));
      }
    }
    return best;
  };

  // ---------- Edificios ----------
  const palette = [0xe8e2d0, 0xf2f0ea, 0xcfe0e6, 0xe6c9b5, 0xd6e3c9, 0xf0e6a8, 0xbfbab0, 0xd8c3a5];
  const styles = facades().map(f => worldMaterial({ color: 0xffffff, map: f.map, emissive: 0xffffff, emissiveMap: f.emissive, emissiveIntensity: 0.9, roughness: 0.93 }, 'wall', 9, 12));
  disposables.push(...styles);
  type Block = { p: THREE.Vector3; w: number; d: number; h: number; angle: number; color: THREE.Color; style: number; seed: number };
  const blocks: Block[] = [];
  if (!real) {
    const placed = new Map<string, THREE.Vector3[]>();
    for (const s of segments) {
      if (s.type === 'puente') continue;
      const length = s.a.distanceTo(s.b);
      const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
      const normal = new THREE.Vector3(-dir.z, 0, dir.x);
      for (let t = 6; t < length - 4; t += 11) for (const side of [1, -1]) {
        const seed = hash01(`${s.a.x.toFixed(1)}:${s.a.z.toFixed(1)}:${t}:${side}`);
        const w = 8 + seed * 5, d = 10 + ((seed * 7) % 1) * 8;
        const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, side * (s.half + (s.half >= 3 ? SIDEWALK : 0.6) + d / 2 + 0.2));
        if (!near(p) || p.z < coastZ(p.x) + 25 || distToStreet(p) < Math.max(w, d) / 2 - 0.5) continue;
        const k = key(p.x, p.z);
        const others = placed.get(k) ?? [];
        if (others.some(o => o.distanceTo(p) < 8.5)) continue;
        others.push(p); placed.set(k, others);
        // Manta: casas de 1 a 3 pisos; torres solo cerca del malecón y de las playas.
        const r = (seed * 13) % 1;
        const coastal = p.z - coastZ(p.x) < 380;
        const floors = coastal && r > 0.9 ? 10 + Math.floor(((seed * 31) % 1) * 14) : r < 0.45 ? 1 : r < 0.82 ? 2 : 3;
        blocks.push({ p, w, d, h: floors * 3 + 0.3, angle: Math.atan2(dir.x, dir.z), seed, style: Math.floor(((seed * 5.7) % 1) * 4),
          color: new THREE.Color(palette[Math.floor(((seed * 7.3) % 1) * palette.length)]).multiplyScalar(0.5) });
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    disposables.push(box);
    for (let style = 0; style < 4; style++) {
      const mine = blocks.filter(b => b.style === style);
      const mesh = new THREE.InstancedMesh(box, styles[style], mine.length);
      mine.forEach((b, i) => {
        q.setFromAxisAngle(UP, b.angle);
        m.compose(new THREE.Vector3(b.p.x, 0, b.p.z), q, new THREE.Vector3(b.w, b.h, b.d));
        mesh.setMatrixAt(i, m); mesh.setColorAt(i, b.color);
      });
      group.add(mesh);
      disposables.push({ dispose: () => mesh.dispose() });
    }
  } else {
    // Huellas reales de OpenStreetMap extruidas a su altura.
    const byStyle: THREE.BufferGeometry[][] = [[], [], [], []];
    for (const b of real.buildings) {
      const pts = b.p.map(project);
      if (pts.length < 3 || !near(pts[0])) continue;
      const shape = new THREE.Shape(pts.map(v => new THREE.Vector2(v.x, -v.z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const seed = hash01(`${pts[0].x.toFixed(1)}:${pts[0].z.toFixed(1)}`);
      const tint = new THREE.Color(palette[Math.floor(seed * palette.length)]).multiplyScalar(0.5);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute('uv');
      byStyle[Math.floor(((seed * 5.7) % 1) * 4)].push(g);
      const c = pts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(pts.length);
      blocks.push({ p: c, w: 6, d: 6, h: b.h, angle: 0, color: tint, style: 0, seed });
    }
    byStyle.forEach((list, style) => {
      if (!list.length) return;
      const merged = mergeGeometries(list);
      list.forEach(g => g.dispose());
      const material = styles[style].clone();
      material.vertexColors = true;
      material.onBeforeCompile = styles[style].onBeforeCompile;
      group.add(new THREE.Mesh(merged, material));
      disposables.push(merged, material);
    });
  }

  // Techos: tinacos (tanques de agua) y varillas de construcción a medio terminar.
  const tanks: THREE.Matrix4[] = [], rebars: THREE.Matrix4[] = [];
  for (const b of blocks) {
    if (!near(b.p, 500) || b.h > 20) continue;
    if (b.seed < 0.55) tanks.push(new THREE.Matrix4().makeTranslation(b.p.x + (b.seed - 0.3) * b.w * 0.5, b.h, b.p.z + (b.seed - 0.3) * 2));
    if (b.seed > 0.7) for (let k = 0; k < 6; k++) {
      const off = new THREE.Vector3((k % 3 - 1) * b.w * 0.35, 0, (k < 3 ? -1 : 1) * b.d * 0.35).applyAxisAngle(UP, b.angle);
      rebars.push(new THREE.Matrix4().makeTranslation(b.p.x + off.x, b.h, b.p.z + off.z));
    }
  }
  const tankGeometry = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 10).translate(0, 0.6, 0);
  const rebarGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1.3, 4).translate(0, 0.65, 0);
  const tankMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6 });
  const rebarMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.7, metalness: 0.6 });
  const tankMesh = new THREE.InstancedMesh(tankGeometry, tankMaterial, tanks.length);
  const rebarMesh = new THREE.InstancedMesh(rebarGeometry, rebarMaterial, rebars.length);
  tanks.forEach((mx, i) => tankMesh.setMatrixAt(i, mx));
  rebars.forEach((mx, i) => rebarMesh.setMatrixAt(i, mx));
  group.add(tankMesh, rebarMesh);
  disposables.push(tankGeometry, rebarGeometry, tankMaterial, rebarMaterial, { dispose: () => { tankMesh.dispose(); rebarMesh.dispose(); } });

  // ---------- Mar (Pacífico al norte) y franja de playa ----------
  const shoreline: THREE.Vector2[] = [];
  for (let x = center.x - radius * 1.3; x <= center.x + radius * 1.3; x += 40) {
    const z = coastZ(x);
    if (Number.isFinite(z)) shoreline.push(new THREE.Vector2(x, -z));
  }
  if (shoreline.length > 2) {
    const far = -(center.z - radius * 3);
    const seaShape = new THREE.Shape([...shoreline, new THREE.Vector2(shoreline[shoreline.length - 1].x, far), new THREE.Vector2(shoreline[0].x, far)]);
    const seaGeometry = new THREE.ShapeGeometry(seaShape).rotateX(-Math.PI / 2);
    const seaMaterial = new THREE.MeshStandardMaterial({ color: 0x0c2433, roughness: 0.15, metalness: 0.6 });
    const sea = new THREE.Mesh(seaGeometry, seaMaterial); sea.position.y = 0.04;
    const sandShape = new THREE.Shape([...shoreline, ...shoreline.slice().reverse().map(v => new THREE.Vector2(v.x, v.y - 28))]);
    const sandGeometry = new THREE.ShapeGeometry(sandShape).rotateX(-Math.PI / 2);
    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0x5a523f, roughness: 1 });
    const sand = new THREE.Mesh(sandGeometry, sandMaterial); sand.position.y = 0.03;
    group.add(sea, sand);
    disposables.push(seaGeometry, seaMaterial, sandGeometry, sandMaterial);
  }

  // ---------- Palmeras en las avenidas ----------
  const palms: THREE.Vector3[] = [];
  for (const s of segments) {
    if (s.half < 6) continue;
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 8; t < length; t += 19) for (const side of [1, -1]) {
      const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, side * (s.half + 1.2));
      if (near(p, 600)) palms.push(p.setY(CURB));
    }
  }
  if (palms.length) {
    const trunk = new THREE.CylinderGeometry(0.12, 0.2, 7, 6).translate(0, 3.5, 0);
    const fronds = mergeGeometries(Array.from({ length: 8 }, (_, i) =>
      new THREE.ConeGeometry(0.32, 3.6, 4).rotateX(Math.PI / 2 + 0.45 + (i % 2) * 0.2).translate(0, 7, 1.6).rotateY((i / 8) * Math.PI * 2)));
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3d2c, roughness: 1 });
    const frondMaterial = new THREE.MeshStandardMaterial({ color: 0x2c4228, roughness: 0.9, side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunk, trunkMaterial, palms.length);
    const crowns = new THREE.InstancedMesh(fronds, frondMaterial, palms.length);
    palms.forEach((p, i) => {
      const s = 0.85 + hash01(`${p.x}:${p.z}`) * 0.4;
      q.setFromEuler(new THREE.Euler((hash01(`${p.z}a`) - 0.5) * 0.12, hash01(`${p.z}`) * 6.28, (hash01(`${p.x}b`) - 0.5) * 0.12));
      m.compose(p, q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    });
    group.add(trunks, crowns);
    disposables.push(trunk, fronds, trunkMaterial, frondMaterial, { dispose: () => { trunks.dispose(); crowns.dispose(); } });
  }

  // ---------- Alumbrado público (muchos postes apagados: apagón) ----------
  const lamps: THREE.Vector3[] = [], dead: THREE.Vector3[] = [];
  for (const s of segments) {
    if (s.type === 'puente') continue;
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 10; t < length; t += 30) {
      const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, s.half + 0.5);
      if (!near(p, 600)) continue;
      (hash01(`${p.x.toFixed(0)}:${p.z.toFixed(0)}`) < 0.55 ? dead : lamps).push(p);
    }
  }
  const all = [...lamps, ...dead];
  const poleGeometry = new THREE.CylinderGeometry(0.07, 0.1, 6, 6).translate(0, 3, 0);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.7, metalness: 0.4 });
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, all.length);
  all.forEach((p, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), i >= lamps.length && hash01(`${p.x}t`) < 0.25 ? 0.35 : 0); m.compose(p.clone().setY(0), q, new THREE.Vector3(1, 1, 1)); poles.setMatrixAt(i, m); });
  const poolGeometry = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({ map: glow(), color: 0xffa94d, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.InstancedMesh(poolGeometry, poolMaterial, lamps.length);
  lamps.forEach((p, i) => { m.makeScale(7, 1, 7).setPosition(p.x, 0.2, p.z); pools.setMatrixAt(i, m); });
  const bulbs = new THREE.Points(new THREE.BufferGeometry().setFromPoints(lamps.map(p => new THREE.Vector3(p.x, 6, p.z))),
    new THREE.PointsMaterial({ map: glow(), color: 0xffc070, size: 3.2, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(poles, pools, bulbs);
  disposables.push(poleGeometry, poleMaterial, poolGeometry, poolMaterial, bulbs.geometry, bulbs.material as THREE.Material,
    { dispose: () => { poles.dispose(); pools.dispose(); } });

  return { group, segments, distToStreet, lamps, dispose: () => disposables.forEach(d => d.dispose()) };
}
