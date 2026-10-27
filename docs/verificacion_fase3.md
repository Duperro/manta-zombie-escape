# Verificación real de Fase 3

Fecha: 27 de octubre de 2026. Aplicación/OpenAPI 0.3.0, algoritmo 3.2.0. Rama feat/backend-simulator. No hubo push, merge, despliegue ni cambios en frontend/ o infra/.

## Pruebas

Línea base previa: **37 passed, 1 warning in 43.37s**.

Batería final, desde backend/: `python -m pytest -q --durations=8`.

**66 passed, 1 warning in 156.42s**, salida 0. Salida conservada en reports/phase3_pytest.txt. La prueba de reproducción Pro ejecutó dos rondas completas de 200 personas por HTTP y tardó 81,08 s; la integración de las tres rondas Base tardó 66,94 s. La advertencia es la deprecación de un alias BlockingPortal entre Starlette y AnyIO. `pip check`: No broken requirements found.

Cobertura nueva: envolvente predictiva de dos aristas, rango tres, intercepciones y bloqueos/hordas; retirada; ausencia de información oculta/futura; reservas atómicas e idempotentes, traslado/liberación/confirmación, 200 intentos concurrentes; capacidad y rutas; cinco vehículos, embarques físicos, ambas aristas e incidentes, cancelación/reoptimización estable, pasajeros sin pasos peatonales independientes, viajes sucesivos; banderas; aislamiento del RNG; 200 peticiones reales, contratos, invariantes por turno y reproducción final.

Las cinco camionetas recogieron y evacuaron 20 personas distintas en una prueba física controlada. En los escenarios de comparación no se fuerza que todas trabajen: V-005 no realizó entregas en esas nueve rondas Pro, lo cual queda expuesto en resultados_fase3.md.

### Discrepancia encontrada y repetición

Una primera batería, ejecutada mientras también corrían comparaciones y compilación Docker, terminó con 64 pruebas aprobadas y una discrepancia entre firmas finales Pro. No se conservó entonces el primer estado divergente y no se atribuye una causa exacta no demostrada. Se amplió el test para conservar el diagnóstico, verificar errores/retardos HTTP y separar tiempos de pared de la firma.

La repetición aislada pasó: **1 passed in 105.14s**. La batería final completa, sin simulaciones pesadas en paralelo, pasó sus 66 pruebas. Además se compararon las dos firmas/historias Windows de esa batería con la ejecución Docker Linux de semilla 7/ronda 3: **coincidencia exacta**, incluidos todos los eventos. Evidencia nativa en reports/phase3_repro_windows.json. No se cambió el algoritmo para omitir la prueba. Una reproducción con diferentes fallos HTTP puede cambiar resultados porque el timeout obliga a permanecer quieto; no se garantiza determinismo frente a redes arbitrarias.

## Comparación principal

Se construyó localmente `manta-backend:phase3` y se ejecutaron **18 rondas completas, 2.700 turnos**, Base/Pro con semillas 7, 11 y 23. Se verificó igualdad de huellas iniciales por pareja. Reportes: reports/phase3_release_v32.json/.csv y sus archivos _comparison.

- Evacuados: **292 Base → 384 Pro**, +31,51% relativo.
- Vivos al terminar: **304 → 441**. Activos aún no evacuados se cuentan como vivos, no como evacuados.
- Ronda 3, agregada en las tres semillas: **170 → 236 vivos** sobre 600 personas; evacuados **165 → 210**.
- Evacuados por camioneta: **40**.
- HTTP real: **46.766 peticiones**, cero errores y cero solicitudes sobre 500 ms.
- Máximo p95 entre las nueve rondas Pro: **59,35 ms**. No es un percentil global calculado promediando percentiles.
- Máxima duración registrada de planificación/HTTP/resolución de un turno Pro: **987,19 ms** en esta medición. No se cronometró una demostración completa de 15 minutos en tiempo real.

La tabla por ronda/semilla, viajes y advertencias está en resultados_fase3.md. Semilla 23/ronda 1 mantuvo 13 evacuados con ambas estrategias, aunque Pro conservó cinco activos adicionales. No se afirma mejora estricta de evacuación en cada caso.

