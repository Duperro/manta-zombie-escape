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
import type { HandTemplates } from './arms';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Templates { zombie: THREE.Group; zombieClips: THREE.AnimationClip[]; survivor: THREE.Group; survivorClips: THREE.AnimationClip[]; hands: HandTemplates | null }
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

// ---------------------------------------------------------------------------------------------
// Ajustes del infectado (diseño original "infectado rabioso"): el modelo base trae un brazo
// mutado gigante y el otro encogido (escalas animadas), un ojo colgando y un acabado de
// caricatura. Aquí se corrige a proporciones humanas, se encorva la postura al correr y se
// cambia el material por piel enferma con venas, mugre y sangre.
// ---------------------------------------------------------------------------------------------
const ARM_SCALE = 0.8;   // brazo humano: hombro→muñeca ≈ 31 % de la estatura
const HAND_SCALE = 0.86; // mano ≈ 10–11 % de la estatura
const ARM_THICK = 1.35, LEG_THICK = 1.2, CHEST = 1.22; // corpulencia del mutado
export const ZOMBIE_HEIGHT = 2.15; // más alto y corpulento que un humano (1,74 m)
const HEAD_Y = 1.5; // altura del cuello en la malla en reposo (unidades del modelo)

/** Rota cada keyframe de un hueso (en espacio local) para cambiar la postura de un clip. */
function bendTrack(clip: THREE.AnimationClip, bone: string, extra: THREE.Quaternion) {
  const track = clip.tracks.find(t => t.name === `${bone}.quaternion`);
  if (!track) return;
  const q = new THREE.Quaternion();
  for (let i = 0; i < track.values.length; i += 4) q.fromArray(track.values, i).multiply(extra).toArray(track.values, i);
}

function prepareZombie(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const fixed = (name: string) => /^(Shoulder_[LR]|Hand_[LR])_/.test(name);
  for (const clip of clips) {
    // Sin escalas animadas en los brazos: proporciones fijas y simétricas.
    clip.tracks = clip.tracks.filter(t => !(t.name.endsWith('.scale') && fixed(t.name.split('.')[0])));
    // El trote original va muy doblado; se endereza un poco el tronco (más humano).
    if (clip.name === 'RUN') bendTrack(clip, 'Spine_02_04', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.22));
  }
  scene.updateMatrixWorld(true);
  const head = scene.getObjectByName('Head_07'), socket = scene.getObjectByName('Eyes_00');
  let body: THREE.SkinnedMesh | null = null;
  scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.geometry.attributes.position.count > 1000) body = m; });
  if (head && socket && body) {
    // La cabeza original tiene un costado abierto (herida enorme). Se rellena con un "cráneo"
    // de piel: un elipsoide un poco más chico que la cabeza, unido al hueso de la cabeza.
    const mesh = body as THREE.SkinnedMesh;
    const headIndex = mesh.skeleton.bones.findIndex(b => b.name === head.name);
    mesh.skeleton.update();
    const position = mesh.geometry.attributes.position, index = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
      if (index.getComponent(i, best) === headIndex) box.expandByPoint(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)); // ya con esqueleto
    }
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0x6f6553, roughness: 0.75 }));
    skull.scale.set(size.x * 0.72, size.y * 0.66, size.z * 0.8);
    const mid = head.getWorldPosition(new THREE.Vector3()).x;
    skull.position.set(mid, center.y - size.y * 0.04, center.z - size.z * 0.05);
    head.attach(skull);
    // Ojos lechosos, sin pupila, en las cuencas.
    const at = socket.getWorldPosition(new THREE.Vector3());
    const eye = new THREE.SphereGeometry(size.x * 0.042, 12, 8);
    const white = new THREE.MeshStandardMaterial({ color: 0xa8a28c, roughness: 0.15 });
    for (const side of [1, -1]) {
      const ball = new THREE.Mesh(eye, white);
      ball.position.set(mid + (at.x - mid) * side, at.y - size.y * 0.01, at.z - size.z * 0.045);
      head.attach(ball);
    }
    mutate(scene, size.x);
  }
  scene.traverse(o => {
    if ((o as THREE.Bone).isBone) {
      // Brazos de largo humano pero gruesos (el eje X del hueso va a lo largo del brazo).
      if (fixed(o.name)) o.name.startsWith('Hand') ? o.scale.setScalar(HAND_SCALE) : o.scale.set(ARM_SCALE, ARM_SCALE * ARM_THICK, ARM_SCALE * ARM_THICK);
      else if (/^UpperLeg_/.test(o.name)) o.scale.set(LEG_THICK, 1, LEG_THICK);
      return;
    }
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    // Ojo colgante de caricatura: malla aparte y pequeña ("oeil"); se oculta.
    if (/oeil/i.test(mesh.name) || mesh.geometry.attributes.position.count < 400) { mesh.visible = false; return; }
    mesh.geometry = toCreasedNormals(mesh.geometry, Math.PI / 2.6); // suaviza el facetado
    mesh.material = infectedMaterial((mesh.material as THREE.MeshStandardMaterial).map);
  });
}

