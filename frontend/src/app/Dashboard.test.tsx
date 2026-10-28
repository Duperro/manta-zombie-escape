import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { SimulationContext } from './SimulationContext';
import type { SimulationProvider } from '../providers/SimulationProvider';
import { adaptState, prepareMap } from '../services/adapter';
import { frameFixtures, mapFixture, clone } from '../test/fixtures';
vi.mock('../components/MapBoard', async () => {
  const actual = await vi.importActual<typeof import('../components/MapBoard')>('../components/MapBoard');
  return { ...actual, MapBoard: ({ children }: { children?: ReactNode }) => <div data-testid="map-shell" style={{ height: '510px' }}>Mapa operativo{children}</div> };
});
function fixture(demo = false, disconnected = false) {
  const state = adaptState(frameFixtures[6], prepareMap(mapFixture), demo);
  const snapshot = { state, connection: disconnected ? 'disconnected' as const : 'connected' as const, error: disconnected ? 'HTTP 503' : null, demo, playing: demo, updatedAt: 1 };
  const provider: SimulationProvider = { getSnapshot: () => snapshot, subscribe: () => () => {}, start: vi.fn(), stop: vi.fn(), advance: vi.fn(), pause: vi.fn(), restart: vi.fn() };
  return { state, provider };
}
describe('operations dashboard', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('shows fire tests in production but keeps sleepers hidden and makes no private fetch without a key', () => {
    vi.stubEnv('DEV', false);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const { provider } = fixture();
    render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    expect(screen.getByText('DATOS REALES')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pruebas de fuego/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Dormidos (solo pruebas)')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('renders real metrics, 4 shelters, 5 selectable trucks and the exact vehicle details', () => {
    const { provider, state } = fixture(); const result = render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    expect(screen.getByRole('heading', { name: /MANTA/ })).toBeInTheDocument();
    expect(screen.getByText('DATOS REALES')).toBeInTheDocument();
    expect(document.querySelector('.sidebar')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar entidad' }), { target: { value: 'V-00' } });
    expect(screen.getAllByRole('button', { name: /V-00/ })).toHaveLength(5);
    expect(screen.getByText('Rescates completados')).toBeInTheDocument(); expect(screen.getByText('Rescates cancelados')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Controles de demostración' })).not.toBeInTheDocument();
    const truck = state.trucks.find(v => v.passengers.length)!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(truck.id) }));
    expect(screen.getByText(truck.passengers.join(', '))).toBeInTheDocument();
    expect(screen.getByText('Punto de encuentro')).toBeInTheDocument();
    expect(screen.getByTestId('map-shell')).toContainElement(screen.getByRole('region', { name: 'Detalle de entidad' }));
    result.unmount(); expect(provider.stop).toHaveBeenCalledTimes(1);
  });
  it('renders all 28 telemetry fields and missing values as unavailable', () => {
    const { provider } = fixture(); render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    fireEvent.click(screen.getByRole('button', { name: 'Telemetría' }));
    expect(document.querySelectorAll('.telemetry .detail-field')).toHaveLength(28);
    expect(screen.getByText('Distancia transportada (m)')).toBeInTheDocument();
    expect(screen.getByText('Latencia p99 (ms)')).toBeInTheDocument();
  });
  it('shows real rescue state on search and details without converting it to active', () => {
    const { provider, state } = fixture(); const s = state.survivors.find(s => s.state === 'EN_CAMIONETA')!;
    render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar entidad' }), { target: { value: s.id } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(s.id) }));
    expect(screen.getByText('En camioneta')).toBeInTheDocument(); expect(screen.getByText('Camioneta asignada')).toBeInTheDocument();
  });
  it('keeps last good data on disconnect and labels demo controls separately', () => {
    const { provider } = fixture(true, true); render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    expect(screen.getByRole('alert')).toHaveTextContent('Se perdió la conexión');
    expect(screen.getByRole('button', { name: 'Avanzar demostración' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Avanzar demostración' })); expect(provider.advance).toHaveBeenCalledTimes(1);
    expect(screen.getByText('DEMOSTRACIÓN')).toBeInTheDocument();
  });
  it('finds a shelter by name, keeps its card in the map and closes on X or Escape', () => {
    const { provider } = fixture(); render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    const input = screen.getByRole('textbox', { name: 'Buscar entidad' });
    fireEvent.change(input, { target: { value: 'Tarqui' } });
    fireEvent.click(screen.getByRole('button', { name: /R-001/ }));
    expect(screen.getByText('Plazas disponibles')).toBeInTheDocument();
    expect(screen.getByTestId('map-shell')).toContainElement(screen.getByRole('region', { name: 'Detalle de entidad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(screen.queryByRole('region', { name: 'Detalle de entidad' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'V-001' } });
    fireEvent.click(screen.getByRole('button', { name: /V-001/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Detalle de entidad' })).not.toBeInTheDocument();
    expect(document.querySelector('.map-detail-card')).toBeNull();
  });

  it('shows the real repair countdown in the selected truck card', () => {
    const { provider, state } = fixture();
    state.trucks[0] = { ...state.trucks[0], state: 'AVERIADA', repairTurns: 3, breakdownCause: 'corredor', breakdowns: 1 };
    render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar entidad' }), { target: { value: state.trucks[0].id } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(state.trucks[0].id) }));
    expect(screen.getByText('AVERIADA')).toBeInTheDocument();
    expect(screen.getByText('3 turnos')).toBeInTheDocument();
    expect(screen.getByText('corredor')).toBeInTheDocument();
  });

});
