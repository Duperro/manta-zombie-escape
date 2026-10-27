# Dashboard — diseño vigente del traspaso Kiro → Codex

Se conservan la arquitectura de proveedores intercambiables, tipos raw/visual, adaptador único, mapa central, capas, selección, paneles y modo oscuro del diseño original. El borrador original está en archive/design.md. Este documento sustituye sus esquemas provisionales.

## Fuente de verdad y tipos

FastAPI actual (backend/app/models/domain.py y evaluation/metrics.py) es la autoridad. scripts/export_frontend_types.py genera frontend/src/types/generated.ts desde app.openapi(); no exporta operaciones privadas. raw.ts añade el contrato conocido de las 25 métricas y la estructura de riesgo, ya que OpenAPI define esos dos campos como diccionarios extensibles.

VehicleView se consume mediante RawVehicle, con nodoActual, estado, capacidad, pasajeros:string[], capacidadUtilizada, sobrevivientesAsignados, puntoEncuentro, refugioDestino, rutaPlanificada, aristasRecorridasEnTurno, viajesRealizados y distanciaRecorrida_m. Los cinco vehículos reales se visualizan; no se consideran pendientes.

El adaptador resuelve nodoActual con PreparedMap.nodes. No intenta leer lat/lng en una camioneta ni interpreta pasajeros como número.

Estados: ACTIVO, CAMINANDO, HACIA_ENCUENTRO, ESPERANDO_RESCATE, EN_CAMIONETA, EVACUADO, ELIMINADO. Los siete se conservan. Un estado desconocido se etiqueta explícitamente y se retiene el string original; no se convierte en ACTIVO.

Las 25 métricas se llevan sin cambios al modelo visual; las ausentes/null se muestran como no disponibles, sin inventar mediciones. Incluyen vivosFinales, evacuadosCaminando, evacuadosCamioneta, rescatesCompletados, rescatesCancelados, distanciaCaminada_m y distanciaTransportada_m.

StateView conserva estrategia, funcionalidadesPro y riesgo; SurvivorView conserva camionetaId, distancias y modoEvacuacion; ShelterView conserva plazas_disponibles, sobrevivientesAsignados e idAnterior.

Refugios: disponibilidad preferente desde plazas_disponibles. Solo si falta/no es finito se usa capacidad_maxima - ocupacion - plazas_reservadas y se publica una observación. No se limita ni sobrescribe un valor válido del servidor. No hay un enum cerrado de estados de refugio; se muestra el string real. La lógica de admisión del backend exige ABIERTO, por lo que un estado distinto no se etiqueta disponible.

## Stack fijado y comprobado

React/DOM 18.3.1, React Leaflet 4.2.1, Leaflet 1.9.4: se conserva la combinación elegida por Kiro. Herramientas instaladas y fijadas: Vite 8.3.5, plugin-react 6.1.2, TypeScript 5.9.3, Vitest 5.0.5, Lucide React 1.62.0, Testing Library 16.1.0 y jsdom 26.1.0. Node usado: 24.22.1. package-lock.json es reproducible; no existía un frontend previo ni dependencias instaladas que migrar. CSS propio responsive, sin framework UI.

## Arquitectura efectiva

src/types/generated.ts + raw.ts → services/decode.ts → services/adapter.ts → types/visual.ts.
providers/ApiSimulationProvider y MockSimulationProvider → app/SimulationContext (useSyncExternalStore) → Dashboard.
components/MapBoard: mapa y capas; components/Panels: métricas, refugios, flota, detalles y telemetría.

MapContainer persiste entre turnos. PreparedMap se reutiliza por mapaVersion; geometrías [lng,lat] se convierten a [lat,lng]. Calles paralelas mantienen IDs distintos. Rutas resuelven aristas reales abiertas; si falta una conexión se omite el trazado en vez de dibujar un atajo ficticio. El encuadre se ajusta al cargar otro mapa o pulsar centrar, no en cada polling.

CircleMarker para personas y zombies visibles; iconos para cuatro refugios y cinco vehículos. Las personas EN_CAMIONETA no se dibujan caminando aparte; permanecen seleccionables y el vehículo muestra pasajeros. Riesgo se dibuja como nodos/aristas del backend, sin algoritmos predictivos en React ni radios oficiales inventados. Hordas se representan por nodosBloqueados.

