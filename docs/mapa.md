# Mapa real e interpretaciones

La fuente se descargó el 27 de octubre de 2026 con OSMnx 2.0.2. Bounding box [oeste,sur,este,norte]: [-80.78,-1.00,-80.67,-0.935]. Red drive, retain_all=True, simplify=True, conservando bridge. El endpoint principal Overpass respondió saturación; la descarga efectiva usó https://overpass.kumi.systems/api. Datos © OpenStreetMap contributors, licencia ODbL: https://www.openstreetmap.org/copyright.

Red fuente: 7.208 nodos y 19.856 aristas dirigidas de la descarga OSM existente. El mayor componente fuertemente conectado tiene 7.112 nodos. La ampliación conserva todos los nodos y todas las calles anteriores, incluidos IDs, geometrías y sentidos, conecta una cuadrícula territorial 4×4 mediante caminos OSM dirigidos de ida/vuelta y densifica por sector hasta superar el objetivo de 1.500 nodos. Se reutilizó la fuente local: no se inventaron enlaces ni se descargaron datos nuevos.

El mapa activo tiene **1.507 nodos y 3.319 aristas dirigidas**, versión manta-e14526d00c21d066. Su envolvente geográfica ocupa aproximadamente 2,885 veces la del mapa anterior (esto no representa superficie municipal cubierta ni longitud de calles físicas). Límites de los nodos: oeste -80.7776113, sur -0.9997772, este -80.6700783 y norte -0.9428075. La selección se extiende al oeste, este, sur y norte del mapa anterior. Existe ruta dirigida entre cada par de nodos antes de bloqueos.

El snapshot anterior de 306 nodos y 571 aristas se conserva en data/maps/archive/manta_graph_306.json para interpretar los reportes históricos. Las ubicaciones de los cuatro refugios y las cinco camionetas se mantienen. Al cambiar el mapa cambia también mapaVersion, y el dashboard vuelve a cargar su índice. Ejemplos y demo se regeneraron con la red ampliada.

Anclas obtenidas por Nominatim (consulta '<sector>, Manta, Ecuador'):

| Sector | Latitud | Longitud |
|---|---:|---:|
| Tarqui | -0.9784464 | -80.7243193 |
| Los Esteros | -0.9585425 | -80.6846573 |
| Barbasquillo | -0.9515404 | -80.7527254 |
| Jocay | -0.9598756 | -80.7161161 |

Estas anclas son resultados de geocodificación, no límites administrativos verificados. Los nodos se agrupan por ancla más cercana para distribuir sobrevivientes. Tarqui y Los Esteros pueden representar centroides del lugar nombrado. Una revisión local del equipo puede ajustar anclas y regenerar el estudio. La selección es una red reducida con corredores entre sectores, no todas las calles de los cuatro barrios; puede omitir rutas alternativas y sesgar resultados de evacuación.

OSMnx elimina nodos geométricos intermedios al simplificar; las geometrías completas, longitudes y osmids de las vías simplificadas se exportan. No se añaden atajos rectos al conectar sectores. Cada calle lógica puede por ello contener curvas y varios segmentos OSM. Un movimiento recorre una arista lógica, tal como define el enunciado, y distancia/velocidad pondera la elección; no se simula desplazamiento continuo de 2 s.

Clasificación, en orden: bridge distinto de no/false/0 → puente; service=alley o nombre callejón/callejon → callejón; highway principal (motorway/trunk/primary/secondary/tertiary y enlaces principales) o nombre avenida → avenida; resto → calle. No se infieren puentes por cercanía al agua. Las 49 aristas etiquetadas como puente corresponden a direcciones/segmentos OSM, no a 49 estructuras físicas. La red drive excluye algunos callejones peatonales: solo se incluyen los caminos presentes en esa descarga.

Tiempo estimado = longitud OSM / velocidad configurable. No se utiliza maxspeed vehicular como velocidad humana. IDs N-<OSM>, E-<OSM origen>-<OSM destino>-<clave>; estables para este snapshot de red, no garantizados ante ediciones OSM futuras. mapaVersion es hash del contenido vial exportado. Un cambio de velocidades de entorno modifica tiempos del servidor sin cambiar la identidad topológica del mapa.

