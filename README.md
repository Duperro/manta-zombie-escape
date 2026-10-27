# Manta Zombie Escape — Backend Pro y dashboard

Simulador Base/Pro sobre calles reales de Manta, con FastAPI, NetworkX y HTTP real. Pro integra predicción de corredores, asignación global con reservas y cinco camionetas con encuentros dinámicos y embarques físicos. Anochecer, Medianoche y Apocalipsis duran 150 turnos cada una. Incluye dashboard React/TypeScript/Leaflet conectado a los datos reales y demo local explícita. No se crearon recursos AWS.

**Para instalar y utilizar la versión completa desde `main`, seguir la [guía de inicio rápido para compañeros](docs/inicio_rapido.md).** Incluye instalación, arranque del dashboard con controles, actualización y solución de problemas para Windows y comandos para Linux/macOS.

Diseño, reglas propias de vehículos, parámetros y comandos completos en [docs/fase3.md](docs/fase3.md). Resultados y límites reales en [docs/verificacion_fase3.md](docs/verificacion_fase3.md).

Los archivos generados por cada corrida se guardan localmente en `reports/` y se excluyen de Git. En GitHub se conservan los comandos, reglas y resúmenes de validación de `docs/`; ver [política de reportes](reports/README.md).

Desde backend/, con API_KEY definida:

```bash
python -m app.simulator.cli --strategy pro --round all --fast --seed 7 --output ../reports/pro_phase3_seed7
python -m app.evaluation.compare --seeds 7 11 23 --output ../reports/phase3_release_v32
python -m app.evaluation.compare --seeds 7 --rounds 3 --ablations --output ../reports/phase3_ablation_v32
```

También puede usarse ROUTING_STRATEGY=base o pro. PRO_PREDICTION, PRO_RESERVATIONS y PRO_FLEET activan cada función por separado. Ejemplo de variables en backend/config/pro.env.example. Para tiempo real, omitir --fast.

## Instalar

Python 3.11 o 3.12. Dependencias directas fijadas en backend/pyproject.toml; OSMnx solo se necesita para regenerar el mapa. El JSON local está incluido: ejecutar no necesita acceder a OSM.

Windows PowerShell, desde la raíz:

```powershell
py -3.12 -m venv backend/.venv312
backend/.venv312/Scripts/Activate.ps1
cd backend
python -m pip install -e '.[test]'
$env:API_KEY='elige-una-clave-local'
python -m uvicorn app.server:app --host 127.0.0.1 --port 8000 --workers 1
```

Linux, desde la raíz:

```bash
python3.12 -m venv backend/.venv312
source backend/.venv312/bin/activate
cd backend
python -m pip install -e '.[test]'
export API_KEY='elige-una-clave-local'
python -m uvicorn app.server:app --host 127.0.0.1 --port 8000 --workers 1
```

En esta máquina ya existe backend/.venv312 con las dependencias. Puede llamarse directamente a su Scripts/python.exe. El main.py y el .venv originales de Fase 1 están preservados: usar app.server, no app.main. Sin API_KEY el servidor rechaza el inicio. .env.example es una referencia; las variables no se cargan automáticamente.

## Ejecutar las tres rondas

Desde backend/, con Python del entorno y API_KEY definida. Detener primero cualquier servidor del puerto elegido: la CLI incluye su propio servidor y el mismo estado que consulta por HTTP.

```bash
python -m app.simulator.cli --round all --fast --seed 7 --output ../reports/base_seed7
python -m app.simulator.cli --round all --seed 7 --output ../reports/realtime_seed7
python -m app.simulator.cli --round 3 --fast --seed 7 --output ../reports/round3_seed7
python -m app.simulator.cli --round 1 --manual --turns 8
python -m app.simulator.cli --demo --fast --turns 8 --output ../reports/demo
```

Sin --fast se descuenta el tiempo de procesamiento para intentar un turno cada 2 s: 5 minutos por ronda, 15 minutos para las tres. Si un turno tarda más, no se solapan turnos y se registra su duración. --fast comparte todas las reglas, sin espera artificial. --turns permite recorridos breves; omitirlo para las rondas completas. --states ../reports/states.jsonl guarda estados por turno; --verbose los imprime. --port cambia el puerto local.

Los JSON y CSV contienen evacuación y supervivencia por separado, eliminaciones, activos, turnos de evacuación, movimientos, solicitudes, errores, percentiles y disponibilidad observada. El JSON añade eventos y duración de cada turno. No representan una puntuación oficial no especificada.

