# ARCHIVO HISTÓRICO DE KIRO

Este borrador se conserva como referencia. No es el contrato vigente; consultar ../design.md, ../requirements.md y ../tasks.md.

# Frontend Dashboard — Tareas Fase 1 (orden estricto)

Tareas en el orden del brief. Cada una termina con `npm run build` (y `npm test` cuando aplique) desde `frontend/`; corregir errores antes de cerrar el paso. Comportamiento visual no assertible por unidad se documenta como verificado manual en el README del paso.

Verificación por paso: `npm run build` sin errores. Donde hay pruebas, `npm test` en verde. Lo visual que no se pueda asertar se documenta como chequeo manual.

- [ ] T1 — Crear proyecto React + TS + Vite en `frontend/` con la estructura de carpetas del design.md y las dependencias fijadas (versiones exactas).
  Aceptación: `npm run dev` arranca y `npm run build` compila sin errores desde `frontend/`.

- [ ] T2 — Configurar dependencias y estructura modular: `tsconfig.json`, `vite.config.ts` (con proxy de desarrollo para `/health`, `/mapa`, `/estado` → target del backend), alias de ruta `@/`, import del CSS de Leaflet, `.env.example` y validación de env en `src/utils/env.ts`.
  Aceptación: `import 'leaflet/dist/leaflet.css'` está presente; `vite.config.ts` declara el proxy público; `env.ts` devuelve defaults seguros para vars inválidas; `npm run build` pasa.

- [ ] T3 — Construir el layout del dashboard (grid oscuro: header + main 1fr/340px + paneles) con CSS modular y el contexto `SimulationProviderContext` + hook `useSimulation`.
  Aceptación: el layout renderiza header, área de mapa, panel lateral y leyenda; `.map-shell` tiene `min-height` explícito; `npm run build` pasa.

- [ ] T4 — Integrar el mapa de Manta con Leaflet (OSM): `MapView` con `MapContainer` centrado en Manta (-0.967, -80.709), `TileLayer` OSM y altura explícita del contenedor.
  Aceptación: el contenedor del mapa tiene `getComputedStyle().height` > 0; `npm run build` pasa; verificación manual de tiles en navegador documentada.

- [ ] T5 — Añadir marcadores de zombies y sobrevivientes (`ZombieLayers`, `SurvivorsLayer`) con `CircleMarker` por tipo y color del design.md.
  Aceptación: con datos mock fijos, el número de marcadores por tipo coincide con el esperado (test con `react-leaflet` mockeado); `npm run build` pasa.

- [ ] T6 — Mostrar cuatro refugios y cinco camionetas (`RefugesLayer`, `TrucksLayer`) con `divIcon`+Lucide y popups de capacidad/ocupación/pasajeros/destino.
  Aceptación: se renderizan 4 marcadores de refugio y 5 de camioneta con sus popups; `npm run build` pasa.

- [ ] T7 — Crear el `MetricsPanel` consumiendo `StateView.metricas` (`sobrevivientesIniciales`, `activos`, `evacuados`, `eliminados`, `latenciaP95Ms`) y derivando `activeZombies`/`availableRefuges`/`activeTrucks`; oculta cualquier métrica `undefined`/`null` (no inventa en modo real; `activeTrucks` se oculta hasta Fase 3).
  Aceptación: con un `VisualState` real con `metricas`, se muestran las métricas provistas y se ocultan las ausentes; con `metricas` ausente cae a derivación defensiva; `npm run build` pasa.

- [ ] T8 — Implementar `MockSimulationProvider`: grafo sintético cerca de Manta, rondas 1/2/3 desde `frontend/data/scenarios/rondas.json` (con fallback en `utils/rounds.ts`; no tocar el `data/` del repo raíz), semillas reproducibles, 4 refugios (40/50/60/70) con `lat`/`lng` propios, 5 camionetas (cap 4), aristas con `geometria` `[lng,lat]`, dormidos solo tras activación (un dormido despierto pasa a `caminante`), etiqueta "Modo demostración".
  Aceptación: genera `VisualState` consistente con la ronda seleccionada; los dormidos no aparecen antes de su turno de activación y al despertar se publican como `caminante`; `npm run build` pasa.

