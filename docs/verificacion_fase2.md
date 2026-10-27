# Verificación ejecutada — Fase 2

Fecha: 27 de octubre de 2026, Ecuador. Rama feat/backend-simulator. No se hizo push, merge, despliegue ni cambios en frontend/, infra/ o .kiro/.

## Base y pruebas

Antes de modificar: 16 pruebas de Fase 1 aprobadas en 4,96 s.

Conjunto completo: `python -m pytest -q --durations=5`, **37 passed, 1 warning in 35.87s**, salida 0. La prueba de tres rondas completas tardó 31,15 s y usa sockets TCP, con la misma topología de event loop que la CLI. Tras actualizar la versión OpenAPI a 0.2.0 se regeneró el contrato y se repitieron sus dos pruebas específicas: **2 passed, 1 warning in 0.82s**.

Advertencia: Starlette 0.46.2 usa un alias BlockingPortal de AnyIO marcado como deprecado. No es un fallo funcional. `pip check`: No broken requirements found. Python local 3.12.14. Las pruebas requieren localhost; el aislamiento del agente en Windows bloquea socketpair y se ejecutaron con acceso local autorizado.

Cobertura: mapa local real, unicidad, coordenadas, extremos, distancias y tiempos, conectividad fuerte y entre sectores/refugios; sentidos únicos y calles paralelas; distribuciones y semillas; cuatro tipos de zombies; mordidas por nodo y ambas aristas de corredores; calles físicas paralelas; capacidad y actores inactivos; eventos y recalculado; snapshots y publicación consistente; autenticación/validación/concurrencia/idempotencia; errores 503, respuesta inválida y timeout real; tres rondas sin acumulación de estado; exportación JSON/CSV.

## Mapa

Importación OSMnx ejecutada y JSON cargado/validado: 306 nodos, 571 aristas dirigidas, 14 aristas puente. Fuertemente conectado antes de eventos. Rutas desde todos los nodos hacia cada refugio comprobadas por Pytest. Mapa versión manta-bb3023537eb6eb6f; datos y método en mapa.md. Las anclas de sector no sustituyen límites administrativos verificados.

## Ejecución nativa, Windows

Comando: `python -m app.simulator.cli --round all --fast --seed 7 --port 8765 --output ../reports/base_seed7`.

Se usó HTTP_CONCURRENCY=4 y timeout de 500 ms. Reportes completos: reports/base_seed7.json y .csv.

| Ronda | Iniciales | Evacuados | Eliminados | Activos | Supervivencia | Evacuación | Duración | HTTP | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Anochecer | 20 | 19 | 0 | 1 | 100% | 95% | 7,363 s | 896 | 27,50 ms |
| Medianoche | 80 | 41 | 39 | 0 | 51,25% | 51,25% | 10,397 s | 1.904 | 25,19 ms |
| Apocalipsis | 200 | 39 | 161 | 0 | 19,50% | 19,50% | 10,535 s | 1.926 | 27,02 ms |

En total: 450 turnos, 4.726 solicitudes HTTP, 0 errores HTTP, 0 respuestas inválidas, 0 movimientos inválidos, 0 solicitudes sobre 500 ms. Disponibilidad observada 100% durante esta ejecución. Se aplicaron 0, 1 y 2 eventos de ciudad respectivamente. No se detienen rondas antes de 150 aunque ya no queden actores activos.

Una primera configuración con concurrencia 16 tuvo p95 de ronda 3 de 327,56 ms y 11 errores HTTP; queda como benchmark_c16.json/.csv. Reducir a cuatro solicitudes simultáneas eliminó esos errores en la medición final. Una primera prueba con servidor en otro hilo también detectó timeouts; la prueba de integración completa ahora reproduce el servidor y coordinador del mismo event loop de la CLI. Las demás pruebas siguen verificando servidores TCP separados, errores y timeout.

## Docker Linux

Construcción real aprobada: `docker build -f backend/Dockerfile -t manta-backend:phase2 .`, salida 0. Imagen Base Python 3.12-slim, aplicación 0.2.0, mapa local incluido, usuario sin privilegios.

Se ejecutó `docker run --rm ... manta-backend:phase2 python -m app.simulator.cli --round all --fast --seed 7 --output /reports/base_docker_seed7`, con un montaje local limitado a reports/ y clave temporal de verificación. Salida 0.

| Ronda | Duración | p95 HTTP | p99 HTTP |
|---|---:|---:|---:|
| Anochecer | 3,676 s | 7,74 ms | 10,52 ms |
| Medianoche | 5,478 s | 7,37 ms | 9,12 ms |
| Apocalipsis | 5,563 s | 7,58 ms | 9,24 ms |

Mismos evacuados, eliminados, activos, solicitudes y turnos promedio de evacuación que Windows. Se comparó además el historial completo de eventos y coincidió exactamente en las tres rondas. También 0 errores y 0 solicitudes sobre 500 ms. Evidencia en reports/base_docker_seed7.json y .csv.

Los ejemplos estado.example.json, mapa.example.json y paso.example.json se contrastaron con GET /estado, GET /mapa y POST /paso sobre un servidor TCP real: coincidencia exacta, salida 0.

## Límites de las mediciones

Percentiles nearest-rank del intercambio HTTP real (cliente, TCP, servidor y lectura/validación), excluyendo espera previa en el semáforo. Duración de turno incluye colas y cálculos. No equivalen a SLA en AWS, tráfico externo o puntuación oficial.

El modo real de 15 minutos no se cronometró completo; comparte el mismo evaluate_round y solo añade la espera correspondiente. Se verificaron las rondas aceleradas completas. La reproducción de reglas no incluye tiempos de pared; fallos HTTP externos pueden cambiar movimientos porque obligan a esperar.

No hay evaluación Pro, reservas inteligentes, camionetas, persistencia compartida, frontend integrado ni AWS. El mapa reducido omite alternativas y el Base queda quieto si su origen está bloqueado por peligro visible; esto limita especialmente la tercera ronda. Los refugios son ubicaciones para simulación, no instalaciones oficiales.