## Atribución por funcionalidad

reports/phase3_ablation_v32.json ejecuta cinco variantes de la ronda 3, semilla 7, sobre condiciones idénticas:

| Variante | Vivos | Evacuados | En camioneta | Turno medio de evacuación |
|---|---:|---:|---:|---:|
| Base | 73 | 73 | 0 | 21,19 |
| Pro completo | 94 | 86 | 4 | 22,29 |
| Pro sin predicción | 76 | 76 | 4 | 19,95 |
| Pro sin reservas | 94 | 86 | 4 | 22,29 |
| Pro sin flota | 94 | 86 | 0 | 22,85 |

La predicción aportó 18 vivos y 10 evacuados frente a Pro sin predicción en este caso. Las reservas no cambiaron el total aquí. La flota no aumentó el total evacuado de esta ronda, pero adelantó llegadas y produjo cuatro entregas físicas. No se presenta ese resultado como un aumento de supervivencia atribuible a la flota.

En el diagnóstico no oficial de capacidad (200 personas concentradas en Los Esteros, sin zombies), reports/phase3_capacity.json:

| Variante | Evacuados | Activos | Turno medio de evacuación |
|---|---:|---:|---:|
| Base | 160 | 40 | 59,84 |
| Pro completo | 200 | 0 | 68,79 |
| Pro sin predicción | 200 | 0 | 68,79 |
| Pro sin reservas | 160 | 40 | 56,25 |
| Pro sin flota | 200 | 0 | 72,52 |

La asignación con reservas permitió evacuar 40 personas adicionales. La flota redujo el promedio frente al Pro sin flota, con 15 entregas. El promedio Base corresponde a solo 160 evacuados y no debe compararse como si ambas muestras incluyeran a las mismas 200 personas. Ninguna variante superó capacidades ni generó movimientos inválidos. Esta configuración no sustituye las rondas oficiales ni su puntuación.

## Benchmark HTTP separado

ROUTING_STRATEGY=pro, `python -m app.evaluation.benchmark --batches 10 --concurrency 4` en Docker Linux:

- 200 personas, diez lotes, **2.000 peticiones TCP reales**.
- p50 **8,07 ms**, p95 **14,04 ms**, p99 **17,72 ms**; promedio **8,90 ms**.
- Cero errores, cero peticiones superiores a 500 ms, disponibilidad observada 100%.
- p95 de espera previa en el semáforo: **453,55 ms**, publicado por separado.
- No se modificaron reservas durante las peticiones repetidas.

La latencia HTTP comienza al enviar la petición, después de adquirir el semáforo, como en el coordinador. La cola previa no se oculta ni se etiqueta como latencia de servidor. Este benchmark prueba el endpoint con decisiones preparadas, mientras la comparación principal también ejecuta planificación y movimiento de cada turno.

## Contratos, ejemplos y límites

OpenAPI se generó desde FastAPI y pasó la prueba de correspondencia. /paso sigue respondiendo exactamente siguienteNodo. Se conservan los campos anteriores de /estado y se añaden los datos Pro. docs/estado.pro.transporte.example.json se capturó con GET /estado real en el turno 6, con tres pasajeros y sin dormidos ocultos.

No se incorporaron dependencias nuevas para Pro. Min-cost flow, Dijkstra, estructuras inmutables, HTTP y almacenamiento local reutilizan las bibliotecas existentes.

La supervivencia ponderada media de las tres semillas fue 39,44% Base y 56,19% Pro. Se calcula solo el componente conocido de supervivencia sobre 50; puntuacionTotal permanece null por faltar fórmulas de eficiencia, latencia y disponibilidad del jurado.

No hay persistencia compartida, SLA AWS ni validación frontend de extremo a extremo. La red está reducida a 306 nodos; reglas de incidentes y velocidad de vehículos son interpretaciones documentadas. Tres semillas no prueban una mejora universal. Resultados exploratorios anteriores se conservan como pilotos y no se mezclan con la comparación principal 3.2.0.