/**
 * Rasgos del mutado (diseño propio): torso y hombros más corpulentos, crestas de hueso
 * calcificado que rompen la piel de la espalda y los codos, y garras oscuras en los dedos.
 * Cada pieza se pega a su hueso, así acompaña la animación.
 */
function mutate(scene: THREE.Object3D, unit: number) {
  const bone = (name: string) => scene.getObjectByName(name);
  const world = (name: string) => bone(name)!.getWorldPosition(new THREE.Vector3());
  // Más corpulento: el pecho (y con él brazos y cuello) crece; la cabeza conserva su tamaño.
  const chest = bone('Spine_03_05'), headBone = bone('Head_07');
  if (chest && headBone) { chest.scale.setScalar(CHEST); headBone.scale.setScalar(1 / CHEST); }
  scene.updateMatrixWorld(true);
  const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xb3a68a, roughness: 0.55 });
  const clawMaterial = new THREE.MeshStandardMaterial({ color: 0x1d1714, roughness: 0.3 });
  const spike = (length: number, radius: number) => new THREE.ConeGeometry(radius, length, 7).translate(0, length / 2, 0);
  const place = (parent: string, at: THREE.Vector3, direction: THREE.Vector3, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const target = bone(parent);
    if (!target) return;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(at);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    target.attach(mesh);
  };
  const back = unit * -0.42; // superficie de la espalda (z) en el modelo en reposo
  // Crestas de la espalda: dos filas a lo largo de la columna, inclinadas hacia arriba y atrás.
  [['Spine_02_04', 0.0], ['Spine_02_04', 0.3], ['Spine_03_05', 0.0], ['Spine_03_05', 0.35], ['Neck_06', -0.1]].forEach(([name, lift], i) => {
    const p = world(name as string);
    for (const side of [-1, 1]) {
      const length = unit * (0.32 - i * 0.03) * (0.85 + ((i + side) % 3) * 0.1);
      place(name as string, new THREE.Vector3(side * unit * 0.13, p.y + (lift as number) * unit, back), new THREE.Vector3(side * 0.25, 0.55, -1), spike(length, unit * 0.06), boneMaterial);
    }
  });
  // Espolones en los codos, apuntando hacia atrás.
  for (const [elbow, side] of [['Elbow_L_017', 1], ['Elbow_R_032', -1]] as const) {
    const p = world(elbow);
    place(elbow, new THREE.Vector3(p.x, p.y, p.z - unit * 0.12), new THREE.Vector3(side * 0.2, 0.15, -1), spike(unit * 0.28, unit * 0.05), boneMaterial);
  }
  // Garras: prolongan la última falange de cada dedo.
  scene.traverse(o => {
    if (!(o as THREE.Bone).isBone || !/(Finger|Thumb)_0[3-8]_/.test(o.name) || o.children.some(c => (c as THREE.Bone).isBone)) return;
    const tip = o.getWorldPosition(new THREE.Vector3());
    const base = o.parent!.getWorldPosition(new THREE.Vector3());
    place(o.name, tip, tip.clone().sub(base), spike(unit * 0.2, unit * 0.022), clawMaterial);
  });
}