## Proveedor real

GET públicos health, estado y mapa, a través de /api en Vite o una URL CORS configurada. No invoca decisiones privadas ni adjunta credenciales.

Un polling cada 1 s, secuencial, sin solapamientos; timeout de 5 s; AbortController y limpieza completa al desmontar. start es idempotente. Un token de generación descarta respuestas de una conexión cancelada. fetch se enlaza a globalThis para conservar el receptor del navegador.

El último turno aceptado no retrocede dentro de su ronda. Un cambio de ronda acepta turno 0. Un mismo par ronda/turno no publica otro frame, salvo cambio relevante de versión/estrategia/estado de simulación. mapaVersion carga /mapa solo al cambiar; versionGrafo representa bloqueos, no el reloj.

En fallo se mantiene el último frame real y se señala desconexión. Nunca se instancia ni mezcla demo como fallback. La reconexión es automática. Ocho segundos sin avance de un estado EN_CURSO producen indicador de estado detenido; FINALIZADA no se marca obsoleta por no avanzar.

El backend no expone runId: al reiniciar una ejecución nueva en la misma ronda/turnos anteriores debe recargarse el cliente; no se interpreta un retroceso como avance.

## Proveedor demo

MockSimulationProvider reproduce archivos locales public/demo/round_N.json, generados de forma reproducible con semilla 7 desde el simulador, sin mediciones HTTP reales ni credenciales. El mapa es local. No necesita FastAPI y no calcula otra estrategia en el navegador.

Son 15 cuadros de presentación por ronda, espaciados 2 s; iniciar/pausar/paso/reiniciar/seleccionar ronda solo aparecen en demo. No se pretende que esta reproducción corta sea una ronda oficial completa de 150 turnos. Una etiqueta persistente marca demostración y las latencias se mantienen null.

## Diseño y seguridad

Centro de operaciones oscuro, mapa principal, cifras operativas, barra de conexión/estrategia/turno, leyenda, capas conmutables, búsqueda/selección, detalles, refugios, cinco unidades y eventos. Desktop y móvil usan la misma información, con disposición apilada en pantallas pequeñas.

No se guardan secretos en VITE_. build ejecuta comprobación de marcadores de credenciales en dist/. Las claves solo se usan por el coordinador Python. Vite solo publica proxy a los tres GET; producción debe usar un proxy equivalente o CORS_ORIGINS explícito.

## Validación

Unitarias de adaptador/proveedores, componentes RTL y pruebas del contrato. La prueba live utiliza HTTP real Vite → FastAPI, con React y el adaptador; sustituye el renderizador cartográfico de Leaflet en jsdom y por tanto no equivale a QA visual. Los resultados y la limitación de navegador se registran en docs/traspaso_kiro.md. No hay capturas finales verificadas si la automatización visual no está disponible.


## Ampliación autorizada: controles locales de pruebas de fuego

El dashboard añade un modal para configurar ronda, población, zombies, turnos, semilla, Base/Pro, distribución y bloqueos. Iniciar/Reiniciar actúa sobre la ejecución real mediante /api/control/iniciar y consulta /api/control/estado. Esta ampliación sustituye la restricción previa de solo lecturas para este panel local. /paso sigue privado y nunca se proxifica. API_KEY se inyecta en el servidor Vite, con guard de origen; no se incorpora al cliente. Backend opt-in dashboard_server, un coordinador, loopback y servidor persistente después del fin. runId distingue reinicios; turnosTotales/segundosPorTurno controlan el contador. Contrato adicional en contracts/dashboard-control.openapi.yaml, pruebas y límites en docs/pruebas_fuego.md.


Ampliación autorizada: capa Dormidos (solo pruebas), opt-in y separada. GET /control/dormidos autenticado, sin cache y con runId/ronda/turno. No se añade a /estado, Observation, proveedor público ni planificador. SleeperDebugLayer valida el frame y aborta al desactivar. Ver docs/pruebas_fuego.md.


Mapa ampliado: 1.507 nodos y 3.319 aristas reales, con toda la red anterior conservada. Geometrías/sentidos/paralelas y ubicaciones de refugios/flota se mantienen. El dashboard y la demo consumen la nueva mapaVersion sin tamaños fijos; ver docs/mapa.md.
