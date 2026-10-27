import type { PreparedMap } from '../types/visual';
import type { RawState } from '../types/raw';
import { ObservableProvider } from './SimulationProvider';
import { prepareMap, adaptState } from '../services/adapter';
import { decodeMap, decodeState } from '../services/decode';
export class MockSimulationProvider extends ObservableProvider {
  private map?: PreparedMap;
  private frames: RawState[] = [];
  private index = 0;
  private round = 3;
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private controller?: AbortController;
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private turnMs = 2000) { super(true); }
  start() {
    if (this.running) return;
    this.running = true;
    if (this.frames.length) this.play(); else void this.load();
  }
  stop() { this.running = false; this.generation++; clearInterval(this.timer); this.controller?.abort(); }
  private async load() {
    const generation = ++this.generation;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    try {
      if (!this.map) {
        const response = await this.fetcher('/demo/mapa.json', { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo cargar el mapa demo.');
        this.map = prepareMap(decodeMap(await response.json()));
      }
      if (!this.running || generation !== this.generation) return;
      const response = await this.fetcher(`/demo/round_${this.round}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error('No se pudo cargar la escena demo.');
      const data = await response.json() as { frames: unknown[] };
      if (!this.running || generation !== this.generation) return;
      this.frames = data.frames.map(decodeState); this.index = 0;
      this.commit(); this.play();
    } catch (error) {
      if (this.running && generation === this.generation) this.publish({ connection: 'disconnected', error: String(error), playing: false });
    }
  }
  private commit() { if (this.map && this.frames[this.index]) this.frame(adaptState(this.frames[this.index], this.map, true)); }
  private play() { clearInterval(this.timer); this.publish({ playing: true }); this.timer = setInterval(() => this.advance(), this.turnMs); }
  pause() { clearInterval(this.timer); this.publish({ playing: false }); }
  advance() { if (this.index >= this.frames.length - 1) { this.pause(); return; } this.index++; this.commit(); }
  restart() { this.index = 0; this.commit(); }
  setRound(round: number) { if (![1, 2, 3].includes(round)) return; this.pause(); this.round = round; this.frames = []; void this.load(); }
  resume() { if (this.running && this.frames.length) this.play(); }
}
