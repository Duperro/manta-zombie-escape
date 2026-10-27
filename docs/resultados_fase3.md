# Resultados medidos Base vs. Pro — algoritmo 3.2.0

Fuente: reports/phase3_release_v32.json y su CSV; ejecución Docker Linux, HTTP TCP real. Tres rondas de 150 turnos por estrategia y semilla. Los valores son resultados de simulación, no puntuación oficial.

| Semilla | Ronda | Evacuados Base → Pro | Vivos Base → Pro | Activos Pro | Evacuados en camioneta | p95 Pro |
|---:|---:|---:|---:|---:|---:|---:|
| 7 | 1 | 17 → 19 | 17 → 20 | 1 | 5 | 26.70 ms |
| 7 | 2 | 39 → 47 | 40 → 51 | 4 | 9 | 17.13 ms |
| 7 | 3 | 73 → 86 | 73 → 94 | 8 | 4 | 13.56 ms |
| 11 | 1 | 16 → 20 | 18 → 20 | 0 | 4 | 59.35 ms |
| 11 | 2 | 19 → 33 | 23 → 53 | 20 | 3 | 12.08 ms |
| 11 | 3 | 32 → 50 | 37 → 62 | 12 | 0 | 10.70 ms |
| 23 | 1 | 13 → 13 | 13 → 18 | 5 | 1 | 37.45 ms |
| 23 | 2 | 23 → 42 | 23 → 43 | 1 | 6 | 39.45 ms |
| 23 | 3 | 60 → 74 | 60 → 80 | 6 | 8 | 16.14 ms |

Total evacuados: **292 → 384**, mejora relativa de **31.51%**. Total vivos: **304 → 441**. Ronda 3, vivos agregados: **170 → 236** sobre 600 personas.

Pro realizó 40 evacuaciones en camioneta. Máximo p95 de sus ejecuciones: 59.35 ms. Errores HTTP: 0; solicitudes sobre 500 ms: 0. Peticiones HTTP registradas: 46766.

Viajes con entrega, agregados sobre las nueve rondas Pro:

| Camioneta | Viajes |
|---|---:|
| V-001 | 2 |
| V-002 | 3 |
| V-003 | 9 |
| V-004 | 5 |
| V-005 | 0 |

No se fuerza utilizar un vehículo si la heurística no estima beneficio; cero viajes es un resultado que debe mostrarse. La capacidad y operación física de las cinco unidades se comprueban también mediante pruebas controladas.

Las columnas de vivos incluyen activos al terminar: no deben mostrarse como evacuaciones. Los percentiles de filas no se promedian como si fueran un percentil global. La tabla de comparación y estimación parcial del componente de supervivencia está en phase3_release_v32_comparison.json/.csv. El total oficial permanece sin calcular por falta de fórmulas de normalización.

Datos para gráficos: usar semilla/ronda/experimento como dimensiones, y evacuados/vivosFinales/evacuadosCamioneta/latenciaP95Ms como series. Para atribución por función consultar phase3_ablation_v32.json; para presión de capacidad, phase3_capacity.json.
