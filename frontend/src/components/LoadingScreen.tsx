// Pantalla de carga inicial: espera el primer estado del simulador y deja descargados
// los archivos de la vista 3D (three.js + datos de la ciudad) para que "Seguir" abra al instante.
import { useEffect, useState } from 'react';
import { Check, Loader2, RadioTower } from 'lucide-react';

type Step = { label: string; done: boolean };

export function LoadingScreen({ ready }: { ready: boolean }) {
  const [view3d, setView3d] = useState(import.meta.env.MODE === 'test');
  const [city, setCity] = useState(import.meta.env.MODE === 'test');
  const [timedOut, setTimedOut] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    import('../firstperson/FirstPersonView').catch(() => undefined).finally(() => setView3d(true));
    Promise.all([import('../firstperson/cityData').then(m => m.loadCityData()), import('../firstperson/models').then(m => m.loadModels())]).catch(() => null).finally(() => setCity(true));
    const timer = setTimeout(() => setTimedOut(true), 15000); // nunca bloquear la página por la vista 3D
    return () => clearTimeout(timer);
  }, []);

  const steps: Step[] = [
    { label: 'Conectando con el centro de operaciones', done: ready },
    { label: 'Cargando el mapa de Manta', done: ready },
    { label: 'Preparando la vista en primera persona', done: view3d },
    { label: 'Cargando la ciudad y los modelos 3D', done: city },
  ];
  const progress = steps.filter(s => s.done).length / steps.length;
  const finished = (ready && view3d && city) || (ready && timedOut);

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setHidden(true), 450);
    return () => clearTimeout(timer);
  }, [finished]);

  if (hidden) return null;
  return <div className={`boot-screen ${finished ? 'leaving' : ''}`} role="status" aria-live="polite" aria-label="Cargando la aplicación">
    <div className="boot-card">
      <div className="brand-mark"><RadioTower size={28}/></div>
      <div className="boot-title">MANTA <span>/ ZOMBIE ESCAPE</span></div>
      <p>Radio de evacuación · Noche del 31 de octubre</p>
      <div className="boot-bar"><i style={{ width: `${Math.round(progress * 100)}%` }}/></div>
      <ul>{steps.map(step => <li key={step.label} className={step.done ? 'done' : ''}>{step.done ? <Check size={13}/> : <Loader2 size={13} className="spin"/>} {step.label}</li>)}</ul>
    </div>
  </div>;
}
