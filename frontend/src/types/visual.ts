import type { RawMetrics } from './raw';
export type SurvivorState = 'ACTIVO' | 'CAMINANDO' | 'HACIA_ENCUENTRO' | 'ESPERANDO_RESCATE' | 'EN_CAMIONETA' | 'EVACUADO' | 'ELIMINADO';
export type Connection = 'connecting' | 'connected' | 'disconnected' | 'stale';
export type Point = [number, number];
export type Selection = { kind: 'survivor' | 'truck' | 'shelter' | 'zombie'; id: string } | null;
export interface Street { id: string; from: string; to: string; points: Point[]; cost: number; type: string; blocked: boolean }
export interface PreparedMap { version: string; attribution: string; nodes: Map<string, Point>; streets: Street[]; pairs: Map<string, Street[]>; bounds: Point[] }
export interface Survivor { id: string; node: string; position?: Point; state: SurvivorState | 'DESCONOCIDO'; rawState: string; shelter: string | null; route: string[]; truck: string | null; evacuationMode: string | null; evacuationTurn: number | null; cause: string | null; distanceWalk: number; distanceTruck: number }
export interface Truck { repairTurns: number; breakdownCause: string | null; breakdowns: number; id: string; node: string; position?: Point; state: string; capacity: number; passengers: string[]; used: number; assigned: string[]; meeting: string | null; shelter: string | null; route: string[]; trips: number; distance: number }
export interface Shelter { id: string; name: string; node: string; position?: Point; capacity: number; occupied: number; reserved: number; available: number; state: string; assigned: string[] }
export interface Zombie { id: string; node: string; position?: Point; type: 'caminante' | 'corredor' | 'horda' }
export interface Route { id: string; owner: string; kind: 'survivor' | 'truck'; points: Point[] }
export interface VisualState {
  runId?: string | null; totalTurns?: number; turnSeconds?: number;
  turn: number; round: number; phase: string; simulation: string; strategy: string; features: Record<string, boolean>;
  mapVersion: string; graphVersion: number; map: PreparedMap; survivors: Survivor[]; trucks: Truck[]; shelters: Shelter[];
  zombies: Zombie[]; blockedEdges: Set<string>; blockedNodes: string[]; routes: Route[];
  riskNodes: Array<{ node: string; position: Point; level: number }>; riskEdges: Array<{ points: Point[]; level: number }>;
  riskTurn: number | null; metrics: Partial<RawMetrics>; events: Record<string, unknown>[]; warnings: string[]; demo: boolean;
}
export interface ProviderSnapshot { state: VisualState | null; connection: Connection; error: string | null; demo: boolean; playing: boolean; updatedAt: number | null }
