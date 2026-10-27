import { useEffect, useState } from 'react';
import { Activity, Circle, Clock3, ExternalLink, Pause, Play, RadioTower, RotateCcw, Search, ShieldCheck, SkipForward, Wifi, WifiOff } from 'lucide-react';
import { useSimulation } from './SimulationContext';
import type { Selection } from '../types/visual';
import { MapBoard, initialLayers, LayerControl } from '../components/MapBoard';
import { SimulationControls } from '../components/SimulationControls';
import { DetailsPanel, FleetPanel, MetricsPanel, number, RefugesPanel, RescueMetrics, Telemetry } from '../components/Panels';
const roundNames: Record<number, string> = { 1: 'Anochecer', 2: 'Medianoche', 3: 'Apocalipsis' };
const connectionNames = { connecting: 'Conectando', connected: 'Conectado', disconnected: 'Sin conexión', stale: 'Sin cambio de turno' };
export function Dashboard() {
  const { state, connection, demo, playing, provider } = useSimulation();
  const [selected, select] = useState<Selection>(null);
  const [layers, setLayers] = useState(initialLayers);
  const [tab, setTab] = useState<'map' | 'telemetry'>('map');
  const [query, setQuery] = useState('');
  useEffect(() => { select(null); setQuery(''); }, [state?.runId, state?.round]);
  const remaining = Math.max(0, ((state?.totalTurns ?? 150) - (state?.turn ?? 0)) * (state?.turnSeconds ?? 2));
  const entities = state ? [
    ...state.survivors.map(s => ({ id: s.id, kind: 'survivor' as const, label: 'Sobreviviente' })),
    ...state.trucks.map(s => ({ id: s.id, kind: 'truck' as const, label: 'Camioneta' })),
    ...state.shelters.map(s => ({ id: s.id, kind: 'shelter' as const, label: s.name })),
    ...state.zombies.map(s => ({ id: s.id, kind: 'zombie' as const, label: s.type })),
  ].filter(e => e.id.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark"><RadioTower size={25}/></div><div><h1>MANTA <span>/ ZOMBIE ESCAPE</span></h1></div></div><div className="header-status"><span className={`source-badge ${demo ? 'demo' : ''}`}>{demo ? 'DEMOSTRACIÓN' : 'DATOS REALES'}</span><span className={`connection ${connection}`} role="status">{connection === 'disconnected' ? <WifiOff size={14}/> : <Wifi size={14}/>} {connectionNames[connection]}</span></div></header>
    <main><div className="page-title"><div><h2>{demo ? 'Simulación demo' : 'Evacuación en vivo'}</h2></div><div className="round-panel"><div><span>RONDA {state?.round ?? '—'} / 3</span><b>{state ? roundNames[state.round] || 'Sin identificar' : 'Esperando operación'}</b></div><div className="turn-counter"><strong>{state?.turn ?? '—'}<small>/{state?.totalTurns ?? 150}</small></strong><span>TURNO</span></div><div className="round-time"><Clock3 size={14}/><b>{`${Math.floor(remaining / 60)}`.padStart(2, '0')}:{`${remaining % 60}`.padStart(2, '0')}</b><small>restantes</small></div></div></div>
      {!demo && <SimulationControls/>}
      <MetricsPanel state={state}/>
      {connection === 'disconnected' && <div className="connection-notice" role="alert"><WifiOff size={17}/><div><b>Se perdió la conexión con el centro.</b><span>Último estado disponible. Reintentando…</span></div></div>}
      {connection === 'stale' && <div className="connection-notice stale" role="status"><Clock3 size={17}/> Turno sin cambios.</div>}
      <div className="workspace-toolbar"><nav aria-label="Vistas"><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><Activity size={15}/> Mapa</button><button className={tab === 'telemetry' ? 'active' : ''} onClick={() => setTab('telemetry')}><ShieldCheck size={15}/> Telemetría</button></nav><div className="toolbar-meta"><span className="strategy-tag">{state?.strategy ?? '—'}</span>{tab === 'map' && <LayerControl layers={layers} onChange={setLayers}/>}</div></div>
      {!state ? <section className="loading-state"><RadioTower size={32}/><h2>{connection === 'disconnected' ? 'Centro no disponible' : 'Conectando con la operación'}</h2><span className="loading-track"/></section> : <>
        {tab === 'telemetry' ? <Telemetry state={state}/> : <div className="operations-grid"><section className="map-column"><MapBoard state={state} selected={selected} onSelect={select} layers={layers}/><div className="legend"><span><i className="survivor-key"/> Sobrevivientes</span><span><i className="eliminated-key">×</i> Eliminados</span><span><i className="walker-key"/> Caminantes</span><span><i className="runner-key"/> Corredores</span><span><i className="horde-key"/> Hordas</span><span><i className="truck-key"/> Camionetas</span><span><i className="shelter-key"/> Refugios</span><span><i className="risk-key"/> Riesgo {state.riskTurn !== null ? `· turno ${state.riskTurn}` : 'no disponible'}</span><small title="Activa Dormidos (solo pruebas) en Capas para mostrarlos. El algoritmo continúa sin conocer sus posiciones.">{layers.sleepers ? 'Dormidos: vista de pruebas' : 'Dormidos: ocultos hasta despertar'}</small></div><RescueMetrics state={state}/><details className="event-panel"><summary><Circle size={11}/> Eventos recientes</summary><div className="event-list">{state.events.length ? state.events.slice(-5).reverse().map((event, i) => <div className="event-row" key={`${String(event.id)}-${i}`}><span className="event-turn">T{String(event.turno ?? state.turn)}</span><b>{String(event.tipo ?? 'evento').replaceAll('_', ' ')}</b><span>{String(event.sobrevivienteId ?? event.camionetaId ?? event.zombieId ?? '')}</span></div>) : <p className="empty-events">Sin eventos.</p>}</div></details></section>
          <aside className="sidebar"><div className="search-shell"><Search size={16}/><input aria-label="Buscar entidad" placeholder="Buscar…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <div className="search-results">{entities.length ? entities.map(e => <button key={`${e.kind}-${e.id}`} onClick={() => { select({ id: e.id, kind: e.kind }); setQuery(''); }}><b>{e.id}</b><span>{e.label}</span></button>) : <p>No se encontraron entidades.</p>}</div>}</div><DetailsPanel state={state} selected={selected} close={() => select(null)}/><RefugesPanel state={state} onSelect={select}/><FleetPanel state={state} selected={selected} onSelect={select}/></aside></div>}
        {state.warnings.length > 0 && <details className="data-warnings"><summary>{state.warnings.length} observaciones de datos</summary>{state.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      </>}
      {demo && <section className="demo-controls" aria-label="Controles de demostración"><div><span className="source-badge demo">DEMO</span><p>15 cuadros por ronda</p></div><div><select aria-label="Ronda de demostración" value={state?.round ?? 3} onChange={e => { select(null); provider.setRound?.(Number(e.target.value)); }}><option value="1">1 · Anochecer</option><option value="2">2 · Medianoche</option><option value="3">3 · Apocalipsis</option></select><button onClick={() => playing ? provider.pause?.() : provider.resume?.()} aria-label={playing ? 'Pausar demostración' : 'Reproducir demostración'}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button><button onClick={() => provider.advance?.()} aria-label="Avanzar demostración"><SkipForward size={16}/></button><button onClick={() => provider.restart?.()} aria-label="Reiniciar demostración"><RotateCcw size={16}/></button></div></section>}
    </main><footer><span><i className="live-dot"/> {state?.simulation === 'FINALIZADA' ? 'RONDA FINALIZADA' : demo ? 'REPRODUCCIÓN DEMOSTRATIVA' : 'OBSERVACIÓN DEL SIMULADOR'}</span><span>{number(state?.zombies.length)} amenazas visibles <i/> {state?.blockedEdges.size ?? '—'} calles bloqueadas</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap <ExternalLink size={11}/></a></footer>
  </div>;
}
