# Contrato de integración React — Fase 3

Fase 3 conserva los campos de Fase 2 y /paso. Añade estrategia, funcionalidadesPro, riesgo, refugios con plazas_disponibles/sobrevivientesAsignados/idAnterior, vehículos tipados y camionetaId/distancias/modoEvacuacion por sobreviviente. OpenAPI actual 0.3.0.

Los refugios ahora usan R-001…R-004 y el campo idAnterior conserva R-1…R-4. Estados Pro: CAMINANDO, HACIA_ENCUENTRO, ESPERANDO_RESCATE, EN_CAMIONETA, EVACUADO y ELIMINADO; ACTIVO sigue siendo válido en Base.

Ejemplos actuales: estado.example.json (Base), estado.pro.example.json (Pro, ronda 3 inicial), estado.pro.transporte.example.json (respuesta HTTP real con pasajeros). riesgo expresa niveles heurísticos para turnoPredicho, no ubicaciones futuras confirmadas. No incluye dormidos ocultos.

Cada camioneta publica nodoActual, estado, capacidad, pasajeros, capacidadUtilizada, sobrevivientesAsignados, puntoEncuentro, refugioDestino, rutaPlanificada, aristasRecorridasEnTurno, viajesRealizados y distanciaRecorrida_m. Un pasajero se dibuja en su vehículo y no debe animarse caminando por su cuenta. /paso devuelve su mismo nodo del snapshot; el traslado se publica en /estado tras resolver las aristas del vehículo. Eventos nuevos: embarque, rescate_cancelado, encuentro_actualizado y evacuacion con modo caminando/camioneta.

Las rutas peatonales pueden terminar en un encuentro o contener solo una retirada segura de un paso; refugioAsignado sigue indicando el destino reservado. Las plazas reservadas no cuentan como ocupadas; una persona dentro de un vehículo aún no está evacuada. Guía técnica completa: fase3.md.

Fuente: modelos FastAPI; contracts/openapi.yaml generado por python -m app.export_contract. Ejemplos reales: estado.example.json, mapa.example.json, paso.example.json. El dashboard no requiere API key para GET.

- GET /health: 200, {"status":"ok","service":"manta-zombie-escape"}.
- GET /mapa: 200, version, atribucion, nodos, aristas, sectores y metadata. nodos incluyen id/lat/lng/sector. Cada arista tiene id/origen/destino/distancia_m/tipo/velocidad_m_s/tiempo_estimado_s/bloqueada/geometria/osmids.
- GET /estado: 200, turno/ronda/fase/estadoSimulacion/versionGrafo/mapaVersion; sobrevivientes/zombies/refugios; nodosBloqueados/aristasBloqueadas/rutas/metricas/eventosRecientes. camionetas contiene cinco vehículos en los escenarios reales.
- POST /paso: x-api-key obligatorio; petición exacta {"sobrevivienteId":"S-0089","nodoActual":"N-0117","turno":142}; respuesta exacta {"siguienteNodo":"N-0118"}. Ejemplo de contrato, no IDs que deban existir en este mapa.

## Cambios desde Fase 1

/estado ya no contiene nodos ni calles: cargar /mapa y guardar un índice por nodo/arista. En /mapa la colección se llama aristas.
Estados de sobrevivientes: ACTIVO, CAMINANDO, HACIA_ENCUENTRO, ESPERANDO_RESCATE, EN_CAMIONETA, EVACUADO y ELIMINADO.
Se mantiene nodo como alias de nodoActual para facilitar migración. Se mantienen capacidad/ocupacion y se añaden capacidad_maxima/plazas_reservadas/estado/nombre/lat/lng en refugios.
rutaPlanificada comienza en nodoActual tras publicar un turno; el campo rutas incluye los actores activos.
Los IDs reales usan N-<osmid>, E-<origenOSM>-<destinoOSM>-<clave> y S-R<ronda>-<número>. No convertirlos a números.

## Leaflet y sincronización

geometria usa [lng,lat]; convertir a [lat,lng] para Polyline, o usar GeoJSON. Dibujar cada arista paralela como registro separado y respetar su dirección.
Cargar el mapa una vez por mapaVersion. Los bloqueos dinámicos se aplican sobre la capa del cliente por aristasBloqueadas. /mapa representa la base inmutable, no los bloqueos de cada turno.
El dashboard consulta /estado cada 1 s sin solapar solicitudes; los turnos reglamentarios son de 2 s. Publicación atómica: mientras el motor decide, el endpoint devuelve el último turno resuelto, nunca actores a mitad de movimiento. Dentro de una ronda descartar respuestas con turno menor; ronda cambia y turno vuelve a 0 al reiniciar.
Los eventos incluyen id único, turno y tipo; eventosRecientes limita a los últimos 50. El reporte JSON conserva el historial completo. No contar varias veces un evento al hacer polling.
Rondas distintas usan actores con IDs distintos; las decisiones históricas permanecen idempotentes. Un reintento con mismo id/turno y nodo distinto recibe 409.
Los errores de movimiento no bloquean el reloj. Respuesta tardía (>500 ms), fallo HTTP o esquema inválido: permanece en el nodo y se registra el fallo. Un destino no vecino también se rechaza al validar.

## Errores y alcance

401: API key ausente/incorrecta. 422: esquema inválido. 409: turno sin snapshot o posición incompatible con decisión almacenada. 404: ID desconocido; actores inactivos conocidos reciben su mismo nodo.
La API standalone sirve la ronda 1 inicial con la estrategia de entorno. La CLI incluye servidor y coordinador y permite consultar /estado en su puerto durante la demostración. Al cambiar de semilla/estrategia se inicia un run de decisiones nuevo: no reutilizar reintentos de experimentos anteriores.
CORS opcional mediante CORS_ORIGINS separado por comas, orígenes exactos y métodos GET. Vite proxifica solo /api/health, /api/mapa y /api/estado. El frontend no llama /paso ni recibe la API key.
Dashboard implementado en frontend/. Ver frontend/README.md y docs/traspaso_kiro.md para ejecución, evidencia y límites. No se enviaron mensajes al equipo.


## Control local de pruebas (ampliación autorizada)

app.dashboard_server añade GET /control/estado y POST /control/iniciar protegidos por x-api-key. La aplicación ordinaria no registra estas rutas. Vite proxifica /api/control con clave de su proceso, sin exponerla al cliente; POST exige origen local coincidente y JSON. CORS sigue siendo solo GET; los controles se usan desde el proxy del mismo origen. /paso no cambia ni se expone al dashboard.

GET /estado añade runId (no nulo en el servidor controlado), turnosTotales y segundosPorTurno. El cliente acepta un turno menor solo si cambió runId; conserva el rechazo de regresiones dentro del mismo run. Un reinicio cambia el namespace de decisiones y cancela el dueño anterior antes del reset. Ver pruebas_fuego.md y contracts/dashboard-control.openapi.yaml. La CLI finita sigue disponible para comparaciones y ejecución automática.

Depuración local autorizada: GET /control/dormidos protegido, separado de /estado y Observation, sin cache y bajo lock. Solo componente SleeperDebugLayer lo consume cuando el operador activa la capa; no se publica al algoritmo. Contrato en dashboard-control.openapi.yaml y detalles en pruebas_fuego.md.