/**
 * Piel enferma y ropa sucia sobre la textura original: la piel gris-azulada pasa a un tono
 * cadavérico con manchas, moretones y venas; la herida enorme de la cabeza se cierra (queda piel
 * con cortes); la ropa se desatura y ensucia y hay sangre oscura y brillante.
 * El ruido usa la posición del modelo en reposo, así cada parte del cuerpo varía.
 */
function infectedMaterial(map: THREE.Texture | null) {
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj;
        float zWet = 0.0;
        float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          float skin = step(c.r, c.b + 0.01) * step(sat, 0.2) * step(0.025, lum);
          float gore = smoothstep(0.05, 0.2, c.r - max(c.g, c.b));
          float pale = step(0.25, lum) * step(sat, 0.15) * (1.0 - skin); // bordes claros de heridas
          float head = smoothstep(${HEAD_Y - 0.06}, ${HEAD_Y + 0.02}, vObj.y);
          vec3 p = vObj * 3.0;
          float mottling = fbm(p * 2.5);
          float veins = smoothstep(0.03, 0.0, abs(fbm(p * 4.0 + 7.0) - 0.5)) * smoothstep(0.35, 0.7, fbm(p * 1.3 + 3.0));
          vec3 flesh = mix(vec3(0.25, 0.21, 0.155), vec3(0.17, 0.165, 0.13), mottling);
          flesh = mix(flesh, vec3(0.17, 0.08, 0.09), smoothstep(0.6, 0.8, fbm(p * 1.7 + 11.0)) * 0.7); // moretones
          flesh = mix(flesh, vec3(0.08, 0.06, 0.09), veins * 0.8); // venas
          // Cabeza: la herida gigante y sus bordes pasan a piel; quedan cortes finos y sangre seca.
          float cut = smoothstep(0.015, 0.0, abs(fbm(p * 3.0 + 5.0) - 0.5)) * head * smoothstep(0.55, 0.7, fbm(p * 1.5 + 2.0));
          skin = max(skin, head * max(gore, pale));
          cut *= skin;
          gore *= 1.0 - head;
          vec3 cloth = mix(vec3(lum), c, 0.4) * (0.65 + 0.45 * fbm(p * 6.0));
          vec3 col = mix(cloth, flesh, skin);
          float splat = smoothstep(0.67, 0.75, fbm(p * 2.2 + 21.0)) * smoothstep(0.4, 0.6, fbm(p * 9.0));
          float wet = clamp(max(max(gore, splat), cut), 0.0, 1.0);
          col = mix(col, mix(vec3(0.20, 0.015, 0.015), vec3(0.06, 0.01, 0.01), fbm(p * 8.0)), wet * 0.92);
          diffuseColor.rgb = col * diffuse;
          zWet = wet;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, zWet);');
  };
  return material;
}

export function loadModels(): Promise<Templates | null> {
  cache ??= (async () => {
    try {
      const loader = new GLTFLoader();
      const [zombie, survivor, hands] = await Promise.all([
        loader.loadAsync('/models/zombie.glb'), loader.loadAsync('/models/survivor.glb'),
        // Manos de la vista en primera persona (si fallan, se usan las procedurales).
        Promise.all([loader.loadAsync('/models/hand_left.glb'), loader.loadAsync('/models/hand_right.glb')])
          .then(([left, right]) => ({ left: left.scene, right: right.scene })).catch(() => null),
      ]);
      prepareZombie(zombie.scene, zombie.animations);
      return {
        zombie: normalize(zombie.scene, ZOMBIE_HEIGHT), zombieClips: zombie.animations,
        survivor: normalize(survivor.scene, 1.74), survivorClips: survivor.animations, hands,
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

// Un material por tono de infectado (comparten el shader); el color multiplica el resultado.
const tintCache = new Map<string, THREE.Material>();
function tinted(base: THREE.MeshStandardMaterial, tint: number) {
  const key = `${base.uuid}:${tint}`;
  let material = tintCache.get(key);
  if (!material) {
    const copy = base.clone();
    copy.onBeforeCompile = base.onBeforeCompile;
    copy.color.multiply(new THREE.Color(tint));
    tintCache.set(key, material = copy);
  }
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
    else if (tint !== undefined && tint !== 0xffffff) mesh.material = tinted(mesh.material as THREE.MeshStandardMaterial, tint);
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
