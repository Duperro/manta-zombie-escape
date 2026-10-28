import { useEffect, useRef, useState } from 'react';
import { Flame, Play, RotateCcw, X } from 'lucide-react';
import { parseConfig } from '../utils/config';

type Counts = { caminante: number; corredor: number; horda: number; dormido: number };
type BreakdownRule = { probabilidad: number; turnos: number };
type Breakdowns = { activadas: boolean; caminante: BreakdownRule; corredor: BreakdownRule; horda: BreakdownRule; dormido: BreakdownRule };
type Config = { averias: Breakdowns; ronda: number; sobrevivientes: number; zombies: Counts; turnos: number; semilla: number; estrategia: 'base' | 'pro'; distribucion: 'equilibrada' | 'aleatoria'; bloqueos: boolean };
type Status = { runId: string; ejecutando: boolean; configuracion: Config | null; error: string | null };
const presets = [
  { sobrevivientes: 20, zombies: { caminante: 12, corredor: 0, horda: 0, dormido: 0 } },
  { sobrevivientes: 80, zombies: { caminante: 16, corredor: 6, horda: 3, dormido: 0 } },
  { sobrevivientes: 200, zombies: { caminante: 24, corredor: 12, horda: 4, dormido: 8 } },
];
const initial: Config = { averias: { activadas: false, caminante: { probabilidad: .25, turnos: 2 }, corredor: { probabilidad: .5, turnos: 3 }, horda: { probabilidad: .8, turnos: 5 }, dormido: { probabilidad: .35, turnos: 2 } }, ronda: 1, ...presets[0], turnos: 150, semilla: 7, estrategia: 'pro', distribucion: 'equilibrada', bloqueos: true };
const countLabels: Record<keyof Counts, string> = { caminante: 'Caminantes', corredor: 'Corredores', horda: 'Hordas', dormido: 'Dormidos' };
const base = parseConfig(import.meta.env).base;
// En local (Vite) el proxy agrega la API key. En el servidor público no hay proxy con
// la clave: el operador la escribe en el modal y viaja solo por HTTPS en x-api-key.
const keyRequired = !import.meta.env.DEV;
const KEY_STORAGE = 'manta-operador-clave';
function readStoredKey() { try { return sessionStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; } }
function storeKey(value: string) { try { if (value) sessionStorage.setItem(KEY_STORAGE, value); else sessionStorage.removeItem(KEY_STORAGE); } catch { /* Sin almacenamiento: la clave vive solo en memoria. */ } }
async function request(path: string, init?: RequestInit, apiKey = ''): Promise<Status> {
  const headers = apiKey ? { ...(init?.headers as Record<string, string> | undefined), 'x-api-key': apiKey } : init?.headers;
  const response = await fetch(`${base}/control/${path}`, { ...init, headers, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) {
    let message = response.status === 404 ? 'El backend actual no tiene controles. Inicia dashboard_server.' : response.status === 401 ? 'Clave de operador incorrecta.' : response.status === 429 ? 'Demasiados intentos. Espera un minuto.' : `Control no disponible (${response.status}).`;
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
  const [apiKey, setApiKey] = useState(readStoredKey);
  const [keyDraft, setKeyDraft] = useState(apiKey);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (keyRequired && !apiKey) { setStatus(null); setError(''); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    request('estado', { signal: controller.signal }, apiKey).then(value => {
      if (controller.signal.aborted) return;
      setStatus(value); if (value.configuracion) setConfig({ ...value.configuracion, averias: value.configuracion.averias ?? initial.averias }); setError(value.error ?? '');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, apiKey]);
  function saveKey(event: React.FormEvent) {
    event.preventDefault();
    const value = keyDraft.trim();
    storeKey(value); setApiKey(value); setMessage(''); setError('');
  }
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy || loading) return;
    if (keyRequired && !apiKey) { setError('Ingresa la clave de operador.'); return; }
    if (Object.values(config.zombies).reduce((a, b) => a + b, 0) > 200) { setError('Máximo 200 zombies en total.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const value = await request('iniciar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }, apiKey);
      setStatus(value); setMessage('Simulación iniciada.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar.'); }
    finally { setBusy(false); }
  }
  return <div className="simulation-control-launcher">
    <button ref={trigger} type="button" className="simulation-control-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}><Flame size={16}/> Pruebas de fuego</button>
    <dialog ref={dialog} className="simulation-controls simulation-modal" aria-labelledby="fire-test-title" onCancel={e => { if (busy) e.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)} onClick={e => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
    <header className="simulation-modal-header"><h2 id="fire-test-title"><Flame size={19}/> Pruebas de fuego</h2><button type="button" className="icon-button" aria-label="Cerrar configuración" disabled={busy} onClick={() => setOpen(false)}><X size={18}/></button></header>
    {keyRequired && <form className="operator-key" onSubmit={saveKey} aria-label="Clave de operador">
      <label>Clave de operador<input type="password" autoComplete="current-password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="API key del equipo"/></label>
      <button type="submit">{apiKey ? 'Cambiar clave' : 'Usar clave'}</button>
      <small>Solo el equipo puede iniciar rondas. La clave se guarda en esta pestaña y se envía cifrada (HTTPS).</small>
    </form>}
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
        <section className="breakdown-options" aria-label="Averías temporales">
          <label className="breakdown-toggle"><input type="checkbox" checked={config.averias.activadas} onChange={e => setConfig(c => ({ ...c, averias: { ...c.averias, activadas: e.target.checked } }))}/> Averías temporales de furgonetas</label>
          {config.averias.activadas && <div className="breakdown-rules"><span>Contacto</span><span>Probabilidad</span><span>Reparación</span>{Object.entries(countLabels).map(([key, label]) => <div className="breakdown-rule" key={key}><span>{label}</span><label><span className="sr-only">Probabilidad de avería por {label}</span><input aria-label={`Probabilidad de avería por ${label}`} type="number" required min={0} max={100} step={1} value={Math.round(config.averias[key as keyof Counts].probabilidad * 100)} onChange={e => setConfig(c => ({ ...c, averias: { ...c.averias, [key]: { ...c.averias[key as keyof Counts], probabilidad: Number(e.target.value) / 100 } } }))}/><small>%</small></label><label><span className="sr-only">Turnos de reparación por {label}</span><input aria-label={`Turnos de reparación por ${label}`} type="number" required min={1} max={30} step={1} value={config.averias[key as keyof Counts].turnos} onChange={e => setConfig(c => ({ ...c, averias: { ...c.averias, [key]: { ...c.averias[key as keyof Counts], turnos: Number(e.target.value) } } }))}/><small>turnos</small></label></div>)}</div>}
        </section>
        <div className="control-actions"><label><input type="checkbox" checked={config.bloqueos} onChange={e => setConfig(c => ({ ...c, bloqueos: e.target.checked }))}/> Bloqueos de la ronda</label><button type="submit">{status?.configuracion ? <RotateCcw size={15}/> : <Play size={15}/>} {busy ? 'Iniciando…' : status?.configuracion ? 'Reiniciar' : 'Iniciar'}</button></div>
      </fieldset>
      {error && <p className="control-error" role="alert">{error}</p>}
      {message && <p className="control-success" role="status">{message}</p>}
    </form>
    </dialog>
  </div>;
}
