import { useEffect, useRef, useState } from 'react';
import { Flame, Play, RotateCcw, X } from 'lucide-react';
import { parseConfig } from '../utils/config';

type Counts = { caminante: number; corredor: number; horda: number; dormido: number };
type Config = { ronda: number; sobrevivientes: number; zombies: Counts; turnos: number; semilla: number; estrategia: 'base' | 'pro'; distribucion: 'equilibrada' | 'aleatoria'; bloqueos: boolean };
type Status = { runId: string; ejecutando: boolean; configuracion: Config | null; error: string | null };
const presets = [
  { sobrevivientes: 20, zombies: { caminante: 12, corredor: 0, horda: 0, dormido: 0 } },
  { sobrevivientes: 80, zombies: { caminante: 16, corredor: 6, horda: 3, dormido: 0 } },
  { sobrevivientes: 200, zombies: { caminante: 24, corredor: 12, horda: 4, dormido: 8 } },
];
const initial: Config = { ronda: 1, ...presets[0], turnos: 150, semilla: 7, estrategia: 'pro', distribucion: 'equilibrada', bloqueos: true };
const countLabels: Record<keyof Counts, string> = { caminante: 'Caminantes', corredor: 'Corredores', horda: 'Hordas', dormido: 'Dormidos' };
const base = parseConfig(import.meta.env).base;
async function request(path: string, init?: RequestInit): Promise<Status> {
  const response = await fetch(`${base}/control/${path}`, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) {
    let message = response.status === 404 ? 'El backend actual no tiene controles. Inicia dashboard_server.' : `Control no disponible (${response.status}).`;
    try { const data = await response.json(); if (typeof data.detail === 'string') message = data.detail; else if (Array.isArray(data.detail)) message = 'Revisa los valores: la configuración no es válida.'; } catch { /* Preserve the status message for non-JSON errors. */ }
    throw new Error(message);
  }
  return response.json();
}
export function SimulationControls() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Config>(initial);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    request('estado', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setStatus(value); if (value.configuracion) setConfig(value.configuracion); setError(value.error ?? '');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy || loading) return;
    if (Object.values(config.zombies).reduce((a, b) => a + b, 0) > 200) { setError('Máximo 200 zombies en total.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const value = await request('iniciar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      setStatus(value); setMessage('Simulación iniciada.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar.'); }
    finally { setBusy(false); }
  }
  return <div className="simulation-control-launcher">
    <button ref={trigger} type="button" className="simulation-control-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}><Flame size={16}/> Pruebas de fuego</button>
    <dialog ref={dialog} className="simulation-controls simulation-modal" aria-labelledby="fire-test-title" onCancel={e => { if (busy) e.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)} onClick={e => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
    <header className="simulation-modal-header"><h2 id="fire-test-title"><Flame size={19}/> Pruebas de fuego</h2><button type="button" className="icon-button" aria-label="Cerrar configuración" disabled={busy} onClick={() => setOpen(false)}><X size={18}/></button></header>
    <form onSubmit={start} aria-label="Configurar prueba de fuego">
      <fieldset disabled={busy || loading}>
        <div className="control-fields">
          <label>Ronda<select value={config.ronda} onChange={e => { const ronda = Number(e.target.value); setConfig(c => ({ ...c, ronda, ...presets[ronda - 1] })); setMessage(''); }}><option value={1}>Anochecer</option><option value={2}>Medianoche</option><option value={3}>Apocalipsis</option></select></label>
          <label>Supervivientes<input type="number" min={1} max={500} required value={config.sobrevivientes} onChange={e => setConfig(c => ({ ...c, sobrevivientes: Number(e.target.value) }))}/></label>
          {Object.entries(countLabels).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} max={200} required value={config.zombies[key as keyof Counts]} onChange={e => setConfig(c => ({ ...c, zombies: { ...c.zombies, [key]: Number(e.target.value) } }))}/></label>)}
          <label>Turnos<input type="number" min={1} max={150} required value={config.turnos} onChange={e => setConfig(c => ({ ...c, turnos: Number(e.target.value) }))}/></label>
          <label>Semilla<input type="number" min={0} max={2147483647} required value={config.semilla} onChange={e => setConfig(c => ({ ...c, semilla: Number(e.target.value) }))}/></label>
          <label>Estrategia<select value={config.estrategia} onChange={e => setConfig(c => ({ ...c, estrategia: e.target.value as Config['estrategia'] }))}><option value="pro">Pro</option><option value="base">Base</option></select></label>
          <label>Distribución<select value={config.distribucion} onChange={e => setConfig(c => ({ ...c, distribucion: e.target.value as Config['distribucion'] }))}><option value="equilibrada">Equilibrada</option><option value="aleatoria">Aleatoria</option></select></label>
        </div>
        <div className="control-actions"><label><input type="checkbox" checked={config.bloqueos} onChange={e => setConfig(c => ({ ...c, bloqueos: e.target.checked }))}/> Bloqueos de la ronda</label><button type="submit">{status?.configuracion ? <RotateCcw size={15}/> : <Play size={15}/>} {busy ? 'Iniciando…' : status?.configuracion ? 'Reiniciar' : 'Iniciar'}</button></div>
      </fieldset>
      {error && <p className="control-error" role="alert">{error}</p>}
      {message && <p className="control-success" role="status">{message}</p>}
    </form>
    </dialog>
  </div>;
}
