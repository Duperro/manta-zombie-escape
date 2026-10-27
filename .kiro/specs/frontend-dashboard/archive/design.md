# ARCHIVO HISTÓRICO DE KIRO

Este borrador se conserva como referencia. No es el contrato vigente; consultar ../design.md, ../requirements.md y ../tasks.md.

# Frontend Dashboard — Diseño técnico (Fase 1)

## Visión general

Un dashboard React Observador de Operaciones de Emergencia donde un mapa Leaflet/OSM centrado en Manta, Ecuador, es el elemento central. El frontend nunca controla la simulación: en modo real es un observador pasivo que hace polling de `GET /estado` cada 1 s y carga una sola vez `GET /mapa` (caché por `mapaVersion`), y representa el estado publicado por el backend; en modo demostración un `MockSimulationProvider` genera un grafo sintético cerca de Manta y avanza turnos de 2 s localmente. Toda la lógica de rescate/ruta pertenece al backend; el frontend solo transforma (`adapter`) y representa.

Hecho de contrato clave: `/estado` (`StateView`) **no** trae `nodos` ni `calles`/`aristas`. El grafo (nodos y aristas con `geometria`) se obtiene del endpoint público `GET /mapa` (`MapView`), que se carga una sola vez y se re-cachea solo si cambia `StateView.mapaVersion`. Las coordenadas de sobrevivientes/zombies se resuelven vía el nodeMap construido desde `/mapa.nodos`; los refugios ya traen `lat`/`lng` propios. El navegador solo llama GETs públicos (`/estado`, `/mapa`, `/health`); `POST /paso` usa `x-api-key` y jamás se invoca desde el frontend.

La pieza central de la arquitectura es el patrón **SimulationProvider**: una abstracción (`SimulationProvider`) con dos implementaciones (`MockSimulationProvider`, `ApiSimulationProvider`) que exponen el mismo `VisualState` al resto de la UI mediante contexto. Esto aísla a los componentes del origen de los datos y permite alternar mock/real sin tocar la UI. Los tipos del backend (alineados a `contracts/openapi.yaml` + `backend/app/models/domain.py`) viven en `src/types/raw.ts`; el modelo visual que consumen los componentes vive en `src/types/visual.ts`; la única función que cruza la frontera es el adaptador en `src/services/adapter.ts`. Ningún componente importa tipos `raw`.

## Stack tecnológico (fijado al aprobarse)

React 18 + TypeScript + Vite, React-Leaflet 4 sobre Leaflet 1.9 (tiles OSM), Lucide React para iconos, Fetch API para HTTP, Vitest 2 + React Testing Library 16 para pruebas. Versiones exactas fijadas en `package.json` (resolución confirmada por el implementador con `npm install` y lockfile comprometido):

- `react` 18.3.1, `react-dom` 18.3.1, `@types/react` 18.3.12, `@types/react-dom` 18.3.1
- `react-leaflet` 4.2.1, `leaflet` 1.9.4, `@types/leaflet` 1.9.14
- `lucide-react` 0.460.0 (si esa revisión no resuelve, usar la estable 0.x más cercana y fijarla en el lockfile)
- `vite` 5.4.10, `@vitejs/plugin-react` 4.3.4, `typescript` 5.6.3
- `vitest` 2.1.8, `@testing-library/react` 16.1.0, `@testing-library/jest-dom` 6.6.3, `jsdom` 25.0.1

CSS modular propio (modo oscuro primario). Sin framework UI pesado. React 18 (no 19) se elige porque React-Leaflet 4 lo soporta de forma probada; cambiar a React 19 requeriría React-Leaflet 5 y se deja fuera de Fase 1.

## Arquitectura y flujo de datos

```
env (VITE_DATA_SOURCE, VITE_API_BASE_URL)
        |
   SimulationProviderContext  (elige implementación: Mock | Api; un único ref)
        |  expone: state: VisualState | null, status: ConnectionStatus,
        |          selectedRound, selectSurvivor(id|null), selection,
        |          controls (start/pause/advance/restart — solo mock), dataSource
        v
   useSimulation()  (hook consumido por la UI)
        |
   Dashboard (layout + selección)
   ├── Header        (turno, ronda, timer, estado de conexión)
   ├── MetricsPanel  (métricas — prefiere StateView.metricas)
   ├── MapView       (Leaflet; 10 capas; coords resueltas desde /mapa)
   ├── DetailsPanel  (entidad seleccionada)
   ├── LegendPanel   (colores/iconos)
   └── SimulationControls (solo mock; en real se ocultan)
```

Flujo de actualización:

1. El provider produce un `VisualState`: el mock lo genera directamente; el api lo adapta de `RawStateView` (`/estado`) **más** un `RawMapView` (`/mapa`) cargado una vez.
2. El gating decide si el nuevo `VisualState` se "publica" al contexto (ver polling): publica solo si hay turno nuevo dentro de la misma ronda, o si cambió la ronda.
3. El contexto dispara un re-render solo cuando se publica un cambio (sin regresión dentro de la ronda).
4. Los componentes leen `useSimulation()` y renderizan memoizados por capa.

`VisualState` es inmutable por turno; cada capa se memoiza con `React.memo`/`useMemo` sobre el slice que consume para evitar re-render de 200 marcadores cuando solo cambió el header.

## Árbol de componentes

```
App
└─ Dashboard                       (layout grid + posee selección y provider)
   ├─ Header                       (nombre, ronda, turno, timer, ConnectionBadge)
   ├─ MetricsPanel                 (lista de métricas; oculta las no disponibles)
   ├─ MapView                      (MapContainer + capas)
   │  ├─ TileLayer                 (OSM)
   │  ├─ StreetsLayer              (aristas → Polyline con geometria; nodos → CircleMarker sutil)
   │  ├─ BlockedStreetsLayer       (aristasBloqueadas + nodosBloqueados, rojo discontinuo)
   │  ├─ ZombieLayers             (por tipo: caminante, corredor, horda+área, dormido)
   │  ├─ SurvivorsLayer            (CircleMarker; el seleccionado resaltado)
   │  ├─ RefugesLayer              (divIcon con icono; popup capacidad_maxima/ocupacion/plazas_reservadas/estado)
   │  ├─ TrucksLayer               (divIcon con icono; popup pasajeros/capacidad/destino)
   │  ├─ RoutesLayer               (Polyline; ruta del sobreviviente seleccionado en negrita)
   │  └─ MapLegend (overlay)       (toggle de capas + explicación)
   ├─ DetailsPanel                 (sobreviviente seleccionado / refugio / camioneta)
   ├─ LegendPanel                  (colores e iconos por tipo)
   └─ SimulationControls           (start/pause/advance/restart; round selector 1/2/3)
```

