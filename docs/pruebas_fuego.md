# Panel local de pruebas de fuego

Pulsar el botón Pruebas de fuego encima de las métricas para abrir el modal. Se cierra con la X, Escape o un clic fuera; el foco queda contenido por el diálogo nativo y vuelve al botón al cerrar. Durante el envío se bloquea el cierre para evitar acciones duplicadas. Elegir ronda carga las cantidades oficiales; después se pueden ajustar. Iniciar ejecuta una ronda; Reiniciar aplica la configuración visible desde turno cero. Se reemplaza la simulación anterior, sus métricas, reservas, eventos y namespace de decisiones. El mapa se actualiza sin recarga gracias al nuevo runId. No cambia ningún JSON de escenario.

| Campo | Límite |
|---|---|
| Ronda | Anochecer / Medianoche / Apocalipsis |
| Supervivientes | 1–500 |
| Caminantes, corredores, hordas, dormidos | 0–200 cada uno, máximo 200 en total |
| Turnos | 1–150 |
| Semilla | 0–2147483647 |
| Estrategia | Base / Pro |
| Distribución | Equilibrada / Aleatoria |
| Bloqueos | Mantiene o desactiva los eventos de la ronda |

Solo se conservan los eventos cuyo turno o intervalo completo cabe en la duración elegida. Las cinco camionetas y cuatro refugios mantienen las reglas actuales; el panel no modifica capacidades, velocidades ni rutas. Turnos de 2 s por defecto: bajar TURN_SECONDS cambia la distancia física por turno y no equivale a acelerar una comparación reglamentaria.

## Ejecución

Con dependencias instaladas, dos terminales. Desde backend/: definir API_KEY y opcional ROUTING_STRATEGY=pro; ejecutar `python -m app.dashboard_server`. Desde frontend/: definir la misma API_KEY en el entorno del proceso, ejecutar `npm run dev`. Abrir http://127.0.0.1:5173. Node 24. No iniciar simultáneamente CLI o uvicorn en el puerto 8000.

La clave es exclusiva de servidor. Vite inyecta x-api-key en /api/control; el navegador solo envía configuración. Origen Host/Origin coincidente y Content-Type JSON obligatorios para mutaciones. Un origen ajeno o POST sin Origin recibe 403 del proxy. El backend exige clave incluso para el estado de control. La API ordinaria no expone las rutas: solo el entrypoint opt-in dashboard_server las registra. Escucha únicamente loopback. Se conserva CORS GET y /paso privado.

Contratos: contracts/openapi.yaml para la API ordinaria, contracts/dashboard-control.openapi.yaml para el servidor de control. Configuración extra/inválida devuelve 422 sin destruir el run actual. Inicio/reinicio serializado, cancelación y espera del dueño anterior, único coordinador; al finalizar el backend permanece activo. Cierre del servidor cancela el task. Estado en memoria, sin historial persistente de controles. Los resultados actuales se consultan en Telemetría; las evaluaciones CLI siguen exportando JSON/CSV.

/estado incluye runId, turnosTotales y segundosPorTurno. /paso conserva su petición y respuesta exactas. runId y metadata de duración se excluyen de la firma determinista: no cambian reglas ni resultados del mundo. La selección se limpia al reiniciar para no confundir actores con IDs reutilizados.

## Evidencia

- backend/tests/test_dashboard_control.py: activación explícita, autenticación, validación, estado conservado al fallar, reinicios concurrentes, cancelación y único task, eventos dentro de la duración.
- frontend/src/components/SimulationControls.test.tsx: presets, configuración numérica, inicio/reinicio, límites y errores. providers.test.ts verifica turno cero con runId nuevo y rechazo de regresiones en el mismo run.
- backend/scripts/check_dashboard_controls.py ejecuta aceptación por TCP real pasando por Vite. Evidencia en reports/dashboard_control_live.json: protección de proxy/backend, finalización por HTTP privado real, validación y reinicios de ejecuciones activas y terminadas.
- Backend completo: 72 pruebas aprobadas, una advertencia de deprecación, 180.11 s. Frontend: 25 pruebas aprobadas y build/TypeScript/escaneo de claves aprobados.
- Resultados completos: reports/control_frontend_tests.txt, control_frontend_build.txt y control_backend_full.txt.

Este panel es local. Para producción se requiere autorización de operadores y proxy de servidor; nunca distribuir API_KEY mediante VITE_*. No se modificó infra/ ni se desplegó.

Actualización modal: 26 pruebas frontend aprobadas (reports/control_modal_verified_tests.txt), con apertura/cierre y restauración del foco. Compilación en reports/control_modal_verified_build.txt. Las pruebas de diálogo son jsdom con métodos nativos simulados; no sustituyen la revisión visual en navegador.


## Dormidos visibles solo para el operador

En Capas activar Dormidos (solo pruebas), desactivado inicialmente. Se dibujan con zZ azul y un rótulo PRUEBAS; apagar la capa elimina los marcadores y cancela la consulta. La opción no cambia configuración, posiciones ni comportamiento del mundo. Para tener dormidos, configurar una cantidad mayor que cero (Apocalipsis trae 8).

GET /control/dormidos exige x-api-key, existe solo en dashboard_server y responde Cache-Control: no-store. Vite utiliza el proxy /api/control ya protegido por origen/clave de servidor. Respuesta separada con runId, ronda, turno y pares id/nodo de los que todavía duermen. Se lee bajo el lock del coordinador para no capturar movimientos parciales. El algoritmo no consulta este canal; /estado y Observation continúan omitiendo dormidos. No se mezcla esta respuesta con VisualState.zombies ni con datos del proveedor público: componente SleeperDebugLayer independiente.

El frontend consulta solo al activar la capa y al cambiar el frame público. Descarta datos con runId/ronda/turno distintos, aborta al desactivar o cambiar frame, y evita marcadores de otra ejecución. Al despertar, el zombie desaparece de depuración y aparece como caminante normal. La API ordinaria devuelve 404; sin clave el servidor de pruebas devuelve 401. No habilitar en producción pública.

Pruebas: test_sleepers_debug_is_authenticated_read_only_and_never_enters_planning valida que observar dormidos conserva estado público, snapshot y decisiones. También verifica activación y retirada del dormido. SleeperDebugLayer.test.tsx valida opt-in, separación, abort, frame obsoleto y errores. Reports: sleeper_debug_frontend_tests.txt, sleeper_debug_build.txt, sleeper_debug_backend_targeted.txt y sleeper_debug_backend_full.txt.

Validación de la capa: 30 pruebas frontend aprobadas y build/TypeScript aprobados. Siete pruebas backend dirigidas aprobadas. Aceptación por TCP real en sleeper_debug_live.json: ocho dormidos de depuración, cero públicos, estado público idéntico antes/después, autenticación/origen y no-store verificados. La configuración anterior del operador se restauró (la ronda reinició desde cero al recargar el servidor).

Suite completa final: 73 pruebas backend aprobadas en 156.64 s, una advertencia de deprecación. Se repitió con -p no:faulthandler por una incidencia del manejador diagnóstico de Windows en la primera ejecución; no se cambió el motor de simulación. Resultado: reports/sleeper_debug_backend_verified.txt.
