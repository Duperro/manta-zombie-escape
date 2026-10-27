# Traspaso Kiro → Codex — 27 octubre 2026

## 1. Estado real de las fases

Fases 1, 2 y 3 backend implementadas; auditoría inicial: 66 pruebas aprobadas, una advertencia (reports/handoff_backend_audit.txt). Se conserva Base/Pro y no se reconstruyeron algoritmos. La misión full stack añade el dashboard, integración y CORS. Su cierre total queda pendiente de revisión visual final y capturas: Computer Use terminó al no poder verificar con confianza la URL de Windows. No se eludió ese bloqueo.

## 2. Backend completado

FastAPI, grafo real reducido de Manta (306 nodos/571 aristas dirigidas), tres rondas de 150 turnos, zombies visibles/ocultos según reglas, coordinador único y decisiones por HTTP. Pro incluye predicción, reservas globales y cinco camionetas físicas. En este traspaso solo se añadieron CORS GET explícito, --host en CLI, generadores de tipos/demo y ejecutor de integración. Sin cambios al contrato obligatorio ni recursos AWS.

## 3. Resolución del review Kiro

El review histórico .agents/tasks/frontend-fase1/design-review.md/.json se conserva. Los tres documentos originales se archivaron en .kiro/specs/frontend-dashboard/archive/; los actuales corresponden a la implementación.

| Hallazgo | Corrección y archivos | Evidencia |
|---|---|---|
| HIGH-1 camionetas vacías/formato incorrecto | generated.ts/RawVehicle, normalizeTruck en services/adapter.ts: nodoActual, pasajeros como IDs, refugioDestino, rutaPlanificada; coordenadas del mapa | adapter.test.ts, Dashboard.test.tsx y live.integration.tsx: cinco unidades, pasajeros y movimiento |
| MEDIUM-1 estados incompletos | types/visual.ts y adapter.ts conservan siete estados; desconocido explícito, sin convertirlo a ACTIVO | adapter.test.ts y detalle EN_CAMIONETA en Dashboard.test.tsx |
| MEDIUM-2 siete métricas ausentes | raw.ts y Panels.tsx incluyen las 25 métricas y resultados de rescate | adapter.test.ts y Telemetría en Dashboard.test.tsx; contraste real por frame |
| NIT-1 tipos/OpenAPI incompletos | export_frontend_types.py desde Pydantic/OpenAPI actual; campos Pro, riesgo, vehículo, superviviente y refugio | contrato regenerado, tipos estrictos, build y tests backend |
| NIT-2 estado CERRADO supuesto | refugio disponible exige plazas positivas y estado ABIERTO, conforme admisión del backend; sin inventar enum | Panels.tsx y diseño actualizado |
| NIT-3 disponibilidad recalculada | plazas_disponibles es autoritativo; fallback solo si falta/no finito, con advertencia | adapter.test.ts prueba valor divergente y fallback |

Los documentos actuales son requisitos, diseño y tareas corregidos; no son una aprobación retroactiva del review histórico.

## 4. Archivos frontend

frontend/package.json, package-lock.json, tsconfig.json, vite.config.ts, vitest.live.config.ts, index.html, .env.example, .gitignore, README.md; scripts/check-bundle.mjs; src/main.tsx y styles.css; src/app/{Dashboard,SimulationContext}.tsx; src/components/{MapBoard,Panels}.tsx; src/providers/{SimulationProvider,ApiSimulationProvider,MockSimulationProvider}.ts; src/services/{adapter,decode}.ts; src/types/{generated,raw,visual}.ts; src/utils/config.ts; tests colocados junto a componentes/proveedores/adaptador y src/test/; public/demo/mapa.json y round_1/2/3.json. No había código frontend previo: solo especificaciones Kiro.

## 5. Componentes visuales

Dashboard oscuro adaptable, mapa Leaflet persistente, red vial con geometrías reales, nueve capas conmutables, zombies, supervivientes, refugios y cinco camionetas; encuentros, rutas, riesgo publicado, bloqueos de calles/hordas, selección/búsqueda/detalle. Paneles de ocupación/reservas/disponibilidad, flota y pasajeros, eventos, métricas principales/rescate y telemetría de 25 campos. Etiqueta de modo real/demo, conexión, estado obsoleto y controles exclusivos demo. No se inventan polígonos, rutas rectas entre nodos no vecinos ni entidades ocultas.