## Providers: SimulationProvider

Interfaz común (`src/providers/types.ts`):

```ts
interface SimulationProvider {
  readonly dataSource: 'mock' | 'api';
  start(): void;            // inicia el avance de turnos (mock) / el polling (api)
  pause(): void;
  advance(): void;          // avanza un turno (mock) o no-op (real)
  restart(): void;          // reinicia la ronda actual (mock) o no-op (real)
  setRound(roundId: 1 | 2 | 3): void;   // mock; en real es no-op (la ronda la controla el backend)
  subscribe(listener: (s: ProviderSnapshot) => void): () => void;  // devuelve unsubscribe
}

interface ProviderSnapshot {
  state: VisualState | null;
  status: ConnectionStatus;   // 'connecting' | 'connected' | 'disconnected' | 'stale'
  selectedRoundId: 1 | 2 | 3;
  isDemo: boolean;
}
```

`SimulationProviderContext` (en `src/app/SimulationProviderContext.tsx`) elige la implementación según `VITE_DATA_SOURCE`, la instancia una sola vez (ref), gestiona `selectedSurvivorId` y expone todo al árbol vía `useSimulation()`. Instancia un único provider → jamás mezcla mock y real.

**MockSimulationProvider** (`src/providers/MockSimulationProvider.ts`):
- Carga la configuración de rondas desde `frontend/data/scenarios/rondas.json` (frontend-owned; ver "Archivos a crear"). Reproducible: semilla fija por ronda (`SEED = roundId * 1000`). Si el archivo está ausente/incompleto, usa la configuración local de respaldo en `mocks/rounds.ts` (idéntica al brief: R1/R2/R3). **No** toca el `data/` del repo raíz.
- Genera un grafo sintético: una rejilla de ~N nodos con coordenadas cerca del centro de Manta (-0.967, -80.709), conectados por calles bidireccionales (ids `E-<origen>-<destino>-<clave>`); 4 refugios con capacidades 40/50/60/70 y `lat`/`lng` propios; 5 camionetas con capacidad 4.
- Avanza un turno cada `VITE_TURN_MS` (2000 ms) con un único `setInterval`. Cada turno: mueve sobrevivientes hacia su refugio asignado, mueve zombies (caminantes en turnos pares, corredores cada turno, hordas con probabilidad configurable), evalúa evacuación/refugio y, en R3, activa dormidos en su turno de activación (antes de ese turno no se emiten; al despertar un dormido se publica como `caminante`, igual que el backend).
- Expone `state` ya en modelo visual (`VisualState`) — no pasa por el adaptador.
- `isDemo = true` → la UI muestra "Modo demostración".
- Controles start/pause/advance/restart operan sobre el intervalo y el turno interno.

**ApiSimulationProvider** (`src/providers/ApiSimulationProvider.ts`):
- Carga `GET {base}/mapa` **una sola vez** al iniciar; guarda `RawMapView` y su `mapaVersion`. En cada tick, si el `StateView.mapaVersion` recibido difiere del cacheado, re-fetchea `/mapa` (re-cachea). `/mapa` es público (sin `security` en `openapi.yaml`).
- Hace polling de `GET {base}/estado` cada `VITE_POLL_MS` (1000 ms por defecto) con `fetch` + `AbortController`.
- Cada `RawStateView` se pasa a `adapter.adaptState(rawState, mapView, { dataSource, isDemo })` → `VisualState`; el gating decide si se publica.
- Nunca llama a `POST /paso` ni envía `x-api-key` ni cabeceras de autenticación. Solo GETs públicos.
- `isDemo = false`. Controles start/pause/advance/restart se ocultan (no hay endpoint público de control en Fase 1; `/paso` es privado y por-sobreviviente, no avanza el reloj).
- No mezcla datos: si `VITE_DATA_SOURCE=api`, el mock jamás se instancia.
- Conexión: se hace un sondeo único de `GET /health` al inicio para el badge inicial (`connecting`→`connected`/`disconnected`); el estado continuo lo gobierna el éxito/fracaso del fetch a `/estado` (ver "Manejo de errores").

## Tipos centralizados: raw vs visual

`src/types/raw.ts` — alineado 1:1 a `contracts/openapi.yaml` + `backend/app/models/domain.py` (fuente de verdad). Son los tipos de las respuestas del backend. **`/estado`** → `RawStateView` (sin `nodos`/`calles`); **`/mapa`** → `RawMapView` (con `nodos`/`aristas`).

