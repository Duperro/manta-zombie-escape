import type { MapView, RawState, RawVehicle } from '../types/raw';
import type { PreparedMap, Point, Street, SurvivorState, Truck, VisualState } from '../types/visual';
export const survivorLabels: Record<SurvivorState | 'DESCONOCIDO', string> = {
  ACTIVO: 'Activo', CAMINANDO: 'Caminando', HACIA_ENCUENTRO: 'Dirigiéndose al encuentro',
  ESPERANDO_RESCATE: 'Esperando rescate', EN_CAMIONETA: 'En camioneta', EVACUADO: 'Evacuado',
  ELIMINADO: 'Eliminado', DESCONOCIDO: 'Estado no reconocido',
};
export function survivorState(value: string): SurvivorState | 'DESCONOCIDO' {
  const normalized = value.toUpperCase();
  return Object.hasOwn(survivorLabels, normalized) ? normalized as SurvivorState : 'DESCONOCIDO';
}
function point(lat: number, lng: number): Point | undefined {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : undefined;
}
export function prepareMap(raw: MapView): PreparedMap {
  const nodes = new Map<string, Point>();
  for (const n of raw.nodos) { const p = point(n.lat, n.lng); if (p) nodes.set(n.id, p); }
  const pairs = new Map<string, Street[]>();
  const streets: Street[] = raw.aristas.map(e => {
    const positions = e.geometria.map(p => point(p[1], p[0])).filter((p): p is Point => !!p);
    const fallback = [nodes.get(e.origen), nodes.get(e.destino)].filter((p): p is Point => !!p);
    const street = { id: e.id, from: e.origen, to: e.destino, points: positions.length >= 2 ? positions : fallback,
      cost: e.tiempo_estimado_s, type: e.tipo, blocked: e.bloqueada };
    const key = `${e.origen}\0${e.destino}`;
    pairs.set(key, [...(pairs.get(key) || []), street]);
    return street;
  });
  for (const roads of pairs.values()) roads.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  return { version: raw.version, attribution: raw.atribucion, nodes, streets, pairs, bounds: [...nodes.values()] };
}
export function resolveRoute(ids: string[], map: PreparedMap, blocked: Set<string>): Point[] {
  if (ids.length < 2) return [];
  const points: Point[] = [];
  for (let i = 1; i < ids.length; i++) {
    const road = map.pairs.get(`${ids[i - 1]}\0${ids[i]}`)?.find(e => !e.blocked && !blocked.has(e.id));
    if (!road || road.points.length < 2) return []; // Never draw a made-up shortcut.
    points.push(...(i === 1 ? road.points : road.points.slice(1)));
  }
  return points;
}
export function normalizeTruck(v: RawVehicle, map: PreparedMap): Truck {
  return { repairTurns: v.turnosReparacionRestantes ?? 0, breakdownCause: v.causaAveria ?? null, breakdowns: v.averiasSufridas ?? 0, id: v.id, node: v.nodoActual, position: map.nodes.get(v.nodoActual), state: v.estado,
    capacity: v.capacidad, passengers: [...v.pasajeros], used: v.capacidadUtilizada, assigned: v.sobrevivientesAsignados,
    meeting: v.puntoEncuentro, shelter: v.refugioDestino, route: v.rutaPlanificada, trips: v.viajesRealizados, distance: v.distanciaRecorrida_m };
}
export function adaptState(raw: RawState, map: PreparedMap, demo = false): VisualState {
  const warnings: string[] = [];
  const blockedEdges = new Set(raw.aristasBloqueadas);
  const survivors = raw.sobrevivientes.map(s => ({ id: s.id, node: s.nodoActual, position: map.nodes.get(s.nodoActual),
    state: survivorState(s.estado), rawState: s.estado, shelter: s.refugioAsignado, route: raw.rutas[s.id] ?? s.rutaPlanificada,
    truck: s.camionetaId ?? null, evacuationMode: s.modoEvacuacion ?? null, evacuationTurn: s.turnoEvacuacion,
    cause: s.causaEliminacion, distanceWalk: s.distanciaCaminada_m ?? 0, distanceTruck: s.distanciaEnCamioneta_m ?? 0 }));
  const trucks = raw.camionetas.map(v => normalizeTruck(v, map));
  const shelters = raw.refugios.map(r => {
    const supplied = r.plazas_disponibles;
    const available = typeof supplied === 'number' && Number.isFinite(supplied) ? supplied : r.capacidad_maxima - r.ocupacion - r.plazas_reservadas;
    if (supplied == null) warnings.push(`Disponibilidad calculada como respaldo: ${r.id}`);
    return { id: r.id, name: r.nombre, node: r.nodo, position: point(r.lat, r.lng) ?? map.nodes.get(r.nodo),
      capacity: r.capacidad_maxima, occupied: r.ocupacion, reserved: r.plazas_reservadas, available, state: r.estado, assigned: r.sobrevivientesAsignados ?? [] };
  });
  const zombies = raw.zombies.filter(z => ['caminante', 'corredor', 'horda'].includes(z.tipo)).map(z => ({
    id: z.id, node: z.nodo, position: map.nodes.get(z.nodo), type: z.tipo as 'caminante' | 'corredor' | 'horda' }));
  for (const entity of [...survivors, ...trucks, ...zombies, ...shelters]) if (!entity.position) warnings.push(`Nodo sin coordenadas: ${entity.id}`);
  const routes = [
    ...survivors.filter(s => s.state !== 'EN_CAMIONETA').map(s => ({ id: `p-${s.id}`, owner: s.id, kind: 'survivor' as const, points: resolveRoute(s.route, map, blockedEdges) })),
    ...trucks.map(v => ({ id: `v-${v.id}`, owner: v.id, kind: 'truck' as const, points: resolveRoute(v.route, map, blockedEdges) })),
  ].filter(r => r.points.length >= 2);
  const riskNodes = Object.entries(raw.riesgo?.nodos ?? {}).flatMap(([node, level]) => {
    const position = map.nodes.get(node); return position && Number.isFinite(level) ? [{ node, position, level }] : [];
  });
  const riskEdges = (raw.riesgo?.aristas ?? []).flatMap(e => (map.pairs.get(`${e.origen}\0${e.destino}`) ?? []).map(s => ({ points: s.points, level: e.nivel })));
  return { runId: raw.runId, totalTurns: raw.turnosTotales ?? 150, turnSeconds: raw.segundosPorTurno ?? 2, turn: raw.turno, round: raw.ronda, phase: raw.fase, simulation: raw.estadoSimulacion, strategy: raw.estrategia ?? 'Base',
    features: raw.funcionalidadesPro ?? {}, mapVersion: raw.mapaVersion, graphVersion: raw.versionGrafo, map, survivors, trucks, shelters,
    zombies, blockedEdges, blockedNodes: raw.nodosBloqueados, routes, riskNodes, riskEdges, riskTurn: raw.riesgo?.turnoPredicho ?? null,
    metrics: raw.metricas, events: raw.eventosRecientes as Record<string, unknown>[], warnings, demo };
}
