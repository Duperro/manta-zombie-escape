import type { ProviderSnapshot, VisualState } from '../types/visual';
export interface SimulationProvider {
  getSnapshot(): ProviderSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  advance?(): void;
  pause?(): void;
  resume?(): void;
  restart?(): void;
  setRound?(round: number): void;
}
export abstract class ObservableProvider implements SimulationProvider {
  protected snapshot: ProviderSnapshot;
  private listeners = new Set<() => void>();
  constructor(demo: boolean) { this.snapshot = { state: null, connection: 'connecting', error: null, demo, playing: false, updatedAt: null }; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  protected publish(patch: Partial<ProviderSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    if (Object.keys(next).every(k => next[k as keyof ProviderSnapshot] === this.snapshot[k as keyof ProviderSnapshot])) return;
    this.snapshot = next;
    this.listeners.forEach(fn => fn());
  }
  protected frame(state: VisualState) { this.publish({ state, updatedAt: Date.now(), error: null, connection: 'connected' }); }
  abstract start(): void;
  abstract stop(): void;
}