```ts
// GET /estado (StateView) — sin nodos ni calles
export interface RawSurvivor {
  id: string; nodo: string; estado: string;            // estado: 'ACTIVO'|'EVACUADO'|'ELIMINADO' (uppercase)
  nodoActual: string; refugioAsignado: string | null; rutaPlanificada: string[];
  turnosTranscurridos: number; turnoEvacuacion: number | null; causaEliminacion: string | null;
}
export interface RawZombie { id: string; nodo: string; tipo: string; }  // tipo: 'caminante'|'corredor'|'horda'|'dormido' (dormido nunca llega en /estado)
export interface RawShelter {
  id: string; nodo: string; capacidad: number; ocupacion: number;
  nombre: string; lat: number; lng: number;
  capacidad_maxima: number; plazas_reservadas: number; estado: string;  // estado: 'ABIERTO'|...
}
export type RawTruck = Record<string, unknown>;          // contrato: additionalProperties true (llega [] hasta Fase 3)
// Métricas: keys de backend/app/evaluation/metrics.py (latencias nullable)
export interface RawMetrics {
  sobrevivientesIniciales: number; evacuados: number; eliminados: number; activos: number;
  porcentajeSupervivencia: number; tasaEvacuacion: number;
  turnosPromedioEvacuacion: number | null;
  rutasValidas: number; rutasInvalidas: number; solicitudesHTTP: number;
  erroresHTTP: number; respuestasInvalidas: number; solicitudesSobre500ms: number;
  latenciaPromedioMs: number | null; latenciaP50Ms: number | null;
  latenciaP95Ms: number | null; latenciaP99Ms: number | null;
  disponibilidadEndpoint: number | null;
}
export interface RawStateView {
  turno: number; fase: string;           // solo 'publicado' llega por /estado
  ronda: number; estadoSimulacion: string;   // 'EN_CURSO'|'FINALIZADA'
  versionGrafo: number; mapaVersion: string;
  sobrevivientes: RawSurvivor[]; zombies: RawZombie[];
  refugios: RawShelter[]; nodosBloqueados: string[];
  camionetas: RawTruck[];
  aristasBloqueadas: string[];           // lista de ids de aristas (E-...)
  rutas: Record<string, string[]>;      // survivorId -> [nodeId, ...]
  metricas: RawMetrics;
  eventosRecientes: unknown[];          // no se renderiza en Fase 1; se lleva para mantener el tipo 1:1
}

// GET /mapa (MapView) — el grafo base inmutable
export interface RawNode { id: string; lat: number; lng: number; sector?: string | null; }
export interface RawEdge {
  id: string;                             // E-<origenOSM>-<destinoOSM>-<clave>
  origen: string; destino: string;
  distancia_m: number; tipo: string; velocidad_m_s: number;
  bloqueada: boolean; tiempo_estimado_s: number;
  geometria: number[][];                  // [[lng, lat], ...] — ¡orden lng,lat!
  osmids?: string[];
}
export interface RawMapView {
  version: string; atribucion: string;
  nodos: RawNode[]; aristas: RawEdge[];
  sectores: Record<string, unknown>; metadata: Record<string, unknown>;
}

export interface RawHealth { status: string; service: string; }   // GET /health (sondeo inicial)
```

`src/types/visual.ts` — el modelo que consumen los componentes (coordenadas resueltas, enums controlados, campos opcionales para lo pendiente).

```ts
export type ZombieType = 'caminante' | 'corredor' | 'horda' | 'dormido';
export type SurvivorState = 'ACTIVO' | 'EVACUADO' | 'ELIMINADO';   // uppercase, igual que el backend
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'stale';

export interface LatLng { lat: number; lng: number; }
export interface VisualNode { id: string; lat: number; lng: number; }
export interface VisualStreet {
  id: string; fromId: string; toId: string; latlngs: LatLng[];  // geometria ([lng,lat]→{lat,lng}) o [from,to]
  blocked: boolean; tipo: string;
}
export interface VisualZombie { id: string; nodeId: string; lat: number; lng: number; tipo: ZombieType; }
export interface VisualSurvivor {
  id: string; nodeId: string; lat: number; lng: number; estado: SurvivorState;
  refugioAsignado: string | null; rutaPlanificada: string[];
  turnosTranscurridos: number; turnoEvacuacion: number | null; causaEliminacion: string | null;
}
export interface VisualRefuge {
  id: string; nombre: string; lat: number; lng: number;   // lat/lng vienen del backend (ShelterView)
  capacidadMaxima: number; ocupacion: number; plazasReservadas: number; estado: string;
  disponible: number; llena: boolean;                    // disponible = capacidadMaxima - ocupacion - plazasReservadas
}
export interface VisualTruck {                  // esquema provisional (camionetas [] hasta Fase 3)
  id: string; lat?: number; lng?: number; nodeId?: string;
  pasajeros?: number; capacidad?: number; destinoRefugioId?: string; estado?: string;
  routeNodeIds?: string[];
}
export interface VisualRoute { id: string; ownerId: string; kind: 'survivor' | 'truck'; latlngs: LatLng[]; }
export interface VisualMetrics {
  initialSurvivors?: number; alive: number; evacuated: number; eliminated?: number;
  activeZombies: number; availableRefuges: number; activeTrucks: number; p95LatencyMs?: number | null;
}
export interface VisualState {
  turno: number; ronda: number; roundName: string | null;   // roundName = 1→Anochecer, 2→Medianoche, 3→Apocalipsis; null si desconocido
  estadoSimulacion: string;
  nodes: VisualNode[]; streets: VisualStreet[];            // vienen de /mapa
  zombies: VisualZombie[]; survivors: VisualSurvivor[];
  refuges: VisualRefuge[]; trucks: VisualTruck[];
  blockedStreetIds: string[]; blockedNodeIds: string[];    // aristasBloqueadas (ids) ; nodosBloqueados
  routes: VisualRoute[];
  metrics: VisualMetrics;
  dataSource: 'mock' | 'api'; isDemo: boolean;
}
```

Enums y normalización de strings (`src/utils/normalize.ts`): `asZombieType(t)` mapea strings a `ZombieType` (desconocidos → `'caminante'` con warn, nunca lanza); `asSurvivorState(e)` es **case-insensitive** (`.toUpperCase()` antes de mapear `ACTIVO`/`EVACUADO`/`ELIMINADO`, desconocido → `'ACTIVO'` con warn). Esto evita que un string nuevo del backend rompa el render; el comportamiento degradado es seguro y respeta los literales confirmados en `domain.py`.

## Capa adaptadora (`src/services/adapter.ts`)

Funciones puras, testeables sin DOM. El adaptador es la **única** frontera raw→visual. Los componentes solo importan de `src/types/visual`.

