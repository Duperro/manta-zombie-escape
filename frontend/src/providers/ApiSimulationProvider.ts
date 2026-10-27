import type { RawState } from '../types/raw';
import type { PreparedMap } from '../types/visual';
import { ObservableProvider } from './SimulationProvider';
import { adaptState, prepareMap } from '../services/adapter';
import { decodeMap, decodeState } from '../services/decode';
type FrameKey = Pick<RawState, 'turno' | 'ronda' | 'mapaVersion' | 'versionGrafo' | 'estrategia' | 'estadoSimulacion'> & { runId?: string | null };
export function shouldCommit(previous: FrameKey | null, next: FrameKey): boolean {
  if (!previous || (next.runId && next.runId !== previous.runId) || next.ronda !== previous.ronda) return true;
  if (next.turno < previous.turno) return false;
  return next.turno > previous.turno || next.mapaVersion !== previous.mapaVersion || next.versionGrafo !== previous.versionGrafo || next.estrategia !== previous.estrategia || next.estadoSimulacion !== previous.estadoSimulacion;
}
export class ApiSimulationProvider extends ObservableProvider {
  private running = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private last: RawState | null = null;
  private map?: PreparedMap;
  private checkedHealth = false;
  constructor(private base = '/api', private fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private pollMs = 1000, private staleMs = 8000) { super(false); }
  start() { if (this.running) return; this.running = true; const generation = ++this.generation; void this.tick(generation); }
  stop() { this.running = false; this.generation++; clearTimeout(this.timer); clearTimeout(this.deadline); this.controller?.abort(); }
  private async get(path: '/health' | '/estado' | '/mapa', signal: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(`${this.base}${path}`, { method: 'GET', signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  private async tick(generation: number) {
    const started = Date.now();
    const controller = new AbortController(); this.controller = controller;
    const deadline = setTimeout(() => controller.abort(), 5000);
    this.deadline = deadline;
    try {
      if (!this.checkedHealth) {
        await this.get('/health', controller.signal);
        if (!this.running || generation !== this.generation) return;
        this.checkedHealth = true;
      }
      const raw = decodeState(await this.get('/estado', controller.signal));
      if (!this.running || generation !== this.generation) return;
      let map = this.map;
      if (!map || map.version !== raw.mapaVersion) {
        const data = decodeMap(await this.get('/mapa', controller.signal));
        if (data.version !== raw.mapaVersion) throw new Error('La versión del mapa no coincide con el estado.');
        map = prepareMap(data);
      }
      if (!this.running || generation !== this.generation) return;
      this.map = map;
      if (shouldCommit(this.last, raw)) { this.last = raw; this.frame(adaptState(raw, map)); }
      else {
        const age = Date.now() - (this.snapshot.updatedAt ?? Date.now());
        this.publish({ connection: raw.estadoSimulacion !== 'FINALIZADA' && age > this.staleMs ? 'stale' : 'connected', error: null });
      }
    } catch (error) {
      if (this.running && generation === this.generation) this.publish({ connection: 'disconnected', error: error instanceof Error ? error.message : 'No se pudo conectar al backend.' });
    } finally {
      clearTimeout(deadline);
      if (this.controller === controller) this.controller = undefined;
      if (this.running && generation === this.generation) this.timer = setTimeout(() => void this.tick(generation), Math.max(0, this.pollMs - (Date.now() - started)));
    }
  }
}
