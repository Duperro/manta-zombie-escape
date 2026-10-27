# Validación de latencia HTTP de Pro

La regresión de Pro exige dos ejecuciones de 150 turnos con 200 supervivientes,
servidor Uvicorn y cliente HTTPX por TCP real. Conserva concurrencia 4, límite de
500 ms, contrato exacto de `/paso`, invariantes y comparación de firmas sin
tiempos de pared. No se aumentaron timeouts ni se añadieron reintentos.

## Corrección

El rastreo de una petición de 521 ms encontró repetidamente
`importlib._path_stat → httpcore._synchronization.current_async_library` durante
asignación y cierre de conexiones. El entorno tenía HTTPX 0.28.1, HTTPcore 1.0.9,
AnyIO 4.15.1 y no tenía `sniffio`. HTTPcore intentaba importar ese paquete opcional
en cada detección del backend; al faltar, volvía a buscarlo en disco. Es la
[regresión reportada en HTTPcore #1103](https://github.com/encode/httpcore/pull/1103).
AnyIO dejó de traerlo transitivamente. Se declara `sniffio==1.3.1` explícitamente
en `backend/pyproject.toml`, sin parchear librerías instaladas ni cambiar el
backend asíncrono. `pip install -e '.[test]'` instala la corrección también en un
entorno nuevo. `pip check` pasó. Evidencia resumida con trazas y pilas reales en
`reports/pro_latency_io_diagnosis.json`.

`World.valid` comprobaba cada tramo reconstruyendo el grafo transitable completo.
Ahora consulta directamente si existe una arista abierta en la dirección pedida;
en multigrafos basta una de las paralelas abiertas. Las decisiones continúan
seleccionando la arista abierta más rápida en el código de movimiento existente.
La prueba nueva compara las respuestas con la construcción original sobre cuatro
clases de grafo, bloqueos dinámicos, direcciones y restricciones de hordas.

Esta optimización sola no eliminó el fallo: la repetición dirigida registró dos
errores en la segunda ejecución. Se conserva el reporte de ese intento en
`reports/pro_latency_fixed_targeted.txt` para no presentarlo como una validación.

El coordinador ahora cede una vez al bucle de eventos después del cálculo
síncrono y antes de despachar el lote HTTP. Permite procesar finalizaciones de
sockets y callbacks de conexiones persistentes pendientes del lote anterior.
La medición sigue comenzando antes de `client.post` y termina al validar la
respuesta; el cálculo previo y la espera del semáforo ya estaban fuera de esa
medición. Un fallo continúa manteniendo al actor en su nodo y ahora registra
turno, ID del actor, tipo de excepción y duración, sin credenciales.

El despacho mantiene solo tantas tareas como ranuras de concurrencia, en vez de
una tarea suspendida por cada actor. Todos los actores siguen enviando una
petición HTTP por turno. Las pruebas comprueban actores vacíos, un actor, 37 y
200 actores, sin duplicados y con el mismo máximo de peticiones simultáneas.

La flota descarta candidatos a agruparse cuando su distancia mínima dirigida al
encuentro supera los dos tramos ya permitidos. Es un filtro conservador: no evita
la comprobación posterior de la ruta ponderada ni elimina candidatos admisibles.
Evita construir árboles de rutas completos para personas demasiado lejanas. Una
prueba diferencial de cuatro turnos con 200 actores compara todos los estados,
decisiones, eventos y física con la búsqueda sin filtro.

El diagnóstico con instrumentación reprodujo una petición de unos 600 ms y dos
errores en la segunda ejecución, además de pausas de GC y reconstrucciones
repetidas de grafos. La instrumentación añade coste: esos valores son evidencia
de diagnóstico, no un benchmark limpio ni prueba de una causa exclusiva.
Resumen en `reports/pro_latency_diagnosis.json`.

## Intentos previos al arreglo de la dependencia

Antes de corregir la dependencia, una regresión dirigida pasó con las primeras optimizaciones:
15.408 peticiones en total, cero errores HTTP, cero respuestas inválidas y cero
peticiones superiores a 500 ms. Cada ejecución terminó los 150 turnos y produjo
la misma huella inicial y firma final. Los p95 fueron 81,22 y 64,94 ms;
los p99, 137,98 y 104,23 ms. Son mediciones locales de esa ejecución y no un SLA
de producción. Ver `reports/pro_latency_fair_dispatch.txt` y
`reports/pro_latency_targeted_metrics.json`.

Esa aprobación aislada no bastó: la suite completa posterior falló con dos
timeouts en el turno 29. Ver `reports/pro_latency_backend_full.txt`. Este resultado
motivó el rastreo de I/O y la corrección de la dependencia; los intentos anteriores
se conservan como diagnóstico y no acreditan la validación final.

## Validación final con la dependencia corregida

La suite completa pasó: **103 pruebas**, una advertencia de deprecación de
Starlette/AnyIO, ningún fallo. Contratos regenerados sin diferencias.
Reporte: `reports/pro_latency_backend_final.txt`.

Las dos ejecuciones de Pro completaron 150 turnos cada una, con 7.704 peticiones
HTTP medidas por ejecución: cero errores, cero respuestas inválidas, cero rutas
inválidas y cero peticiones superiores a 500 ms. P95: **11,11 y 11,88 ms**;
p99: **17,29 y 20,34 ms**. Huellas iniciales y firmas finales coinciden entre
ejecuciones. La firma final también coincide con la ejecución correcta anterior
a estas optimizaciones (`fcce7444…f563381`), conservando las decisiones y reglas.

Base completó sus tres rondas de 150 turnos y 6.633 peticiones medidas en total,
también sin errores, respuestas inválidas, rutas inválidas ni excesos de 500 ms.
Todos los resultados son locales; no acreditan un SLA de producción. Métricas y
firmas en `reports/pro_latency_final_metrics.json`.

Frontend verificado de nuevo con Node 24.22.1: `npm ci --prefer-offline`
(cero vulnerabilidades reportadas), **36 pruebas aprobadas** y build de
producción aprobado, incluida la comprobación de ausencia de credenciales en el
bundle. Reportes `pro_latency_frontend_install.txt`,
`pro_latency_frontend_tests.txt` y `pro_latency_frontend_build.txt` en `reports/`.