- `buildNodeMap(nodos: RawNode[]): Map<string, LatLng>` — lookup `id → {lat,lng}` desde `/mapa.nodos`.
- `buildEdgeMap(aristas: RawEdge[]): Map<string, RawEdge>` — lookup `id → RawEdge` desde `/mapa.aristas`.
- `adaptState(raw: RawStateView, mapView: RawMapView, opts: { dataSource, isDemo }): VisualState`:
  - Construye `nodeMap` desde `mapView.nodos` y `edgeMap` desde `mapView.aristas`.
  - `nodes` = `mapView.nodos.map(...)`; `streets` = `mapView.aristas.map(edge => ...)`:
    - `id = edge.id` (id real del contrato, p. ej. `E-363642664-363642714-0`), `fromId = edge.origen`, `toId = edge.destino`.
    - `latlngs`: si `edge.geometria` es no vacío, `geometria.map(p => ({ lat: p[1], lng: p[0] }))` (¡la geometría viene en orden `[lng, lat]`, se invierte!); si está vacío, `[nodeMap.get(origen), nodeMap.get(destino)]`. Cada arista (incluidas las paralelas) es un registro separado; se respeta su dirección.
    - `blocked` se deriva al final (ver abajo), no de un flag fijo.
  - `zombies` = `raw.zombies.map(...)` resolviendo coords vía `nodeMap.get(nodo)`; los de nodo inexistente se omiten con warn (defensivo). `tipo = asZombieType(...)`. **Los dormidos nunca llegan** en `/estado` (filtrados por el backend), así que la capa dormido queda vacía en real.
  - `survivors` = `raw.sobrevivientes.map(...)` con coords vía `nodeMap.get(nodoActual ?? nodo)`, `estado = asSurvivorState(...)`, y los campos `refugioAsignado`, `rutaPlanificada`, `turnosTranscurridos`, `turnoEvacuacion`, `causaEliminacion` tal cual.
  - `refuges` = `raw.refugios.map(r => ({ id, nombre, lat: r.lat, lng: r.lng, capacidadMaxima: r.capacidad_maxima, ocupacion: r.ocupacion, plazasReservadas: r.plazas_reservadas, estado: r.estado, disponible: r.capacidad_maxima - r.ocupacion - r.plazas_reservadas, llena: r.capacidad_maxima - r.plazas_reservadas <= r.ocupacion }))`. **Usa `lat`/`lng` del refugio directamente** (no requiere nodeMap). Si `ocupacion + plazasReservadas > capacidad_maxima`, se captea a `capacidad_maxima` y se loguea (defensivo).
  - `trucks` = `raw.camionetas.map(normalizeTruck)`. `normalizeTruck(raw)` lee claves esperadas de forma defensiva (`id`, `nodo`/`lat`+`lng`, `pasajeros`, `capacidad`, `destino`, `estado`, `ruta`) y deja `undefined` lo ausente. Como el contrato es `additionalProperties: true` y llega `[]` hasta Fase 3, esto es best-effort; el UI oculta campos ausentes. Coords: si trae `lat`+`lng` directos úsalos; si trae `nodo`, resuélvelos vía nodeMap.
  - `blockedStreetIds = raw.aristasBloqueadas` **directamente** (es la lista de ids de aristas bloqueadas que provee el backend; campo requerido de `StateView`). `blockedNodeIds = raw.nodosBloqueados`. Para `streets`, marca `blocked = blockedStreetIds.includes(edge.id)`.
  - `routes`: a partir de `raw.rutas` (clave = survivorId → `[nodeId, ...]`). Para cada entrada, resuelve los nodeIds a latlngs vía nodeMap (omitiendo los inexistentes) y crea `VisualRoute { id: ownerId, ownerId, kind: 'survivor', latlngs }`. Solo se incluyen rutas cuyos nodos resuelvan ≥2 puntos.
  - `metrics`: **prefiere `raw.metricas`** (ya computado por el backend) cuando está presente:
    - `initialSurvivors = metricas.sobrevivientesIniciales`, `alive = metricas.activos`, `evacuated = metricas.evacuados`, `eliminated = metricas.eliminados`, `p95LatencyMs = metricas.latenciaP95Ms` (nullable → se muestra solo si no es null).
    - `activeZombies = raw.zombies.length` (no hay métrica de zombies; es derivable fielmente).
    - `availableRefuges = refuges.filter(r => r.disponible > 0 && r.estado !== 'CERRADO').length`.
    - `activeTrucks = raw.camionetas.length` (0 hasta Fase 3).
    - Solo si `metricas` estuviera ausente (defensivo), cae a derivación: `alive = sobrevivientes.filter(s => s.estado === 'ACTIVO').length`, `evacuated = filter(estado === 'EVACUADO')`, `eliminated = filter(estado === 'ELIMINADO')`.
    - El `MetricsPanel` oculta cualquier métrica `undefined`/`null` (no inventa).
  - `ronda` = `raw.ronda`; `roundName` = map `1→'Anochecer'`, `2→'Medianoche'`, `3→'Apocalipsis'`, otro → `null` (badge "ronda desconocida").
- `shouldCommit(prev: VisualState | null, next: VisualState): boolean` — gating (ver abajo).

## Estrategia de polling (ApiSimulationProvider)

- Un único `setInterval(POLL_MS=1000)` arrancado en `start()`. Cada tick lanza `fetch(\`${base}/estado\`, { signal })` con un `AbortController` nuevo por tick. `/mapa` se carga una sola vez antes del primer tick (y se re-cachea si cambia `mapaVersion`).
- Cadencia: **1 s por el brief**; `docs/integracion.md` menciona 2 s como recomendación suave. `VITE_POLL_MS` por defecto 1000; subir a 2000 si el backend señala carga.
- **Gating de publicación** (`shouldCommit`), basado en `(ronda, turno)` (no hay campo genérico de versión en `StateView`; `mapaVersion`/`versionGrafo` son del grafo, no del turno):
  - Publicar si `next.ronda !== lastRonda` (cambio de ronda: el turno vuelve a 0 al reiniciar) **O** (`next.ronda === lastRonda` Y `next.turno > lastTurno`).
  - **Sin regresión dentro de la ronda**: si `next.ronda === lastRonda` y `next.turno <= lastTurno` (respuesta tardía/desordenada) → descartar, sin tocar el estado.
  - `fase`: `/estado` solo sirve `fase='publicado'` (el coordinador refresca `published_state` tras `phase='publicado'`; la fase `decision` es interna y nunca llega por el endpoint). Se mantiene un *fallback defensivo*: si `fase` estuviera ausente, se publica igual con la regla de `(ronda, turno)`. No se depende de recibir `fase='decision'` (nunca llega).
  - Resultado: a lo sumo un render por turno nuevo dentro de la ronda; las repeticiones del mismo turno no re-renderizan.
