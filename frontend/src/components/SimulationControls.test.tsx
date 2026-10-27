import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimulationControls } from './SimulationControls';
const status = { runId: 'first', ejecutando: false, configuracion: null, error: null };
const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => body }) as Response;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => vi.unstubAllGlobals());
async function open() {
  render(<SimulationControls/>);
  fireEvent.click(screen.getByRole('button', { name: 'Pruebas de fuego' }));
  expect(screen.getByRole('dialog', { name: 'Pruebas de fuego' })).toBeVisible();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText('Supervivientes')).toBeEnabled());
}
describe('fire test controls', () => {
  it('loads a preset, submits real numeric configuration and can restart', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(status)).mockResolvedValue(reply({ ...status, ejecutando: true, configuracion: {} }));
    vi.stubGlobal('fetch', fetcher);
    await open();
    fireEvent.change(screen.getByLabelText('Ronda'), { target: { value: '3' } });
    expect(screen.getByLabelText('Supervivientes')).toHaveValue(200);
    expect(screen.getByLabelText('Dormidos')).toHaveValue(8);
    fireEvent.change(screen.getByLabelText('Supervivientes'), { target: { value: '250' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Configurar prueba de fuego' }));
    await screen.findByText('Simulación iniciada.');
    const [url, init] = fetcher.mock.calls.at(-1)!;
    expect(url).toBe('/api/control/iniciar'); expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ ronda: 3, sobrevivientes: 250, zombies: { dormido: 8 }, estrategia: 'pro' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(screen.getByRole('button', { name: 'Reiniciar' })).toBeEnabled();
  });
  it('rejects excessive totals locally without sending a start request', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(status)); vi.stubGlobal('fetch', fetcher);
    await open();
    fireEvent.change(screen.getByLabelText('Caminantes'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Corredores'), { target: { value: '1' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Configurar prueba de fuego' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Máximo 200 zombies');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('shows backend validation errors and lets the user retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(status)).mockResolvedValue(reply({ detail: 'Configuración rechazada' }, false)));
    await open(); fireEvent.submit(screen.getByRole('form', { name: 'Configurar prueba de fuego' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Configuración rechazada');
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeEnabled();
  });
  it('closes the modal, restores focus and reopens the configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status)));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar configuración' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pruebas de fuego' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Pruebas de fuego' }));
    expect(screen.getByRole('dialog', { name: 'Pruebas de fuego' })).toBeVisible();
  });

  it('sends configurable breakdown chances as fractions and repair durations as turns', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(status)).mockResolvedValue(reply({ ...status, ejecutando: true, configuracion: {} }));
    vi.stubGlobal('fetch', fetcher); await open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Averías temporales de furgonetas' }));
    fireEvent.change(screen.getByLabelText('Probabilidad de avería por Corredores'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Turnos de reparación por Corredores'), { target: { value: '6' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Configurar prueba de fuego' }));
    await screen.findByText('Simulación iniciada.');
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).averias).toMatchObject({ activadas: true, corredor: { probabilidad: 1, turnos: 6 } });
  });

});
