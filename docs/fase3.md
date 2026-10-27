# Fase 3: estrategias, contratos y reglas de diseño

El algoritmo 3.2.0 utiliza el mismo World, coordinador, grafo y reglas físicas para Base y Pro. ROUTING_STRATEGY selecciona base/pro; PRO_PREDICTION, PRO_RESERVATIONS y PRO_FLEET permiten ablaciones independientes. La API no planifica dentro de /paso: sirve decisiones ya calculadas para un snapshot.

## Frontera observable y predicción

Observation contiene un grafo dirigido transitable privado e inmutable, posiciones de sobrevivientes vivos, refugios y zombies **visibles**, nodos de horda y trayectos zombie ya observados. PlanningContext expone actores propios, refugios, vehículos, reservas y parámetros; no incluye el mundo interno, zombies dormidos, eventos futuros ni generadores aleatorios.

RunnerPredictor examina hasta dos aristas desde cada corredor visible. Los destinos bloqueados, sentidos contrarios y obstáculos de horda se excluyen. Se enumeran posibilidades; no se consulta el sorteo que ejecutará World. El riesgo de un vecino es 0,7 y a dos aristas 0,45; una persecución compatible con posiciones actuales aumenta a 1,0 los tramos probables. Empate por distancia en saltos e ID del objetivo. Estos valores son niveles heurísticos, **no probabilidades calibradas**.

La persecución se estima con sobrevivientes en sus posiciones observadas, sin afirmar que permanecerán allí. Por eso también se mantiene la envolvente de otras posiciones alcanzables. El riesgo publicado indica turnoObservado y turnoPredicho=turnoObservado+1.

Se distinguen dos peligros:

- Actual: nodo zombie visible, horda y aristas ya recorridas en sentido opuesto este turno. Se prohíbe el destino o intercepción correspondiente.
- Predicho: nodos y aristas que podrían ocupar corredores en su siguiente fase. Añaden penalización, sin declararse hechos futuros.

Costo Pro de una arista u→v:

`tiempoEstimado(u,v) + RISK_WEIGHT × [riesgoNodo(v) + 0,75 × riesgoArista(v,u)]`.

El término de arista penaliza intercepciones potenciales en sentido contrario. Las restricciones obligatorias se eliminan del grafo antes de buscar rutas. Se comparten árboles Dijkstra inversos hacia los refugios y árboles por origen para candidatos de rescate, una vez por snapshot; no se reutilizan después de un cambio de peligro.

Cuando el origen está ocupado, Pro puede salir hacia un vecino permitido; nunca entra en otro nodo prohibido. Si la ruta al refugio falta o el siguiente paso tiene riesgo alto, la retirada selecciona un vecino con mejora de riesgo suficiente y desempata por costo hacia refugio. Ante una coincidencia zombie ya observada, salir tiene prioridad sobre cualquier penalización futura. Puede optar por una intención de un solo paso y volver a planificar después. Sin vecino válido permanece quieto y puede ser eliminado. Una penalización no garantiza supervivencia.

## Refugios y reservas

Se mantienen los nodos y capacidades de Fase 2. IDs normalizados a R-001, R-002, R-003 y R-004; idAnterior conserva R-1…R-4 para migración.

`plazas_disponibles = capacidad_maxima - ocupacion - plazas_reservadas`.

ShelterAllocator construye un min-cost flow de hasta 200 personas y cuatro refugios. Cada persona demanda una plaza; las capacidades descuentan ocupaciones confirmadas. Las rutas inaccesibles no generan opciones. Una salida ficticia de costo alto representa **sin asignación**, nunca una plaza adicional. Se minimiza el costo global y se desempata de forma determinista.

Las reservas anteriores se mantienen si las alternativas no mejoran al menos REASSIGNMENT_IMPROVEMENT. Si el refugio se cierra, se vuelve inaccesible o aumenta suficientemente el costo/riesgo, se permite cambiarlo. Un pasajero confirmado tiene menor tiempo de viaje estimado por VEHICLE_EDGES_PER_TURN; su penalización de riesgo no se reduce.

MemoryReservations ofrece reserve, release, confirm y replace(expected_version), protegidos por RLock. El reemplazo de toda la asignación valida capacidad antes de aplicar el cambio. Una persona tiene una sola reserva; pedirla de nuevo no crea otra. Un cambio sustituye la anterior atómicamente, la muerte libera, y la llegada transforma reserva en ocupación. confirm es idempotente. Personas embarcadas conservan su reserva o reciben una reasignación válida durante el siguiente precálculo.

La interfaz ReservationRepository delimita futuras transacciones/versiones condicionales DynamoDB. Actualmente todo está en un proceso. Las peticiones HTTP no escriben reservas. No basta desplegar varios workers con estos diccionarios.

## Flota y beneficio de rescate