## API y React

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/mapa
curl http://127.0.0.1:8000/estado
curl -X POST http://127.0.0.1:8000/paso -H 'Content-Type: application/json' -H 'x-api-key: elige-una-clave-local' -d '{"sobrevivienteId":"S-R1-0001","nodoActual":"REEMPLAZAR_CON_ESTADO","turno":0}'
```

Consultar nodoActual en /estado antes de llamar /paso; el ejemplo indica un campo a sustituir, no una posición inventada. En PowerShell usar curl.exe o Invoke-RestMethod. /paso mantiene exactamente los campos obligatorios y responde solo siguienteNodo. /docs presenta OpenAPI.

Cargar /mapa una vez por mapaVersion y consultar /estado por polling. /estado contiene solo el último turno publicado, incluso durante la decisión del siguiente. Dormidos ocultos no se publican. El archivo docs/integracion.md explica cambios frente a Fase 1, errores y adaptación para Leaflet. Ejemplos generados desde la aplicación en docs/estado.example.json y docs/mapa.example.json. Frontend implementado en frontend/: ver frontend/README.md y docs/traspaso_kiro.md.

## Mapa y refugios

data/maps/manta_graph.json contiene **1.507 nodos y 3.319 aristas dirigidas**, fuertemente conectados antes de eventos, con cobertura de Tarqui, Los Esteros, Barbasquillo y Jocay mediante anclas Nominatim. Conserva identificadores OSM, geometrías GeoJSON [lng,lat], sentidos únicos y calles paralelas. Sus 49 aristas de tipo puente son direcciones/segmentos etiquetados OSM, no 49 puentes físicos distintos.

Es una selección de la red, no la totalidad de Manta. La ampliación conserva la red anterior de 306 nodos y añade cobertura mediante una cuadrícula territorial y caminos reales hasta 1.507 nodos. Los sectores se asignan por proximidad a anclas, no por límites administrativos. Detalles y limitaciones en docs/mapa.md. Atribución: © OpenStreetMap contributors, ODbL.

Cuatro refugios de simulación (no refugios oficiales) en data/scenarios/shelters.json: Tarqui 40, Los Esteros 50, Barbasquillo 60 y Jocay 70 plazas. Pro realiza asignación min-cost flow y reservas atómicas en memoria. IDs R-001…R-004; idAnterior permite migrar desde R-1…R-4. Nunca se excede la capacidad.

Regenerar desde backend/:

```bash
python -m pip install -e '.[maps]'
python scripts/generate_manta_graph.py --target 1500 --coverage-grid 4 --preserve ../data/maps/archive/manta_graph_306.json
python -m app.export_contract
```

El script reutiliza GraphML/cache si existen; al regenerar con otra red revisar shelters.json y los contratos de mapa. No se crean calles sintéticas para conectar componentes. El importador valida el JSON antes de escribirlo.

## Configuración y reglas

data/scenarios/round_1.json, round_2.json y round_3.json contienen cantidades oficiales y eventos. distribucion acepta equilibrada, desigual o aleatoria; pesosSectores configura concentraciones. --scenario ruta.json permite una configuración propia. --seed fija posiciones y eventos. IDs de sobrevivientes incluyen ronda para evitar colisiones entre reintentos de rondas distintas.

Eventos admiten turno fijo o turnoAleatorio, tipo de calle o IDs explícitos. Un colapso bloquea las direcciones de la misma geometría/recorrido OSM. Las horas 75, 50 e intervalo 90–120 son elecciones de diseño, no horarios oficiales. La versión del grafo aumenta una vez por evento efectivo; se recalculan decisiones sobre un nuevo snapshot.

Caminantes: una calle en turnos pares. Corredores: hasta dos calles, detección por hasta tres saltos dirigidos transitables, desempate por distancia e ID, dirección aleatoria con semilla si no detectan. Hordas: bloquean su nodo y vecinos entrantes/salientes; inmóviles por defecto, probabilidad por turno configurable. Dormidos: ocultos hasta detección a dos saltos transitables; despiertan tras los movimientos, y esperan la siguiente fase par. Las cuatro reglas y colisiones se prueban independientemente.

El planificador recibe solo información observable, excluye bloqueos y peligro visible y comparte cuatro búsquedas Dijkstra inversas por snapshot como máximo. Coste distancia/velocidad. Sin camino o capacidad disponible devuelve el mismo nodo. Actores ya evacuados o eliminados permanecen quietos. Mordidas por nodo o cruce de la misma calle física; tienen prioridad sobre llegada al refugio. Los empates de plazas se resuelven por ID. Interpretaciones completas en docs/mapa.md.

HTTP_CONCURRENCY=4 limita solicitudes; timeout total de 500 ms. Errores o respuestas tardías/incorrectas dejan al actor quieto. Los percentiles se miden desde el inicio del intercambio HTTP, excluyendo la espera previa del semáforo. La duración de turno sí incluye toda esa espera. No se promete un SLA a partir de una medición local.

## Pruebas y estructura

```bash
python -m app.export_contract
python -m pytest -q --durations=5
```

backend/app/api y models definen contratos; core carga mapa/escenarios/configuración; simulator coordina actores, vehículos, colisiones y eventos; routing contiene Base, predicción y costos Pro; rescue implementa asignación y despacho; storage contiene decisiones y reservas atómicas; evaluation compara y exporta métricas. Los scripts importan el mapa y calculan puestos estáticos. Pytest valida las tres fases, incluidas rondas completas y reproducción Pro.

Resultados históricos en docs/verificacion_fase2.md; verificación actual en docs/verificacion_fase3.md. Las pruebas con TCP local necesitan localhost; el aislamiento usado por el agente en Windows bloquea socketpair.

## Docker

Desde la raíz (el contexto debe incluir data/):

```bash
docker build -f backend/Dockerfile -t manta-backend .
docker run --rm -p 8000:8000 -e API_KEY manta-backend
docker run --rm -e API_KEY manta-backend python -m app.simulator.cli --round all --fast --output /tmp/base
```

Un solo worker y usuario sin privilegios. No incluye caches OSM, secretos, entornos virtuales ni frontend/infra. La verificación de Docker depende de que Docker Desktop esté iniciado.

## Límites y siguiente fase

Persistencia y coordinación son de un solo proceso. No desplegar múltiples workers hasta implementar repositorio compartido de mundo/snapshots/RNG, decisiones atómicas y elección de coordinador. La API standalone publica el estado inicial; para avanzar usar la CLI, que es el dueño del reloj. No hay endpoints públicos para mutar turnos.

CORS GET configurable y dashboard React integrado. GET públicos sin autenticación; POST /paso protegido. No hay WebSockets. No se hizo push, merge ni despliegue. El trabajo está organizado por categoría y consolidado en main; ver docs/organizacion_git.md.

Fase 3 implementada: predicción, reservas y camionetas se ejecutan en el mismo mundo que Base. Para comparar se usan las mismas condiciones iniciales y generadores separados por entidad/evento. Se conservan los reportes históricos de Fase 2; no son la línea base emparejada del motor actualizado. No se inicia despliegue ni una nueva fase sin revisión.


## Dashboard y traspaso Kiro → Codex

En una terminal desde backend/, con API_KEY definida, ejecutar el motor y su servidor:

```powershell
.venv312/Scripts/python.exe -m app.dashboard_server
```

En otra terminal desde frontend/ (Node 24), define API_KEY con el mismo valor del backend (solo la usa el servidor Vite):

```powershell
$env:API_KEY='elige-una-clave-local'
npm ci
npm run dev
```

Abrir http://127.0.0.1:5173. Abre Pruebas de fuego, configura una ronda y pulsa Iniciar/Reiniciar. dashboard_server permanece activo al terminar para permitir nuevas pruebas. El proxy sirve las tres lecturas y los controles protegidos, sin exponer la clave al navegador. No arrancar además CLI o uvicorn en el mismo puerto. Para ejecución automática de tres rondas sigue disponible la CLI descrita arriba. Ver docs/pruebas_fuego.md.

Demo independiente, en una terminal nueva desde frontend/:

```powershell
$env:VITE_DATA_SOURCE='mock'
npm run dev
```

La demo reproduce 15 estados preparados por ronda, tiene controles locales y no es una ejecución completa. API es el modo por defecto; no existe fallback automático a demo.

Validación, ejecución detallada, arquitectura, variables y entrega AWS: [frontend/README.md](frontend/README.md), [informe de traspaso](docs/traspaso_kiro.md) y [entrega AWS](docs/entrega_aws.md). La integración HTTP/React pasó las tres rondas; revisión visual final y capturas pendientes por bloqueo de Computer Use. No se declara cerrado ese criterio.



## Organización de Git

main integra las entregas de feat/backend-simulator, feat/frontend-dashboard y chore/docs-contracts. Los commits agrupan backend/datos, frontend y documentación/contratos/evidencias; los merges conservan su historia. Guía en [docs/organizacion_git.md](docs/organizacion_git.md).

La ampliación actual conserva refugios y flota, actualiza ejemplos y demo, y aumenta la envolvente geográfica unas 2,9 veces. Los reportes previos de Fase 3 corresponden al mapa archivado de 306 nodos. Ver docs/mapa.md y reports/map_expansion.json para la comparación.

Averías temporales configurables en Pruebas de fuego: probabilidad y reparación por tipo de zombie, estado AVERIADA y contador en el mapa. Opción apagada por defecto; reglas comunes Base/Pro y pruebas reproducibles. Detalles en [docs/averias.md](docs/averias.md).