## 6. Contratos verificados

GET /health, /mapa, /estado públicos. POST /paso mantiene x-api-key, petición sobrevivienteId/nodoActual/turno y respuesta solo siguienteNodo. Frontend solo usa los tres GET. OpenAPI y ejemplos se regeneraron desde app.export_contract; generated.ts solo exporta tipos de lectura. mapaVersion controla cache; versionGrafo identifica estado dinámico. Geometrías GeoJSON se convierten a Leaflet. CORS permite GET de orígenes exactos, sin credenciales; rechaza preflight POST y /paso sigue protegido.

## 7. Pruebas

- Auditoría backend inicial: 66 passed, 1 warning en 127.43 s.
- Frontend final: 20 pruebas, 4 archivos, aprobadas en 6.99 s (reports/handoff_frontend_tests.txt).
- Build final: TypeScript + Vite aprobado, 1.73 s; JS 406.69 KB (gzip 126.77 KB), CSS 33.59 KB. Escaneo de marcadores de claves aprobado (handoff_frontend_build.txt).
- Integración real: GET por proxy Vite + React/RTL; 126 estados en tres rondas, mapa cargado una vez. Comparó métricas por frame y verificó movimiento de zombies/supervivientes/camionetas, pasajeros, ocupación, rutas, riesgo y bloqueos. reports/handoff_frontend_live.json y handoff_live_backend_public_calls.json. No hubo llamadas privadas del cliente.
- En integración RTL se sustituyó MapBoard. La prueba separada MapBoard.test.tsx sí monta Leaflet real con SVG en jsdom, comprueba cinco iconos de camioneta, cuatro refugios, geometrías, selección y persistencia al actualizar. Ninguna equivale a QA visual de tiles/móvil.
- Backend final posterior a cambios: **68 passed, 1 warning en 112.43 s**, incluyendo los dos tests CORS nuevos y las rondas HTTP (reports/handoff_backend_verified.txt). La advertencia es deprecación de anyio en Starlette. Una ejecución previa dentro del sandbox se quedó esperando localhost y fue terminada; se conservó el resultado de la repetición con acceso local.

## 8. Tres rondas conectadas

Semilla 7, Pro 3.2.0, 150 turnos por ronda. Cadencia acelerada de QA 0.25 s: **no usar estos resultados para sustituir la comparación reglamentaria de 2 s**, pues la distancia recorrida depende de turn_seconds.

| Ronda | Iniciales | Evacuados | Vivos finales | En camioneta | HTTP | p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Anochecer | 20 | 19 | 20 | 5 | 953 | 43.10 |
| Medianoche | 80 | 47 | 51 | 9 | 2724 | 30.83 |
| Apocalipsis | 200 | 86 | 94 | 4 | 5238 | 32.93 |

Cero errores HTTP, respuestas inválidas o solicitudes mayores de 500 ms. Evidencia completa en handoff_live_backend.json/.csv, con configuración y firmas.

## 9. Base vs. Pro

Se conserva el estudio previo reglamentario: reports/phase3_release_v32.json/.csv y docs/resultados_fase3.md. Semillas 7, 11 y 23: evacuados Base 292 → Pro 384 (+31.51%); vivos 304 → 441. En ronda 3 agregada: evacuados 165 → 210 y vivos 170 → 236. No implica mejora universal ni puntuación oficial. No se repitió un estudio idéntico sin motivo.

## 10. Latencia HTTP

En la integración nueva p95 por ronda 43.10/30.83/32.93 ms. Estudio previo: máximo p95 por ronda Pro 59.35 ms; benchmark separado de 2,000 solicitudes p95 14.04 ms, p99 17.72 ms. No mezclar percentiles entre experimentos ni sumar espera de semáforo a latencia HTTP. No se afirma SLA de producción.

## 11. Inicio exacto

