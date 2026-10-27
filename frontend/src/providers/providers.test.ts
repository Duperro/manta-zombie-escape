import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSimulationProvider, shouldCommit } from './ApiSimulationProvider';
import { MockSimulationProvider } from './MockSimulationProvider';
import { frameFixtures, mapFixture, clone, reply } from '../test/fixtures';
import type { RawState } from '../types/raw';
const health = { status: 'ok', service: 'manta-zombie-escape' };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe('controlled public polling', () => {
  let provider: ApiSimulationProvider | undefined;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => { provider?.stop(); provider = undefined; });
  it('gates by round/turn, permits relevant metadata changes and rejects regressions', () => {
    const a = frameFixtures[1]; expect(shouldCommit(a, a)).toBe(false);
    expect(shouldCommit(a, frameFixtures[0])).toBe(false);
    expect(shouldCommit(a, frameFixtures[2])).toBe(true);
    expect(shouldCommit(a, { ...a, ronda: 1, turno: 0 })).toBe(true);
    expect(shouldCommit({ ...a, runId: 'old' }, { ...a, turno: 0, runId: 'new' })).toBe(true);
    expect(shouldCommit({ ...a, runId: 'same' }, { ...a, turno: 0, runId: 'same' })).toBe(false);
    expect(shouldCommit(a, { ...a, versionGrafo: a.versionGrafo + 1 })).toBe(true);
  });
  it('polls each second without downloading the map again or committing the same frame', async () => {
    let state = clone(frameFixtures[0]);
    const fetcher = vi.fn(async (url: string | URL | Request) => reply(String(url).endsWith('/health') ? health : String(url).endsWith('/mapa') ? { ...mapFixture, version: state.mapaVersion } : state));
    provider = new ApiSimulationProvider('/api', fetcher as typeof fetch); provider.start(); provider.start(); await flush();
    const first = provider.getSnapshot().state; expect(first?.survivors).toHaveLength(200);
    await vi.advanceTimersByTimeAsync(1000); expect(provider.getSnapshot().state).toBe(first);
    state = clone(frameFixtures[2]); await vi.advanceTimersByTimeAsync(1000); expect(provider.getSnapshot().state?.turn).toBe(2);
    state = clone(frameFixtures[1]); await vi.advanceTimersByTimeAsync(1000); expect(provider.getSnapshot().state?.turn).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/mapa'))).toHaveLength(1);
    state = { ...state, turno: 3, mapaVersion: 'new-map' }; await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/mapa'))).toHaveLength(2);
    expect(fetcher.mock.calls.every(([url]) => ['/api/estado', '/api/mapa', '/api/health'].includes(String(url)))).toBe(true);
  });
  it('keeps a single in-flight request, aborts on stop and ignores its late response', async () => {
    let resolve!: (r: Response) => void; let signal: AbortSignal | undefined;
    const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).endsWith('/health')) return reply(health);
      signal = options?.signal as AbortSignal; return new Promise<Response>(r => { resolve = r; });
    });
    provider = new ApiSimulationProvider('/api', fetcher as typeof fetch); provider.start(); await flush();
    await vi.advanceTimersByTimeAsync(3000); expect(fetcher).toHaveBeenCalledTimes(2);
    provider.stop(); expect(signal?.aborted).toBe(true); resolve(reply(frameFixtures[0])); await flush();
    expect(provider.getSnapshot().state).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a prior generation even if the transport ignores cancellation', async () => {
    let oldResolve!: (r: Response) => void; let first = true;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) return reply(health);
      if (String(url).endsWith('/mapa')) return reply(mapFixture);
      if (first) { first = false; return new Promise<Response>(r => { oldResolve = r; }); }
      return reply(frameFixtures[2]);
    });
    provider = new ApiSimulationProvider('/api', fetcher as typeof fetch); provider.start(); await flush();
    provider.stop(); provider.start(); await flush(); expect(provider.getSnapshot().state?.turn).toBe(2);
    oldResolve(reply({ ...frameFixtures[0], turno: 99 })); await flush(); expect(provider.getSnapshot().state?.turn).toBe(2);
  });
  it('recovers after an HTTP error without switching to demo', async () => {
    let fail = true;
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/health') ? reply(health) : String(url).endsWith('/mapa') ? reply(mapFixture) : fail ? reply({}, 503) : reply(frameFixtures[0]));
    provider = new ApiSimulationProvider('/api', fetcher as typeof fetch); provider.start(); await flush();
    expect(provider.getSnapshot().connection).toBe('disconnected'); expect(provider.getSnapshot().demo).toBe(false);
    fail = false; await vi.advanceTimersByTimeAsync(1000); expect(provider.getSnapshot().connection).toBe('connected');
  });
  it('marks an unchanged active clock stale, while a finished round remains connected', async () => {
    let state: RawState = clone(frameFixtures[0]);
    const fetcher = vi.fn(async (url: string | URL | Request) => reply(String(url).endsWith('/health') ? health : String(url).endsWith('/mapa') ? mapFixture : state));
    provider = new ApiSimulationProvider('/api', fetcher as typeof fetch, 1000, 2000); provider.start(); await flush();
    await vi.advanceTimersByTimeAsync(3000); expect(provider.getSnapshot().connection).toBe('stale');
    state = { ...state, turno: 150, estadoSimulacion: 'FINALIZADA' }; await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(4000); expect(provider.getSnapshot().connection).toBe('connected');
  });
});
describe('demonstration recording provider', () => {
  it('binds native browser fetch to its global receiver', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', function(this: typeof globalThis, url: string) {
      expect(this).toBe(globalThis);
      return Promise.resolve(reply(url.endsWith('mapa.json') ? mapFixture : { frames: frameFixtures }));
    });
    const p = new MockSimulationProvider();
    try { p.start(); await flush(); expect(p.getSnapshot().state?.survivors).toHaveLength(200); }
    finally { p.stop(); vi.unstubAllGlobals(); }
  });
  it('uses local recordings, advances every two seconds, supports controls and cleans up', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (url: string | URL | Request) => reply(String(url).endsWith('mapa.json') ? mapFixture : { frames: frameFixtures }));
    const p = new MockSimulationProvider(fetcher as typeof fetch); p.start(); p.start(); await flush();
    expect(p.getSnapshot().demo).toBe(true); expect(p.getSnapshot().state?.turn).toBe(0);
    await vi.advanceTimersByTimeAsync(2000); expect(p.getSnapshot().state?.turn).toBe(1);
    p.pause(); await vi.advanceTimersByTimeAsync(4000); expect(p.getSnapshot().state?.turn).toBe(1);
    p.advance(); expect(p.getSnapshot().state?.turn).toBe(2); p.restart(); expect(p.getSnapshot().state?.turn).toBe(0);
    p.stop(); expect(vi.getTimerCount()).toBe(0);
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('/demo/'))).toBe(true);
  });
});
