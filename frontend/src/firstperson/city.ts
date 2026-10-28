// Escena 3D de Manta construida a partir del MISMO grafo del simulador.
// - Calles: cintas de asfalto sobre la geometría real de OpenStreetMap.
// - Edificios: procedurales a ambos lados de las calles (no hay huellas reales en el repo).
// - Noche + niebla + linterna: con pocos polígonos se ve creíble y corre en cualquier PC.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point, PreparedMap } from '../types/visual';

export type Project = (p: Point) => THREE.Vector3;

/** Lat/lng -> metros locales (x = este, z = sur) alrededor de un origen. */
export function makeProjector(origin: Point): Project {
  const [lat0, lng0] = origin;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const kz = 110540;
  return p => new THREE.Vector3((p[1] - lng0) * kx, 0, -(p[0] - lat0) * kz);
}

export const STREET_WIDTH: Record<string, number> = { avenida: 13, calle: 8, 'callejón': 4.5, callejon: 4.5, puente: 8 };

/** Número pseudoaleatorio estable a partir de un texto (mismos edificios en cada visita). */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

interface Segment { a: THREE.Vector3; b: THREE.Vector3; half: number }

function windowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 16) {
    for (let x = 5; x < 60; x += 14) {
      const lit = Math.random() < 0.3;
      ctx.fillStyle = lit ? (Math.random() < 0.7 ? '#ffc979' : '#9fd3ff') : '#0b0d10';
      ctx.fillRect(x, y, 8, 9);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export interface City { group: THREE.Group; dispose: () => void }

/** Línea de costa aproximada (z más al norte de la tierra) para cada x local.
 *  Manta mira al Pacífico por el norte: se toma la calle más al norte en una ventana
 *  amplia (±1,2 km) para no meter mar en los huecos del mapa. Si existe la costa real de
 *  OSM (public/manta/ciudad.json) se usa esa. */
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

export interface RealCity { buildings: Array<{ p: Point[]; h: number }>; coast: Point[][] }

export function buildCity(map: PreparedMap, project: Project, blocked: Set<string>, center: THREE.Vector3, radius = 900, coastZ: (x: number) => number = () => -Infinity, real: RealCity | null = null): City {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const near = (v: THREE.Vector3) => Math.hypot(v.x - center.x, v.z - center.z) < radius;

  // ---------- Calles ----------
  const segments: Segment[] = [];
  const road: number[] = [];
  const bridge: number[] = [];
  const nodeDiscs: Array<{ p: THREE.Vector3; r: number }> = [];
  for (const street of map.streets) {
    if (street.blocked || blocked.has(street.id) || street.points.length < 2) continue; // la arista bloqueada desaparece
    const pts = street.points.map(project);
    if (!pts.some(near)) continue;
    const half = (STREET_WIDTH[street.type] ?? 8) / 2;
    const target = street.type === 'puente' ? bridge : road;
    const y = street.type === 'puente' ? 0.35 : 0.02;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = new THREE.Vector3().subVectors(b, a);
      if (dir.lengthSq() < 0.01) continue;
      dir.normalize();
      const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(half);
      const q = [a.clone().add(n), a.clone().sub(n), b.clone().add(n), b.clone().sub(n)];
      for (const v of [q[0], q[1], q[2], q[1], q[3], q[2]]) target.push(v.x, y, v.z);
      segments.push({ a, b, half });
    }
    nodeDiscs.push({ p: pts[0], r: half }, { p: pts[pts.length - 1], r: half });
  }
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8, metalness: 0.1 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x4a4740, roughness: 0.9 });
  disposables.push(asphalt, concrete);
  for (const [positions, material] of [[road, asphalt], [bridge, concrete]] as const) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = false;
    group.add(mesh);
    disposables.push(geometry);
  }
  // Discos en las esquinas para que las calles se unan sin huecos.
  const disc = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  const discs = new THREE.InstancedMesh(disc, asphalt, nodeDiscs.length);
  const m = new THREE.Matrix4();
  nodeDiscs.forEach(({ p, r }, i) => { m.makeScale(r, 1, r).setPosition(p.x, 0.021, p.z); discs.setMatrixAt(i, m); });
  group.add(discs);
  disposables.push(disc);

  // Suelo (veredas y lotes) muy oscuro.
  const groundGeometry = new THREE.PlaneGeometry(radius * 2.4, radius * 2.4).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ color: 0x1c1d1c, roughness: 1 }));
  ground.position.set(center.x, 0, center.z);
  group.add(ground);
  disposables.push(groundGeometry, ground.material as THREE.Material);

  // ---------- Edificios procedurales ----------
  const CELL = 40;
  const grid = new Map<string, Segment[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const s of segments) {
    const steps = Math.ceil(s.a.distanceTo(s.b) / CELL) + 1;
    const seen = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const p = s.a.clone().lerp(s.b, i / steps);
      const k = key(p.x, p.z);
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
        best = Math.min(best, p.distanceTo(s.a.clone().addScaledVector(ab, t)) - s.half);
      }
    }
    return best;
  };
  const placed = new Map<string, THREE.Vector3[]>();
  const buildings: Array<{ p: THREE.Vector3; w: number; d: number; h: number; angle: number; color: THREE.Color }> = [];
  // Colores de la costa manabita: crema, blanco, celeste, salmón, menta, amarillo y bloque gris.
  const palette = [0xe8e2d0, 0xf2f0ea, 0xcfe0e6, 0xe6c9b5, 0xd6e3c9, 0xf0e6a8, 0xbfbab0, 0xd8c3a5];
  for (const s of segments) {
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 6; t < length - 4; t += 13) {
      for (const side of [1, -1]) {
        const seed = hash01(`${s.a.x.toFixed(1)}:${s.a.z.toFixed(1)}:${t}:${side}`);
        const w = 9 + seed * 6, d = 9 + ((seed * 7) % 1) * 7;
        const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, side * (s.half + 2.5 + d / 2));
        if (real || !near(p) || p.z < coastZ(p.x) + 25 || distToStreet(p) < Math.max(w, d) / 2 + 1.2) continue;
        const k = key(p.x, p.z);
        const others = placed.get(k) ?? [];
        if (others.some(o => o.distanceTo(p) < 10)) continue;
        others.push(p); placed.set(k, others);
        // Manta: casas de 1 a 3 pisos; torres solo cerca del malecón y de las playas.
        const r = (seed * 13) % 1;
        const coastal = p.z - coastZ(p.x) < 380;
        const floors = coastal && r > 0.9 ? 10 + Math.floor(((seed * 31) % 1) * 14) : r < 0.5 ? 1 : r < 0.85 ? 2 : 3;
        buildings.push({ p, w, d, h: floors * 3.1 + 0.4, angle: Math.atan2(dir.x, dir.z),
          color: new THREE.Color(palette[Math.floor(((seed * 7.3) % 1) * palette.length)]).multiplyScalar(0.42) });
        if (buildings.length > 9000) break;
      }
    }
  }
  const windows = windowTexture();
  windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const wall = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 0.7 });
  // Ventanas a tamaño real: la textura se proyecta en coordenadas del mundo (1 ventana cada
  // 3,5 m y un piso cada 3 m) en vez de estirarse con el tamaño de cada edificio. Sin ventanas en el techo.
  wall.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFpWorld;\nvarying float vFpRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 fpWorld = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nfpWorld = instanceMatrix * fpWorld;\n#endif\nvFpWorld = (modelMatrix * fpWorld).xyz;\nvFpRoof = step(0.5, abs(normal.y));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFpWorld;\nvarying float vFpRoof;')
      .replace('#include <emissivemap_fragment>', 'vec4 fpWin = texture2D(emissiveMap, vec2((vFpWorld.x + vFpWorld.z) / 14.0, vFpWorld.y / 24.0));\ntotalEmissiveRadiance *= fpWin.rgb * (1.0 - vFpRoof);');
  };
  const blocks = new THREE.InstancedMesh(boxGeometry, wall, buildings.length);
  const q = new THREE.Quaternion();
  buildings.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.angle);
    m.compose(new THREE.Vector3(b.p.x, 0, b.p.z), q, new THREE.Vector3(b.w, b.h, b.d));
    blocks.setMatrixAt(i, m);
    blocks.setColorAt(i, b.color);
  });
  group.add(blocks);
  disposables.push(windows, boxGeometry, wall);

  // ---------- Edificios reales de OpenStreetMap (si se descargaron) ----------
  if (real) {
    const extruded: THREE.BufferGeometry[] = [];
    for (const b of real.buildings) {
      const pts = b.p.map(project);
      if (pts.length < 3 || !near(pts[0])) continue;
      const shape = new THREE.Shape(pts.map(v => new THREE.Vector2(v.x, -v.z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const tint = new THREE.Color(palette[Math.floor(hash01(`${pts[0].x}`) * palette.length)]).multiplyScalar(0.42);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      extruded.push(g.toNonIndexed());
      g.dispose();
    }
    if (extruded.length) {
      const merged = mergeGeometries(extruded);
      extruded.forEach(g => g.dispose());
      const realWall = wall.clone();
      realWall.vertexColors = true;
      realWall.onBeforeCompile = wall.onBeforeCompile;
      group.add(new THREE.Mesh(merged, realWall));
      disposables.push(merged, realWall);
    }
  }

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
    const seaMaterial = new THREE.MeshStandardMaterial({ color: 0x0c2433, roughness: 0.18, metalness: 0.55 });
    const sea = new THREE.Mesh(seaGeometry, seaMaterial); sea.position.y = 0.04;
    const sandShape = new THREE.Shape([...shoreline, ...shoreline.slice().reverse().map(v => new THREE.Vector2(v.x, v.y - 28))]);
    const sandGeometry = new THREE.ShapeGeometry(sandShape).rotateX(-Math.PI / 2);
    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4334, roughness: 1 });
    const sand = new THREE.Mesh(sandGeometry, sandMaterial); sand.position.y = 0.03;
    group.add(sea, sand);
    disposables.push(seaGeometry, seaMaterial, sandGeometry, sandMaterial);
  }

  // ---------- Palmeras en las avenidas (malecón y avenidas principales) ----------
  const palmSpots: THREE.Vector3[] = [];
  for (const s of segments) {
    if (s.half < 6) continue; // solo avenidas
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 8; t < length; t += 19) for (const side of [1, -1]) {
      const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, side * (s.half + 1.4));
      if (near(p) && distToStreet(p) > 0.8) palmSpots.push(p);
    }
  }
  if (palmSpots.length) {
    const trunk = new THREE.CylinderGeometry(0.12, 0.2, 7, 6).translate(0, 3.5, 0);
    const fronds = mergeGeometries(Array.from({ length: 7 }, (_, i) =>
      new THREE.ConeGeometry(0.35, 3.6, 4).rotateX(Math.PI / 2 + 0.35).translate(0, 7, 1.6).rotateY((i / 7) * Math.PI * 2)));
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3d2c, roughness: 1 });
    const frondMaterial = new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 0.9, side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunk, trunkMaterial, palmSpots.length);
    const crowns = new THREE.InstancedMesh(fronds, frondMaterial, palmSpots.length);
    palmSpots.forEach((p, i) => {
      const scale = 0.85 + hash01(`${p.x}:${p.z}`) * 0.4;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash01(`${p.z}`) * 6.28);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    });
    group.add(trunks, crowns);
    disposables.push(trunk, fronds, trunkMaterial, frondMaterial, { dispose: () => { trunks.dispose(); crowns.dispose(); } });
  }

  // ---------- Alumbrado público (luz falsa: barata y convincente de noche) ----------
  const lamps: THREE.Vector3[] = [];
  for (const s of segments) {
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 10; t < length; t += 34) {
      const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, s.half + 0.6);
      if (!near(p) || hash01(`${p.x.toFixed(0)}:${p.z.toFixed(0)}`) < 0.25) continue; // algunas fundidas
      lamps.push(p);
    }
  }
  const poleGeometry = new THREE.CylinderGeometry(0.07, 0.1, 6, 6).translate(0, 3, 0);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.7, metalness: 0.4 });
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, lamps.length);
  const poolGeometry = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa94d, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.InstancedMesh(poolGeometry, poolMaterial, lamps.length);
  lamps.forEach((p, i) => {
    m.makeTranslation(p.x, 0, p.z); poles.setMatrixAt(i, m);
    m.makeScale(7, 1, 7).setPosition(p.x, 0.05, p.z); pools.setMatrixAt(i, m);
  });
  const bulbs = new THREE.Points(new THREE.BufferGeometry().setFromPoints(lamps.map(p => new THREE.Vector3(p.x, 6, p.z))),
    new THREE.PointsMaterial({ map: glowTexture(), color: 0xffc070, size: 3.2, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(poles, pools, bulbs);
  disposables.push(poleGeometry, poleMaterial, poolGeometry, poolMaterial, bulbs.geometry, bulbs.material as THREE.Material);

  return {
    group,
    dispose: () => { disposables.forEach(d => d.dispose()); discs.dispose(); blocks.dispose(); poles.dispose(); pools.dispose(); },
  };
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// ---------- Infectado (diseño propio, low-poly con articulaciones) ----------
// Cada brazo y pierna tiene dos segmentos (hombro/codo, cadera/rodilla) para que la marcha
// se vea natural: el caminante cojea y arrastra un pie; el corredor esprinta inclinado.
type Joint = { upper: THREE.Group; lower: THREE.Group };
export interface Infected { root: THREE.Group; body: THREE.Group; head: THREE.Object3D; legs: [Joint, Joint]; arms: [Joint, Joint]; type: string; phase: number; limp: number }

const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x55604c, roughness: 0.95 });
const woundMaterial = new THREE.MeshStandardMaterial({ color: 0x3d0f0c, roughness: 0.6 });
const clothMaterials = [0x2a2522, 0x1f2730, 0x3a2c20, 0x262626, 0x30352b].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const eyeMaterials: Record<string, THREE.MeshBasicMaterial> = {
  caminante: new THREE.MeshBasicMaterial({ color: 0xd8f070 }),
  corredor: new THREE.MeshBasicMaterial({ color: 0xff5a3c }),
  horda: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
};
const seg = (w: number, h: number) => new THREE.CapsuleGeometry(w, h, 2, 6).translate(0, -h / 2 - w, 0);
const geo = {
  thigh: seg(0.085, 0.36), shin: seg(0.07, 0.36), upperArm: seg(0.06, 0.26), foreArm: seg(0.05, 0.26),
  torso: new THREE.CapsuleGeometry(0.2, 0.36, 3, 8), head: new THREE.SphereGeometry(0.135, 12, 10),
  jaw: new THREE.BoxGeometry(0.15, 0.05, 0.12), eye: new THREE.SphereGeometry(0.022, 6, 4), wound: new THREE.SphereGeometry(0.07, 6, 4),
};

function joint(parent: THREE.Object3D, x: number, y: number, upperGeometry: THREE.BufferGeometry, lowerGeometry: THREE.BufferGeometry, upperLength: number, material: THREE.Material, lowerMaterial: THREE.Material): Joint {
  const upper = new THREE.Group(); upper.position.set(x, y, 0);
  upper.add(new THREE.Mesh(upperGeometry, material));
  const lower = new THREE.Group(); lower.position.y = -upperLength;
  lower.add(new THREE.Mesh(lowerGeometry, lowerMaterial));
  upper.add(lower); parent.add(upper);
  return { upper, lower };
}

/** Figura humanoide infectada: encorvada, ropa rasgada, ojos que brillan en la oscuridad. */
export function createInfected(type: string, seed: number): Infected {
  const root = new THREE.Group();
  const cloth = clothMaterials[Math.floor(seed * clothMaterials.length)];
  const legs: [Joint, Joint] = [joint(root, -0.11, 0.92, geo.thigh, geo.shin, 0.53, cloth, cloth), joint(root, 0.11, 0.92, geo.thigh, geo.shin, 0.53, cloth, skinMaterial)];
  const body = new THREE.Group(); body.position.y = 0.95; root.add(body);
  const torso = new THREE.Mesh(geo.torso, cloth); torso.position.y = 0.36; torso.scale.set(1.05, 1, 0.65); body.add(torso);
  const wound = new THREE.Mesh(geo.wound, woundMaterial); wound.position.set(0.09, 0.45, 0.12); wound.scale.set(1, 1.4, 0.5); body.add(wound);
  const head = new THREE.Group(); head.position.set(0, 0.86, 0.04); body.add(head);
  const skull = new THREE.Mesh(geo.head, skinMaterial); skull.scale.set(0.92, 1.08, 1); head.add(skull);
  const jaw = new THREE.Mesh(geo.jaw, woundMaterial); jaw.position.set(0, -0.09, 0.08); jaw.rotation.x = 0.35; head.add(jaw);
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(geo.eye, eyeMaterials[type] ?? eyeMaterials.caminante);
    e.position.set(side * 0.05, 0.02, 0.12); head.add(e);
  }
  const arms: [Joint, Joint] = [joint(body, -0.27, 0.62, geo.upperArm, geo.foreArm, 0.38, cloth, skinMaterial), joint(body, 0.27, 0.62, geo.upperArm, geo.foreArm, 0.38, skinMaterial, skinMaterial)];
  root.scale.setScalar(0.94 + seed * 0.14);
  return { root, body, head, legs, arms, type, phase: seed * Math.PI * 2, limp: 0.4 + seed * 0.5 };
}