- [ ] T9 — Simular el cambio visual de turno cada 2 s: un único `setInterval(TURN_MS)` que avanza el turno y publica el nuevo `VisualState`; controles start/pause/advance/restart y selector de ronda.
  Aceptación: con fake timers, al avanzar 2000 ms el `turno` incrementa exactamente en 1 y la UI lo refleja; no se crean intervalos duplicados; `npm run build` pasa.

- [ ] T10 — Implementar `ApiSimulationProvider`: carga `GET /mapa` una vez (re-cachea por `mapaVersion`) + polling de `GET /estado` cada 1 s con `fetch`+`AbortController`, adaptador `adaptState(rawState, mapView, opts)` raw→visual (coords desde `/mapa.nodos`, refugios con su `lat`/`lng`, `geometria` invertida de `[lng,lat]`), sin `POST /paso`, sin API keys, `isDemo=false`, controles ocultos.
  Aceptación: con `VITE_DATA_SOURCE=api` y fetch mockeado (`/mapa` + `/estado`), publica `VisualState` adaptado con coordenadas resueltas; al desmontar aborta los controllers y limpia el intervalo; `npm run build` pasa.

- [ ] T11 — Crear el polling a `GET /estado` cada segundo con gating `shouldCommit` por `(ronda, turno)`: publica si cambia la ronda o si `turno` mayor al último dentro de la misma ronda; descarta `turno` menor o igual en la misma ronda (sin regresión); nota que `/estado` solo sirve `fase='publicado'` (fallback defensivo si `fase` falta). Bandera `inFlight`, indicadores `disconnected` y `stale` (tras `STALE_MS`), sondeo inicial de `/health`.
  Aceptación: un turno mayor en la misma ronda publica; uno igual no re-renderiza; uno menor se descarta; un cambio de ronda publica aunque el turno vuelva a 0; fetch fallido → `disconnected`; sin commits > `STALE_MS` → `stale`; `npm run build` pasa.

- [ ] T12 — Preparar selección y visualización de rutas: al seleccionar un sobreviviente se resalta su ruta (`RoutesLayer`) desde `StateView.rutas` (clave = survivorId) y `SurvivorView.rutaPlanificada`; `DetailsPanel` muestra `estado` (`ACTIVO`/`EVACUADO`/`ELIMINADO`), `refugioAsignado`, `turnoEvacuacion`, `causaEliminacion`, `rutaPlanificada`.
  Aceptación: con un `VisualState` que trae ruta para el sobreviviente, seleccionarlo dibuja su `Polyline` resaltada y llena el `DetailsPanel`; en real sin ruta la capa queda vacía sin error; `npm run build` pasa.

- [ ] T13 — Añadir estados de carga, error y desconexión (`ConnectionBadge`, `ErrorBoundary`): indicadores de "backend desconectado" y "estado desactualizado", y skeleton inicial.
  Aceptación: con `VITE_DATA_SOURCE=api` y fetch rechazado, se muestra el indicador de desconexión y la app no crashea; tras `STALE_MS` aparece "estado desactualizado"; `npm run build` pasa.

- [ ] T14 — Crear pruebas básicas (Vitest + RTL): arranque, altura del mapa, marcadores, cambio cada 2 s, identificación de turno, sin intervalos duplicados, sin actualizaciones obsoletas (no-regreso dentro de la ronda), funciona con backend desconectado, dormidos ocultos, 200 sobrevivientes sin error, estados de sobreviviente `ACTIVO`/`EVACUADO`/`ELIMINADO` (case-insensitive), `adaptState` resuelve coords desde `/mapa` y swap de `geometria`, y seguridad (sin credenciales en `dist/`).
  Aceptación: `npm test` pasa en verde cubriendo los casos listados; `npm run build` pasa.

- [ ] T15 — Documentar ejecución e integración FastAPI en `frontend/README.md`: comandos (`npm install`, `npm run dev`, `npm run build`, `npm test`), variables de entorno, proxy de Vite (sin CORS aún), modo demo vs real, conexión a `GET /estado` + `GET /mapa`, `geometria` en `[lng,lat]`, estados de sobreviviente uppercase, campos pendientes con el backend, y limitaciones actuales.
  Aceptación: el README incluye comandos reproducibles, la lista de campos pendientes de `design.md` y cómo conectar al backend (`/estado`+`/mapa`, proxy); `npm run build` pasa.