Cinco vehículos de cuatro plazas, definidos en data/scenarios/fleet.json. El script scripts/plan_fleet_posts.py obtiene puestos estáticos únicamente del mapa y refugios: maximiza beneficio marginal de transporte en saltos, alternando sectores. No mira posiciones de zombies ni semillas. Base y Pro reciben los mismos puestos; Base deja la flota sin despachar.

VEHICLE_EDGES_PER_TURN=2 interpreta velocidad doble como hasta dos aristas por turno. No convierte tiempo/distancia real en movimiento continuo. Cada microtramo se valida en el grafo real; no existen saltos ni recogidas a distancia. Los vehículos usan calles transitables, sentidos y exclusiones de horda/zombies actuales.

La prioridad aproxima:

`beneficio = turnosCaminando - turnosRescate + RESCUE_RISK_WEIGHT × exposición - 0,15 × turnosHastaRecogida`.

`turnosRescate = max(llegadaPersona,llegadaCamioneta) + 1 + llegadaRefugioEnCamioneta`.

Es una heurística explicable, no una probabilidad de muerte. Solo se consideran PICKUP_CANDIDATES personas prioritarias y MEETING_CANDIDATES puntos por candidato. Se evita despachar a alguien que puede llegar caminando en dos turnos sin peligro considerable. Se exige destino con plaza/reserva y beneficio mínimo. Se agrupan hasta cuatro personas próximas con el mismo destino; los IDs ya asignados se excluyen de las otras camionetas.

El tiempo operativo en saltos responde a la regla de movimiento; las rutas siguen el costo de distancia/velocidad y riesgo. Esta combinación no es un óptimo combinatorio.

## Encuentros, estabilidad y cancelaciones

Candidatos: nodo de la persona, próximos puntos de su ruta y vecinos transitables. Deben ser alcanzables por ambas partes, con refugio posterior viable y una diferencia de llegada dentro de MEETING_MAX_WAIT. Puntos con riesgo mayor o igual a MEETING_RISK_THRESHOLD se descartan.

Se conserva un encuentro viable. Se reevaluan pocos puntos y solo se cambia por una mejora relativa suficiente y al menos un turno de beneficio, o porque deja de ser viable. Se publica encuentro_actualizado con punto anterior y nuevo. Si aparece peligro, bloqueo, muerte, evacuación, falta de capacidad o espera excesiva, se cancela/replanifica y se publica rescate_cancelado. Los peatones cancelados vuelven a CAMINANDO y reciben ruta al refugio.

Transiciones de vehículo: DISPONIBLE → HACIA_RECOGIDA → RECOGIENDO → HACIA_REFUGIO → DISPONIBLE. REPLANIFICANDO representa ausencia temporal de una ruta válida. Puede repetir viajes. Viaje significa una llegada con al menos un pasajero admitido; no una orden de recogida. Una camioneta puede hacer paradas sucesivas si las reservas de sus pasajeros se reasignan a destinos distintos; refugioDestino indica la siguiente parada.

Estados peatonales Pro: CAMINANDO, HACIA_ENCUENTRO, ESPERANDO_RESCATE. ACTIVO se conserva para Base y compatibilidad. EN_CAMIONETA implica que el sobreviviente no camina por separado. EVACUADO y ELIMINADO son terminales.

Embarque: persona y camioneta en el mismo nodo de encuentro al resolver el turno, persona viva y asignada a ese vehículo, plaza disponible y destino con capacidad/reserva. Solo entonces aparece EN_CAMIONETA y evento embarque. Se evacúa únicamente tras llegar físicamente a un refugio y confirmar ocupación.

## Incidentes en vehículos: interpretación propia

El enunciado no define inmunidad ni destrucción de camionetas. En esta implementación los pasajeros pueden morir al terminar cualquier microtramo en un nodo zombie o cruzar en sentido opuesto una calle recorrida por zombie ese turno. Se revisan ambos tramos, incluidos nodos intermedios. Si el vehículo permanece quieto, se revisa su nodo. Un pasajero eliminado se localiza en el punto del incidente y libera su reserva; el vehículo puede continuar sin él. No se modelan conductores, averías o destrucción.

Un vehículo vacío no obtiene protección para una persona: esta debe llegar al encuentro, sobrevivir las colisiones y embarcar. Una persona que llega caminando al refugio antes del embarque cuenta como evacuada caminando. Estas reglas se aplican en el mismo World para todas las estrategias y no se presentan como reglas oficiales del jurado.

## Orden e invariantes

Eventos → zombies/trayectos → snapshot observable → riesgo → asignación/reservas → rescates → decisiones peatonales → HTTP concurrente → movimientos de personas y vehículos → colisiones → activaciones → eliminaciones, desembarques, embarques y ocupaciones → invariantes → publicación → métricas.

