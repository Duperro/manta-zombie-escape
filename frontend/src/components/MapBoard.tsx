import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { renderToStaticMarkup } from 'react-dom/server';
import { Biohazard, Check, Crosshair, Layers, Minus, PersonStanding, Plus, ShieldPlus, Skull, Truck as TruckIcon, Wrench, X, Zap } from 'lucide-react';
import type { Point, Selection, VisualState } from '../types/visual';
import { SleeperDebugLayer } from './SleeperDebugLayer';
import { localOperatorControlsEnabled } from '../utils/operator';
import { survivorLabels } from '../services/adapter';
export const layerNames = { streets: 'Red vial', survivors: 'Sobrevivientes', eliminated: 'Personas eliminadas', zombies: 'Zombies visibles', sleepers: 'Dormidos (solo pruebas)', hordes: 'Bloqueo por hordas', shelters: 'Refugios', trucks: 'Camionetas y encuentros', blocked: 'Calles bloqueadas', routes: 'Rutas planificadas', risk: 'Predicción de corredores' };
export type LayersState = Record<keyof typeof layerNames, boolean>;
export const initialLayers: LayersState = { streets: true, survivors: true, eliminated: true, zombies: true, sleepers: false, hordes: true, shelters: true, trucks: true, blocked: true, routes: true, risk: true };
export const stateColors: Record<string, string> = { ACTIVO: '#65dcff', CAMINANDO: '#65dcff', HACIA_ENCUENTRO: '#b59aff', ESPERANDO_RESCATE: '#dec0ff', EN_CAMIONETA: '#b7ee72', EVACUADO: '#70d6a3', ELIMINADO: '#ff95b5' };
export function selectionPosition(state: VisualState, selected: Selection): Point | undefined {
  if (!selected) return;
  if (selected.kind === 'survivor') {
    const person = state.survivors.find(s => s.id === selected.id);
    return (person?.state === 'EN_CAMIONETA' ? state.trucks.find(v => v.id === person.truck)?.position : undefined) ?? person?.position;
  }
  return (selected.kind === 'truck' ? state.trucks : selected.kind === 'shelter' ? state.shelters : state.zombies).find(e => e.id === selected.id)?.position;
}
function SelectionFocus({ position, selectionKey }: { position?: Point; selectionKey: string }) {
  const map = useMap();
  const focused = useRef('');
  useEffect(() => {
    if (!selectionKey) { focused.current = ''; return; }
    if (!position || focused.current === selectionKey) return;
    focused.current = selectionKey;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    map.stop();
    map.flyTo(position, Math.max(map.getZoom(), Math.min(map.getZoom() + 0.75, 17)), { animate: !reduced, duration: 0.65 });
  }, [map, position, selectionKey]);
  return null;
}
function MapNavigation() {
  const map = useMap();
  return <div className="map-zoom-controls" onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <button className="icon-button" aria-label="Acercar mapa" title="Acercar" onClick={e => { e.stopPropagation(); map.zoomIn(); }}><Plus size={19}/></button>
    <button className="icon-button" aria-label="Alejar mapa" title="Alejar" onClick={e => { e.stopPropagation(); map.zoomOut(); }}><Minus size={19}/></button>
  </div>;
}
const personIcons = new Map<string, ReturnType<typeof divIcon>>();
function personIcon(status: string, selected: boolean) {
  const key = `${status}-${selected}`;
  if (!personIcons.has(key)) {
    const eliminated = status === 'ELIMINADO';
    const terminal = status === 'EVACUADO';
    const glyph = status === 'ELIMINADO' ? <X size={14} strokeWidth={3.2}/> : status === 'EVACUADO' ? <Check size={10}/> : <PersonStanding size={13} strokeWidth={2.7}/>;
    personIcons.set(key, divIcon({ className: 'entity-icon', html: `<span class="person-pin ${terminal ? 'terminal' : ''} ${eliminated ? 'eliminated' : ''} ${selected ? 'is-selected' : ''}" style="--entity-color:${stateColors[status] || '#acb5c1'}">${renderToStaticMarkup(glyph)}</span>`, iconSize: [terminal ? 14 : 20, terminal ? 14 : 20], iconAnchor: [terminal ? 7 : 10, terminal ? 7 : 10] }));
  }
  return personIcons.get(key)!;
}
const threatIcons = new Map<string, ReturnType<typeof divIcon>>();
function threatIcon(type: string, selected: boolean) {
  const key = `${type}-${selected}`;
  if (!threatIcons.has(key)) {
    const glyph = type === 'horda' ? <Biohazard size={16} strokeWidth={2.4}/> : type === 'corredor' ? <Zap size={13} fill="currentColor"/> : <Skull size={13} strokeWidth={2.4}/>;
    const size = type === 'horda' ? 27 : 22;
    threatIcons.set(key, divIcon({ className: 'entity-icon', html: `<span class="threat-pin threat-${type} ${selected ? 'is-selected' : ''}">${renderToStaticMarkup(glyph)}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
  }
  return threatIcons.get(key)!;
}
function Fit({ points, version, fitKey }: { points: Point[]; version: string; fitKey: number }) {
  const map = useMap();
  useEffect(() => { if (points.length) map.fitBounds(points, { padding: [24, 24], maxZoom: 15, animate: false }); }, [map, version, fitKey, points]);
  useEffect(() => { const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(map.getContainer()); return () => observer.disconnect(); }, [map]);
  return null;
}
const shelterIcon = divIcon({ className: 'entity-icon', html: `<span class="shelter-pin">${renderToStaticMarkup(<ShieldPlus size={18} strokeWidth={2}/>)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
function truckIcon(count: number, repairTurns: number) { return divIcon({ className: 'entity-icon', html: `<span class="truck-pin ${repairTurns ? 'truck-broken' : ''}">${renderToStaticMarkup(<TruckIcon size={18}/>)}<b>${count}</b>${repairTurns ? `<i>${renderToStaticMarkup(<Wrench size={11}/>)}</i><em>${repairTurns}t</em>` : ''}</span>`, iconSize: [32, 28], iconAnchor: [16, 14] }); }
export const MapBoard = memo(function MapBoard({ state, selected, onSelect, layers, children }: { state: VisualState; selected: Selection; onSelect: (s: Selection) => void; layers: LayersState; children?: ReactNode }) {
  const [fitKey, setFitKey] = useState(0);
  const [tileError, setTileError] = useState(false);
  const baseRoads = useMemo(() => state.map.streets.filter(e => e.points.length >= 2).map(e => e.points), [state.map]);
  const selectedRoutes = state.routes.filter(r => selected && r.owner === selected.id);
  const backgroundRoutes = selected ? [] : state.routes.filter(r => r.kind === 'truck');
  const target = selectionPosition(state, selected);
  const selectionKey = selected ? `${state.runId ?? ""}:${state.round}:${state.mapVersion}:${selected.kind}:${selected.id}` : '';
  return <div className="map-shell" data-testid="map-shell">
    <MapContainer center={[-0.967, -80.715]} zoom={13} zoomSnap={0.25} preferCanvas zoomControl={false} className="leaflet-map" attributionControl>
      <Fit points={state.map.bounds} version={state.map.version} fitKey={fitKey}/>
      <SelectionFocus position={target} selectionKey={selectionKey}/>
      <MapNavigation/>
      <SleeperDebugLayer state={state} enabled={localOperatorControlsEnabled() && layers.sleepers === true}/>
      {!tileError && <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={{ tileerror: () => setTileError(true) }}/>}
      {layers.streets && <Polyline positions={baseRoads} pathOptions={{ color: '#8aa8b8', weight: 1.7, opacity: 0.5 }} interactive={false}/>}
      {layers.risk && state.riskNodes.map(n => <CircleMarker key={`risk-${n.node}`} center={n.position} radius={9 + n.level * 7} pathOptions={{ color: '#ffbf62', fillColor: '#ffad47', fillOpacity: 0.09, opacity: 0.25, weight: 1 }} interactive={false}/>)}
      {layers.risk && state.riskEdges.map((e, i) => <Polyline key={`riskedge-${i}`} positions={e.points} pathOptions={{ color: '#de9e49', weight: 4, opacity: 0.18 }} interactive={false}/>)}
      {layers.hordes && state.blockedNodes.map(id => { const p = state.map.nodes.get(id); return p ? <CircleMarker key={`horde-${id}`} center={p} radius={14} pathOptions={{ color: '#dd8366', weight: 1, dashArray: '3 4', fillOpacity: 0.12 }}><Tooltip>Nodo bloqueado por horda · {id}</Tooltip></CircleMarker> : null; })}
      {layers.blocked && state.map.streets.filter(e => state.blockedEdges.has(e.id) || e.blocked).map(e => <Polyline key={`blocked-${e.id}`} positions={e.points} pathOptions={{ color: '#fc7775', weight: 4, dashArray: '6 5' }}><Tooltip>Calle bloqueada · {e.id}</Tooltip></Polyline>)}
      {layers.routes && [...backgroundRoutes, ...selectedRoutes].map(r => <Polyline key={r.id} positions={r.points} pathOptions={{ color: r.kind === 'truck' ? '#c3f287' : '#b1a2ff', weight: selected ? 4 : 2, opacity: selected ? 1 : 0.65, dashArray: r.kind === 'truck' ? '8 5' : undefined }} interactive={false}/>)}
      {state.survivors.filter(s => s.position && s.state !== 'EN_CAMIONETA' && (s.state === 'ELIMINADO' ? layers.eliminated !== false : layers.survivors)).map(s => <Marker key={s.id} position={s.position!} icon={personIcon(s.state, selected?.id === s.id)} zIndexOffset={selected?.id === s.id ? 2000 : s.state === 'ELIMINADO' ? 900 : s.state === 'EVACUADO' ? -200 : 100} eventHandlers={{ click: () => onSelect({ kind: 'survivor', id: s.id }) }}><Tooltip>{s.id} · {survivorLabels[s.state]}{s.state === 'ELIMINADO' && s.cause ? ` · ${s.cause.replaceAll('_', ' ')}` : ''}</Tooltip></Marker>)}
      {layers.zombies && state.zombies.filter(z => z.position).map(z => <Marker key={z.id} position={z.position!} icon={threatIcon(z.type, selected?.id === z.id)} zIndexOffset={selected?.id === z.id ? 2000 : 200} eventHandlers={{ click: () => onSelect({ kind: 'zombie', id: z.id }) }}><Tooltip>{z.id} · {z.type}</Tooltip></Marker>)}
      {layers.shelters && state.shelters.filter(r => r.position).map(r => <Marker key={r.id} position={r.position!} icon={shelterIcon} zIndexOffset={selected?.id === r.id ? 2000 : 400} eventHandlers={{ click: () => onSelect({ kind: 'shelter', id: r.id }) }}><Tooltip>{r.name} · {r.available} plazas disponibles</Tooltip></Marker>)}
      {layers.trucks && state.trucks.map(v => <Fragment key={v.id}>
        {v.position && <Marker position={v.position} icon={truckIcon(v.passengers.length, v.repairTurns)} zIndexOffset={selected?.id === v.id ? 2000 : 500} eventHandlers={{ click: () => onSelect({ kind: 'truck', id: v.id }) }}><Tooltip>{v.id} · {v.used}/{v.capacity} pasajeros · {v.state}{v.repairTurns ? ` · reparación: ${v.repairTurns} turnos` : ''}</Tooltip></Marker>}
        {v.meeting && state.map.nodes.has(v.meeting) && <CircleMarker center={state.map.nodes.get(v.meeting)!} radius={8} pathOptions={{ color: '#c4a0ff', fillOpacity: 0.05, weight: 2, dashArray: '3 3' }}><Tooltip>Encuentro · {v.id}</Tooltip></CircleMarker>}
      </Fragment>)}
      {target && selected && <CircleMarker center={target} radius={24} pathOptions={{ color: '#ffffff', weight: 2, opacity: 0.9, fillColor: '#ffffff', fillOpacity: 0.05, dashArray: '5 5' }} interactive={false}><Tooltip permanent direction="top" offset={[0, -23]} className="selection-tooltip">{selected.id}</Tooltip></CircleMarker>}
    </MapContainer>
    {children}
    <div className="map-topline"><button className="icon-button" aria-label="Centrar mapa" title="Centrar mapa" onClick={() => setFitKey(x => x + 1)}><Crosshair size={18}/></button></div>
    {tileError && <div className="map-bottomline"><span>Fondo no disponible · red vial local</span></div>}
    {state.demo && <div className="map-watermark">DEMOSTRACIÓN</div>}
  </div>;
});
export function LayerControl({ layers, onChange }: { layers: LayersState; onChange: (next: LayersState) => void }) {
  return <details className="layer-control"><summary><Layers size={15}/> Capas <span>{Object.entries(layers).filter(([key, value]) => value && (key !== 'sleepers' || localOperatorControlsEnabled())).length}</span></summary><div>{Object.entries(layerNames).filter(([key]) => key !== 'sleepers' || localOperatorControlsEnabled()).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key as keyof LayersState]} onChange={() => onChange({ ...layers, [key]: !layers[key as keyof LayersState] })}/>{label}</label>)}</div></details>;
}
