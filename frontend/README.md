# Dashboard Manta Zombie Escape

## Inicio recomendado: panel de pruebas de fuego

El modal permite elegir ronda y configurar supervivientes, cuatro tipos de zombies, turnos, semilla, estrategia, distribución y bloqueos. Iniciar/Reiniciar reemplaza la ejecución actual; no modifica archivos ni requiere recargar. El servidor permanece disponible al terminar.

Terminal 1, desde backend/:

```powershell
$env:API_KEY='elige-una-clave-local'
$env:ROUTING_STRATEGY='pro'
.venv312/Scripts/python.exe -m app.dashboard_server
```

Terminal 2, desde frontend/ (usar la misma clave, solo en el entorno del servidor Vite):

```powershell
$env:API_KEY='elige-una-clave-local'
npm ci
npm run dev
```

Abrir http://127.0.0.1:5173 y pulsar Pruebas de fuego. Detalles y límites en ../docs/pruebas_fuego.md. El servidor es local, loopback y un worker; no publicar estos controles como endpoints anónimos. La clave no usa prefijo VITE_ ni entra en el bundle. Los siguientes comandos CLI son una alternativa de ejecución automática con un servidor finito y sin controles de inicio.


React 18, TypeScript estricto, Vite, React-Leaflet y Leaflet. Node 24; instalar con `npm ci` desde esta carpeta. Las versiones directas están fijadas y package-lock.json registra las transitivas.

## Ejecución local real

Terminal 1, desde backend/, Python del entorno instalado:

```powershell
$env:API_KEY='elige-una-clave-local'
.venv312/Scripts/python.exe -m app.simulator.cli --strategy pro --round all --seed 7 --output ../reports/dashboard_run
```

Terminal 2, desde frontend/:

```powershell
npm ci
npm run dev
```

Abrir http://127.0.0.1:5173. La CLI controla los turnos y sirve la misma instancia; no arrancar otro uvicorn. Sin --fast, cada ronda dura aproximadamente cinco minutos (150 turnos de 2 s). Una vez termina la CLI se conserva el último estado y se muestra la desconexión. Repetir la CLI para una nueva ejecución; si el turno retrocede, recargar el dashboard (no existe runId público para distinguir reinicios).

## Demo sin backend

En una terminal nueva:

```powershell
$env:VITE_DATA_SOURCE='mock'
npm run dev
```

Reproducción de 15 estados preparados por ronda, inicio/pausa/paso/reinicio/selección de ronda. No representa los 150 turnos completos. La etiqueta DEMOSTRACIÓN permanece visible. No se activa por fallos del API.

## Variables

| Variable | Uso |
|---|---|
| VITE_DATA_SOURCE | api (defecto) o mock explícito |
| VITE_API_BASE_URL | /api por defecto; URL pública HTTP(S) o ruta relativa |
| BACKEND_PROXY_TARGET | Solo Vite dev: http://127.0.0.1:8000 por defecto |

VITE_* se incorpora al bundle durante build; nunca colocar secretos. El código del navegador no recibe API_KEY; el servidor Vite sí la usa para el proxy de control local. Para dominios distintos configurar CORS_ORIGINS en backend con el origen exacto del frontend. Para producción con /api, el responsable de hosting debe crear su reverse proxy: Vite preview no incluye el proxy de desarrollo. Ver ../docs/entrega_aws.md.

## Validación

```powershell
npm test
npm run build
npm run preview
```

El build valida TypeScript y escanea el bundle por marcadores de claves. Tests: adaptadores/contratos, siete estados, 25 métricas, métricas/refugios/flota en React, polling/cache/abort/reconexión y montaje real de capas Leaflet mediante SVG en jsdom. Ese montaje no verifica tiles ni disposición visual.

Integración real reproducible (tres terminales): iniciar `npm run dev` en esta carpeta; desde backend/ ejecutar `python scripts/run_dashboard_integration.py --pace 0.25 --delay 12 --hold 60` con API_KEY definida; inmediatamente aquí ejecutar `npm run test:live`. La prueba espera las tres rondas completas; la cadencia acelerada es solo QA. Consume GET reales a través del proxy de Vite y renderiza React con el mapa sustituido en RTL. Escribe ../reports/handoff_frontend_live.json. El script backend escribe métricas y llamadas públicas en ../reports/. Esta prueba requiere localhost y tarda unos tres minutos; no se incluye en npm test.

Regeneración, desde backend/: `python -m app.export_contract`, `python scripts/export_frontend_types.py`, y opcional `python scripts/export_dashboard_demo.py` (45 estados por HTTP ASGI local). El contrato privado nunca entra al cliente.

## Arquitectura y límites

