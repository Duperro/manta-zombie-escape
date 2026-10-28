// Vista "Seguir": primera persona del sobreviviente elegido. Se carga aparte (lazy)
// para que three.js no aumente el peso de la página principal.
import { useEffect, useRef, useState } from 'react';
import { Footprints, ShieldPlus, Skull, X } from 'lucide-react';
import { useSimulation } from '../app/SimulationContext';
import { FirstPersonEngine, type Hud } from './engine';
import { loadCityData } from './cityData';

const stateText: Record<string, string> = {
  ACTIVO: 'Esperando', CAMINANDO: 'Huyendo', HACIA_ENCUENTRO: 'Hacia la camioneta', ESPERANDO_RESCATE: 'Esperando rescate',
  EN_CAMIONETA: 'En camioneta', EVACUADO: 'A salvo', ELIMINADO: 'Eliminado',
};
const zombieText: Record<string, string> = { caminante: 'Caminante', corredor: 'Corredor', horda: 'Horda' };

export default function FirstPersonView({ survivorId, onClose }: { survivorId: string; onClose: () => void }) {
  const { state } = useSimulation();
  const mount = useRef<HTMLDivElement>(null);
  const engine = useRef<FirstPersonEngine | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!mount.current || !state) return;
    let cancelled = false;
    loadCityData().then(real => {
      if (cancelled || !mount.current) return;
      try {
        engine.current = new FirstPersonEngine(mount.current, survivorId, latest.current ?? state, setHud, real);
      } catch {
        setError('Tu navegador no permite gráficos 3D (WebGL). Prueba con Chrome o Edge actualizados.');
      }
    });
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
    // El motor se crea una sola vez por sobreviviente; los turnos llegan por update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survivorId]);

  useEffect(() => { if (state) engine.current?.update(state); }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const danger = hud?.nearest ? Math.max(0, Math.min(1, (35 - hud.nearest.distance) / 30)) : 0;
  const over = hud?.state === 'EVACUADO' || hud?.state === 'ELIMINADO';
  return <div className="fp-overlay" role="dialog" aria-modal="true" aria-label={`Siguiendo a ${survivorId}`}>
    <div ref={mount} className="fp-canvas"/>
    <div className="fp-vignette" style={{ opacity: danger * 0.85 }}/>
    <header className="fp-hud">
      <div><small>SIGUIENDO</small><b>{survivorId}</b><span><Footprints size={13}/> {hud ? stateText[hud.state] ?? hud.state : 'Cargando…'}</span></div>
      <div><small>REFUGIO</small><b><ShieldPlus size={13}/> {hud?.shelter ?? 'Sin asignar'}</b><span>{hud?.shelterDistance != null ? `${hud.shelterDistance} m en línea recta` : '—'}</span></div>
      <div className={danger > 0.5 ? 'fp-alert' : ''}><small>ZOMBIE MÁS CERCANO</small><b><Skull size={13}/> {hud?.nearest ? zombieText[hud.nearest.type] ?? hud.nearest.type : 'Ninguno visible'}</b><span>{hud?.nearest ? `${hud.nearest.distance} m` : '—'}</span></div>
      <div><small>TURNO</small><b>{hud?.turn ?? '—'} / {hud?.totalTurns ?? 150}</b><span>Arrastra para mirar alrededor</span></div>
      <button className="icon-button" aria-label="Salir de la vista en primera persona" onClick={onClose}><X size={18}/></button>
    </header>
    {over && <div className={`fp-end ${hud?.state === 'EVACUADO' ? 'safe' : 'dead'}`}>
      <h2>{hud?.state === 'EVACUADO' ? 'Llegó al refugio' : 'No lo logró'}</h2>
      <p>{hud?.state === 'EVACUADO' ? `${survivorId} está a salvo en ${hud?.shelter ?? 'el refugio'}.` : `${survivorId} fue alcanzado.`}</p>
      <button onClick={onClose}>Volver al mapa</button>
    </div>}
    {error && <div className="fp-end dead"><h2>Vista 3D no disponible</h2><p>{error}</p><button onClick={onClose}>Volver al mapa</button></div>}
  </div>;
}
