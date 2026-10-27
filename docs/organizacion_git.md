# Organización de ramas y commits

- main: integración completa de las categorías, mediante merges explícitos.
- feat/backend-simulator: FastAPI, motor Base/Pro, rescates, escenarios/mapa, pruebas y utilidades Python; variables de referencia del backend.
- feat/frontend-dashboard: React/TypeScript/Leaflet, interfaz, modal de pruebas, capas y pruebas frontend; package-lock y datos demo preparados.
- chore/docs-contracts: contratos OpenAPI, ejemplos, documentación, reportes verificables y especificaciones/review históricos de Kiro.

Se conserva la historia inicial a2126a4 y 03d6b09. Las ramas de frontend y documentación parten del avance anterior para no perder dependencias. Los merges --no-ff de cada categoría en main dejan visible su integración. No se reescribe historia ni se fuerza el remoto.

No se versionan claves, entornos virtuales, node_modules, dist, caches ni logs/PIDs/configuración temporal de procesos. Sí se conservan resultados de evaluaciones y pruebas, incluidos intentos fallidos documentados y su verificación posterior. Las fuentes originales de Kiro se mantienen en archive/ y el review histórico no se altera.

Validación previa conservada: 75 pruebas backend, 30 frontend, build TypeScript/Vite y aceptación HTTP de controles/dormidos. Ver docs/pruebas_fuego.md y reports/sleeper_debug_backend_verified.txt / sleeper_debug_frontend_tests.txt / sleeper_debug_build.txt.

Para nuevos cambios: trabajar en la rama de su categoría, hacer un commit con título claro y explicación, y fusionar en main tras validar. No incluir cambios de infra/ del responsable AWS ni desplegar automáticamente.


La ampliación del mapa se entrega en tres commits por categoría: backend/datos conserva toda la red anterior y genera 1.507 nodos/3.319 tramos; frontend actualiza demo y validaciones sin tamaños fijos; documentación registra cobertura, ejemplos y evidencias. Ver docs/mapa.md y reports/map_expansion_backend_tests.txt (75 pruebas), map_expansion_frontend_tests.txt (30 pruebas) y map_expansion_dashboard_live.json (HTTP real). Los resultados históricos de 306 nodos permanecen identificados y su mapa se conserva en archive/.
