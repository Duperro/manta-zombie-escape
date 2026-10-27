import { useEffect, useState } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { VisualState } from '../types/visual';
import { parseConfig } from '../utils/config';

type DebugFrame = { runId: string; ronda: number; turno: number; dormidos: Array<{ id: string; nodo: string }> };
const icon = divIcon({ className: 'entity-icon', html: '<span class="sleeper-pin" aria-hidden="true">z<span>z</span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
const base = parseConfig(import.meta.env).base;
export function SleeperDebugLayer({ state, enabled }: { state: VisualState; enabled: boolean }) {
  const [frame, setFrame] = useState<DebugFrame | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled || state.demo || !state.runId) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    setError(false);
    void fetch(`${base}/control/dormidos`, { method: 'GET', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Debug unavailable');
      const data = await response.json() as DebugFrame;
      if (!data || typeof data.runId !== 'string' || !Number.isInteger(data.ronda) || !Number.isInteger(data.turno) || !Array.isArray(data.dormidos) || data.dormidos.some(z => typeof z.id !== 'string' || typeof z.nodo !== 'string')) throw new Error('Invalid debug response');
      if (active) setFrame(data);
    }).catch(() => { if (active) { setFrame(null); setError(true); } }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, state.demo, state.runId, state.round, state.turn]);
  if (!enabled || state.demo) return null;
  const matches = frame && frame.runId === state.runId && frame.ronda === state.round && frame.turno === state.turn;
  return <>
    <div className="sleeper-debug-badge" role="status">{!state.runId || error ? 'Dormidos: vista de pruebas no disponible' : `PRUEBAS · Dormidos ${matches ? frame.dormidos.length : '…'}`}</div>
    {matches && frame.dormidos.map(z => {
      const position = state.map.nodes.get(z.nodo);
      return position ? <Marker key={z.id} position={position} icon={icon} zIndexOffset={300}><Tooltip>{z.id} · Dormido · solo pruebas</Tooltip></Marker> : null;
    })}
  </>;
}
