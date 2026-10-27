import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { SimulationContext } from './SimulationContext';
import type { SimulationProvider } from '../providers/SimulationProvider';
import { adaptState, prepareMap } from '../services/adapter';
import { frameFixtures, mapFixture, clone } from '../test/fixtures';
vi.mock('../components/MapBoard', async () => {
  const actual = await vi.importActual<typeof import('../components/MapBoard')>('../components/MapBoard');
  return { ...actual, MapBoard: () => <div data-testid="map-shell" style={{ height: '510px' }}>Mapa operativo</div> };
});
function fixture(demo = false, disconnected = false) {
  const state = adaptState(frameFixtures[6], prepareMap(mapFixture), demo);
  const snapshot = { state, connection: disconnected ? 'disconnected' as const : 'connected' as const, error: disconnected ? 'HTTP 503' : null, demo, playing: demo, updatedAt: 1 };
  const provider: SimulationProvider = { getSnapshot: () => snapshot, subscribe: () => () => {}, start: vi.fn(), stop: vi.fn(), advance: vi.fn(), pause: vi.fn(), restart: vi.fn() };
  return { state, provider };
}
describe('operations dashboard', () => {
  it('renders real metrics, 4 shelters, 5 selectable trucks and the exact vehicle details', () => {
    const { provider, state } = fixture(); const result = render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    expect(screen.getByRole('heading', { name: /MANTA/ })).toBeInTheDocument();
    expect(screen.getByText('DATOS REALES')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /V-00/ })).toHaveLength(5);
    expect(screen.getByText('Rescates completados')).toBeInTheDocument(); expect(screen.getByText('Rescates cancelados')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Controles de demostración' })).not.toBeInTheDocument();
    const truck = state.trucks.find(v => v.passengers.length)!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(truck.id) }));
    expect(screen.getByText(truck.passengers.join(', '))).toBeInTheDocument();
    expect(screen.getByText('Punto de encuentro')).toBeInTheDocument();
    result.unmount(); expect(provider.stop).toHaveBeenCalledTimes(1);
  });
  it('renders all 25 telemetry fields and missing values as unavailable', () => {
    const { provider } = fixture(); render(<SimulationContext provider={provider}><Dashboard/></SimulationContext>);
    fireEvent.click(screen.getByRole('button', { name: 'Telemetría' }));
    expect(document.querySelectorAll('.telemetry .detail-field')).toHaveLength(25);
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
});