src/providers contiene la fuente observable API y demo; src/services valida y adapta; src/types separa tipos generados/raw/visuales; src/app conecta el dashboard; src/components contiene mapa y paneles. Mapa cacheado por versión; polling secuencial cada 1 s, timeout 5 s, respuesta anterior conservada, stale desde 8 s sin avance mientras EN_CURSO. Finalizada no se considera stale. No se calculan decisiones ni predicciones en el navegador.

Mapas y entidades vienen del backend. Geometrías [lng,lat] se convierten a [lat,lng], se conservan sentidos/aristas paralelas. Capas de riesgo usan la predicción publicada; horda indica nodos bloqueados, sin inventar polígonos. Disponibilidad del refugio usa plazas_disponibles y ABIERTO. Pasajeros son IDs y no duplican peatones en el mapa. Los cuatro refugios son simulados.

Tiles de OpenStreetMap y fuentes de Google necesitan red; las geometrías y entidades locales siguen disponibles sin tiles. Atribución OSM visible. Validación final de tiles, móvil y capturas pendiente: Computer Use terminó por no verificar con confianza la URL. No se afirma QA visual completada.


## Interacción y legibilidad del mapa

Seleccionar desde el mapa, búsqueda, flota o refugios centra la entidad con acercamiento suave de 0.75 niveles (650 ms, tope de acercamiento automático 17). Si ya se está más cerca, conserva ese zoom. No vuelve a mover la cámara por el polling; arrastrar y explorar sigue siendo libre. La preferencia de movimiento reducido desactiva la animación. Pasajeros se localizan sobre la camioneta publicada. Selección con anillo e ID permanente, botones +/- y centrar red.

Personas: icono circular azul; estados de encuentro/espera violeta; evacuados con check y eliminados con X, ambos más discretos. Caminantes: calavera roja; corredores: rayo naranja; hordas: biohazard violeta. Refugios verdes con escudo, camionetas ámbar con contador de pasajeros. Contornos y sombra separan entidades del mapa base atenuado. Leyenda actualizada. No se alteran posiciones ni reglas del backend.

Validación de esta mejora: 22 pruebas aprobadas (reports/map_interaction_tests.txt) y build/TypeScript aprobados (reports/map_interaction_build.txt). Incluye zoom una vez por selección, cámara estable entre frames y localización de pasajeros. Revisión visual a cargo del usuario en el dashboard abierto.
`nAjuste posterior de presentación: iconos reducidos aproximadamente un 25 %, encabezados compactos y sin frases decorativas. Nodos y rutas quedan en Más detalles, eventos plegados y el detalle de entidad aparece únicamente al seleccionar. Se mantienen los 25 campos en Telemetría y las métricas de rescate.

La configuración se abre en un diálogo modal nativo con foco contenido, cierre por X/Escape/fondo y retorno de foco al botón. Durante el envío se bloquea el cierre.

Visibilidad: dormidos ocultos por contrato hasta despertar; al despertar son caminantes y se registra despertar en eventos. Eliminados usan X blanca sobre rosa oscuro, capa independiente activada por defecto y prioridad sobre zombies en el mismo nodo. Tooltip muestra la causa publicada.

Opción nueva: Capas → Dormidos (solo pruebas), apagada por defecto. Consulta un canal de control protegido y dibuja zZ azul sin incorporar datos al proveedor público ni al planificador. Solo acepta el mismo runId/ronda/turno; al despertar pasan a caminantes. Requiere dashboard_server actualizado.

Mapa ampliado activo y demo: 1.507 nodos y 3.319 tramos dirigidos. El adaptador conserva las geometrías y detecta la nueva mapaVersion; Leaflet encuadra la cobertura completa sin asumir un número fijo de nodos. La red anterior se conserva en data/maps/archive/ para los resultados históricos.

Vista centrada en el mapa: sin panel lateral permanente. La búsqueda por ID, tipo o nombre vive sobre el mapa; seleccionar una entidad abre una tarjeta flotante con datos reales, cierre por X/Escape y scroll interno en móvil. El mapa conserva el zoom suave y gana todo el ancho disponible. Refugios y camionetas se consultan seleccionando sus iconos o buscándolos.

Validación de tarjetas: 31 pruebas frontend y build aprobados. Navegador desktop: selección de camioneta, zoom, tarjeta dentro del mapa, búsqueda y cierre por X verificados; mapa de 1.189 px sin columna lateral ni desbordamiento horizontal. Evidencia en reports/map_cards_visual_check.json y map_card_desktop.jpg. Sin afirmar revisión visual móvil en esta comprobación.

Averías temporales: activar la opción en el modal y configurar porcentaje y turnos para cada tipo de zombie. Vehículo rojo con herramienta y Nt, tarjeta con reparación y segundos aproximados, eventos de avería/reparación. Los contadores provienen de VehicleView; no hay simulación local ni acceso del algoritmo a posiciones ocultas. Ver ../docs/averias.md.
