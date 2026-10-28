import { describe, it, expect } from 'vitest';
import { adaptState, normalizeTruck, prepareMap, resolveRoute, survivorLabels, survivorState } from './adapter';
import { mapFixture, frameFixtures, clone } from '../test/fixtures';
import { decodeState } from './decode';
import { metricLabels } from '../components/Panels';
describe('FastAPI → visual contract', () => {
  const map = prepareMap(mapFixture);
  it('preserves the real directed graph and swaps longitude/latitude', () => {
    expect(map.nodes.size).toBe(mapFixture.nodos.length); expect(map.streets).toHaveLength(mapFixture.aristas.length);
    expect(map.nodes.size).toBeGreaterThanOrEqual(1500);
    const e = mapFixture.aristas[0]; expect(map.streets[0].points[0]).toEqual([e.geometria[0][1], e.geometria[0][0]]);
  });
  it('normalizes all five trucks using node IDs, passenger IDs and exact field names', () => {
    const source = frameFixtures.find(s => s.camionetas.some(v => v.pasajeros.length))!;
    const raw = source.camionetas.find(v => v.pasajeros.length)!;
    const v = normalizeTruck(raw, map);
    expect(v.position).toEqual(map.nodes.get(raw.nodoActual)); expect(v.passengers).toEqual(raw.pasajeros);
    expect(v.used).toBe(raw.capacidadUtilizada); expect(v.shelter).toBe(raw.refugioDestino);
    expect(v.meeting).toBe(raw.puntoEncuentro); expect(v.route).toEqual(raw.rutaPlanificada);
    expect(adaptState(source, map).trucks).toHaveLength(5);
  });
  it('supports exactly the seven operational states without collapsing rescue states', () => {
    for (const value of ['ACTIVO', 'CAMINANDO', 'HACIA_ENCUENTRO', 'ESPERANDO_RESCATE', 'EN_CAMIONETA', 'EVACUADO', 'ELIMINADO']) expect(survivorState(value.toLowerCase())).toBe(value);
    expect(survivorState('new-server-state')).toBe('DESCONOCIDO');
    expect(survivorLabels.EN_CAMIONETA).toBe('En camioneta');
  });
  it('carries all 25 demo metrics (28 labels), the Pro extensions and 200 survivors', () => {
    const raw = frameFixtures[6]; const state = adaptState(raw, map);
    expect(state.survivors).toHaveLength(200); expect(state.metrics).toEqual(raw.metricas);
    expect(Object.keys(metricLabels)).toHaveLength(28); expect(Object.keys(raw.metricas)).toHaveLength(25);
    expect(state.strategy).toBe(raw.estrategia); expect(state.riskTurn).toBe(raw.riesgo?.turnoPredicho);
  });
  it('prefers the supplied availability, retains unknown shelter status and has an explicit fallback', () => {
    const raw = clone(frameFixtures[0]); raw.refugios[0].plazas_disponibles = 7; raw.refugios[0].estado = 'EN_REVISION';
    let state = adaptState(raw, map); expect(state.shelters[0].available).toBe(7); expect(state.shelters[0].state).toBe('EN_REVISION');
    delete raw.refugios[0].plazas_disponibles; state = adaptState(raw, map);
    expect(state.shelters[0].available).toBe(raw.refugios[0].capacidad_maxima - raw.refugios[0].ocupacion - raw.refugios[0].plazas_reservadas);
    expect(state.warnings.length).toBeGreaterThan(0);
  });
  it('never exposes hidden sleepers or fabricates a position for an unknown node', () => {
    const raw = clone(frameFixtures[0]); raw.zombies.push({ id: 'HIDDEN', nodo: raw.sobrevivientes[0].nodoActual, tipo: 'dormido' });
    raw.camionetas[0].nodoActual = 'UNKNOWN'; const state = adaptState(raw, map);
    expect(state.zombies.some(z => z.id === 'HIDDEN')).toBe(false); expect(state.trucks[0].position).toBeUndefined();
    expect(state.warnings).toContain('Nodo sin coordenadas: V-001');
  });
  it('carries a visible runner’s actual street trace into the map view', () => {
    const raw = clone(frameFixtures[0]);
    const first = map.streets[0];
    raw.zombies[0] = { id: 'Z-test', tipo: 'corredor', nodo: first.to,
      aristasRecorridasEnTurno: [{ origen: first.from, destino: first.to, aristaId: first.id }] };
    expect(adaptState(raw, map).zombies[0].traversed).toEqual([{ from: first.from, to: first.to, id: first.id }]);
  });
  it('does not draw non-adjacent or blocked routes and preserves real street geometry', () => {
    const edge = map.streets[0];
    expect(resolveRoute([edge.from, edge.to], map, new Set()).length).toBeGreaterThanOrEqual(2);
    expect(resolveRoute(['missing', edge.to], map, new Set())).toEqual([]);
    const all = new Set(map.pairs.get(`${edge.from}\0${edge.to}`)!.map(e => e.id));
    expect(resolveRoute([edge.from, edge.to], map, all)).toEqual([]);
  });
  it('preserves backend repair status and countdown, with safe defaults for older frames', () => {
    const raw = clone(frameFixtures[0].camionetas[0]);
    Object.assign(raw, { estado: 'AVERIADA', turnosReparacionRestantes: 5, causaAveria: 'horda', averiasSufridas: 2 });
    expect(normalizeTruck(raw, map)).toMatchObject({ state: 'AVERIADA', repairTurns: 5, breakdownCause: 'horda', breakdowns: 2 });
    expect(normalizeTruck(frameFixtures[0].camionetas[0], map).repairTurns).toBe(0);
  });

  it('rejects a broken vehicle without a valid repair countdown', () => {
    const raw = clone(frameFixtures[0]); raw.camionetas[0].estado = 'AVERIADA';
    delete raw.camionetas[0].turnosReparacionRestantes;
    expect(() => decodeState(raw)).toThrow('camionetas.reparacion');
    raw.camionetas[0].turnosReparacionRestantes = 3;
    expect(decodeState(raw).camionetas[0].turnosReparacionRestantes).toBe(3);
  });

});
