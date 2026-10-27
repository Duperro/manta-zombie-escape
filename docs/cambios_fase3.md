# Archivos de Fase 3

## Nuevos módulos y herramientas

- backend/app/routing/prediction.py: envolvente de corredores y RiskMap inmutable.
- backend/app/routing/risk_routes.py: costos y árboles compartidos con restricciones actuales/predicción.
- backend/app/routing/strategies.py: interfaz y estrategias Base/Pro, contexto sin información oculta.
- backend/app/rescue/shelters.py: asignación global min-cost flow con estabilidad.
- backend/app/rescue/fleet.py: beneficio de rescate, encuentros, grupos y replanificación.
- backend/app/storage/reservations.py: protocolo y operaciones atómicas en memoria.
- backend/app/evaluation/compare.py y benchmark.py: comparación emparejada, ablaciones, estimación parcial y HTTP real.
- backend/scripts/plan_fleet_posts.py, capture_pro_example.py y summarize_phase3.py: despliegue estático, ejemplo HTTP y tabla medida.
- backend/config/pro.env.example: configuración sin credenciales reales.
- backend/tests/test_prediction.py, test_reservations.py, test_fleet.py y test_pro_integration.py: pruebas de comportamiento e invariantes.
- data/scenarios/fleet.json y diagnostic_capacity.json: cinco puestos y diagnóstico separado de las rondas oficiales.

## Módulos ampliados

- core/config.py y core/scenario_config.py: estrategia, banderas, parámetros, flota y huella inicial; RNG de eventos independiente.
- models/domain.py: estados, vehículos, distancias, reservas y modelos observables.
- simulator/world.py: mismas reglas Base/Pro, microtramos, incidentes, embarques, evacuaciones e invariantes; RNG por zombie/turno.
- simulator/coordinator.py: precálculo estratégico, ejecución única e aislamiento de ejecuciones.
- simulator/collisions.py: estados vivos de Pro.
- routing/planner.py: Observation ampliada; algoritmo Base conservado.
- storage/repository.py: nuevo espacio de decisiones por experimento.
- rescue/interfaces.py: contratos alineados con las implementaciones.
- evaluation/metrics.py y evaluator.py: transporte, viajes, datos de reproducibilidad y exportación.
- simulator/cli.py: --strategy y salidas separadas para no sobrescribir Base histórico.
- api/application.py, export_contract.py, pyproject.toml y contracts/openapi.yaml: aplicación/contrato 0.3.0 y ejemplos reales.
- data/scenarios/shelters.json: IDs R-001…R-004, conservando nodos/capacidades.

## Entrega técnica

README.md, AGENTS.md, docs/fase3.md, integracion.md, pendientes.md, resultados_fase3.md y verificacion_fase3.md.
Ejemplos: estado.example.json, estado.pro.example.json, estado.pro.transporte.example.json y paso.example.json.
Reportes principales: phase3_release_v32, phase3_ablation_v32, phase3_capacity, phase3_http_benchmark, phase3_pytest y phase3_repro_windows en reports/.

Los reportes Base de Fase 2 se conservaron. El grafo real no se regeneró ni se cambiaron sus calles. Los archivos de frontend/, infra/, .agents/ y .kiro/ de otros integrantes no se modificaron. No se hizo push, merge ni despliegue. El backend previo estaba sin seguimiento en Git; los cambios se dejan locales para revisión, sin mezclar archivos ajenos en commits.