- `lastRonda`/`lastTurno` se inicializan en `null`/`-1` (el primer estado publicado se publica).
- **En vuelo / desmontaje**: el `AbortController` del tick se aborta en `stop()`/unmount; el `setInterval` se limpia. Un tick no lanza el siguiente si el anterior sigue pendiente (bandera `inFlight`); si lo está, salta ese tick (evita acumular solicitudes concurrentes). Al desmontar, `clearInterval` + `abort()` de cualquier controller activo. El fetch de `/mapa` usa su propio `AbortController`, cancelable al desmontar.
- **Estados de conexión**:
  - `fetch /estado` lanza (red) o respuesta no-2xx → `status='disconnected'`, se conserva el último `VisualState` publicado. El polling continúa a 1 s (reconexión automática; sin backoff agresivo en Fase 1). Al primer éxito → `status='connected'`. `/health` se sondan una vez al inicio para el badge inicial.
  - **Stale**: si `Date.now() - lastCommitAt > STALE_MS` (default 4000 = 2× turno) → `status='stale'` (mantiene el último estado y muestra el indicador). Al publicar un turno nuevo → `connected` y se resetea el timer de stale.
  - **Error de `/mapa`**: si falla al cargar, `status='disconnected'` y el polling de `/estado` continúa; sin grafo, el adaptador no resuelve coords y `zombies`/`survivors` quedan vacíos (defensivo) hasta que `/mapa` cargue. No corrompe el estado. Se reintenta la carga de `/mapa` en el siguiente tick exitoso de `/estado` si `mapaVersion` difiere.
- El frontend **no** controla el reloj ni avanza turnos; solo observa. No ralentiza al simulador: una sola petición cada 1 s, sin reintentos por turno.

## Las 10 capas del mapa (toggleables, explicadas en leyenda)

1. **Calles/nodos** — `Polyline` por cada `VisualStreet` con su `geometria` real (slate); `CircleMarker` sutil por nodo (toggle separado, off por defecto para no saturar).
2. **Caminantes** — `CircleMarker` gris por `VisualZombie` con `tipo==='caminante'`.
3. **Corredores** — `CircleMarker` rojo por `tipo==='corredor'`.
4. **Hordas + áreas bloqueadas** — `CircleMarker` granate por `tipo==='horda'` + área bloqueada. En **real**, el área bloqueada = `blockedNodeIds` (`nodosBloqueados` = nodo de la horda + vecinos), dibujados como marcadores/relleno semitransparente; un polígono/radio explícito es **solo mock** (sintético). En real no hay geometría de área en `ZombieView`, solo el conjunto de nodos bloqueados.
5. **Dormidos** — solo tras activación. En mock se emiten con `tipo==='dormido'` a partir de su turno de activación (morado); antes de ese turno no existen en el array. En **real** el backend nunca publica dormidos (`world.py` filtra `kind!=="dormido"`; un dormido despierto se publica como `caminante`), así que la capa dormido (morado) **siempre queda vacía** en real — no se sintetiza nada. (El morado es efectivamente solo mock.)
6. **Sobrevivientes** — `CircleMarker` cian; el seleccionado se agranda/amber.
7. **Cuatro refugios** — `divIcon` con icono Lucide; popup con `nombre`, `capacidad_maxima`, `ocupacion`, `plazas_reservadas`, `disponible`, `estado` (todos provistos por `ShelterView`).
8. **Cinco camionetas** — `divIcon` con icono; popup con pasajeros/capacidad/destino (campos opcionales; `camionetas` llega `[]` hasta Fase 3 → capa vacía en real, poblada en mock).
9. **Calles bloqueadas** — `Polyline` roja discontinua para las `VisualStreet` con `blocked===true` (cuyos `id` están en `blockedStreetIds` = `aristasBloqueadas`) + marcadores para `blockedNodeIds`.
10. **Rutas planificadas** — `Polyline` amarilla; la ruta del sobreviviente seleccionado se dibuja en negrita amber sobre el resto. En real, las rutas provienen de `StateView.rutas` (clave = survivorId).

Toggle de capas: estado local `Record<LayerId, boolean>` en `MapView`; los legend items lo controlan. Por defecto: calles, sobrevivientes, refugios, camionetas, bloqueadas activas; zombies activos según tipo; rutas activas solo si hay selección o datos.

## Sistema de color e iconos (modo oscuro)

Fondo `#0b0f1a`; paneles `#111827` con borde `#1f2937`; texto `#e5e7eb`.

| Entidad | Color | Icono Lucide |
|---|---|---|
| Caminante | `#9ca3af` (gris) | `Footprints` |
| Corredor | `#ef4444` (rojo) | `Zap` |
| Horda | `#b91c1c` (granate) + área `#7f1d1d33` | `Skull` |
| Dormido (despierto, solo mock) | `#a855f7` (morado) | `Moon` |
| Sobreviviente | `#22d3ee` (cian); seleccionado `#fbbf24` (amber) | `User` |
| Refugio | `#22c55e` (verde); lleno `#f59e0b` | `Shield`/`Home` |
| Camioneta | `#f97316` (naranja) | `Truck` |
| Calle | `#475569` (slate) | — |
| Calle bloqueada | `#ef4444` discontinua | `Ban` |
| Ruta planificada | `#eab308` (amarillo); seleccionada `#fbbf24` negrita | `Route` |

Marcadores densos (zombies/sobrevivientes, hasta 200) usan `CircleMarker` (SVG, ligero). Refugios y camionetas (≤9) usan `divIcon` con Lucide. Las animaciones se limitan a transiciones CSS suaves en popups/badges; el mapa no anima marcadores por performance.

## Variables de entorno

`frontend/.env.example`:

```
# Origen de datos: 'mock' (por defecto) o 'api'
VITE_DATA_SOURCE=mock
# Base URL del backend (solo modo api). Vacío = mismo origen (proxy de Vite).
VITE_API_BASE_URL=http://localhost:8000
# Ajustes opcionales (con defaults seguros)
VITE_TURN_MS=2000
VITE_POLL_MS=1000
VITE_STALE_MS=4000
```

