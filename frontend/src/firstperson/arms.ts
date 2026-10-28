// Brazos en primera persona: chaqueta, manos y una linterna en la mano derecha.
// Al correr se balancean alternados (como al esprintar); quieto, respiran suave.
import * as THREE from 'three';

export interface Arms { root: THREE.Group; flashlightTip: THREE.Object3D; update: (time: number, running: number, dt: number) => void }

export function createArms(): Arms {
  const root = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x2d3a2e, roughness: 0.9 });
  const cuff = new THREE.MeshStandardMaterial({ color: 0x1d241e, roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6650, roughness: 0.75 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 });
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });

  const make = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, -0.5, 0.0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.38, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -0.22), jacket);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0, -0.45), cuff);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.06, 0.11).translate(0, 0, -0.52), skin);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.05).translate(0, -0.012, -0.585), skin);
    shoulder.add(sleeve, band, hand, fingers);
    root.add(shoulder);
    return shoulder;
  };
  const left = make(-1), right = make(1);
  // Linterna sostenida en la mano derecha, apuntando al frente (compensa la inclinación del brazo).
  const grip = new THREE.Group();
  grip.position.set(0, 0.035, -0.55);
  grip.rotation.x = -0.5;
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.22, 10).rotateX(Math.PI / 2).translate(0, 0, -0.05), metal);
  const torchLens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12).rotateY(Math.PI).translate(0, 0, -0.162), lens);
  const flashlightTip = new THREE.Object3D();
  flashlightTip.position.set(0, 0, -0.17);
  grip.add(torch, torchLens, flashlightTip);
  right.add(grip);

  // Las manos se ven siempre (un poco de luz propia) sin agregar otra luz a la escena.
  for (const mat of [jacket, cuff, skin]) { mat.emissive = mat.color.clone().multiplyScalar(0.35); }
  root.traverse(o => { o.renderOrder = 10; });

  let phase = 0;
  const update = (time: number, running: number, dt: number) => {
    phase += dt * (6 + running * 5.5); // cadencia de zancada
    const s = Math.sin(phase);
    const run = running;
    // Brazos alternados: solo se ven antebrazos y manos en las esquinas inferiores.
    left.rotation.x = 0.55 + s * 0.22 * run;
    left.position.y = -0.5 + s * 0.05 * run + Math.sin(time * 1.6) * 0.004 - (1 - run) * 0.12; // quieto: baja y casi no se ve
    left.position.z = -s * 0.05 * run;
    right.rotation.x = 0.5 - s * 0.14 * run;  // la mano de la linterna se mueve menos
    right.position.y = -0.49 - s * 0.035 * run + Math.sin(time * 1.6 + 1) * 0.004;
    right.position.z = s * 0.035 * run;
    left.rotation.z = 0.12 + 0.1 * run;
    right.rotation.z = -0.1 - 0.06 * run;
    left.rotation.y = 0.12; right.rotation.y = -0.1;
    left.visible = run > 0.2; // quieto: solo se ve la mano con la linterna
  };
  return { root, flashlightTip, update };
}
