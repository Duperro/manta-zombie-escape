// Datos reales opcionales de Manta (edificios y costa de OpenStreetMap).
// Se generan con backend/scripts/fetch_manta_city.py -> frontend/public/manta/ciudad.json.
// Si el archivo no existe, la vista 3D usa edificios procedurales y una costa aproximada.
import type { RealCity } from './city';

let cache: Promise<RealCity | null> | null = null;

export function loadCityData(): Promise<RealCity | null> {
  cache ??= fetch('/manta/ciudad.json', { cache: 'force-cache' })
    .then(response => (response.ok && response.headers.get('content-type')?.includes('json') ? response.json() : null))
    .then(data => (data && Array.isArray(data.buildings) ? (data as RealCity) : null))
    .catch(() => null);
  return cache;
}
