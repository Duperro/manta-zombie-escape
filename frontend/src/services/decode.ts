import type { MapView, RawState } from '../types/raw';
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function requireContract(ok: unknown, field: string): asserts ok { if (!ok) throw new Error(`Respuesta incompatible: ${field}`); }
export function decodeState(value: unknown): RawState {
  requireContract(record(value), 'estado');
  requireContract(Number.isInteger(value.turno) && Number.isInteger(value.ronda) && typeof value.mapaVersion === 'string', 'turno/ronda/mapaVersion');
  for (const name of ['sobrevivientes', 'zombies', 'refugios', 'camionetas', 'aristasBloqueadas', 'nodosBloqueados', 'eventosRecientes']) requireContract(Array.isArray(value[name]), name);
  requireContract(record(value.metricas) && record(value.rutas), 'metricas/rutas');
  for (const v of value.camionetas as unknown[]) requireContract(record(v) && typeof v.id === 'string' && typeof v.nodoActual === 'string' && Array.isArray(v.pasajeros) && Array.isArray(v.rutaPlanificada) && Array.isArray(v.sobrevivientesAsignados), 'camionetas');
  for (const s of value.sobrevivientes as unknown[]) requireContract(record(s) && typeof s.id === 'string' && typeof s.nodoActual === 'string' && typeof s.estado === 'string' && Array.isArray(s.rutaPlanificada), 'sobrevivientes');
  return value as unknown as RawState;
}
export function decodeMap(value: unknown): MapView {
  requireContract(record(value) && typeof value.version === 'string' && Array.isArray(value.nodos) && Array.isArray(value.aristas), 'mapa');
  for (const n of value.nodos as unknown[]) requireContract(record(n) && typeof n.id === 'string' && Number.isFinite(n.lat) && Number.isFinite(n.lng), 'mapa.nodos');
  for (const e of value.aristas as unknown[]) requireContract(record(e) && typeof e.id === 'string' && Array.isArray(e.geometria), 'mapa.aristas');
  return value as unknown as MapView;
}
