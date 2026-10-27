# ARCHIVO HISTÓRICO DE KIRO

Este borrador se conserva como referencia. No es el contrato vigente; consultar ../design.md, ../requirements.md y ../tasks.md.

# Frontend Dashboard — Requisitos (Fase 1)

## Resumen

Dashboard web estilo "Centro de Operaciones de Emergencia" para Manta Zombie Escape. Un mapa Leaflet/OSM centrado en Manta, Ecuador, es el elemento central, con capas por tipo de entidad, panel de métricas, panel de detalles, leyenda y simulación en tiempo real. El frontend es un observador pasivo: dos fuentes de datos intercambiables — `MockSimulationProvider` (demostración sin backend) y `ApiSimulationProvider` (polling `GET /estado` + carga única `GET /mapa`) — controladas por variables de entorno. Fase 1 = demo corriendo en localhost + servicio HTTP listo para conectar al backend sin cambios adicionales.

Alcance de rol: solo `frontend/` y `.kiro/specs/frontend-dashboard/`. No modificar `backend/`, `contracts/`, `data/`, `docs/`, `infra/` ni archivos raíz existentes (solo lectura de los artefactos del repo para alinear).

## Requisitos funcionales

- R1 Mapa Leaflet + OSM centrado en Manta, Ecuador; contenedor con altura CSS explícita y no nula.
- R2 Diez capas, toggleables y explicadas en la leyenda: (1) calles/nodos del grafo, (2) caminantes, (3) corredores, (4) hordas + sus áreas bloqueadas, (5) dormidos solo al despertar, (6) sobrevivientes, (7) cuatro refugios, (8) cinco camionetas, (9) calles bloqueadas, (10) rutas planificadas.
- R3 Nunca mostrar zombies dormidos antes de su activación. En modo real los dormidos nunca llegan a `/estado` (un dormido despierto se publica como `caminante`); la capa dormido solo se puebla en mock.
- R4 Al seleccionar un sobreviviente, resaltar su ruta cuando exista. En modo real la ruta proviene de `StateView.rutas` (clave = id del sobreviviente) y de `SurvivorView.rutaPlanificada`.
- R5 Refugios muestran capacidad total (`capacidad_maxima`), ocupación, `plazas_reservadas`, disponibilidad y estado (`ABIERTO`/lleno) — el backend ya provee estos campos en `ShelterView`.
- R6 Camionetas muestran pasajeros actuales, capacidad y destino cuando el backend lo provea. En Fase 1 `camionetas` llega como `[]` (pendiente hasta Fase 3); la capa existe y se puebla en mock.
- R7 Header: nombre "Manta Zombie Escape", ronda actual (desde `StateView.ronda` → Anochecer/Medianoche/Apocalipsis), número de turno, temporizador de ronda (estimación local), estado de conexión del backend.
- R8 Panel de métricas: sobrevivientes iniciales, vivos, evacuados, eliminados, zombies activos, refugios disponibles, camionetas activas, latencia p95. Usa las métricas que el backend provee en `StateView.metricas` (`sobrevivientesIniciales`, `activos`, `evacuados`, `eliminados`, `latenciaP95Ms`); no las inventa ni las oculta en modo real. Las no provistas (`activeTrucks` hasta Fase 3) se ocultan.
- R9 Panel de detalles: sobreviviente seleccionado, `refugioAsignado`, estado (`ACTIVO`/`EVACUADO`/`ELIMINADO`), `turnoEvacuacion`, `causaEliminacion`, `rutaPlanificada` y destino si existen datos.
- R10 Leyenda con colores/iconos identificables y explicación por tipo de entidad.
- R11 Simulación en tiempo real: turnos de 2 s, polling `GET /estado` cada 1 s. Actualizar el estado solo al detectar un turno nuevo (o cambio de ronda). Sin retroceso de turno dentro de una ronda. Cancelar solicitudes en vuelo al desmontar y limpiar intervalos.
- R12 Manejo de errores, reconexión automática, indicador "backend desconectado" e indicador "estado desactualizado".
- R13 El frontend no ralentiza el simulador (solo observa; no controla el reloj).
- R14 `MockSimulationProvider`: datos de demostración, turnos de 2 s, rondas 1/2/3 seleccionables, semillas reproducibles, permite probar rutas, bloqueos y evacuaciones. Etiqueta visual "Modo demostración".
- R15 `ApiSimulationProvider`: polling `GET /estado` + carga única de `GET /mapa` (caché por `mapaVersion`), transforma las respuestas reales al modelo visual, maneja errores y desconexiones. Sin mezclar datos mock y reales.
- R16 Control por env: `VITE_DATA_SOURCE=mock|api`, `VITE_API_BASE_URL`. Sin secretos en vars `VITE_` ni en el bundle. `POST /paso` (API key privada) jamás se llama desde el navegador. El navegador solo llama GETs públicos: `/estado`, `/mapa` y `/health`.
- R17 Controles iniciar/pausar/avanzar/reiniciar operan en modo demo. En modo real solo aparecen si existen endpoints públicos que los implementen (en Fase 1 no existen → se ocultan).
- R18 Rondas (configuración local, no oficial): R1 Anochecer (20 sob., 12 caminantes); R2 Medianoche (80 sob., 16 cam., 6 corredores, 3 hordas, 1 puente colapsado); R3 Apocalipsis (200 sob., 24 cam., 12 corredores, 4 hordas, 8 dormidos, 2 calles bloqueadas). Cada ronda dura 5 min y tiene 150 turnos.
- R19 Refugios: capacidades 40/50/60/70; el dashboard muestra capacidad total, ocupación, reservadas, disponibilidad y estado lleno/disponible.
- R20 Rescate Pro (solo visualización): cinco camionetas, hasta 4 pasajeros, rutas a puntos de encuentro, sobrevivientes asignados, refugio destino, estados de rescate. La lógica de optimización es del backend; el frontend solo representa decisiones.
- R21 `geometria` de las aristas viene en orden `[lng, lat]`; el adaptador la convierte a `{lat, lng}` para Leaflet y dibuja cada arista (incluidas las paralelas) como registro separado respetando su dirección.

