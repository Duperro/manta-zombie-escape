// Modelos 3D animados (glTF) para infectados y sobrevivientes.
//
// - public/models/zombie.glb: "Zombie" de ImageParSeconde, CC BY 4.0
//   (https://sketchfab.com/3d-models/zombie-8d5b2c61b7c34179b8d2388635a75de4), con esqueleto y
//   animaciones IDLE, WALK, RUN, ATK y DEAD.
// - public/models/survivor.glb: "Cesium Man" de Cesium (Khronos glTF Sample Assets), CC BY 4.0,
//   sin la textura original (tenía logotipos); la ropa se pinta por altura del cuerpo.
// Créditos completos en frontend/public/models/CREDITOS.md.
//
// Si los archivos no cargan, la vista usa las figuras procedurales de infected.ts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface Templates { zombie: THREE.Group; zombieClips: THREE.AnimationClip[]; survivor: THREE.Group; survivorClips: THREE.AnimationClip[] }
export type Pose = 'idle' | 'walk' | 'run' | 'attack';
export interface Actor { root: THREE.Group; mixer: THREE.AnimationMixer; pose: Pose | null; setPose: (pose: Pose, speed?: number) => void }

let cache: Promise<Templates | null> | null = null;

/** Normaliza el modelo: pies en y=0, mirando hacia +z y con la altura indicada (en metros). */
function normalize(scene: THREE.Object3D, height: number) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(size.y, 1e-6);
  const wrapper = new THREE.Group();
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(scene, true);
  scene.position.y -= scaled.min.y;
  scene.position.x -= (scaled.min.x + scaled.max.x) / 2;
  scene.position.z -= (scaled.min.z + scaled.max.z) / 2;
  wrapper.add(scene);
  return wrapper;
}

export function loadModels(): Promise<Templates | null> {
  cache ??= (async () => {
    try {
      const loader = new GLTFLoader();
      const [zombie, survivor] = await Promise.all([loader.loadAsync('/models/zombie.glb'), loader.loadAsync('/models/survivor.glb')]);
      return {
        zombie: normalize(zombie.scene, 1.78), zombieClips: zombie.animations,
        survivor: normalize(survivor.scene, 1.74), survivorClips: survivor.animations,
      };
    } catch {
      return null; // sin modelos: figuras procedurales
    }
  })();
  return cache;
}

// Ropa del sobreviviente según la altura del cuerpo: zapatos, pantalón, chaqueta, piel y pelo.
const OUTFITS = [[0x23262a, 0x3a4250, 0x5b3a2a], [0x1c1c1c, 0x4a4535, 0x2e4a3a], [0x2b2118, 0x2f3b55, 0x7a2e2e], [0x202020, 0x55524a, 0x3b3f46]];
function survivorMaterial(seed: number) {
  const [shoes, pants, jacket] = OUTFITS[Math.floor(seed * OUTFITS.length)].map(c => new THREE.Color(c));
  const skin = new THREE.Color().setHSL(0.07, 0.35, 0.28 + seed * 0.25);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  material.onBeforeCompile = shader => {
    shader.uniforms.cShoes = { value: shoes }; shader.uniforms.cPants = { value: pants };
    shader.uniforms.cJacket = { value: jacket }; shader.uniforms.cSkin = { value: skin };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.z;'); // Cesium Man es Z-arriba
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nuniform vec3 cShoes, cPants, cJacket, cSkin;')
      .replace('#include <map_fragment>', `
        vec3 cloth = vH < 0.08 ? cShoes : vH < 0.72 ? cPants : vH < 1.22 ? cJacket : vH < 1.43 ? cSkin : vec3(0.05);
        diffuseColor.rgb = cloth;`);
  };
  return material;
}

export function spawnActor(templates: Templates, kind: 'zombie' | 'survivor', seed: number, tint?: number): Actor {
  const template = kind === 'zombie' ? templates.zombie : templates.survivor;
  const clips = kind === 'zombie' ? templates.zombieClips : templates.survivorClips;
  const root = cloneSkinned(template) as THREE.Group;
  root.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // los huesos mueven la malla fuera de su caja original
    if (kind === 'survivor') mesh.material = survivorMaterial(seed);
    else if (tint !== undefined) { const m = (mesh.material as THREE.MeshStandardMaterial).clone(); m.color.multiply(new THREE.Color(tint)); mesh.material = m; }
  });
  root.scale.setScalar(0.94 + seed * 0.12);
  const mixer = new THREE.AnimationMixer(root);
  const find = (name: string) => clips.find(c => c.name.toUpperCase() === name) ?? clips[0];
  const clipFor: Record<Pose, THREE.AnimationClip | undefined> = kind === 'zombie'
    ? { idle: find('IDLE'), walk: find('WALK'), run: find('RUN'), attack: find('ATK') }
    : { idle: clips[0], walk: clips[0], run: clips[0], attack: clips[0] };
  let current: THREE.AnimationAction | null = null;
  const actor: Actor = {
    root, mixer, pose: null,
    setPose(pose, speed = 1) {
      const clip = clipFor[pose];
      if (!clip) return;
      const action = mixer.clipAction(clip);
      // Sobreviviente: un solo ciclo de caminar; quieto = pausa, corriendo = más rápido.
      action.timeScale = kind === 'survivor' ? (pose === 'idle' ? 0 : pose === 'run' ? 2.2 * speed : speed) : speed;
      if (actor.pose === pose) return;
      actor.pose = pose;
      if (current && current !== action) { action.reset().play(); current.crossFadeTo(action, 0.25, false); }
      else action.play();
      action.time = seed * clip.duration; // cada uno desfasado: no marchan sincronizados
      current = action;
    },
  };
  actor.setPose('idle');
  return actor;
}
