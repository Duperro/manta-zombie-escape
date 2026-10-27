# Dashboard — requisitos vigentes tras la auditoría

Sustituye el alcance de diseño Fase 1 de Kiro. Se conserva su arquitectura y se integra el backend Pro real. Fuente: domain.py, metrics.py y OpenAPI generado. El borrador original está archivado.

- R1 React + TypeScript + Vite + React Leaflet/Leaflet + Lucide; CSS oscuro responsive; mapa de Manta con altura no nula.
- R2 GET /mapa separado del estado; preservar nodos, IDs de arista, sentidos, paralelas y geometría [lng,lat] → [lat,lng].
- R3 Capas: grafo, sobrevivientes, caminantes, corredores, hordas, nodos bloqueados, refugios, camionetas, encuentros, calles bloqueadas, rutas y riesgo disponible.
- R4 No mostrar dormidos ocultos, incluso si una entrada incompatible los incluye. Un dormido despertado se publica como caminante.
- R5 Cuatro refugios: nombre, capacidad, ocupación, reservas, plazas_disponibles y estado real. Preferir disponibilidad de API; fallback documentado solo si falta.
- R6 Cinco camionetas reales: posición por nodoActual; pasajeros como IDs; capacidadUtilizada, estado, refugioDestino, puntoEncuentro, asignados, ruta y viajes.
- R7 Header: ronda, turno, estado de simulación, estrategia, conexión. El reloj por turnos es reglamentario, no una medición de tiempo de pared.
- R8 Conservar las 25 métricas del backend. Mostrar rescates completados/cancelados, evacuados caminando/en camioneta y las distancias. Ausentes/null no se inventan.
- R9 Selección y detalles auténticos de sobreviviente/refugio/camioneta/zombie visible. Sobrevivientes admiten los siete estados Pro; desconocidos no se convierten en ACTIVO.
- R10 Rutas de personas y vehículos sobre aristas reales. No inventar conexiones cuando faltan datos. Pasajeros no caminan independientemente.
- R11 Polling real cada 1 s, sin solapamiento, con cancelación, timeout, generación, reconexión y control ronda/turno; caché de mapa por versión.
- R12 Mantener el último frame real ante desconexión y señalar estado detenido sin confundirlo con ronda finalizada.
- R13 Observador pasivo: nunca invocar POST /paso desde React, ni incluir credenciales privadas en el bundle.
- R14 Dos proveedores mediante configuración: VITE_DATA_SOURCE=api|mock y VITE_API_BASE_URL. No hay fallback silencioso de real a demo.
- R15 Demo local sin backend, claramente etiquetada: reproducción reproducible de 15 cuadros por ronda, no un resultado oficial ni latencia medida.
- R16 Controles de reproducción exclusivamente demo; en real el backend mantiene su reloj.
- R17 Visualizar solo la predicción publicada; riesgo en nodos/aristas no es una geocerca oficial ni una predicción calculada por React.
- R18 Tres rondas reales de 150 turnos deben poder observarse sin descargar el mapa por cada polling.
- R19 Errores de contrato o coordenadas ausentes no generan puntos ficticios; informar y conservar datos válidos.
- R20 Entrega con build, TypeScript, Vitest/RTL, prueba HTTP real y documentación de las limitaciones visuales.

## Criterios verificables

Build y tipos sin errores; pruebas de los seis hallazgos Kiro; 200 sobrevivientes y cinco vehículos; cleanup y no regresión de turnos; modo demo aislado; bundle sin marcadores de credenciales. Integración de proveedor/adaptador/componentes con FastAPI en ejecución y proxy Vite. La verificación visual final de tiles, disposición y capturas debe registrarse por separado; no se confunde jsdom con un navegador real.

Backend, frontend y contratos pueden corregirse dentro de este traspaso. infra/ permanece a cargo del integrante AWS, sin recursos ni despliegues automáticos.


## Ampliación autorizada: controles locales de pruebas de fuego

El dashboard añade un modal para configurar ronda, población, zombies, turnos, semilla, Base/Pro, distribución y bloqueos. Iniciar/Reiniciar actúa sobre la ejecución real mediante /api/control/iniciar y consulta /api/control/estado. Esta ampliación sustituye la restricción previa de solo lecturas para este panel local. /paso sigue privado y nunca se proxifica. API_KEY se inyecta en el servidor Vite, con guard de origen; no se incorpora al cliente. Backend opt-in dashboard_server, un coordinador, loopback y servidor persistente después del fin. runId distingue reinicios; turnosTotales/segundosPorTurno controlan el contador. Contrato adicional en contracts/dashboard-control.openapi.yaml, pruebas y límites en docs/pruebas_fuego.md.


Ampliación autorizada: capa Dormidos (solo pruebas), opt-in y separada. GET /control/dormidos autenticado, sin cache y con runId/ronda/turno. No se añade a /estado, Observation, proveedor público ni planificador. SleeperDebugLayer valida el frame y aborta al desactivar. Ver docs/pruebas_fuego.md.


Mapa ampliado: 1.507 nodos y 3.319 aristas reales, con toda la red anterior conservada. Geometrías/sentidos/paralelas y ubicaciones de refugios/flota se mantienen. El dashboard y la demo consumen la nueva mapaVersion sin tamaños fijos; ver docs/mapa.md.


Distribución actual autorizada: mapa a todo el ancho, sin panel lateral. La búsqueda vive sobre el mapa y la información de la entidad seleccionada se muestra en una tarjeta flotante, con X/Escape y detalles secundarios plegados. Los datos de refugios y flota se consultan al seleccionar o buscar. No se modifica la API ni el algoritmo.
