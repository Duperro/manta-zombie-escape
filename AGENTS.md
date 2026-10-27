# Desarrollo full stack — traspaso autorizado

Ámbito autorizado por el usuario: backend, frontend/, contratos, datos, documentación y correcciones de .kiro/. Preservar archivos históricos de Kiro en archive/. No modificar infra/ del responsable AWS ni sobrescribir trabajo ajeno.
Organización autorizada por el usuario: main integra feat/backend-simulator (backend/datos), feat/frontend-dashboard (interfaz) y chore/docs-contracts (entrega). Trabajar en la rama de su categoría. La solicitud actual autoriza crear ramas, commits y merges de integración; no desplegar. Para cambios posteriores no hacer push/merge sin autorización.
No incluir secretos, caches OSM ni entornos virtuales en Git. Preservar main.py y .venv originales; entrada correcta app.server:app.
No versionar ni subir resultados generados por corridas, pruebas, benchmarks o capturas en reports/. Conservarlos localmente; versionar solo los README de ese directorio y resúmenes documentales en docs/. No forzar su inclusión con git add -f.

Python 3.11/3.12. Desde backend/: python -m app.export_contract y python -m pytest -q --durations=5.
El conjunto incluye tres rondas de 150 turnos por TCP real; requiere acceso localhost.
Regenerar OpenAPI y ejemplos después de cambios en modelos. /paso conserva exactamente petición y respuesta obligatorias.
Mapa en /mapa; /estado contiene solo el último estado publicado. No exponer dormidos ocultos.

Un único proceso/worker y coordinador. No crear bucles de turnos por petición.
Planificador solo recibe Observation; nunca consultar zombies internos desde routing/.
Conservar direcciones, geometrías y aristas paralelas. Las decisiones por nodo seleccionan la arista abierta más rápida.
Medir HTTP real; excluir tiempos de pared al comparar determinismo. No afirmar SLA si no se midió.
Documentar interpretaciones y añadir pruebas de comportamiento al cambiar reglas.
El usuario autorizó Fase 3. Conservar Base y Pro sobre el mismo World y reglas físicas.
No pasar zombies internos, posiciones ocultas ni RNG a la estrategia: usar Observation y PlanningContext.
No escribir reservas dentro de /paso; planificar y aplicar el lote bajo el coordinador.
Ejecutar invariantes después de cada turno, incluidas reservas, pasajeros y tramos válidos.
Comparar estrategias con huellas iniciales idénticas y espacios de idempotencia nuevos por ejecución.
No confundir activos/vivos con evacuados. No inventar una puntuación oficial total.
La misión de traspaso autoriza completar e integrar el frontend. No hacer push, merge ni despliegues.

Frontend: Node 24, npm ci, npm test y npm run build desde frontend/. VITE_DATA_SOURCE=api por defecto; mock siempre explícito. No exponer API_KEY ni llamar POST /paso desde el navegador. Proxy dev de lectura limitado a los tres GET públicos. El usuario autorizó controles locales de prueba: /api/control/estado, /api/control/iniciar y /api/control/dormidos, con API_KEY inyectada solo en el proxy de Vite y validación de origen. /paso no se proxifica. CORS_ORIGINS enumera orígenes exactos para GET cuando hay dominios distintos.
No inventar posiciones, rutas, estados o métricas. VehicleView y OpenAPI regenerado son la referencia; siete estados y 25 métricas. Polling secuencial con cancelación, cache de mapa y último estado válido.
La evidencia HTTP/RTL no equivale a revisión visual de Leaflet en navegador. Ver pendientes y resultados en docs/traspaso_kiro.md.

Panel de pruebas: iniciar app.dashboard_server (loopback, un worker) para tener dueño persistente del reloj; la CLI anterior conserva su propio dueño y no se ejecuta en paralelo. Controles opt-in y protegidos; contratos adicionales en contracts/dashboard-control.openapi.yaml. runId distingue reinicios; metadata de ejecución excluida de la firma determinista.

El usuario autoriza visualizar dormidos solo en una capa local de depuración opt-in, vía /control/dormidos protegido y sin cache. No incorporarlos a /estado, Observation, planificadores, rutas ni métricas. Verificar runId/ronda/turno antes de dibujar y eliminar al despertar.

Averías autorizadas: física opt-in común Base/Pro, sorteos independientes por vehículo/ronda/turno/tipo; 1–30 turnos completos de reparación sin movimiento/embarque/desembarque. Preservar pasajeros supervivientes y sus reservas; liberar recogidas pendientes. Nunca pasar registros internos de contacto al planificador. Ver docs/averias.md.
