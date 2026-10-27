import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ApiSimulationProvider } from '../providers/ApiSimulationProvider';
import { SimulationContext } from '../app/SimulationContext';
import { Dashboard } from '../app/Dashboard';
import type { VisualState } from '../types/visual';
import type { RawState, MapView } from '../types/raw';
vi.mock('../components/MapBoard', async () => {
  const actual = await vi.importActual<typeof import('../components/MapBoard')>('../components/MapBoard');
  return { ...actual, MapBoard: () => <div data-testid="map-shell" style={{ height: '510px' }}>Renderizador cartográfico sustituido para jsdom</div> };
});
it('observes actual Pro rounds through Vite → FastAPI and renders final dashboard metrics', async () => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const calls: Record<string, number> = {};
  const rawFrames = new Map<string, RawState>();
  let rawMap: MapView | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls[url.pathname] = (calls[url.pathname] || 0) + 1;
    expect(init?.method).toBe('GET'); expect(Object.keys(init?.headers || {})).toEqual(['Accept']);
    const response = await nativeFetch(input, init);
    if (response.ok) {
      const data = await response.clone().json();
      if (url.pathname.endsWith('/estado')) rawFrames.set(`${data.ronda}:${data.turno}`, data);
      if (url.pathname.endsWith('/mapa')) rawMap = data;
    }
    return response;
  };
  const provider = new ApiSimulationProvider(process.env.LIVE_API_BASE || 'http://127.0.0.1:5173/api', fetcher);
  const seen = new Set<string>(); const rounds = new Set<number>(); const states = new Set<string>();
  const evidence = { zombieMoved: false, survivorMoved: false, truckMoved: false, passengersObserved: false,
    shelterChanged: false, routesChanged: false, blockedStreetsObserved: false, riskObserved: false };
  let previous: VisualState | null = null;
  let final: VisualState | null = null;
  let done!: () => void; let fail!: (error: unknown) => void;
  const complete = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
  const observe = () => {
    const state = provider.getSnapshot().state; if (!state || seen.has(`${state.round}:${state.turn}`)) return;
    const raw = rawFrames.get(`${state.round}:${state.turn}`)!;
    expect(raw).toBeTruthy(); expect(state.metrics).toEqual(raw.metricas); expect(state.demo).toBe(false);
    expect(state.trucks).toHaveLength(5); expect(state.shelters).toHaveLength(4);
    for (const v of state.trucks) {
      const original = raw.camionetas.find(x => x.id === v.id)!;
      const node = rawMap!.nodos.find(n => n.id === original.nodoActual)!;
      expect(v.position).toEqual([node.lat, node.lng]); expect(v.passengers).toEqual(original.pasajeros);
    }
    seen.add(`${state.round}:${state.turn}`); rounds.add(state.round);
    state.survivors.forEach(s => states.add(s.state));
    evidence.passengersObserved ||= state.trucks.some(v => v.passengers.length > 0);
    evidence.blockedStreetsObserved ||= state.blockedEdges.size > 0;
    evidence.riskObserved ||= state.riskNodes.length > 0;
    for (const id of state.blockedEdges) expect(state.map.streets.some(s => s.id === id)).toBe(true);
    if (previous?.round === state.round) {
      evidence.zombieMoved ||= state.zombies.some(z => previous!.zombies.some(old => old.id === z.id && old.node !== z.node));
      evidence.survivorMoved ||= state.survivors.some(s => previous!.survivors.some(old => old.id === s.id && old.node !== s.node));
      evidence.truckMoved ||= state.trucks.some(v => previous!.trucks.some(old => old.id === v.id && old.node !== v.node));
      evidence.shelterChanged ||= state.shelters.some(r => previous!.shelters.some(old => old.id === r.id && old.occupied !== r.occupied));
      evidence.routesChanged ||= JSON.stringify(state.routes) !== JSON.stringify(previous.routes);
    }
    previous = state;
    if (state.round === 3 && state.turn === 150) { final = state; done(); }
  };
  const unsubscribe = provider.subscribe(() => { try { observe(); } catch (error) { fail(error); } });
  const ui = render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
  try {
    await complete;
    await waitFor(() => expect(document.querySelector('.turn-counter strong')?.textContent).toBe('150/150'));
    expect(screen.getByText('DATOS REALES')).toBeInTheDocument(); expect(screen.queryByText('DEMOSTRACIÓN')).not.toBeInTheDocument();
    expect(document.querySelector('.metric-card.lime strong')?.textContent).toBe(String((final as unknown as VisualState).metrics.evacuados));
    expect([...rounds].sort()).toEqual([1, 2, 3]);
    expect(calls['/api/mapa']).toBe(1); expect(Object.keys(calls).sort()).toEqual(['/api/estado', '/api/health', '/api/mapa']);
    expect(Object.values(evidence).every(Boolean)).toBe(true);
    const output = path.resolve(process.cwd(), '../reports/handoff_frontend_live.json');
    fs.writeFileSync(output, JSON.stringify({ evidence, rounds: [...rounds], framesObserved: seen.size, survivorStatesObserved: [...states],
      calls, finalMetrics: (final as unknown as VisualState).metrics, note: 'Real HTTP + React/RTL. Leaflet renderer mocked in jsdom; this is not a visual browser check.' }, null, 2));
  } finally { unsubscribe(); ui.unmount(); provider.stop(); }
});