/** Ciclo de marcha con rodillas y codos. */
export function animateInfected(z: Infected, time: number, moving: boolean) {
  const runner = z.type === 'corredor';
  const speed = runner ? 10.5 : moving ? 3.6 : 1.2;
  const stride = runner ? 0.95 : moving ? 0.42 : 0.05;
  const c = time * speed + z.phase;
  for (const [i, leg] of z.legs.entries()) {
    const s = Math.sin(c + i * Math.PI);
    const drag = !runner && i === 1 ? z.limp : 1; // el caminante arrastra una pierna
    leg.upper.rotation.x = s * stride * drag;
    leg.lower.rotation.x = Math.max(0, -Math.cos(c + i * Math.PI)) * stride * 1.4 * drag; // rodilla
  }
  // Cuerpo: el corredor se inclina hacia adelante; el caminante se balancea y rebota con el paso.
  z.body.rotation.x = runner ? 0.55 : 0.25 + Math.sin(c * 2) * 0.03;
  z.body.rotation.z = runner ? Math.sin(c) * 0.05 : Math.sin(c) * 0.11;
  z.root.position.y = Math.abs(Math.sin(c)) * (runner ? 0.09 : moving ? 0.03 : 0);
  // Cabeza: espasmos del infectado.
  z.head.rotation.z = runner ? 0 : Math.sin(time * 0.9 + z.phase) * 0.25 + (Math.sin(time * 7 + z.phase * 3) > 0.97 ? 0.3 : 0);
  z.head.rotation.x = runner ? -0.5 : -0.15;
  for (const [i, arm] of z.arms.entries()) {
    const s = Math.sin(c + i * Math.PI + Math.PI);
    if (runner) { arm.upper.rotation.x = s * 1.1; arm.lower.rotation.x = -1.2; }                // braceo de carrera
    else { arm.upper.rotation.x = -1.15 + s * 0.15; arm.lower.rotation.x = -0.25 + Math.sin(c * 0.5 + i) * 0.1; } // brazos al frente
    arm.upper.rotation.z = (i ? -1 : 1) * 0.08;
  }
}

/** Posición a lo largo de una polilínea según la fracción recorrida (0..1). */
export function alongPath(path: THREE.Vector3[], fraction: number): { position: THREE.Vector3; direction: THREE.Vector3 | null } {
  if (path.length === 0) return { position: new THREE.Vector3(), direction: null };
  if (path.length === 1) return { position: path[0].clone(), direction: null };
  const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const share = lengths[i] ? Math.min(1, remaining / lengths[i]) : 1;
      const direction = new THREE.Vector3().subVectors(path[i + 1], path[i]);
      return { position: path[i].clone().lerp(path[i + 1], share), direction: direction.lengthSq() > 0 ? direction.normalize() : null };
    }
    remaining -= lengths[i];
  }
  return { position: path[path.length - 1].clone(), direction: null };
}