- `VITE_DATA_SOURCE` distingue `'mock'` | `'api'` (cualquier otro valor → `'mock'`). Sin secretos: jamás `VITE_API_KEY` ni similares. `POST /paso` (API key privada) no se invoca ni referencia.
- `VITE_API_BASE_URL` es la base para `/estado` y `/mapa`. Como **aún no hay CORS** (`docs/pendientes.md`: "CORS permitido por origen" es integración posterior; `docs/integracion.md` recomienda el proxy de desarrollo de React), en desarrollo local se prefiere el **proxy de Vite** (en `vite.config.ts` se redirige `/health`, `/mapa`, `/estado` al target del backend, p. ej. `http://localhost:8000`) y se deja `VITE_API_BASE_URL` vacío para usar mismo origen. En un despliegue con CORS configurado, se usa `VITE_API_BASE_URL` apuntando directo al backend.
- Las vars se validan en `src/utils/env.ts` con defaults y tipos; un valor inválido cae al default y emite un warning en consola (no lanza).

## Altura del contenedor del mapa (requisito explícito)

`MapView` envuelve `MapContainer` en un `.map-shell` con altura explícita vía CSS:

```css
.dashboard { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.dashboard__main { display: grid; grid-template-columns: 1fr 340px; min-height: 0; }
.map-shell { height: 100%; min-height: 320px; }   /* el 1fr del grid le da altura real */
.leaflet-container { height: 100%; width: 100%; }
```

El `1fr` del grid garantiza una altura calculada > 0 distinta de auto; `min-height: 320px` es red de seguridad para tablet/móvil. La prueba `AC8` verifica `getComputedStyle(.map-shell).height` > 0 (jsdom devuelve el valor del estilo; el layout real se verifica manualmente en navegador).

## Manejo de errores (por operación)

- **fetch /estado (cada tick)**: falla de red o no-2xx → recuperable; `status='disconnected'`, conserva último `VisualState`, sigue el polling. Log warn (no error ruidoso). Sin reintentos inmediatos (el siguiente tick reintenta naturalmente).
- **fetch /mapa (una vez / re-cache)**: falla de red o no-2xx → recuperable; `status='disconnected'`, el polling de `/estado` continúa; sin grafo, zombies/sobrevivientes quedan vacíos hasta que cargue. Log warn. Se reintenta la carga en el siguiente tick exitoso si `mapaVersion` difiere.
- **Respuesta 200 pero JSON inválido**: recuperable; se descarta el tick, `status='disconnected'`, log warn. No corrompe el estado actual.
- **adaptState: nodo inexistente para una entidad**: recuperable; se omite esa entidad, log warn, se conservan las demás. No fatal.
- **Campo con tipo inesperado (enum desconocido)**: recuperable; `asZombieType`/`asSurvivorState` degradan a un valor seguro, log warn. No fatal.
- **Env var inválida**: recuperable; cae al default, log warn. No fatal.
- **Desmontaje del provider**: cancela el `setInterval` y aborta los `AbortController` en vuelo (`/estado` y `/mapa`). No hay leaks.
- No hay errores "fatales" que tiren la app: cualquier fallo del backend degrada a "desconectado" manteniendo el último estado y la UI viva. El único fallo que impediría render es un error de código del propio componente, capturado por un ErrorBoundary en `App` que muestra un mensaje de recuperación.

## Validación de entradas externas

- `RawStateView` desde `/estado`: se asume el shape del contrato. Antes de adaptar, `assertRawState(raw)` valida presencia de `turno` (number ≥ 0), `ronda` (number), `aristasBloqueadas` (array), `sobrevivientes`/`zombies`/`refugios` (arrays); **no** busca `nodos`/`calles` (no existen en `StateView`). Si falta algo crítico se descarta el tick como "desconectado" (no lanza). Validación defensiva, no compilación estricta de tipos en runtime.
- `RawMapView` desde `/mapa`: `assertMapView(raw)` valida `nodos` y `aristas` como arrays no vacíos; si no, se descarta y reintenta.
- `nodo` referenciado por entidades: se resuelve vía `nodeMap` (desde `/mapa.nodos`); inexistente → omite la entidad. Los refugios usan su propio `lat`/`lng` (no necesitan nodeMap).
- `capacidad_maxima`/`ocupacion`/`plazas_reservadas` de refugios: enteros; si `ocupacion + plazas_reservadas > capacidad_maxima` se captea a `capacidad_maxima` (defensivo) y se loguea.
- `geometria`: cada punto es `[lng, lat]`; el adaptador siempre invierte a `{lat, lng}`. Si un punto no tiene exactamente 2 elementos, se omite ese punto (defensivo).
- Env vars: validadas en `env.ts` (rangos y tipos) con defaults.
- Invariante "sin dormidos antes de activación": la posee el **MockSimulationProvider** (no los emite hasta su turno de activación; un dormido despierto pasa a `caminante`). En real, el backend filtra los dormidos de `/estado`; el frontend no añade dormidos. Capa de presentación no es responsable de filtrarlos (no llegan).
- Invariante "sin mezclar mock y real": la posee `SimulationProviderContext` (instancia un único provider según `VITE_DATA_SOURCE`).
- Invariante "sin retroceso de turno dentro de la ronda": la posee `shouldCommit` (regla `(ronda, turno)`).

## Testabilidad