Refugios: shelters.json explica la selección de un nodo de buen grado vial a menos de ~450 m de cada ancla, sobre el componente conectado. Son puntos de simulación y no instalaciones oficiales verificadas. El archivo almacena capacidades y coordenadas; al servir se derivan coordenadas del nodo real. Evacuaciones empatadas se resuelven por ID, sin exceder ocupación ni reservas.

Interpretaciones de reglas: detección zombie mediante saltos dirigidos transitables, respetando bloqueos; vecinos de horda incluyen entrantes y salientes. Corredores recalculan objetivo en cada subpaso; empate por distancia e ID, sin objetivo eligen vecino abierto ordenado mediante RNG con semilla. Las aristas paralelas usan la opción abierta de menor tiempo, desempate por ID. Para cruces opuestos se compara geometría canónica y conjunto de osmids, evitando considerar calles paralelas distintas como la misma calle física.

Dormidos solo se activan por sobrevivientes activos tras movimientos; quien recibe una mordida en ese mismo turno todavía puede activarlos antes de registrar su eliminación. Personas eliminadas en turnos previos o ya evacuadas no los activan. Coincidencia de nodo incluye un dormido interno aunque el planificador no sepa su posición. Una mordida elimina inmediatamente; no hay conversión en zombie porque no se especificó. Mordidas tienen prioridad sobre refugios.

Las rutas excluyen nodos de zombies visibles y de hordas. Si el origen ya está excluido, el algoritmo Base permanece quieto: no intenta una maniobra de escape Pro. Sin ruta o refugio con espacio, también espera y puede morir. No hay garantías de porcentaje de evacuación.

Validaciones ejecutables: modelos Pydantic, unicidad, coordenadas finitas, extremos existentes, longitudes/velocidades positivas, tiempos consistentes, geometrías válidas y conectividad fuerte. Pytest comprueba rutas entre sectores y desde cada nodo hacia los cuatro refugios, carga JSON, sentidos y paralelas. Eventos pueden romper esa conectividad; la espera sin ruta es un resultado permitido.

Referencias técnicas: https://osmnx.readthedocs.io/en/stable/user-reference.html y https://nominatim.org/release-docs/latest/api/Search/.


## Regeneración de la ampliación

Desde backend/: `python scripts/generate_manta_graph.py --target 1500 --coverage-grid 4 --preserve ../data/maps/archive/manta_graph_306.json`. Requiere el extra maps y reutiliza manta_source.graphml si existe; fuente/cache no se versionan. Sin --preserve se conservan por defecto los nodos del mapa activo: --target es un mínimo de selección, no un límite que autorice borrar nodos. La selección puede superarlo para completar caminos reales. Generar el mapa desde una descarga OSM actualizada puede cambiar IDs/geométricas; el generador rechaza perder o alterar una calle del mapa previo en esta operación de ampliación.

Pruebas y evidencia: reports/map_expansion.json registra comparación y calentamiento ASGI (no latencia TCP); tests/test_map_expansion.py verifica conservación de nodos/calles/geometría, expansión territorial y referencias de refugios/flota. Los resultados previos Base/Pro sobre 306 nodos son históricos y no deben atribuirse al mapa ampliado. Las velocidades, duración de turnos y reglas físicas no se cambiaron.


## Verificación de la red ampliada

- Backend completo: 75 pruebas aprobadas, una advertencia de deprecación, 364,64 s (reports/map_expansion_backend_tests.txt). Incluye las tres rondas por TCP real, Pro reproducible y comprobación de conservación del mapa anterior.
- Frontend: 30 pruebas aprobadas y build TypeScript/Vite aprobado; demo y ejemplos regenerados con la nueva versión.
- Dashboard por HTTP real: 1.507 nodos y 3.319 aristas, turnos 0/1/2 observados, cinco camionetas y cuatro refugios, todas las posiciones/rutas resuelven a nodos publicados. 398 decisiones HTTP, cero errores; p95 de esta muestra 38,13 ms. No equivale a SLA ni a comparación Base/Pro completa. Ver reports/map_expansion_dashboard_live.json.
- Se conservó la configuración del operador y se reinició sobre el mapa nuevo. La aceptación HTTP no sustituye una revisión visual en navegador.
