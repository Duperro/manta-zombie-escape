import type { StateView, VehicleView } from './generated';
export type { MapView, NodeView, EdgeView, SurvivorView, ZombieView, ShelterView } from './generated';
export type RawVehicle = VehicleView;
// Backend metricas/risks are extensible dictionaries. These are the 25 currently supplied metric keys.
export interface RawMetrics {
  sobrevivientesIniciales: number; evacuados: number; eliminados: number; activos: number;
  porcentajeSupervivencia: number; tasaEvacuacion: number; turnosPromedioEvacuacion: number | null;
  rutasValidas: number; rutasInvalidas: number; solicitudesHTTP: number; erroresHTTP: number;
  respuestasInvalidas: number; solicitudesSobre500ms: number; latenciaPromedioMs: number | null;
  latenciaP50Ms: number | null; latenciaP95Ms: number | null; latenciaP99Ms: number | null;
  disponibilidadEndpoint: number | null; vivosFinales: number; evacuadosCaminando: number;
  evacuadosCamioneta: number; rescatesCompletados: number; rescatesCancelados: number;
  distanciaCaminada_m: number; distanciaTransportada_m: number;
  eficienciaPromedio: number | null; tasaFallosEndpoint: number | null; notaRondaEstimada: number | null;
}
export interface RawRisk {
  turnoObservado?: number; turnoPredicho?: number;
  nodos?: Record<string, number>; aristas?: Array<{ origen: string; destino: string; nivel: number }>;
}
export interface RawState extends Omit<StateView, 'metricas' | 'riesgo'> {
  metricas: Partial<RawMetrics>;
  riesgo?: RawRisk;
}