- **Unit (sin DOM)**: `adapter.ts` (`buildNodeMap`, `buildEdgeMap`, `adaptState` con `raw`+`mapView`, swap de `geometria`, `blockedStreetIds` desde `aristasBloqueadas`, refugios con `lat`/`lng`, `rutas` → `VisualRoute`, métricas desde `metricas`, omisión de nodos inexistentes), `normalize.ts` (enums case-insensitive), `env.ts`, `rounds.ts` (config de rondas y fallback), `shouldCommit` (gating: nuevo turno en misma ronda publica; mismo turno no; turno menor se descarta; cambio de ronda publica aunque el turno vuelva a 0).
- **Hook/provider (fake timers + fetch mockeado)**: `MockSimulationProvider` avanza turno cada 2000 ms y al `advance()`; `ApiSimulationProvider` hace un fetch por tick a `/estado` + un fetch único a `/mapa`, publica solo con gating, no regresa el turno, re-cachea `/mapa` si cambia `mapaVersion`, limpia el intervalo y aborta al desmontar (assert un solo `setInterval` activo), marca `disconnected` ante rechazo de fetch y `stale` tras `STALE_MS`.
- **Componentes (RTL)**: `Header` muestra nombre/turno/ronda; `MetricsPanel` oculta métricas `undefined`/`null` y muestra las provistas por `metricas`; `DetailsPanel` muestra datos del sobreviviente seleccionado (`refugioAsignado`, `estado`, `rutaPlanificada`); `SimulationControls` solo aparece en mock.
- **MapView en jsdom**: Leaflet no inicializa tiles en jsdom de forma fiable. Estrategia: mockear `react-leaflet` (`MapContainer` → div con `data-testid="map"` que renderiza sus hijos; `CircleMarker`/`Polyline`/`TileLayer` → stubs que exponen el dato que recibieron). Así se aserta altura del contenedor, número de marcadores por tipo, dormidos=0 antes de activación, 200 sobrevivientes sin throw. La renderización real de tiles/marcadores se verifica **manualmente** en navegador (documentado en el README de cada paso).
- **Build/seguridad**: `npm run build` sin errores; test que grep `dist/` no contenga la literal `API_KEY`/`x-api-key` ni valores de `.env` (AC3).

## Archivos a crear (estructura del brief)

```
frontend/
  index.html
  package.json
  vite.config.ts          # incluye proxy de desarrollo: /health, /mapa, /estado → target backend
  tsconfig.json
  tsconfig.node.json
  .env.example
  .gitignore
  README.md
  data/
    scenarios/
      rondas.json          # frontend-owned: config de rondas R1/R2/R3 (el data/ del repo raíz no se toca)
  src/
    main.tsx
    app/
      SimulationProviderContext.tsx
      useSimulation.ts
      ErrorBoundary.tsx
    components/
      Dashboard.tsx
      dashboard/{Header, MetricsPanel, DetailsPanel, LegendPanel, SimulationControls, ConnectionBadge}.tsx
      map/{MapView, StreetsLayer, BlockedStreetsLayer, ZombieLayers, SurvivorsLayer, RefugesLayer, TrucksLayer, RoutesLayer, MapLegend, mapIcons.ts}.tsx
    providers/{MockSimulationProvider, ApiSimulationProvider}.ts
    providers/types.ts
    services/{adapter.ts, httpClient.ts}   # httpClient expone fetchEstado, fetchMapa, fetchHealth
    types/{raw.ts, visual.ts, layers.ts}
    hooks/{useInterval, useSelection}.ts
    utils/{env, normalize, rounds, geometry, colors}.ts   # geometry.ts: swap [lng,lat]→{lat,lng}
    styles/{index.css, theme.css, dashboard.css, map.css}
    mocks/{graphGenerator.ts}                              # roundData.ts unificado en utils/rounds.ts
  public/
  tests/{adapter.test.ts, shouldCommit.test.ts, mockProvider.test.ts, apiProvider.test.ts, App.test.tsx, MapView.test.tsx, metrics.test.tsx, security.test.ts}
```

Notas de estructura: `frontend/data/scenarios/rondas.json` es **propiedad del frontend** (no es el `data/` del repo raíz, que es un índice de Fase 2 y no se modifica). `utils/rounds.ts` contiene la config de respaldo y la carga del JSON; `mocks/graphGenerator.ts` genera el grafo sintético. `services/httpClient.ts` centraliza los tres GETs públicos y los `AbortController`.

## Campos pendientes de confirmar con el backend (Codex)

Solo lo **genuinamente pendiente** (lo demás está confirmado por `openapi.yaml`/`domain.py`/ejemplos). El `MetricsPanel`/capas ocultan lo ausente en modo real.

1. **Esquema de `camionetas`** — el contrato las deja como `additionalProperties: true` (sin esquema) y `/estado` las envía como `[]` hasta Fase 3 (`docs/pendientes.md`). Pendiente el esquema completo: `id`, posición (`nodo` o `lat`/`lng`), `pasajeros`, `capacidad`, `destinoRefugioId`, `estado`, `ruta`. `normalizeTruck` es best-effort; la capa existe y se puebla en mock.
2. **Geometría de área de horda (polígono/radio explícito)** — `ZombieView` solo tiene `{id, nodo, tipo}`. En real, el área bloqueada se representa con `nodosBloqueados` (nodo de la horda + vecinos); un polígono/radio explícito es **solo mock** (sintético). Pendiente: ¿quiere el backend añadir geometría de área, o se acepta la representación por `nodosBloqueados`?
3. **CORS** — no habilitado aún (`docs/integracion.md`/`pendientes.md`: "CORS permitido por origen" es integración posterior). Mientras tanto, el frontend usa el proxy de desarrollo de Vite. Pendiente: confirmar el origen permitido cuando se habilite.
4. **Endpoint público de control de simulación** — no existe; `POST /paso` es privado (API key) y por-sobreviviente (no avanza el reloj). Los controles start/pause/advance/restart se ocultan en real hasta que exista un endpoint público equivalente.
5. **Temporizador de ronda / tiempo transcurrido** — no está en `/estado`. El frontend calcula localmente `(turno × TURN_MS)` y `((150 - turno) × TURN_MS)` en mock; en real es solo una estimación local (el turno real viene de `/estado`, pero el "reloj de pared" del backend no se expone). Pendiente: ¿expondrá el backend un timestamp o tiempo transcurrido por ronda?
6. **Campo genérico de versión de estado** — no hay; el gating usa `(ronda, turno)`. `mapaVersion`/`versionGrafo` son versiones del grafo/mapa (caché de `/mapa`), no del turno. Si el backend añade un `version`/`etag` de estado, extender `shouldCommit`.

## Notas de mapeo contrato ↔ brief

