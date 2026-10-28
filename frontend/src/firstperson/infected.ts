// Infectados: diseño propio (no reproduce personajes de videojuegos ni películas).
import * as THREE from 'three';
import { infectedCloth, infectedSkin } from './textures';

// ---------- Infectado (diseño propio, low-poly con articulaciones) ----------
// Cada brazo y pierna tiene dos segmentos (hombro/codo, cadera/rodilla) para que la marcha
// se vea natural: el caminante cojea y arrastra un pie; el corredor esprinta inclinado.
type Joint = { upper: THREE.Group; lower: THREE.Group };
export interface Infected { root: THREE.Group; body: THREE.Group; head: THREE.Object3D; legs: [Joint, Joint]; arms: [Joint, Joint]; type: string; phase: number; limp: number }

let skinMaterial: THREE.MeshStandardMaterial;
let clothMaterials: THREE.MeshStandardMaterial[];
let stripMaterials: THREE.MeshStandardMaterial[];
function materials() {
  // Se crean al primer uso (necesitan document para dibujar las texturas).
  skinMaterial ??= new THREE.MeshStandardMaterial({ map: infectedSkin(), color: 0x7c8276, roughness: 0.92 });
  clothMaterials ??= [0, 1, 2, 3, 4].map(v => new THREE.MeshStandardMaterial({ map: infectedCloth(v), color: 0x8a8a8a, roughness: 1 }));
  stripMaterials ??= clothMaterials.map(m => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });
}
const woundMaterial = new THREE.MeshStandardMaterial({ color: 0x3d0f0c, roughness: 0.6 });
const eyeMaterials: Record<string, THREE.MeshBasicMaterial> = {
  caminante: new THREE.MeshBasicMaterial({ color: 0xd8f070 }),
  corredor: new THREE.MeshBasicMaterial({ color: 0xff5a3c }),
  horda: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
};
const seg = (w: number, h: number) => new THREE.CapsuleGeometry(w, h, 3, 10).translate(0, -h / 2 - w, 0);
// Proporciones de un adulto delgado (~1,75 m): piernas ~0,9 m, torso ~0,55 m, cuello y cabeza ~0,3 m.
const geo = {
  thigh: seg(0.062, 0.34), shin: seg(0.048, 0.36), upperArm: seg(0.042, 0.24), foreArm: seg(0.036, 0.22),
  chest: new THREE.CapsuleGeometry(0.13, 0.2, 4, 12), pelvis: new THREE.CapsuleGeometry(0.11, 0.06, 4, 12),
  neck: new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8), head: new THREE.SphereGeometry(0.105, 16, 12),
  hand: new THREE.BoxGeometry(0.06, 0.1, 0.03), foot: new THREE.BoxGeometry(0.09, 0.06, 0.24),
  jaw: new THREE.BoxGeometry(0.1, 0.035, 0.08), eye: new THREE.SphereGeometry(0.016, 6, 4), wound: new THREE.SphereGeometry(0.05, 6, 4),
  socket: new THREE.SphereGeometry(0.028, 8, 6), rib: new THREE.TorusGeometry(0.12, 0.009, 4, 12, Math.PI * 0.7),
  strip: new THREE.PlaneGeometry(0.06, 0.28).translate(0, -0.14, 0), hair: new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
};
const socketMaterial = new THREE.MeshBasicMaterial({ color: 0x050403 });
const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xc9bfa6, roughness: 0.7 });
const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 1 });

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
  materials();
  const root = new THREE.Group();
  const cloth = clothMaterials[Math.floor(seed * clothMaterials.length)];
  const pants = clothMaterials[Math.floor(((seed * 3.1) % 1) * clothMaterials.length)];
  const legs: [Joint, Joint] = [joint(root, -0.09, 0.93, geo.thigh, geo.shin, 0.46, pants, pants), joint(root, 0.09, 0.93, geo.thigh, geo.shin, 0.46, pants, seed > 0.5 ? skinMaterial : pants)];
  for (const leg of legs) { const foot = new THREE.Mesh(geo.foot, hairMaterial); foot.position.set(0, -0.44, 0.05); leg.lower.add(foot); }
  const body = new THREE.Group(); body.position.y = 0.93; root.add(body);
  const pelvis = new THREE.Mesh(geo.pelvis, pants); pelvis.position.y = 0.04; pelvis.scale.set(1.25, 1, 0.75); body.add(pelvis);
  const chest = new THREE.Mesh(geo.chest, cloth); chest.position.y = 0.33; chest.scale.set(1.3, 1, 0.68); body.add(chest); // hombros anchos, cintura fina
  const neck = new THREE.Mesh(geo.neck, skinMaterial); neck.position.y = 0.58; body.add(neck);
  const wound = new THREE.Mesh(geo.wound, woundMaterial); wound.position.set(0.07, 0.38, 0.085); wound.scale.set(1, 1.5, 0.4); body.add(wound);
  const head = new THREE.Group(); head.position.set(0, 0.73, 0.02); body.add(head);
  const skull = new THREE.Mesh(geo.head, skinMaterial); skull.scale.set(0.88, 1.12, 0.98); head.add(skull);
  const jaw = new THREE.Mesh(geo.jaw, woundMaterial); jaw.position.set(0, -0.085, 0.055); jaw.rotation.x = 0.4; head.add(jaw); // mandíbula caída
  for (const side of [-1, 1]) {
    const sk = new THREE.Mesh(geo.socket, socketMaterial); sk.position.set(side * 0.038, 0.018, 0.08); sk.scale.set(1, 0.8, 0.5); head.add(sk);
    const e = new THREE.Mesh(geo.eye, eyeMaterials[type] ?? eyeMaterials.caminante); e.position.set(side * 0.038, 0.018, 0.088); head.add(e);
  }
  // Cabello ralo, costillas expuestas y jirones de ropa: cada infectado sale distinto según su semilla.
  if (seed > 0.3) { const hair = new THREE.Mesh(geo.hair, hairMaterial); hair.rotation.x = -0.25; hair.rotation.z = (seed - 0.5) * 0.5; head.add(hair); }
  if (seed > 0.55) for (let k = 0; k < 4; k++) { const rib = new THREE.Mesh(geo.rib, boneMaterial); rib.position.set(-0.03, 0.22 + k * 0.05, 0.02); rib.rotation.set(Math.PI / 2, 0, -0.4); body.add(rib); }
  for (let k = 0; k < 4; k++) {
    const strip = new THREE.Mesh(geo.strip, stripMaterials[clothMaterials.indexOf(cloth)]);
    strip.position.set(-0.12 + k * 0.08, 0.16, 0.09 * (k % 2 ? 1 : -1)); strip.rotation.set((k % 2 ? 1 : -1) * 0.15, 0, (seed - 0.5) * 0.6);
    strip.scale.y = 0.5 + ((seed * (k + 3)) % 1) * 0.7; body.add(strip);
  }
  const arms: [Joint, Joint] = [joint(body, -0.2, 0.5, geo.upperArm, geo.foreArm, 0.33, cloth, skinMaterial), joint(body, 0.2, 0.5, geo.upperArm, geo.foreArm, 0.33, seed > 0.4 ? skinMaterial : cloth, skinMaterial)];
  for (const arm of arms) { const hand = new THREE.Mesh(geo.hand, skinMaterial); hand.position.set(0, -0.33, 0); arm.lower.add(hand); }
  root.scale.setScalar(0.95 + seed * 0.12);
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
