# Mapa real e interpretaciones

La fuente se descargó el 27 de octubre de 2026 con OSMnx 2.0.2. Bounding box [oeste,sur,este,norte]: [-80.78,-1.00,-80.67,-0.935]. Red drive, retain_all=True, simplify=True, conservando bridge. El endpoint principal Overpass respondió saturación; la descarga efectiva usó https://overpass.kumi.systems/api. Datos © OpenStreetMap contributors, licencia ODbL: https://www.openstreetmap.org/copyright.

Red fuente: 7.208 nodos y 19.856 aristas dirigidas. Se toma el mayor componente fuertemente conectado. Cada ancla se ajusta al nodo vial más cercano; caminos dirigidos de ida/vuelta conectan las cuatro anclas y un puente real. Una expansión alternada cerca de las anclas añade caminos hasta superar 300. El subgrafo inducido final tiene 306 nodos y 571 aristas; no se inventan enlaces entre coordenadas. Existe una ruta dirigida entre cada par de nodos antes de bloqueos. Los 6 nodos adicionales conservan caminos completos.

Anclas obtenidas por Nominatim (consulta '<sector>, Manta, Ecuador'):

| Sector | Latitud | Longitud |
|---|---:|---:|
| Tarqui | -0.9784464 | -80.7243193 |
| Los Esteros | -0.9585425 | -80.6846573 |
| Barbasquillo | -0.9515404 | -80.7527254 |
| Jocay | -0.9598756 | -80.7161161 |

Estas anclas son resultados de geocodificación, no límites administrativos verificados. Los nodos se agrupan por ancla más cercana para distribuir sobrevivientes. Tarqui y Los Esteros pueden representar centroides del lugar nombrado. Una revisión local del equipo puede ajustar anclas y regenerar el estudio. La selección es una red reducida con corredores entre sectores, no todas las calles de los cuatro barrios; puede omitir rutas alternativas y sesgar resultados de evacuación.

OSMnx elimina nodos geométricos intermedios al simplificar; las geometrías completas, longitudes y osmids de las vías simplificadas se exportan. No se añaden atajos rectos al conectar sectores. Cada calle lógica puede por ello contener curvas y varios segmentos OSM. Un movimiento recorre una arista lógica, tal como define el enunciado, y distancia/velocidad pondera la elección; no se simula desplazamiento continuo de 2 s.

Clasificación, en orden: bridge distinto de no/false/0 → puente; service=alley o nombre callejón/callejon → callejón; highway principal (motorway/trunk/primary/secondary/tertiary y enlaces principales) o nombre avenida → avenida; resto → calle. No se infieren puentes por cercanía al agua. Las 14 aristas puente corresponden a direcciones/segmentos, no a 14 estructuras físicas. La red drive excluye algunos callejones peatonales: solo se incluyen los caminos presentes en esa descarga.

Tiempo estimado = longitud OSM / velocidad configurable. No se utiliza maxspeed vehicular como velocidad humana. IDs N-<OSM>, E-<OSM origen>-<OSM destino>-<clave>; estables para este snapshot de red, no garantizados ante ediciones OSM futuras. mapaVersion es hash del contenido vial exportado. Un cambio de velocidades de entorno modifica tiempos del servidor sin cambiar la identidad topológica del mapa.

Refugios: shelters.json explica la selección de un nodo de buen grado vial a menos de ~450 m de cada ancla, sobre el componente conectado. Son puntos de simulación y no instalaciones oficiales verificadas. El archivo almacena capacidades y coordenadas; al servir se derivan coordenadas del nodo real. Evacuaciones empatadas se resuelven por ID, sin exceder ocupación ni reservas.

Interpretaciones de reglas: detección zombie mediante saltos dirigidos transitables, respetando bloqueos; vecinos de horda incluyen entrantes y salientes. Corredores recalculan objetivo en cada subpaso; empate por distancia e ID, sin objetivo eligen vecino abierto ordenado mediante RNG con semilla. Las aristas paralelas usan la opción abierta de menor tiempo, desempate por ID. Para cruces opuestos se compara geometría canónica y conjunto de osmids, evitando considerar calles paralelas distintas como la misma calle física.

Dormidos solo se activan por sobrevivientes activos tras movimientos; quien recibe una mordida en ese mismo turno todavía puede activarlos antes de registrar su eliminación. Personas eliminadas en turnos previos o ya evacuadas no los activan. Coincidencia de nodo incluye un dormido interno aunque el planificador no sepa su posición. Una mordida elimina inmediatamente; no hay conversión en zombie porque no se especificó. Mordidas tienen prioridad sobre refugios.

Las rutas excluyen nodos de zombies visibles y de hordas. Si el origen ya está excluido, el algoritmo Base permanece quieto: no intenta una maniobra de escape Pro. Sin ruta o refugio con espacio, también espera y puede morir. No hay garantías de porcentaje de evacuación.

Validaciones ejecutables: modelos Pydantic, unicidad, coordenadas finitas, extremos existentes, longitudes/velocidades positivas, tiempos consistentes, geometrías válidas y conectividad fuerte. Pytest comprueba rutas entre sectores y desde cada nodo hacia los cuatro refugios, carga JSON, sentidos y paralelas. Eventos pueden romper esa conectividad; la espera sin ruta es un resultado permitido.

Referencias técnicas: https://osmnx.readthedocs.io/en/stable/user-reference.html y https://nominatim.org/release-docs/latest/api/Search/.