- "aristasBloqueadas" (brief) = `StateView.aristasBloqueadas` (lista de ids de aristas, **campo requerido presente**). Se emparejan contra `MapView.aristas[].id`. Confirmado, no pendiente.
- "zombies visibles con id, tipo, nodo" (brief) = `zombies[]` (`ZombieView`). Los dormidos no aparecen (filtrados). Confirmado.
- "current round" (brief) = `StateView.ronda` (`1`/`2`/`3`); se mapea a Anochecer/Medianoche/Apocalipsis. Confirmado.
- "new state version" (brief) = sin campo versión; el gating usa `(ronda, turno)`. Confirmado.
- "p95 latency" (brief) = `metricas.latenciaP95Ms` (nullable; se muestra solo si llega). Confirmado.
- "capacidad / ocupación / reservadas / disponibilidad" (brief) = `ShelterView.capacidad_maxima`/`ocupacion`/`plazas_reservadas`/`estado`. Confirmado, todos presentes.
- "refugio asignado / estado de rescate / ruta y destino" (brief, DetailsPanel) = `SurvivorView.refugioAsignado`/`estado` (`ACTIVO`/`EVACUADO`/`ELIMINADO`)/`rutaPlanificada`/`turnoEvacuacion`/`causaEliminacion`. Confirmado.
- "rutas planificadas" (brief) = `StateView.rutas` (clave = survivorId → `[nodeId, ...]`). Confirmado.
- `geometria` = orden `[lng, lat]`; el adaptador invierte a `{lat, lng}`. Confirmado por `docs/mapa.example.json`.

## Respuestas a hallazgos del review (design-review.md)

- **HIGH-1 (`nodos`/`calles` venían de `/estado`)**: Resuelto. `raw.ts` se dividió en `RawStateView` (sin `nodos`/`calles`) + `RawMapView` (con `nodos`/`aristas`). `ApiSimulationProvider` carga `GET /mapa` una vez y re-cachea por `mapaVersion`. `adaptState(raw, mapView, opts)` resuelve coords desde `mapView.nodos`; `VisualState.nodes`/`streets` provienen de `mapView`. AC5 actualizado para reflejar `/estado` + `/mapa`.
- **HIGH-2 (`aristasBloqueadas` "ausente")**: Resuelto. `blockedStreetIds = raw.aristasBloqueadas` directo (campo requerido de `StateView`). Se emparejan contra `MapView.aristas` por `EdgeView.id`; `VisualStreet.id = edge.id` (no se inventa `origen->destino`). Eliminada la afirmación falsa de que el contrato no tenía el campo.
- **HIGH-3 (`raw.ts` no era 1:1; campos marcados pendientes ya existen)**: Resuelto. `raw.ts` reescrito para reflejar `StateView`/`SurvivorView`/`ShelterView`/`EdgeView`/`MapView`/`NodeView` con sus campos requeridos (`ronda`, `rutas`, `metricas`, `refugioAsignado`, `rutaPlanificada`, `turnoEvacuacion`, `causaEliminacion`, `capacidad_maxima`, `plazas_reservadas`, `nombre`, `lat`, `lng`, `estado`, `estadoSimulacion`, `versionGrafo`, `mapaVersion`, `eventosRecientes`, `geometria`, `tiempo_estimado_s`, `osmids`). El adaptador consume `metricas`/`rutas`/`ronda`/`plazas_reservadas`/`refugioAsignado`. La lista "Campos pendientes" se redujo a 6 ítems genuinamente pendientes.
- **HIGH-4 (enum de `estado` en minúsculas/`rescatado`)**: Resuelto. `SurvivorState = 'ACTIVO' | 'EVACUADO' | 'ELIMINADO'` (uppercase). `asSurvivorState` es case-insensitive con degradado seguro a `'ACTIVO'`. El panel de métricas **prefiere `metricas`** (`activos`/`evacuados`/`eliminados`/`sobrevivientesIniciales`) en vez de re-derivar. Ítem 2 actualizado a "confirmado".
- **MEDIUM-1 (ignora `geometria` y `lat`/`lng` de refugios)**: Resuelto. `VisualStreet.latlngs` usa `geometria` (invertida de `[lng,lat]`→`{lat,lng}`) cuando no está vacía; si no, `[from,to]`. `VisualRefuge` usa `ShelterView.lat`/`lng` directamente (sin nodeMap).
- **MEDIUM-2 (`rondas.json` sin anclar)**: Resuelto. Anclado a `frontend/data/scenarios/rondas.json` (frontend-owned), añadido al árbol de "Archivos a crear", con fallback en `utils/rounds.ts`. El `data/` del repo raíz no se toca.
- **NIT-1 (dormido es efectivamente solo mock)**: Resuelto. Añadida la aclaración: en real un dormido despierto se publica como `caminante`, así que el marcador morado solo aparece en mock; la capa dormido en real siempre queda vacía.
- **NIT-2 (polling 1 s vs 2 s)**: Resuelto. Notado: 1 s por el brief; `integracion.md` menciona 2 s como recomendación suave; `VITE_POLL_MS` por defecto 1000, subir a 2000 si el backend señala carga.
- **NIT-3 (`fase='decision'` nunca llega por `/estado`)**: Resuelto. Notado que `/estado` solo sirve `fase='publicado'`; se mantiene el fallback defensivo (publicar con `(ronda,turno)` si `fase` falta) y el no-regreso, pero se quitó la implicación de que `decision` llega por el endpoint.
- **NIT-4 (`RawHealth` sin usar)**: Resuelto. Se elige usar `/health` una vez al inicio como sondeo de conexión para el badge inicial; el estado continuo lo gobierna `/estado`. `RawHealth` queda documentado y usado.
- **NIT-5 (`eventosRecientes` sin modelar)**: Resuelto. Añadido `eventosRecientes: unknown[]` a `RawStateView` con nota "no se renderiza en Fase 1; se lleva para mantener el tipo 1:1".
- **NIT-6 (`tipo` de zombie "asumido")**: Resuelto. Ítem actualizado a "confirmado: `caminante`/`corredor`/`horda`/`dormido` (minúsculas, `domain.py` Literal)", conservando el degradado seguro para compatibilidad futura.
