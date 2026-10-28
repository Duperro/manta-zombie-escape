// Motor de la vista en primera persona: cámara a la altura de los ojos del sobreviviente,
// que se mueve por las mismas calles y al mismo ritmo (2 s por turno) que en el mapa.
import * as THREE from 'three';
import { movementPath, type TraversedEdge } from '../services/movement';
import type { Point, VisualState } from '../types/visual';
import { alongPath, animateInfected, approximateCoast, buildCity, createInfected, hash01, makeProjector, type City, type Infected, type Project, type RealCity } from './city';

export interface Hud {
  id: string; state: string; shelter: string | null; shelterDistance: number | null;
  nearest: { type: string; distance: number } | null; turn: number; totalTurns: number;
}

interface Motion { path: THREE.Vector3[]; start: number; duration: number }
interface ZombieView { figures: Infected[]; root: THREE.Group; node: string; motion: Motion | null; type: string; position: THREE.Vector3; heading: number }

const EYE_HEIGHT = 1.65;
const MOON_OFFSET = new THREE.Vector3(-260, 210, -340); // luna hacia el noroeste, sobre el mar

export class FirstPersonEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.1, 500);
  private project: Project;
  private city: City | null = null;
  private cityCenter = new THREE.Vector3();
  private cityBlocked = '';
  private zombies = new Map<string, ZombieView>();
  private shelters = new THREE.Group();
  private routeLine: THREE.Line | null = null;
  private routeKey = '';
  private shelterKey = '';
  private survivorNode = '';
  private survivorTurn = -1;
  private motion: Motion | null = null;
  private yaw = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lastDrag = 0;
  private dragging = false;
  private frame = 0;
  private lastHud = 0;
  private stateRef: VisualState;
  private resize: ResizeObserver;
  private clock = new THREE.Clock();
  private fall = 0;

  private coastZ: (x: number) => number;
  private moon: THREE.Mesh | null = null;

  constructor(private container: HTMLElement, private survivorId: string, state: VisualState, private onHud: (hud: Hud) => void, private real: RealCity | null = null) {
    this.stateRef = state;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    const survivor = state.survivors.find(s => s.id === survivorId);
    const origin: Point = survivor?.position ?? state.map.bounds[0] ?? [-0.95, -80.72];
    this.project = makeProjector(origin);
    this.coastZ = real?.coast?.length ? coastFromReal(real.coast, this.project) : approximateCoast(state.map, this.project);

    // Noche del 31 de octubre: niebla, luna tenue y la linterna del sobreviviente.
    this.scene.background = new THREE.Color(0x05080d);
    this.scene.fog = new THREE.FogExp2(0x0a0f16, 0.014);
    this.scene.add(new THREE.HemisphereLight(0x4a6488, 0x151515, 1.05));
    const moon = new THREE.DirectionalLight(0x9fb4d8, 0.6);
    moon.position.set(-60, 120, 40);
    this.scene.add(moon);
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
    this.moon = moonDisc;
    this.scene.add(moonDisc); // se mueve con la cámara (solo traslación) para quedar siempre en el cielo
    const flashlight = new THREE.SpotLight(0xfff1d6, 160, 70, 0.36, 0.75, 2);
    flashlight.position.set(0.25, -0.2, 0);
    flashlight.target.position.set(0, -1.1, -14);
    this.camera.add(flashlight, flashlight.target);
    this.scene.add(this.camera, this.shelters);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    this.bindLook();
    this.update(state);
    this.loop();
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Arrastrar con el mouse (o el dedo) para mirar alrededor; vuelve solo al frente. */
  private bindLook() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let last: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', e => { this.dragging = true; last = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (!this.dragging || !last) return;
      this.lookYaw -= (e.clientX - last.x) * 0.005;
      this.lookPitch = Math.max(-0.8, Math.min(0.6, this.lookPitch - (e.clientY - last.y) * 0.004));
      last = { x: e.clientX, y: e.clientY };
      this.lastDrag = performance.now();
    });
    const stop = () => { this.dragging = false; last = null; this.lastDrag = performance.now(); };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  private nodePoint(node: string): THREE.Vector3 | null {
    const p = this.stateRef.map.nodes.get(node);
    return p ? this.project(p) : null;
  }

  private pathBetween(from: string, to: string, kind: 'person' | 'zombie' | 'runner' | 'truck', traversed: TraversedEdge[] = []): THREE.Vector3[] {
    if (from === to) return [];
    const points = movementPath(from, to, kind, this.stateRef.map, this.stateRef.blockedEdges, traversed);
    if (points.length >= 2) return points.map(this.project);
    const a = this.nodePoint(from), b = this.nodePoint(to);
    return a && b ? [a, b] : [];
  }

  private motionFor(path: THREE.Vector3[]): Motion | null {
    return path.length >= 2 ? { path, start: performance.now(), duration: Math.min(1800, Math.max(150, (this.stateRef.turnSeconds ?? 2) * 900)) } : null;
  }

  update(state: VisualState) {
    this.stateRef = state;
    const survivor = state.survivors.find(s => s.id === this.survivorId);
    if (!survivor) return;

    // Sobreviviente: animar de su nodo anterior al actual durante el turno.
    if (survivor.node !== this.survivorNode || state.turn !== this.survivorTurn) {
      const consecutive = this.survivorTurn + 1 === state.turn;
      if (this.survivorNode && survivor.node !== this.survivorNode && consecutive) {
        const truck = survivor.truck ? state.trucks.find(t => t.id === survivor.truck) : undefined;
        const path = truck && survivor.state === 'EN_CAMIONETA'
          ? this.pathBetween(this.survivorNode, survivor.node, 'truck', truck.traversed)
          : this.pathBetween(this.survivorNode, survivor.node, 'person');
        this.motion = this.motionFor(path);
      } else if (survivor.node !== this.survivorNode) {
        this.motion = null;
      }
      this.survivorNode = survivor.node;
      this.survivorTurn = state.turn;
    }
    const here = this.nodePoint(survivor.node) ?? new THREE.Vector3();

    // Ciudad: se reconstruye si cambian los bloqueos (la calle desaparece) o si nos alejamos.
    const blockedKey = [...state.blockedEdges].sort().join('|');
    if (!this.city || blockedKey !== this.cityBlocked || here.distanceTo(this.cityCenter) > 550) {
      this.city?.dispose();
      if (this.city) this.scene.remove(this.city.group);
      this.cityCenter = here.clone();
      this.cityBlocked = blockedKey;
      this.city = buildCity(state.map, this.project, state.blockedEdges, this.cityCenter, 900, this.coastZ, this.real);
      this.scene.add(this.city.group);
    }

    // Refugios: columna de luz verde visible a lo lejos.
    const shelterKey = state.shelters.map(r => `${r.id}:${r.available > 0}`).join('|');
    if (shelterKey !== this.shelterKey) {
      this.shelterKey = shelterKey;
      this.shelters.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } });
      this.shelters.clear();
      for (const shelter of state.shelters) {
        if (!shelter.position) continue;
        const p = this.project(shelter.position);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: shelter.available > 0 ? 0x8dff9c : 0xffc46b, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        beam.position.set(p.x, 30, p.z);
        const light = new THREE.PointLight(0x8dff9c, 30, 45, 1.5);
        light.position.set(p.x, 4, p.z);
        this.shelters.add(beam, light);
      }
    }

    // Ruta planificada: línea punteada sobre el asfalto.
    const routeKey = survivor.route.join('>');
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      if (this.routeLine) { this.scene.remove(this.routeLine); this.routeLine.geometry.dispose(); }
      const points = survivor.route.map(n => this.nodePoint(n)).filter((p): p is THREE.Vector3 => !!p).map(p => p.setY(0.08));
      if (points.length >= 2) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        this.routeLine = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x6fdcff, dashSize: 2, gapSize: 1.5, fog: true }));
        this.routeLine.computeLineDistances();
        this.scene.add(this.routeLine);
      } else this.routeLine = null;
    }

    // Zombies visibles (los dormidos no se publican: aparecen cuando despiertan).
    const alive = new Set<string>();
    for (const z of state.zombies) {
      alive.add(z.id);
      let view = this.zombies.get(z.id);
      if (!view) {
        const root = new THREE.Group();
        const count = z.type === 'horda' ? 6 : 1;
        const figures = Array.from({ length: count }, (_, i) => {
          const figure = createInfected(z.type, hash01(`${z.id}:${i}`));
          if (count > 1) figure.root.position.set(Math.cos(i) * 2.6 * (0.5 + hash01(`${z.id}r${i}`)), 0, Math.sin(i * 1.7) * 2.6);
          root.add(figure.root);
          return figure;
        });
        if (z.type === 'horda') {
          const ring = new THREE.Mesh(new THREE.RingGeometry(7, 7.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.35 }));
          ring.position.y = 0.05;
          root.add(ring);
        }
        const start = this.nodePoint(z.node) ?? new THREE.Vector3();
        view = { figures, root, node: z.node, motion: null, type: z.type, position: start, heading: hash01(z.id) * Math.PI * 2 };
        root.position.copy(start);
        this.scene.add(root);
        this.zombies.set(z.id, view);
      } else if (view.node !== z.node) {
        view.motion = this.motionFor(this.pathBetween(view.node, z.node, z.type === 'corredor' ? 'runner' : 'zombie', z.traversed));
        if (!view.motion) view.position = this.nodePoint(z.node) ?? view.position;
        view.node = z.node;
      }
    }
    for (const [id, view] of this.zombies) {
      if (!alive.has(id)) { this.scene.remove(view.root); this.zombies.delete(id); }
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const now = performance.now();
    const state = this.stateRef;
    const survivor = state.survivors.find(s => s.id === this.survivorId);

    // Posición del sobreviviente sobre la calle.
    let position = this.nodePoint(this.survivorNode) ?? new THREE.Vector3();
    let direction: THREE.Vector3 | null = null;
    if (this.motion) {
      const progress = (now - this.motion.start) / this.motion.duration;
      const step = alongPath(this.motion.path, progress);
      position = step.position;
      direction = progress < 1 ? step.direction : null;
      if (progress >= 1.2) this.motion = null;
    }

    // Zombies: avanzar por su camino y animar el cuerpo.
    let nearest: { type: string; distance: number; at: THREE.Vector3 } | null = null;
    for (const view of this.zombies.values()) {
      let moving = false;
      if (view.motion) {
        const progress = (now - view.motion.start) / view.motion.duration;
        const step = alongPath(view.motion.path, progress);
        view.position = step.position;
        if (step.direction && progress < 1) { view.heading = Math.atan2(step.direction.x, step.direction.z); moving = true; }
        if (progress >= 1) view.motion = null;
      }
      const distance = view.position.distanceTo(position);
      if (distance < 18) view.heading = Math.atan2(position.x - view.position.x, position.z - view.position.z); // te ve y gira hacia ti
      view.root.position.copy(view.position);
      view.root.rotation.y = view.heading;
      if (distance < 140) for (const figure of view.figures) animateInfected(figure, t, moving);
      if (!nearest || distance < nearest.distance) nearest = { type: view.type, distance, at: view.position };
    }

    // Hacia dónde mira: hacia donde corre; si está quieto, vigila al zombie más cercano.
    let target = this.yaw;
    if (direction) target = Math.atan2(-direction.x, -direction.z);
    else if (nearest && nearest.distance < 35) target = Math.atan2(-(nearest.at.x - position.x), -(nearest.at.z - position.z));
    const delta = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += delta * Math.min(1, dt * (direction ? 4 : 2));
    if (!this.dragging && now - this.lastDrag > 1500) { this.lookYaw *= 1 - Math.min(1, dt * 2); this.lookPitch *= 1 - Math.min(1, dt * 2); }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const bob = reduced ? 0 : direction ? Math.sin(t * 10) * 0.05 : Math.sin(t * 1.6) * 0.012;
    const dead = survivor?.state === 'ELIMINADO';
    this.fall = dead ? Math.min(1, this.fall + dt * 0.8) : 0;
    this.camera.position.set(position.x, EYE_HEIGHT + bob - this.fall * 1.25, position.z);
    this.camera.rotation.set(this.lookPitch + (direction ? -0.04 : 0) - this.fall * 0.5, this.yaw + this.lookYaw, this.fall * 0.9 + (direction && !reduced ? Math.sin(t * 5) * 0.012 : 0), 'YXZ');

    if (now - this.lastHud > 200 && survivor) {
      this.lastHud = now;
      const shelter = state.shelters.find(r => r.id === survivor.shelter);
      const shelterPoint = shelter?.position ? this.project(shelter.position) : null;
      this.onHud({
        id: survivor.id, state: survivor.state, shelter: shelter?.name ?? survivor.shelter,
        shelterDistance: shelterPoint ? Math.round(shelterPoint.distanceTo(position)) : null,
        nearest: nearest ? { type: nearest.type, distance: Math.round(nearest.distance) } : null,
        turn: state.turn, totalTurns: state.totalTurns ?? 150,
      });
    }
    if (this.moon) { this.moon.position.copy(this.camera.position).add(MOON_OFFSET); this.moon.lookAt(this.camera.position); }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.city?.dispose();
    this.routeLine?.geometry.dispose();
    this.shelters.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}


/** Costa real de OSM: para cada franja de 50 m en x, la z más al sur de la línea de costa. */
function coastFromReal(lines: Point[][], project: Project): (x: number) => number {
  const bins = new Map<number, number>();
  for (const line of lines) {
    const pts = line.map(project);
    for (let i = 0; i < pts.length - 1; i++) {
      const steps = Math.max(1, Math.ceil(pts[i].distanceTo(pts[i + 1]) / 25)); // densificar cada 25 m
      for (let k = 0; k <= steps; k++) {
        const v = pts[i].clone().lerp(pts[i + 1], k / steps); const b = Math.round(v.x / 50);
        bins.set(b, Math.max(bins.get(b) ?? -Infinity, v.z));
      }
    }
  }
  return x => bins.get(Math.round(x / 50)) ?? -Infinity;
}
