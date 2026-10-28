// Brazos en primera persona: manga de chaqueta con textura, puño, mano con palma, dedos
// articulados y pulgar. La derecha sujeta la linterna; la izquierda cierra el puño al correr.
// Al correr se balancean alternados (como al esprintar); quieto, respiran suave.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { infectedCloth } from './textures';

export interface Arms { root: THREE.Group; flashlightTip: THREE.Object3D; update: (time: number, running: number, dt: number) => void }

function skinTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b07f63'; ctx.fillRect(0, 0, 128, 128);
  const img = ctx.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 16; img.data[i] += n; img.data[i + 1] += n * 0.8; img.data[i + 2] += n * 0.7; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 25; i++) { ctx.fillStyle = `rgba(60,35,25,${Math.random() * 0.25})`; ctx.beginPath(); ctx.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 4, 0, 7); ctx.fill(); } // suciedad
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Mano derecha o izquierda. curl: 0 abierta … 1 puño cerrado. */
function hand(skin: THREE.Material, side: number) {
  const group = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.035, 4, 10).rotateX(Math.PI / 2).scale(1.35, 0.55, 1), skin);
  group.add(palm);
  const fingers: Array<[THREE.Group, THREE.Group]> = [];
  for (let k = 0; k < 4; k++) {
    const base = new THREE.Group();
    base.position.set((k - 1.5) * 0.019, 0, -0.045);
    base.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.026, 3, 6).rotateX(Math.PI / 2).translate(0, 0, -0.017), skin));
    const tip = new THREE.Group(); tip.position.z = -0.036;
    tip.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0078, 0.02, 3, 6).rotateX(Math.PI / 2).translate(0, 0, -0.014), skin));
    base.add(tip); group.add(base); fingers.push([base, tip]);
  }
  const thumb = new THREE.Group();
  thumb.position.set(side * 0.04, -0.004, -0.008);
  thumb.rotation.set(0.2, side * 0.6, side * 0.4);
  thumb.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.03, 3, 6).rotateX(Math.PI / 2).translate(0, 0, -0.02), skin));
  group.add(thumb);
  const setCurl = (curl: number) => fingers.forEach(([base, tip], k) => { base.rotation.x = -curl * (1.2 + k * 0.05); tip.rotation.x = -curl * 1.4; });
  return { group, setCurl, thumb };
}

export function createArms(): Arms {
  const root = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ map: infectedCloth(1), color: 0x7d8a76, roughness: 0.95 });
  const cuff = new THREE.MeshStandardMaterial({ color: 0x1b2119, roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ map: skinTexture(), roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const dial = new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.3, metalness: 0.8 });
  // Mangas con pliegues: varias secciones un poco desalineadas.
  const sleeveGeometry = mergeGeometries([0, 1, 2, 3].map(i =>
    new THREE.CylinderGeometry(0.058 - i * 0.003, 0.062 - i * 0.003, 0.11, 12).rotateX(Math.PI / 2).translate(Math.sin(i * 2) * 0.003, Math.cos(i) * 0.003, -0.06 - i * 0.1)));

  const make = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, -0.5, 0.0);
    const sleeve = new THREE.Mesh(sleeveGeometry, jacket);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.054, 0.04, 12).rotateX(Math.PI / 2).translate(0, 0, -0.43), cuff);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.06, 10).rotateX(Math.PI / 2).translate(0, 0, -0.47), skin);
    const h = hand(skin, side);
    h.group.position.set(0, 0, -0.53);
    shoulder.add(sleeve, band, wrist, h.group);
    if (side < 0) { // reloj en la muñeca izquierda
      const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.006, 6, 16).rotateY(Math.PI / 2).translate(0, 0, -0.465), strap);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16).translate(0, 0.033, -0.465), dial);
      shoulder.add(band2, face);
    }
    root.add(shoulder);
    return { shoulder, hand: h };
  };
  const left = make(-1), right = make(1);
  right.hand.setCurl(0.85); // sujeta la linterna

  // Linterna táctica en la mano derecha, apuntando al frente (compensa la inclinación del brazo).
  const grip = new THREE.Group();
  grip.position.set(0, 0.01, -0.53);
  grip.rotation.x = -0.5;
  grip.scale.setScalar(1.35);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 14).rotateX(Math.PI / 2).translate(0, 0, -0.02), metal);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.019, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, -0.12), metal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 6, 16).translate(0, 0, -0.146), rubber);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16).rotateY(Math.PI).translate(0, 0, -0.147), lens);
  const knurl = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.05, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.03), rubber);
  const flashlightTip = new THREE.Object3D();
  flashlightTip.position.set(0, 0, -0.15);
  grip.add(body, head, ring, glass, knurl, flashlightTip);
  right.shoulder.add(grip);

  // Las manos se ven siempre (un poco de luz propia) sin agregar otra luz a la escena.
  for (const mat of [jacket, cuff, skin]) mat.emissive = new THREE.Color(0x2a2420).multiplyScalar(mat === skin ? 0.9 : 0.5);
  root.traverse(o => { o.renderOrder = 10; });

  let phase = 0;
  const update = (time: number, running: number, dt: number) => {
    phase += dt * (6 + running * 5.5); // cadencia de zancada
    const s = Math.sin(phase);
    const run = running;
    const L = left.shoulder, R = right.shoulder;
    // Brazos alternados: solo se ven antebrazos y manos en las esquinas inferiores.
    L.rotation.x = 0.55 + s * 0.22 * run;
    L.position.y = -0.5 + s * 0.05 * run + Math.sin(time * 1.6) * 0.004 - (1 - run) * 0.12; // quieto: baja y casi no se ve
    L.position.z = -s * 0.05 * run;
    R.rotation.x = 0.5 - s * 0.14 * run;  // la mano de la linterna se mueve menos
    R.position.y = -0.49 - s * 0.035 * run + Math.sin(time * 1.6 + 1) * 0.004;
    R.position.z = s * 0.035 * run;
    L.rotation.z = 0.12 + 0.1 * run;
    R.rotation.z = -0.1 - 0.06 * run;
    L.rotation.y = 0.12; R.rotation.y = -0.1;
    L.visible = run > 0.2; // quieto: solo se ve la mano con la linterna
    left.hand.setCurl(0.35 + run * 0.6); // al correr cierra el puño
    left.hand.group.rotation.z = 0.4;
  };
  return { root, flashlightTip, update };
}
