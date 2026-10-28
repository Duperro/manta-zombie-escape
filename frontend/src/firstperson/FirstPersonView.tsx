// Vista "Seguir": primera persona del sobreviviente elegido. Se carga aparte (lazy)
// para que three.js no aumente el peso de la página principal.
import { useEffect, useRef, useState } from 'react';
import { Footprints, ShieldPlus, Skull, X } from 'lucide-react';
import { useSimulation } from '../app/SimulationContext';
import { FirstPersonEngine, type FollowTarget, type Hud } from './engine';
import { loadModels } from './models';
import { loadCityData } from './cityData';

const stateText: Record<string, string> = {
  ACTIVO: 'Esperando', CAMINANDO: 'Huyendo', HACIA_ENCUENTRO: 'Hacia la camioneta', ESPERANDO_RESCATE: 'Esperando rescate',
  EN_CAMIONETA: 'En camioneta', EVACUADO: 'A salvo', ELIMINADO: 'Eliminado',
};
const zombieText: Record<string, string> = { caminante: 'Caminante', corredor: 'Corredor', horda: 'Horda' };

export default function FirstPersonView({ target, onClose }: { target: FollowTarget; onClose: () => void }) {
  const survivorId = target.id;
  const zombieMode = target.kind === 'zombie';
  const { state } = useSimulation();
  const mount = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const engine = useRef<FirstPersonEngine | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!mount.current || !state) return;
    let cancelled = false;
    Promise.all([loadCityData(), loadModels()]).then(([real, models]) => {
      if (cancelled || !mount.current) return;
      try {
        engine.current = new FirstPersonEngine(mount.current, target, latest.current ?? state, setHud, real, models);
        engine.current.setMinimap(minimap.current);
      } catch {
        setError('Tu navegador no permite gráficos 3D (WebGL). Prueba con Chrome o Edge actualizados.');
      }
    });
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
    // El motor se crea una sola vez por sobreviviente; los turnos llegan por update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id]);

  useEffect(() => { if (state) engine.current?.update(state); }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const danger = !zombieMode && hud?.nearest ? Math.max(0, Math.min(1, (35 - hud.nearest.distance) / 30)) : 0;
  const over = !zombieMode && (hud?.state === 'EVACUADO' || hud?.state === 'ELIMINADO');
  return <div className="fp-overlay" role="dialog" aria-modal="true" aria-label={`${zombieMode ? 'Tercera persona de' : 'Siguiendo a'} ${survivorId}`}>
    <div ref={mount} className="fp-canvas"/>
    <div className="fp-vignette" style={{ opacity: danger * 0.85 }}/>
    <header className="fp-hud">
      {zombieMode ? <>
        <div><small>TERCERA PERSONA</small><b>{survivorId}</b><span><Skull size={13}/> {hud ? zombieText[hud.state] ?? hud.state : 'Cargando…'}</span></div>
        <div><small>SOBREVIVIENTE MÁS CERCANO</small><b><Footprints size={13}/> {hud?.nearest ? `${hud.nearest.distance} m` : 'Ninguno a la vista'}</b><span>Arrastra para girar la cámara</span></div>
      </> : <>
        <div><small>SIGUIENDO</small><b>{survivorId}</b><span><Footprints size={13}/> {hud ? stateText[hud.state] ?? hud.state : 'Cargando…'}</span></div>
        <div><small>REFUGIO</small><b><ShieldPlus size={13}/> {hud?.shelter ?? 'Sin asignar'}</b><span>{hud?.shelterDistance != null ? `${hud.shelterDistance} m en línea recta` : '—'}</span></div>
        <div className={danger > 0.5 ? 'fp-alert' : ''}><small>ZOMBIE MÁS CERCANO</small><b><Skull size={13}/> {hud?.nearest ? zombieText[hud.nearest.type] ?? hud.nearest.type : 'Ninguno visible'}</b><span>{hud?.nearest ? `${hud.nearest.distance} m` : '—'}</span></div>
      </>}
      <div><small>TURNO</small><b>{hud?.turn ?? '—'} / {hud?.totalTurns ?? 150}</b><span title="El simulador avanza una calle (50–150 m) cada 2 s; a pie tomaría mucho más, por eso la vista va acelerada.">{hud && hud.timeScale > 1 ? `Cámara rápida ×${hud.timeScale}` : 'Arrastra para mirar alrededor'}</span></div>
      <button className="icon-button" aria-label="Salir de la vista 3D" onClick={onClose}><X size={18}/></button>
    </header>
    <figure className="fp-minimap" aria-label="Minimapa: norte arriba"><canvas ref={minimap} width={220} height={220}/><figcaption><i className="mm-route"/> Ruta <i className="mm-shelter"/> Refugio <i className="mm-zombie"/> Zombie</figcaption></figure>
    {!hud && !error && <div className="fp-preparing"><div className="boot-bar"><i style={{ width: '70%' }}/></div><p>Preparando las calles de Manta…</p></div>}
    {over && <div className={`fp-end ${hud?.state === 'EVACUADO' ? 'safe' : 'dead'}`}>
      <h2>{hud?.state === 'EVACUADO' ? 'Llegó al refugio' : 'No lo logró'}</h2>
      <p>{hud?.state === 'EVACUADO' ? `${survivorId} está a salvo en ${hud?.shelter ?? 'el refugio'}.` : `${survivorId} fue alcanzado.`}</p>
      <button onClick={onClose}>Volver al mapa</button>
    </div>}
    {error && <div className="fp-end dead"><h2>Vista 3D no disponible</h2><p>{error}</p><button onClick={onClose}>Volver al mapa</button></div>}
  </div>;
}