Desde raíz, terminal backend:

```powershell
$env:API_KEY='elige-una-clave-local'
cd backend
.venv312/Scripts/python.exe -m app.simulator.cli --strategy pro --round all --seed 7 --output ../reports/dashboard_run
```

Otra terminal desde raíz:

```powershell
cd frontend
npm ci
npm run dev
```

Abrir http://127.0.0.1:5173. Node 24. API por defecto, turnos de 2 s; CLI ya incluye servidor. `npm run build` produce dist/. Demo explícita: VITE_DATA_SOURCE=mock en una nueva terminal antes de npm run dev. Instalación Python, Linux y ejemplos en README.md y fase3.md.

## 12. Evidencia disponible

JSON/CSV reales, reportes de tests/build y prueba de montaje Leaflet. **No hay capturas finales verificadas del dashboard**. La inspección inicial del navegador encontró Illegal invocation de fetch; se corrigió vinculando fetch a globalThis en ambos proveedores y se añadió regresión. El bloqueo posterior impidió completar revisión visual; queda registrado, sin simular capturas.

## 13. Límites pendientes

Revisar tiles OSM, composición desktop/móvil, interacción visual y capturas en navegador. Persistencia en memoria, un worker/coordinador; sin runId público, recargar frontend al reiniciar una ronda. CLI finita termina al completar las tres rondas; retiene último estado en cliente y señal de desconexión. Demo tiene 15 frames por ronda. Tiles y fuentes externas requieren red; la red vial local puede dibujarse sin tiles. Mapa es selección reducida y los refugios son simulados. Hordas inmóviles por configuración predeterminada; variantes se documentan en fase3.md. No se probó AWS ni se reejecutó Docker en este traspaso.

## 14. Entrega AWS

Ver entrega_aws.md para Docker, artefactos dist/, proxy, HTTPS, CORS, variables, secreto y persistencia. No se editó infra/ ni se crearon recursos. El responsable debe configurar el proxy productivo o URL API pública al compilar; Vite dev proxy no se incluye en el build. No se enviaron mensajes al compañero.

## 15. Git

Rama feat/backend-simulator, HEAD a2126a4 (Inicialización de proyecto). El backend y documentación recibidos estaban sin seguimiento, junto a .agents y .kiro. Se conservaron y no se hizo un commit masivo que mezclara esa entrega con código ajeno. Nuevos cambios quedan locales para revisión; no hay commits nuevos, push, merge o despliegue. Históricos de Kiro conservados en archive/. El código generado y pruebas se entregan con package-lock.json; node_modules/dist/entornos/caches están ignorados.


## Ampliación posterior: panel de pruebas de fuego

El usuario autorizó configurar e iniciar/reiniciar desde el dashboard. Ver pruebas_fuego.md. Se añade servidor local persistente app.dashboard_server y controles opt-in protegidos vía proxy de servidor; la CLI y /paso se conservan. runId permite detectar reinicios sin recargar. Los resultados posteriores sustituyen el conteo de tests del traspaso inicial: 72 backend y 25 frontend aprobados, build aprobado, aceptación por HTTP real en dashboard_control_live.json. La restricción anterior de dashboard exclusivamente GET se amplía solo a estos controles locales; la clave nunca entra al navegador. No hay despliegue ni cambios de infra/.

## Validación posterior de averías y latencia (2026-10-27)

Estado actualizado: 103 pruebas del backend y 36 del frontend aprobadas, contratos regenerados y build correcto. La regresión intermitente HTTP de Pro quedó corregida mediante la dependencia explícita sniffio, junto con optimizaciones de validación, agrupación y despacho. Dos ejecuciones de Pro de 150 turnos: 15.408 peticiones medidas, cero errores o excesos de 500 ms, p95 de 11,11/11,88 ms y firmas idénticas. Base también completó las tres rondas. Estos resultados locales sustituyen los conteos anteriores y no acreditan un SLA de producción. Ver [latencia_pro.md](latencia_pro.md) y [averias.md](averias.md), con evidencia visual de averías y reportes finales. Sin cambios en infra/ ni despliegues.
