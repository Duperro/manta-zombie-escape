// Motor de la vista en primera persona: cámara a la altura de los ojos del sobreviviente,
// que recorre las mismas calles que en el mapa.
//
// Movimiento continuo (sin saltos): cada turno se encadena al anterior desde la posición
// visual actual, y la duración se ajusta al tiempo real entre turnos. Si el sobreviviente
// avanza más de una calle (o se perdió un turno), se reconstruye el camino por el grafo.
//
// Escala de tiempo: el simulador mueve una calle (50–150 m) cada 2 s. A pie eso tomaría
// 20–40 s, así que la vista es una "cámara rápida" y el HUD muestra el factor (×N).
import * as THREE from 'three';
import { movementPath, type TraversedEdge } from '../services/movement';
import type { Point, VisualState } from '../types/visual';
import { approximateCoast, buildCity, hash01, makeProjector, type City, type Project, type RealCity } from './city';
import { buildApocalypse, type Apocalypse } from './apocalypse';
import { animateInfected, createInfected, type Infected } from './infected';
import { createArms, type Arms } from './arms';
import { alongPath, pathLength, restOfPath } from './path';
import { sky } from './textures';
import { spawnActor, type Actor, type Templates } from './models';

export type FollowTarget = { kind: 'survivor' | 'zombie'; id: string };
export interface Hud {
  mode: 'survivor' | 'zombie'; id: string; state: string; shelter: string | null; shelterDistance: number | null;
  nearest: { type: string; distance: number } | null; turn: number; totalTurns: number; timeScale: number;
}

interface Track { path: THREE.Vector3[]; start: number; duration: number }
interface ZombieView { figures: Infected[]; actors: Actor[]; root: THREE.Group; node: string; track: Track | null; type: string; position: THREE.Vector3; heading: number; moving: boolean }
interface PersonView { node: string; track: Track | null; position: THREE.Vector3; heading: number; actor: Actor | null; moving: boolean }
const ON_FOOT = new Set(['ACTIVO', 'CAMINANDO', 'HACIA_ENCUENTRO', 'ESPERANDO_RESCATE']);
const ZOMBIE_TINT: Record<string, number> = { caminante: 0xffffff, corredor: 0xffc7b8, horda: 0xe8e0c8 };

const EYE_HEIGHT = 1.65;
const RUN_SPEED = 4.5; // m/s de un sobreviviente corriendo
const SANDBAG = new THREE.CapsuleGeometry(0.3, 0.9, 2, 6).rotateZ(Math.PI / 2).scale(1, 0.55, 1);
const SANDBAG_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x6b6046, roughness: 1 });
const MOON_OFFSET = new THREE.Vector3(-140, 115, -185);

