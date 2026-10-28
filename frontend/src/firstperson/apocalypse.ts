// Ambientación de apocalipsis: autos abandonados y quemados, incendios con humo, escombros,
// barricadas (también en las calles bloqueadas por eventos), manchas de sangre y ceniza en el aire.
// Todo se coloca de forma estable (misma semilla = mismo lugar) y con instancias para que sea liviano.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PreparedMap } from '../types/visual';
import { hash01, type Project, type Segment } from './city';
import { blood, flame, glow as glowTex, smoke } from './textures';

export interface Apocalypse { group: THREE.Group; update: (time: number, camera: THREE.Vector3) => void; dispose: () => void }

const UP = new THREE.Vector3(0, 1, 0);

function carGeometry() {
  // Carrocería y cabina con colores por vértice (vidrios oscuros); se tiñe por instancia.
  const paint = (g: THREE.BufferGeometry, v: number) => {
    const c = new Float32Array(g.attributes.position.count * 3).fill(v);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const body = paint(new THREE.BoxGeometry(1.8, 0.75, 4.3).translate(0, 0.7, 0), 1);
  const cabin = paint(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.35, -0.2), 0.18);
  const hood = paint(new THREE.BoxGeometry(1.7, 0.08, 1.2).translate(0, 1.1, 1.5), 1);
  const wheels = mergeGeometries([[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]].map(([x, z]) =>
    paint(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10).rotateZ(Math.PI / 2).translate(x, 0.36, z), 0.05)));
  return mergeGeometries([body, cabin, hood, wheels].map(g => g.toNonIndexed()));
}