Tras cada turno se comprueba: posiciones válidas, estados admitidos, plazas no negativas, ocupación/reservas dentro de capacidad, ausencia de reservas terminales/huérfanas, unicidad de pasajeros y asignaciones, coincidencia de posición pasajero/vehículo, trayectos transitables y límite de aristas. /estado sigue publicando solo el estado resuelto.

## Contrato y representación de pasajeros

/paso conserva únicamente sobrevivienteId, nodoActual, turno y respuesta siguienteNodo, con x-api-key. Para quien espera devuelve un vecino o el mismo nodo; para un pasajero, el mismo nodo **del snapshot previo al movimiento del vehículo**. El traslado de hasta dos calles se representa en camionetas y en el estado publicado, nunca como un salto peatonal en /paso. Los reintentos del mismo actor/turno/nodo repiten la decisión.

/estado añade estrategia, funcionalidadesPro, riesgo, vehículos tipados, reservas/disponibilidad/asignaciones de refugios, camionetaId y distancias/modo de evacuación por persona. Se mantienen todos los campos anteriores. Ver integracion.md, estado.pro.example.json y estado.pro.transporte.example.json.

## Reproducción y evaluación

Desde backend/, con el entorno y API_KEY:

```bash
python -m app.simulator.cli --strategy base --round all --fast --seed 7 --output ../reports/base_phase3_seed7
python -m app.simulator.cli --strategy pro --round all --fast --seed 7 --output ../reports/pro_phase3_seed7
python -m app.evaluation.compare --seeds 7 11 23 --output ../reports/phase3_release_v32
python -m app.evaluation.compare --seeds 7 --rounds 3 --ablations --output ../reports/phase3_ablation_v32
python -m app.evaluation.compare --seeds 7 --scenario ../data/scenarios/diagnostic_capacity.json --ablations --output ../reports/phase3_capacity
python -m app.evaluation.benchmark --batches 10 --concurrency 4
python -m app.export_contract
python -m pytest -q --durations=8
```

Para benchmark Pro, exportar ROUTING_STRATEGY=pro. Para tiempo real, omitir --fast en la CLI. Parámetros en backend/config/pro.env.example; no se cargan automáticamente.

Cada experimento reconstruye mundo, flota, reservas y estrategia; un nuevo experimento cambia el espacio de decisiones idempotentes. Las rondas conservan IDs distintos. Las decisiones históricas no deben compartirse entre semillas/estrategias. En producción reset_run debe seleccionar un nuevo runId persistente, no borrar un historial compartido.

Se comparan huellas de condiciones iniciales: grafo, personas, zombies, refugios, puestos y eventos idénticos por semilla/ronda. Las decisiones sí cambian las persecuciones futuras. El RNG de cada zombie depende de semilla, ID y turno; eventos tienen su propio generador. Una entidad no consume sorteos de las demás. Por ello el Base recalculado de Fase 3 no tiene que coincidir con los archivos históricos de Fase 2; esos archivos se conservan.

Los reportes incluyen semilla, parámetros sin API key, escenario, versión, fecha UTC, firmas de entrada/salida, vivos/evacuados/eliminados, transporte, distancias, ocupaciones, viajes, cancelaciones y HTTP real. Se exportan CSV/JSON y comparación con mejoras relativas y puntos porcentuales. diagnóstico_capacity.json es una prueba de estrés, no una ronda oficial.

Puntuación estimada: se calcula solo supervivencia ponderada `(R1 + 2×R2 + 3×R3)/6` y su componente de 50 puntos. No hay fórmula suficiente para normalizar eficiencia, latencia y disponibilidad según el jurado; puntuacionTotal es null. No se inventa un total oficial.

## Límites y AWS

Predicción de un turno, posiciones futuras inciertas, despacho greedy acotado y min-cost flow sin optimización conjunta de toda la flota. No garantizan mejora en cada semilla ni aporte individual en cada escenario. Deben presentarse también las ablaciones sin mejora o con regresión. El mapa reducido puede omitir alternativas. Las reservas activas al final de 150 turnos pertenecen a personas aún vivas, no son evacuaciones ni reservas huérfanas.

Latencia HTTP medida fuera de la espera previa del semáforo; el tiempo completo del turno sí incluye planificación y colas. Un timeout/JSON inválido deja a la persona quieta. No se garantiza un SLA de AWS con mediciones locales.

Para despliegue futuro: un único coordinador líder por simulación; runId/roundId y versión de snapshot en almacenamiento compartido; decisiones idempotentes precargadas; transacciones de ocupación/reservas; persistencia de eventos y parámetros/RNG; API key mediante secretos/entorno. No ejecutar varios workers con memoria local. El integrante AWS debe implementar y validar infraestructura, observabilidad y elección del líder. En esta fase no se creó ni desplegó infraestructura.