export class FirstPersonEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300) // más allá de ~250 m la niebla tapa todo;
  private project: Project;
  private coastZ: (x: number) => number;
  private city: City | null = null;
  private cityCenter = new THREE.Vector3(1e9, 0, 0);
  private apocalypse: Apocalypse | null = null;
  private apocalypseCenter = new THREE.Vector3(1e9, 0, 0);
  private blockedKey = '';
  private adjacency = new Map<string, string[]>();
  private zombies = new Map<string, ZombieView>();
  private shelters = new THREE.Group();
  private routeLine: THREE.Line | null = null;
  private routeKey = '';
  private shelterKey = '';
  private survivorNode = '';
  private survivorTurn = -1;
  private track: Track | null = null;
  private lastTurnAt = 0;
  private turnMs: number;
  private timeScale = 1;
  private running = 0;
  private stride = 0;
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
  private moon: THREE.Mesh;
  private skyDome: THREE.Mesh;
  private arms: Arms;
  private minimap: HTMLCanvasElement | null = null;
  private minimapStreets: Array<{ id: string; pts: THREE.Vector3[]; type: string }> | null = null;
  private lastMinimap = 0;
  private people = new Map<string, PersonView>();
  private mode: 'survivor' | 'zombie';
  private survivorId: string;
  private targetId: string;
  private chaseYaw = 0;
  private lastFocus = new THREE.Vector3();

  constructor(private container: HTMLElement, target: FollowTarget, state: VisualState, private onHud: (hud: Hud) => void,
    private real: RealCity | null = null, private models: Templates | null = null) {
    this.stateRef = state;
    this.mode = target.kind;
    this.targetId = target.id;
    this.survivorId = target.kind === 'survivor' ? target.id : '';
    this.turnMs = (state.turnSeconds ?? 2) * 1000;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    const survivor = state.survivors.find(s => s.id === this.survivorId);
    const zombie = state.zombies.find(z => z.id === this.targetId);
    const origin: Point = (target.kind === 'zombie' ? zombie?.position : survivor?.position) ?? state.map.bounds[0] ?? [-0.95, -80.72];
    this.project = makeProjector(origin);
    this.coastZ = real?.coast?.length ? coastFromReal(real.coast, this.project) : approximateCoast(state.map, this.project);
    for (const key of state.map.pairs.keys()) {
      const [from, to] = key.split('\0');
      if (!this.adjacency.has(from)) this.adjacency.set(from, []);
      this.adjacency.get(from)!.push(to);
    }

    // Noche del 31 de octubre: humo, resplandor de incendios en el horizonte, luna y linterna.
    this.scene.fog = new THREE.FogExp2(0x100d0b, 0.016);
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(280, 24, 16), new THREE.MeshBasicMaterial({ map: sky(), side: THREE.BackSide, fog: false, depthWrite: false }));
    this.skyDome.renderOrder = -1;
    this.scene.add(this.skyDome);
    this.scene.add(new THREE.HemisphereLight(0x6a7a98, 0x3a2a1c, 1.5));
    const moon = new THREE.DirectionalLight(0x9fb4d8, 0.5);
    moon.position.set(-60, 120, 40);
    this.scene.add(moon);
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshBasicMaterial({ color: 0xd9cfc0, fog: false }));
    this.scene.add(this.moon);

    this.arms = createArms();
    this.camera.add(this.arms.root);
    const flashlight = new THREE.SpotLight(0xfff1d6, 120, 70, 0.36, 0.7, 2);
    flashlight.position.set(0.27, -0.3, -0.6);
    flashlight.target.position.set(0.05, -1.6, -10);
    this.camera.add(flashlight, flashlight.target);
    this.scene.add(this.camera, this.shelters);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    this.bindLook();
    this.update(state);
    this.loop();
  }

  /** Minimapa 2D (arriba a la derecha): calles, ruta, refugios y zombies alrededor del sobreviviente. */
  setMinimap(canvas: HTMLCanvasElement | null) { this.minimap = canvas; }

  private drawMinimap(position: THREE.Vector3) {
    const canvas = this.minimap;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width, R = 260; // metros visibles desde el centro hasta el borde
    const k = size / 2 / R;
    const toPx = (v: THREE.Vector3) => [size / 2 + (v.x - position.x) * k, size / 2 + (v.z - position.z) * k] as const; // norte arriba
    this.minimapStreets ??= this.stateRef.map.streets.map(s => ({ id: s.id, pts: s.points.map(this.project), type: s.type }));
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8,14,18,.86)'; ctx.fillRect(0, 0, size, size);
    ctx.lineCap = 'round';
    for (const street of this.minimapStreets) {
      const a = street.pts[0];
      if (Math.abs(a.x - position.x) > R * 1.6 || Math.abs(a.z - position.z) > R * 1.6) continue;
      const blocked = this.stateRef.blockedEdges.has(street.id);
      ctx.strokeStyle = blocked ? '#ff5a4f' : street.type === 'avenida' ? '#7f939c' : '#4d5d65';
      ctx.lineWidth = blocked ? 2.5 : street.type === 'avenida' ? 2.6 : 1.4;
      ctx.setLineDash(blocked ? [3, 3] : []);
      ctx.beginPath();
      street.pts.forEach((p, i) => { const [x, y] = toPx(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const survivor = this.stateRef.survivors.find(s => s.id === this.survivorId);
    if (survivor && survivor.route.length > 1) {
      ctx.strokeStyle = '#6fdcff'; ctx.lineWidth = 2.2; ctx.beginPath();
      survivor.route.forEach((n, i) => { const p = this.nodePoint(n); if (!p) return; const [x, y] = toPx(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    for (const shelter of this.stateRef.shelters) {
      if (!shelter.position) continue;
      let [x, y] = toPx(this.project(shelter.position));
      const off = x < 6 || y < 6 || x > size - 6 || y > size - 6;
      x = Math.max(6, Math.min(size - 6, x)); y = Math.max(6, Math.min(size - 6, y)); // fuera del radio: pegado al borde
      ctx.fillStyle = shelter.available > 0 ? '#8dff9c' : '#ffc46b';
      ctx.globalAlpha = off ? 0.6 : 1; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.globalAlpha = 1;
    }
    const colors: Record<string, string> = { caminante: '#d8f070', corredor: '#ff5a3c', horda: '#ffa040' };
    for (const view of this.zombies.values()) {
      const [x, y] = toPx(view.position);
      if (x < 0 || y < 0 || x > size || y > size) continue;
      ctx.fillStyle = colors[view.type] ?? '#ff5a3c';
      ctx.beginPath(); ctx.arc(x, y, view.type === 'horda' ? 6 : 3.5, 0, 7); ctx.fill();
    }
    // Sobreviviente: flecha en el centro apuntando hacia donde mira.
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(-(this.yaw + this.lookYaw));
    ctx.fillStyle = '#66c8ef'; ctx.strokeStyle = '#06131b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#9ab1bd'; ctx.font = '10px monospace'; ctx.fillText('N', size / 2 - 3, 12);
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

  /** Camino por las calles entre dos nodos (aunque no sean vecinos: BFS de hasta 8 calles). */
  private streetPath(from: string, to: string, kind: 'person' | 'zombie' | 'runner' | 'truck', traversed: TraversedEdge[] = []): THREE.Vector3[] {
    if (from === to) return [];
    const direct = movementPath(from, to, kind, this.stateRef.map, this.stateRef.blockedEdges, traversed);
    if (direct.length >= 2) return direct.map(this.project);
    const previous = new Map<string, string | null>([[from, null]]);
    let frontier = [from];
    for (let depth = 0; depth < 8 && !previous.has(to) && frontier.length; depth++) {
      const next: string[] = [];
      for (const n of frontier) for (const m of this.adjacency.get(n) ?? []) if (!previous.has(m)) { previous.set(m, n); next.push(m); }
      frontier = next;
    }
    if (previous.has(to)) {
      const nodes: string[] = [];
      for (let n: string | null = to; n !== null; n = previous.get(n) ?? null) nodes.unshift(n);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const hop = movementPath(nodes[i], nodes[i + 1], 'person', this.stateRef.map, new Set()).map(this.project);
        const seg = hop.length >= 2 ? hop : [this.nodePoint(nodes[i]), this.nodePoint(nodes[i + 1])].filter((p): p is THREE.Vector3 => !!p);
        points.push(...(points.length ? seg.slice(1) : seg));
      }
      if (points.length >= 2) return points;
    }
    const a = this.nodePoint(from), b = this.nodePoint(to);
    return a && b ? [a, b] : [];
  }

  /** Encadena el nuevo tramo al movimiento en curso, desde donde está ahora (no teletransporta). */
  private chain(track: Track | null, fallback: THREE.Vector3, next: THREE.Vector3[], now: number): Track | null {
    const rest = track ? restOfPath(track.path, (now - track.start) / track.duration) : [fallback.clone()];
    const path = [...rest];
    if (next.length >= 2) path.push(...(path[path.length - 1].distanceTo(next[0]) < 0.5 ? next.slice(1) : next));
    if (pathLength(path) < 0.3) return null;
    return { path, start: now, duration: this.turnMs * 0.97 };
  }

  private positionOf(track: Track | null, fallback: THREE.Vector3, now: number) {
    if (!track) return { position: fallback.clone(), direction: null as THREE.Vector3 | null, moving: false };
    const progress = (now - track.start) / track.duration;
    const step = alongPath(track.path, progress);
    return { position: step.position, direction: progress < 1 ? step.direction : null, moving: progress < 1 };
  }

  update(state: VisualState) {
    this.stateRef = state;
    const now = performance.now();
    const followed = state.survivors.find(s => s.id === this.survivorId);
    const followedZombie = state.zombies.find(z => z.id === this.targetId);
    if (this.mode === 'survivor' && !followed) return;
    if (this.mode === 'zombie' && !followedZombie && !this.zombies.has(this.targetId)) return;
    // En vista de zombie no hay sobreviviente propio: se usa un "sobreviviente" vacío para reutilizar el código.
    const survivor = followed ?? { node: followedZombie?.node ?? this.survivorNode, route: [] as string[], truck: null, state: 'CAMINANDO', id: '' };

    // Ritmo real de los turnos (por si el servidor va más lento que 2 s).
    if (state.turn !== this.survivorTurn) {
      if (this.lastTurnAt) {
        const interval = now - this.lastTurnAt;
        if (interval > 400 && interval < 8000) this.turnMs = this.turnMs * 0.7 + interval * 0.3;
      }
      this.lastTurnAt = now;
    }

    // Sobreviviente: encadenar el tramo de este turno.
    if (this.mode === 'survivor' && survivor.node !== this.survivorNode) {
      const here = this.positionOf(this.track, this.nodePoint(this.survivorNode || survivor.node) ?? new THREE.Vector3(), now).position;
      if (this.survivorNode) {
        const truck = survivor.truck && survivor.state === 'EN_CAMIONETA' ? state.trucks.find(t => t.id === survivor.truck) : undefined;
        const next = this.streetPath(this.survivorNode, survivor.node, truck ? 'truck' : 'person', truck?.traversed ?? []);
        this.track = this.chain(this.track, here, next, now);
        if (this.track) this.timeScale = Math.max(1, pathLength(this.track.path) / (this.track.duration / 1000) / RUN_SPEED);
      }
      this.survivorNode = survivor.node;
    }
    if (this.mode === 'zombie') this.survivorNode = survivor.node;
    this.survivorTurn = state.turn;
    const here = this.nodePoint(survivor.node) ?? new THREE.Vector3();

    // Ciudad y ambientación: se reconstruyen si cambian los bloqueos o si nos alejamos mucho.
    const blockedKey = [...state.blockedEdges].sort().join('|');
    if (!this.city || blockedKey !== this.blockedKey || here.distanceTo(this.cityCenter) > 450) {
      if (this.city) { this.scene.remove(this.city.group); this.city.dispose(); }
      this.cityCenter = here.clone();
      this.city = buildCity(state.map, this.project, state.blockedEdges, this.cityCenter, 750, this.coastZ, this.real);
      this.scene.add(this.city.group);
      this.apocalypseCenter.set(1e9, 0, 0);
    }
    if (!this.apocalypse || blockedKey !== this.blockedKey || here.distanceTo(this.apocalypseCenter) > 300) {
      if (this.apocalypse) { this.scene.remove(this.apocalypse.group); this.apocalypse.dispose(); }
      this.apocalypseCenter = here.clone();
      this.apocalypse = buildApocalypse(state.map, this.project, this.city.segments, this.city.distToStreet, state.blockedEdges, this.apocalypseCenter);
      this.scene.add(this.apocalypse.group);
    }
    this.blockedKey = blockedKey;

    // Refugios: columna de luz verde visible a lo lejos.
    const shelterKey = state.shelters.map(r => `${r.id}:${r.available > 0}`).join('|');
    if (shelterKey !== this.shelterKey) {
      this.shelterKey = shelterKey;
      this.shelters.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.geometry !== SANDBAG) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } });
      this.shelters.clear();
      for (const shelter of state.shelters) {
        if (!shelter.position) continue;
        const p = this.project(shelter.position);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: shelter.available > 0 ? 0x8dff9c : 0xffc46b, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        beam.position.set(p.x, 35, p.z);
        const glowRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 6, 32).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x8dff9c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
        glowRing.position.set(p.x, 0.25, p.z);
        this.shelters.add(beam, glowRing);
        // Barricada de sacos de arena alrededor del refugio, con una entrada.
        const bags = new THREE.InstancedMesh(SANDBAG, SANDBAG_MATERIAL, 22);
        const mx = new THREE.Matrix4(), qq = new THREE.Quaternion();
        for (let i = 0; i < 22; i++) {
          const a = (i / 24) * Math.PI * 2 + 0.4;
          qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
          mx.compose(new THREE.Vector3(p.x + Math.cos(a) * 9, 0.25 + (i % 2) * 0.32, p.z + Math.sin(a) * 9), qq, new THREE.Vector3(1, 1, 1));
          bags.setMatrixAt(i, mx);
        }
        this.shelters.add(bags);
      }
    }

    // Ruta planificada: línea punteada sobre el asfalto.
    const routeKey = survivor.route.join('>');
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      if (this.routeLine) { this.scene.remove(this.routeLine); this.routeLine.geometry.dispose(); }
      const points = survivor.route.map(n => this.nodePoint(n)).filter((p): p is THREE.Vector3 => !!p).map(p => p.setY(0.09));
      if (points.length >= 2) {
        this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0x6fdcff, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.7 }));
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
        const figures: Infected[] = [], actors: Actor[] = [];
        for (let i = 0; i < count; i++) {
          const seed = hash01(`${z.id}:${i}`);
          // Modelo animado (glTF) si cargó; si no, figura procedural.
          const body = this.models ? spawnActor(this.models, 'zombie', seed, ZOMBIE_TINT[z.type]) : null;
          const object = body ? body.root : (figures[figures.push(createInfected(z.type, seed)) - 1]).root;
          if (body) actors.push(body);
          if (count > 1) object.position.set(Math.cos(i * 2.4) * (1.2 + i * 0.5), 0, Math.sin(i * 2.4) * (1.2 + i * 0.5));
          root.add(object);
        }
        if (z.type === 'horda') {
          const ring = new THREE.Mesh(new THREE.RingGeometry(7, 7.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.3 }));
          ring.position.y = 0.06;
          root.add(ring);
        }
        const start = this.nodePoint(z.node) ?? new THREE.Vector3();
        view = { figures, actors, root, node: z.node, track: null, type: z.type, position: start, heading: hash01(z.id) * Math.PI * 2, moving: false };
        root.position.copy(start);
        this.scene.add(root);
        this.zombies.set(z.id, view);
      } else if (view.node !== z.node) {
        const next = this.streetPath(view.node, z.node, z.type === 'corredor' ? 'runner' : 'zombie', z.traversed);
        view.track = this.chain(view.track, view.position, next, now);
        view.node = z.node;
      }
    }
    for (const [id, view] of this.zombies) if (!alive.has(id)) { this.scene.remove(view.root); this.zombies.delete(id); }

    // Otros sobrevivientes a pie (con modelo animado): huyen por las calles igual que en el mapa.
    if (this.models) {
      const present = new Set<string>();
      for (const p of state.survivors) {
        if (p.id === this.survivorId || !ON_FOOT.has(p.state)) continue;
        present.add(p.id);
        const view = this.people.get(p.id);
        if (!view) {
          this.people.set(p.id, { node: p.node, track: null, position: this.nodePoint(p.node) ?? new THREE.Vector3(), heading: 0, actor: null, moving: false });
        } else if (view.node !== p.node) {
          view.track = this.chain(view.track, view.position, this.streetPath(view.node, p.node, 'person'), now);
          view.node = p.node;
        }
      }
      for (const [id, view] of this.people) if (!present.has(id)) { if (view.actor) this.scene.remove(view.actor.root); this.people.delete(id); }
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const now = performance.now();
    const state = this.stateRef;
    const survivor = state.survivors.find(s => s.id === this.survivorId);

    const me = this.positionOf(this.track, this.nodePoint(this.survivorNode) ?? new THREE.Vector3(), now);
    if (this.track && !me.moving && now - this.track.start > this.track.duration * 1.5) this.track = null;
    const position = me.position;

    // Zombies: avanzar por su camino y animar el cuerpo.
    let nearest: { type: string; distance: number; at: THREE.Vector3 } | null = null;
    const focusZombie = this.mode === 'zombie' ? this.zombies.get(this.targetId) : undefined;
    const eye = focusZombie ? focusZombie.position : position; // desde dónde se mide la cercanía
    for (const view of this.zombies.values()) {
      const step = this.positionOf(view.track, view.position, now);
      view.position = step.position;
      view.moving = step.moving;
      if (view.track && !step.moving) view.track = null;
      if (step.direction) view.heading = Math.atan2(step.direction.x, step.direction.z);
      const distance = view.position.distanceTo(eye);
      if (this.mode === 'survivor' && distance < 18 && !step.moving) view.heading = Math.atan2(position.x - view.position.x, position.z - view.position.z); // te ve y gira hacia ti
      view.root.position.copy(view.position);
      view.root.rotation.y = view.heading;
      if (distance < 140) {
        for (const figure of view.figures) animateInfected(figure, t, step.moving);
        const pose = step.moving ? (view.type === 'corredor' ? 'run' : 'walk') : this.mode === 'survivor' && distance < 3 ? 'attack' : 'idle';
        for (const actor of view.actors) { actor.setPose(pose, view.type === 'caminante' ? 0.9 : 1.1); actor.mixer.update(dt); }
      }
      view.root.visible = distance < 220;
      if (view !== focusZombie && (!nearest || distance < nearest.distance)) nearest = { type: view.type, distance, at: view.position };
    }

    // Otros sobrevivientes: solo se dibujan los 40 más cercanos (los modelos animados cuestan).
    let nearestPerson: { distance: number; at: THREE.Vector3 } | null = null;
    const ranked: Array<[number, PersonView]> = [];
    for (const view of this.people.values()) {
      const step = this.positionOf(view.track, view.position, now);
      view.position = step.position;
      view.moving = step.moving;
      if (view.track && !step.moving) view.track = null;
      if (step.direction) view.heading = Math.atan2(step.direction.x, step.direction.z);
      const d = view.position.distanceTo(eye);
      ranked.push([d, view]);
      if (!nearestPerson || d < nearestPerson.distance) nearestPerson = { distance: d, at: view.position };
    }
    ranked.sort((x, y) => x[0] - y[0]);
    ranked.forEach(([d, view], i) => {
      const show = i < 40 && d < 160;
      if (show && !view.actor && this.models) { view.actor = spawnActor(this.models, 'survivor', hash01(String(i) + view.node)); this.scene.add(view.actor.root); }
      if (!view.actor) return;
      view.actor.root.visible = show;
      if (!show) return;
      view.actor.root.position.copy(view.position);
      view.actor.root.rotation.y = view.heading;
      view.actor.setPose(view.moving ? 'run' : 'idle');
      view.actor.mixer.update(dt);
    });

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (this.mode === 'zombie') {
      // Tercera persona: cámara detrás y por encima del zombie, siguiéndolo.
      const z = focusZombie;
      const at = z ? z.position : this.lastFocus;
      if (z) this.lastFocus.copy(z.position);
      const targetYaw = z ? z.heading + Math.PI : this.chaseYaw;
      this.chaseYaw += Math.atan2(Math.sin(targetYaw - this.chaseYaw), Math.cos(targetYaw - this.chaseYaw)) * Math.min(1, dt * 2.5);
      if (!this.dragging && now - this.lastDrag > 1500) { this.lookYaw *= 1 - Math.min(1, dt * 2); this.lookPitch *= 1 - Math.min(1, dt * 2); }
      const yaw = this.chaseYaw + this.lookYaw;
      const distance = 4.6, height = 2.3 + this.lookPitch * -2;
      this.camera.position.set(at.x + Math.sin(yaw) * distance, Math.max(0.6, height), at.z + Math.cos(yaw) * distance);
      this.camera.lookAt(at.x, 1.15, at.z);
      this.camera.fov = 62; this.camera.updateProjectionMatrix();
      this.arms.root.visible = false;
      this.yaw = Math.atan2(at.x - this.camera.position.x, at.z - this.camera.position.z) + Math.PI; // para la flecha del minimapa
      this.apocalypse?.update(t, at);
      this.skyDome.position.copy(this.camera.position);
      this.moon.position.copy(this.camera.position).add(MOON_OFFSET);
      this.moon.lookAt(this.camera.position);
      if (now - this.lastHud > 200) {
        this.lastHud = now;
        this.onHud({ mode: 'zombie', id: this.targetId, state: z?.type ?? 'desconocido', shelter: null, shelterDistance: null,
          nearest: nearestPerson ? { type: 'sobreviviente', distance: Math.round(nearestPerson.distance) } : null,
          turn: state.turn, totalTurns: state.totalTurns ?? 150, timeScale: Math.round(this.timeScale) });
      }
      if (now - this.lastMinimap > 120) { this.lastMinimap = now; this.drawMinimap(at); }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Hacia dónde mira: hacia donde corre; si está quieto, vigila al zombie más cercano.
    let target = this.yaw;
    if (me.direction) target = Math.atan2(-me.direction.x, -me.direction.z);
    else if (nearest && nearest.distance < 35) target = Math.atan2(-(nearest.at.x - position.x), -(nearest.at.z - position.z));
    const delta = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += delta * Math.min(1, dt * (me.direction ? 5 : 2));
    if (!this.dragging && now - this.lastDrag > 1500) { this.lookYaw *= 1 - Math.min(1, dt * 2); this.lookPitch *= 1 - Math.min(1, dt * 2); }

    // Zancada: el cuerpo sube y baja con cada paso; los brazos se balancean.
    const dead = survivor?.state === 'ELIMINADO';
    const safe = survivor?.state === 'EVACUADO';
    this.running += ((me.moving && !dead && !safe ? 1 : 0) - this.running) * Math.min(1, dt * 6);
    this.stride += dt * (6 + this.running * 5.5);
    const bob = reduced ? 0 : Math.abs(Math.sin(this.stride)) * 0.06 * this.running + Math.sin(t * 1.6) * 0.008;
    this.fall = dead ? Math.min(1, this.fall + dt * 0.8) : 0;
    this.camera.position.set(position.x, EYE_HEIGHT + bob - this.fall * 1.3, position.z);
    this.camera.rotation.set(this.lookPitch - 0.05 * this.running - this.fall * 0.5, this.yaw + this.lookYaw,
      this.fall * 0.9 + (reduced ? 0 : Math.sin(this.stride) * 0.015 * this.running), 'YXZ');
    this.camera.fov = 70 + this.running * 6; // sensación de velocidad
    this.camera.updateProjectionMatrix();
    this.arms.root.visible = !dead;
    this.arms.update(t, reduced ? 0 : this.running, dt);

    this.apocalypse?.update(t, position);
    this.skyDome.position.copy(this.camera.position);
    this.moon.position.copy(this.camera.position).add(MOON_OFFSET);
    this.moon.lookAt(this.camera.position);

    if (now - this.lastHud > 200 && survivor) {
      this.lastHud = now;
      const shelter = state.shelters.find(r => r.id === survivor.shelter);
      const shelterPoint = shelter?.position ? this.project(shelter.position) : null;
      this.onHud({
        mode: 'survivor', id: survivor.id, state: survivor.state, shelter: shelter?.name ?? survivor.shelter,
        shelterDistance: shelterPoint ? Math.round(shelterPoint.distanceTo(position)) : null,
        nearest: nearest ? { type: nearest.type, distance: Math.round(nearest.distance) } : null,
        turn: state.turn, totalTurns: state.totalTurns ?? 150, timeScale: Math.round(this.timeScale),
      });
    }
    if (now - this.lastMinimap > 120) { this.lastMinimap = now; this.drawMinimap(position); }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.city?.dispose();
    this.apocalypse?.dispose();
    this.routeLine?.geometry.dispose();
    this.shelters.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.geometry !== SANDBAG) mesh.geometry.dispose(); });
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