export function buildApocalypse(map: PreparedMap, project: Project, segments: Segment[], distToStreet: (p: THREE.Vector3) => number,
  blocked: Set<string>, center: THREE.Vector3, radius = 500): Apocalypse {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const near = (p: THREE.Vector3) => Math.hypot(p.x - center.x, p.z - center.z) < radius;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();

  // ---------- Autos abandonados ----------
  const cars: Array<{ p: THREE.Vector3; angle: number; burned: boolean; tilt: number; color: THREE.Color }> = [];
  const carColors = [0x8b1e1e, 0x1e3a6b, 0xb8b8b0, 0x2a2a2a, 0x6b6b20, 0x3c5a3c, 0xc7c2b0];
  for (const s of segments) {
    if (s.half < 3.5 || s.type === 'puente') continue;
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let t = 12; t < length - 8; t += 23) {
      const seed = hash01(`car:${s.a.x.toFixed(1)}:${s.a.z.toFixed(1)}:${t}`);
      if (seed > 0.42) continue;
      const side = seed < 0.21 ? 1 : -1;
      const crashed = seed < 0.07;
      const p = s.a.clone().addScaledVector(dir, t).addScaledVector(normal, side * (s.half - 1.3));
      if (!near(p)) continue;
      cars.push({ p, angle: Math.atan2(dir.x, dir.z) + (crashed ? (seed * 40) % 1.6 - 0.8 : (seed - 0.2) * 0.3), burned: seed < 0.14,
        tilt: crashed ? 0.08 : 0, color: new THREE.Color(carColors[Math.floor(seed * 97) % carColors.length]).multiplyScalar(0.55) });
    }
  }
  // Algunos autos están volcados y algunos son patrulleros abandonados con la baliza encendida.
  const police: THREE.Vector3[] = [];
  cars.forEach((c, i) => {
    const r = hash01(`kind:${c.p.x.toFixed(1)}:${c.p.z.toFixed(1)}`);
    if (r < 0.1 && !c.burned) { c.tilt = Math.PI; c.p.y = 1.75; }                         // volcado
    else if (r > 0.93 && !c.burned) { c.color = new THREE.Color(0xd8d8d2).multiplyScalar(0.6); police.push(c.p.clone()); c.angle += 0; void i; }
  });
  const carGeo = carGeometry();
  const carMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
  const carMesh = new THREE.InstancedMesh(carGeo, carMaterial, cars.length);
  cars.forEach((c, i) => {
    q.setFromEuler(new THREE.Euler(0, c.angle, c.tilt));
    m.compose(c.p, q, new THREE.Vector3(1, 1, 1));
    carMesh.setMatrixAt(i, m);
    carMesh.setColorAt(i, c.burned ? new THREE.Color(0x141210) : c.color);
  });
  group.add(carMesh);
  disposables.push(carGeo, carMaterial, { dispose: () => carMesh.dispose() });

  // Balizas de patrullero: barra roja y azul que parpadea (sin luces reales: solo brillo).
  const beaconGeometry = new THREE.BoxGeometry(0.5, 0.14, 0.25);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true });
  const blue = new THREE.MeshBasicMaterial({ color: 0x2a6bff, transparent: true });
  const redMesh = new THREE.InstancedMesh(beaconGeometry, red, police.length);
  const blueMesh = new THREE.InstancedMesh(beaconGeometry, blue, police.length);
  const beaconCar = cars.filter(c => police.some(p => p.equals(c.p)));
  beaconCar.forEach((c, i) => {
    q.setFromAxisAngle(UP, c.angle);
    for (const [mesh, side] of [[redMesh, -1], [blueMesh, 1]] as const) {
      const off = new THREE.Vector3(side * 0.28, 1.72, -0.2).applyQuaternion(q);
      m.compose(c.p.clone().add(off), q, new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(i, m);
    }
  });
  const beaconGlow = new THREE.Points(new THREE.BufferGeometry().setFromPoints(beaconCar.map(c => c.p.clone().setY(1.9))),
    new THREE.PointsMaterial({ map: glowTex(), color: 0xff2a2a, size: 4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(redMesh, blueMesh, beaconGlow);
  disposables.push(beaconGeometry, red, blue, beaconGlow.geometry, beaconGlow.material as THREE.Material, { dispose: () => { redMesh.dispose(); blueMesh.dispose(); } });

  // ---------- Incendios (autos y barricadas en llamas) + humo ----------
  const fires = cars.filter((c, i) => c.burned && i % 2 === 0).map(c => c.p.clone().setY(1.2));
  const flameMaterial = new THREE.SpriteMaterial({ map: flame(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flames: THREE.Sprite[] = [];
  for (const f of fires) for (let k = 0; k < 3; k++) {
    const sprite = new THREE.Sprite(flameMaterial);
    sprite.position.copy(f).add(new THREE.Vector3((k - 1) * 0.6, 0, (k % 2) * 0.5));
    sprite.userData.base = sprite.position.clone();
    sprite.userData.phase = hash01(`${f.x}:${k}`) * 10;
    flames.push(sprite); group.add(sprite);
  }
  // Luces de fuego reales solo para los 2 incendios más cercanos (cada luz encarece todo el render).
  const fireLights = Array.from({ length: 2 }, () => { const l = new THREE.PointLight(0xff7a2a, 0, 26, 1.6); group.add(l); return l; });
  const SMOKE_PER_FIRE = 18;
  const smokeCount = fires.length * SMOKE_PER_FIRE;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeAge = new Float32Array(smokeCount).map((_, i) => (i % SMOKE_PER_FIRE) / SMOKE_PER_FIRE);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeMaterial = new THREE.PointsMaterial({ map: smoke(), color: 0x3a3532, size: 7, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false });
  const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
  smokePoints.frustumCulled = false;
  group.add(smokePoints);
  disposables.push(flameMaterial, smokeGeometry, smokeMaterial);

  // ---------- Escombros, basura y barricadas ----------
  const rubble: THREE.Matrix4[] = [], barriers: THREE.Matrix4[] = [], barrels: THREE.Matrix4[] = [], stains: THREE.Matrix4[] = [], bags: THREE.Matrix4[] = [], papers: THREE.Matrix4[] = [];
  for (const s of segments) {
    if (s.type === 'puente') continue;
    const length = s.a.distanceTo(s.b);
    const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    const angle = Math.atan2(dir.x, dir.z);
    for (let t = 5; t < length; t += 9) {
      const seed = hash01(`deb:${s.a.x.toFixed(1)}:${s.a.z.toFixed(1)}:${t}`);
      const p = s.a.clone().addScaledVector(dir, t);
      if (!near(p)) continue;
      if (seed < 0.3) { // escombros sobre la vereda y la orilla de la calzada
        const at = p.clone().addScaledVector(normal, (seed < 0.15 ? 1 : -1) * (s.half + 0.6 + seed * 3));
        q.setFromEuler(new THREE.Euler(seed * 3, seed * 17, seed * 7));
        rubble.push(new THREE.Matrix4().compose(at.setY(0.1), q, new THREE.Vector3(0.5 + seed * 2.2, 0.3 + seed, 0.5 + seed * 1.8)));
      } else if (seed < 0.4) { // bolsas de basura acumuladas (no hay recolección)
        const at = p.clone().addScaledVector(normal, (seed < 0.35 ? 1 : -1) * (s.half + 1.2));
        for (let k = 0; k < 3; k++) bags.push(new THREE.Matrix4().compose(at.clone().add(new THREE.Vector3(k * 0.5 - 0.5, 0.3, (k % 2) * 0.4)).setY(0.3),
          new THREE.Quaternion().setFromAxisAngle(UP, seed * 9 + k), new THREE.Vector3(1, 0.8 + k * 0.1, 1)));
      } else if (seed < 0.5) { // papeles y ropa tirados en la calzada
        papers.push(new THREE.Matrix4().compose(p.clone().addScaledVector(normal, (seed - 0.45) * s.half * 3).setY(0.045),
          new THREE.Quaternion().setFromAxisAngle(UP, seed * 31), new THREE.Vector3(0.4 + seed * 0.4, 1, 0.3 + seed * 0.3)));
      } else if (seed < 0.56) {
        stains.push(new THREE.Matrix4().compose(p.clone().addScaledVector(normal, (seed - 0.53) * s.half * 4).setY(0.05),
          new THREE.Quaternion().setFromAxisAngle(UP, seed * 50), new THREE.Vector3(2 + seed * 3, 1, 2 + seed * 3)));
      }
    }
    // Barricada improvisada al final de algunas calles.
    const seed = hash01(`bar:${s.a.x.toFixed(1)}:${s.a.z.toFixed(1)}`);
    if (seed < 0.04 && s.half >= 3 && near(s.b)) {
      for (let k = -1; k <= 1; k++) {
        q.setFromAxisAngle(UP, angle + Math.PI / 2 + (hash01(`${seed}${k}`) - 0.5) * 0.4);
        const at = s.b.clone().addScaledVector(normal, k * (s.half * 0.7)).addScaledVector(dir, -3);
        barriers.push(new THREE.Matrix4().compose(at.setY(0), q, new THREE.Vector3(1, 1, 1)));
        barrels.push(new THREE.Matrix4().makeTranslation(at.x + 1.2, 0, at.z + 0.6));
      }
    }
  }
  // Calles bloqueadas por eventos: barreras de concreto en ambos extremos.
  for (const street of map.streets) {
    if (!(street.blocked || blocked.has(street.id)) || street.points.length < 2) continue;
    const pts = street.points.map(project);
    for (const [end, prev] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]] as const) {
      if (!near(end)) continue;
      const dir = new THREE.Vector3().subVectors(prev, end).normalize();
      const normal = new THREE.Vector3(-dir.z, 0, dir.x);
      const at = end.clone().addScaledVector(dir, 6);
      for (let k = -2; k <= 2; k++) {
        q.setFromAxisAngle(UP, Math.atan2(normal.x, normal.z));
        barriers.push(new THREE.Matrix4().compose(at.clone().addScaledVector(normal, k * 2.1).setY(0), q, new THREE.Vector3(1, 1, 1)));
      }
      barrels.push(new THREE.Matrix4().makeTranslation(at.x + normal.x * 5.5, 0, at.z + normal.z * 5.5));
    }
  }
  const rubbleGeometry = new THREE.DodecahedronGeometry(0.6, 0);
  const rubbleMaterial = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 1, flatShading: true });
  const barrierGeometry = new THREE.BoxGeometry(2, 0.9, 0.6).translate(0, 0.45, 0);
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 0.95 });
  const barrelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10).translate(0, 0.45, 0);
  const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x9a3a12, roughness: 0.6, metalness: 0.3 });
  const stainGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const stainMaterial = new THREE.MeshStandardMaterial({ map: blood(), transparent: true, depthWrite: false, roughness: 0.4 });
  const bagGeometry = new THREE.SphereGeometry(0.35, 8, 6);
  const bagMaterial = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.35, metalness: 0.1 });
  const paperGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const paperMaterial = new THREE.MeshStandardMaterial({ color: 0x8f8a7c, roughness: 0.9 });
  for (const [geometry, material, list] of [[rubbleGeometry, rubbleMaterial, rubble], [barrierGeometry, barrierMaterial, barriers],
    [barrelGeometry, barrelMaterial, barrels], [stainGeometry, stainMaterial, stains], [bagGeometry, bagMaterial, bags], [paperGeometry, paperMaterial, papers]] as const) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((mx, i) => mesh.setMatrixAt(i, mx));
    group.add(mesh);
    disposables.push(geometry, material, { dispose: () => mesh.dispose() });
  }
  void distToStreet;

  // ---------- Ceniza cayendo alrededor de la cámara ----------
  const ASH = 900;
  const ashPositions = new Float32Array(ASH * 3);
  for (let i = 0; i < ASH; i++) {
    ashPositions[i * 3] = (hash01(`ax${i}`) - 0.5) * 60;
    ashPositions[i * 3 + 1] = hash01(`ay${i}`) * 25;
    ashPositions[i * 3 + 2] = (hash01(`az${i}`) - 0.5) * 60;
  }
  const ashGeometry = new THREE.BufferGeometry();
  ashGeometry.setAttribute('position', new THREE.BufferAttribute(ashPositions, 3));
  const ashMaterial = new THREE.PointsMaterial({ map: smoke(), color: 0x9a9088, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false });
  const ash = new THREE.Points(ashGeometry, ashMaterial);
  ash.frustumCulled = false;
  group.add(ash);
  disposables.push(ashGeometry, ashMaterial);

  let lastLights = -1;
  const update = (time: number, camera: THREE.Vector3) => {
    // Balizas: rojo y azul alternados.
    const phase = Math.floor(time * 3) % 2;
    red.opacity = phase ? 1 : 0.15; blue.opacity = phase ? 0.15 : 1;
    (beaconGlow.material as THREE.PointsMaterial).color.setHex(phase ? 0xff2a2a : 0x2a6bff);
    // Llamas que parpadean.
    for (const sprite of flames) {
      const ph = sprite.userData.phase as number;
      const s = 1.2 + Math.sin(time * 9 + ph) * 0.18 + Math.sin(time * 23 + ph * 2) * 0.1;
      sprite.scale.set(1.3 * s, 2.3 * s, 1);
      sprite.position.copy(sprite.userData.base as THREE.Vector3).add(new THREE.Vector3(0, 0.6 + Math.sin(time * 7 + ph) * 0.08, 0));
    }
    // Humo: sube, se abre y vuelve a empezar.
    for (let f = 0; f < fires.length; f++) for (let k = 0; k < SMOKE_PER_FIRE; k++) {
      const i = f * SMOKE_PER_FIRE + k;
      smokeAge[i] = (smokeAge[i] + 0.0035) % 1;
      const a = smokeAge[i];
      smokePositions[i * 3] = fires[f].x + Math.sin(i * 1.7 + time * 0.3) * a * 3 + a * 4;
      smokePositions[i * 3 + 1] = fires[f].y + 1 + a * 22;
      smokePositions[i * 3 + 2] = fires[f].z + Math.cos(i * 2.3 + time * 0.25) * a * 3;
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    // Luces de fuego en los incendios más cercanos (se recalcula 1 vez por segundo).
    if (Math.floor(time) !== lastLights) {
      lastLights = Math.floor(time);
      const nearest = fires.map(f => ({ f, d: f.distanceTo(camera) })).sort((a, b) => a.d - b.d).slice(0, fireLights.length);
      fireLights.forEach((light, i) => { if (nearest[i]) light.position.copy(nearest[i].f).setY(2); light.userData.on = !!nearest[i]; });
    }
    fireLights.forEach((light, i) => { light.intensity = light.userData.on ? 22 + Math.sin(time * 13 + i) * 6 + Math.sin(time * 31 + i) * 3 : 0; });
    // Ceniza: cae lento y sigue a la cámara.
    for (let i = 0; i < ASH; i++) {
      let y = ashPositions[i * 3 + 1] - 0.012;
      if (y < 0) y += 25;
      ashPositions[i * 3 + 1] = y;
      ashPositions[i * 3] += Math.sin(time + i) * 0.004;
    }
    ash.position.set(camera.x, 0, camera.z);
    ashGeometry.attributes.position.needsUpdate = true;
  };

  return { group, update, dispose: () => disposables.forEach(d => d.dispose()) };
}
