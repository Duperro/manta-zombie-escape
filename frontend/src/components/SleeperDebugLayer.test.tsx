import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SleeperDebugLayer } from './SleeperDebugLayer';
import { adaptState, prepareMap } from '../services/adapter';
import { frameFixtures, mapFixture } from '../test/fixtures';
vi.mock('react-leaflet', () => ({ Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="debug-marker">{children}</div>, Tooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
afterEach(() => vi.unstubAllGlobals());
function fixture() { return { ...adaptState(frameFixtures[0], prepareMap(mapFixture)), runId: 'test-run' }; }
const reply = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
describe('isolated sleeper debug view', () => {
  it('does not request hidden data by default and never merges it into visible zombies', async () => {
    const state = fixture(); const original = [...state.zombies];
    const fetcher = vi.fn().mockResolvedValue(reply({ runId: state.runId, ronda: state.round, turno: state.turn, dormidos: [{ id: 'SLEEPER', nodo: state.survivors[0].node }] }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<SleeperDebugLayer state={state} enabled={false}/>);
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<SleeperDebugLayer state={state} enabled/>);
    expect(await screen.findByText('SLEEPER · Dormido · solo pruebas')).toBeInTheDocument();
    expect(fetcher.mock.calls[0][0]).toBe('/api/control/dormidos');
    expect(state.zombies).toEqual(original);
    view.rerender(<SleeperDebugLayer state={state} enabled={false}/>);
    expect(screen.queryByTestId('debug-marker')).not.toBeInTheDocument();
  });
  it('hides old run or turn data and aborts requests when disabled', async () => {
    const state = fixture(); let resolve!: (r: Response) => void;
    const fetcher = vi.fn((_url, options) => new Promise<Response>(r => { resolve = r; expect(options.signal).toBeTruthy(); }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<SleeperDebugLayer state={state} enabled/>);
    view.rerender(<SleeperDebugLayer state={{ ...state, runId: 'new-run' }} enabled={false}/>);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(reply({ runId: state.runId, ronda: state.round, turno: state.turn, dormidos: [{ id: 'OLD', nodo: state.survivors[0].node }] })));
    expect(screen.queryByTestId('debug-marker')).not.toBeInTheDocument();
  });
  it('rejects mismatched frames and reports an unavailable protected endpoint', async () => {
    const state = fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ runId: 'other-run', ronda: state.round, turno: state.turn, dormidos: [{ id: 'WRONG', nodo: state.survivors[0].node }] })).mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<SleeperDebugLayer state={state} enabled/>);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('debug-marker')).not.toBeInTheDocument();
    view.rerender(<SleeperDebugLayer state={{ ...state, turn: state.turn + 1 }} enabled/>);
    expect(await screen.findByText('Dormidos: vista de pruebas no disponible')).toBeInTheDocument();
  });
});