## Requisitos no funcionales

- NFR1 Stack: React + TypeScript + Vite, React-Leaflet + Leaflet (OSM), Lucide React, Fetch API, Vitest + React Testing Library. Versiones estables y mutuamente compatibles fijadas (ver design.md).
- NFR2 Modo oscuro primario; CSS modular responsive (desktop y tablet). Sin framework UI pesado.
- NFR3 Rendimiento: `CircleMarker` para capas densas (hasta 200 sobrevivientes); iconos solo para refugios/camionetas (≤9 entidades). Animaciones suaves que no afecten el rendimiento.
- NFR4 Seguridad: sin credenciales ni API keys en vars `VITE_` ni en el bundle; `POST /paso` no se invoca desde el navegador; sin cabecera `x-api-key`.
- NFR5 Tipos centralizados en `src/types` (raw alineado a `openapi.yaml`/`domain.py` y visual); capa adaptadora en `services`; nunca formas del backend inlineadas en componentes.

## Criterios de aceptación (verificables)

- AC1 `npm run build` compila sin errores desde `frontend/`.
- AC2 `npm test` pasa y cubre: arranque de la app, altura del mapa, render de marcadores, cambio de datos cada 2 s, identificación correcta del turno, sin intervalos duplicados, sin actualizaciones obsoletas, funcionamiento con backend desconectado, dormidos ocultos antes de su activación, y 200 sobrevivientes sin error.
- AC3 El bundle no contiene credenciales (verificación por grep sobre `dist/`); no aparece `x-api-key`/`API_KEY` ni literales de `.env`.
- AC4 El dashboard corre en localhost, visualiza Manta y muestra movimiento de personajes en modo demo.
- AC5 El servicio HTTP está listo para conectar a `GET /estado` (polling 1 s) y `GET /mapa` (caché por `mapaVersion`) cambiando solo variables de entorno; el navegador nunca llama a `POST /paso`.
- AC6 Los datos simulados se etiquetan "Modo demostración" y no se mezclan con datos reales.
- AC7 Los dormidos no se renderizan antes de su activación (demo y real); en real la capa dormido permanece vacía.
- AC8 El contenedor del mapa tiene altura calculada > 0.
- AC9 En modo real, el adaptador resuelve coordenadas desde `/mapa` (no desde `/estado`), consume `metricas`/`rutas`/`ronda`/`plazas_reservadas`/`refugioAsignado`, y usa `ACTIVO`/`EVACUADO`/`ELIMINADO` para los estados de sobreviviente.

## Fuera de alcance (Fase 1)

- Algoritmos de rescate/ruta en React (el backend decide; el frontend solo representa).
- Mapa real con ~300 intersecciones OSMnx en el frontend (el backend lo sirve vía `/mapa`; el frontend ya lo consume tal cual).
- Persistencia/DynamoDB, infraestructura, despliegue, Docker, monitoreo.
- WebSockets (se usa polling de 1 s).
- `POST /paso` desde el navegador (endpoint privado con API key).
- Esquema de `camionetas` (llega `[]` hasta Fase 3); geometría de polígono/radio explícita de horda (el área se representa con `nodosBloqueados`).
- CORS (no habilitado aún; se usa el proxy de desarrollo de Vite).
