# Frontend Dashboard — Design Review (Fase 1)

Reviewer: design-review subagent (fresh review, no prior context).
Artifacts reviewed: `requirements.md`, `design.md`, `tasks.md` under `.kiro/specs/frontend-dashboard/`.
Verified against backend source (read-only, not edited): `contracts/openapi.yaml`, `backend/app/api/application.py`, `backend/app/models/domain.py`, `backend/app/simulator/coordinator.py`, `backend/app/simulator/world.py`, `backend/app/evaluation/metrics.py`, `backend/app/core/scenario_config.py`, `data/scenarios/fleet.json`, `docs/integracion.md`, `docs/pendientes.md`, `docs/mapa.example.json`, `docs/estado.example.json`.

## Verdict

**CHANGES_REQUESTED** — 1 HIGH + 2 MEDIUM findings (any HIGH/MEDIUM blocks).

---

## Findings

### HIGH-1 — `camionetas` mis-classified as "[] hasta Fase 3" with a wrong field shape

Where: `design.md` (raw.ts `RawTruck`, adapter `normalizeTruck`, R6, AC5/AC9, "Campos pendientes" item 1, "Notas de mapeo"); `requirements.md` R6/R15/R16; `tasks.md` T10.

Problem: The design repeatedly asserts that `/estado` sends `camionetas` as `[]` until Fase 3 and that the schema is "`additionalProperties: true` (sin esquema)". This is sourced from the stale `docs/integracion.md` ("camionetas es [] hasta Fase 3") and the stale OpenAPI (`StateView.camionetas` = `items: { additionalProperties: true }`). But the actual backend code contradicts both:

- `backend/app/models/domain.py` defines a **full `VehicleView`** model and types `StateView.camionetas: list[VehicleView]` (strongly typed, not an open object).
- `backend/app/core/scenario_config.py` `build_world()` **requires** exactly 5 camionetas (`fleet.json`), validates `len(fleet_data) != 5`, and appends them to `world.vehicles`.
- `data/scenarios/fleet.json` exists with 5 trucks (`V-001`..`V-005`, each with `id` + `nodo`).
- `backend/app/simulator/world.py` `view()` serializes them: `camionetas=[dict(id=v.id, nodoActual=v.node, estado=v.status, capacidad=v.capacity, pasajeros=v.passengers, capacidadUtilizada=..., sobrevivientesAsignados=v.assigned, puntoEncuentro=v.meeting, refugioDestino=v.shelter_id, rutaPlanificada=v.route, aristasRecorridasEnTurno=[...], viajesRealizados=v.trips, distanciaRecorrida_m=v.distance_m) for v in self.vehicles]`.

So the running `/estado` returns **5 populated `VehicleView` objects now**, not `[]`. The OpenAPI is stale (it predates `VehicleView`; it would show a `$ref` to `VehicleView` if regenerated, per the AGENTS.md rule "Regenerar OpenAPI y ejemplos después de cambios en modelos"). `docs/estado.example.json` showing `camionetas: []` is likewise stale.

Concrete consequence: the design's `normalizeTruck` reads `nodo` / `lat`+`lng` / `pasajeros` (as number) / `destino` / `ruta`. The real `VehicleView` uses `nodoActual` (not `nodo`), has **no** `lat`/`lng`, `pasajeros` is `list[str]` (survivor ids, not a count), `refugioDestino` (not `destino`), and `rutaPlanificada` (not `ruta`). In real mode the truck layer would resolve **no coordinates** (neither the `lat`+`lng` branch nor the `nodo` branch matches) and popups would show wrong/missing data. The design cites `domain.py` as co-source-of-truth yet ignored its `VehicleView`.

Fix (pick one and document the choice):
- If the running backend is authoritative: replace `RawTruck` with the real `VehicleView` shape and fix `normalizeTruck`:

```ts
export interface RawVehicle {            // = backend VehicleView (domain.py)
  id: string; nodoActual: string; estado: string; capacidad: number;
  pasajeros: string[]; capacidadUtilizada: number; sobrevivientesAsignados: string[];
  puntoEncuentro: string | null; refugioDestino: string | null;
  rutaPlanificada: string[]; aristasRecorridasEnTurno: unknown[];
  viajesRealizados: number; distanciaRecorrida_m: number;
}
// normalizeTruck: coords via nodeMap.get(v.nodoActual); pasajeros = v.pasajeros.length (or v.capacidadUtilizada);
//   destinoRefugioId = v.refugioDestino; routeNodeIds = v.rutaPlanificada; estado = v.estado.
```
Update R6/R20/AC5/AC9 and the layer description to state the truck layer is **populated in real mode** (5 trucks), not empty. Remove "[] hasta Fase 3" everywhere it is stated as fact.
- If the backend team confirms camionetas is *intended* to be `[]` until Fase 3 (i.e. the fleet loading is unauthorized Fase-3 creep per `docs/pendientes.md` / AGENTS.md "No avanzar a Fase 3 sin aprobación"): state that explicitly as a confirmed backend decision, and add a defensive `normalizeTruck` that tries **both** the real `VehicleView` keys (`nodoActual`, `refugioDestino`, `rutaPlanificada`, `pasajeros` as array) and the design's provisional keys, so the layer works either way.

Either way: add a note that `contracts/openapi.yaml` and `docs/estado.example.json` are stale on `camionetas` and must be flagged to the backend for regeneration. Treat `domain.py` + `world.view()` as the authoritative source, not the OpenAPI.

### MEDIUM-1 — Survivor `estado` enum is incomplete; rescue states are collapsed to `ACTIVO`

Where: `design.md` (`SurvivorState = 'ACTIVO' | 'EVACUADO' | 'ELIMINADO'`, `asSurvivorState`, R9); `requirements.md` R9.

Problem: The design states `SurvivorState = 'ACTIVO' | 'EVACUADO' | 'ELIMINADO'` ("uppercase, igual que el backend") and `asSurvivorState` degrades unknown values to `'ACTIVO'`. But `backend/app/models/domain.py` defines more states:

```python
FOOT_STATES = frozenset({"ACTIVO", "CAMINANDO", "HACIA_ENCUENTRO", "ESPERANDO_RESCATE"})
def living(status): return status not in {"EVACUADO", "ELIMINADO"}
# and in world.resolve(): s.status = "EN_CAMIONETA"
```

So `SurvivorView.estado` (set as `estado=s.status` in `world.view()`) actually carries **7** values: `ACTIVO`, `CAMINANDO`, `HACIA_ENCUENTRO`, `ESPERANDO_RESCATE`, `EN_CAMIONETA`, `EVACUADO`, `ELIMINADO`. The four omitted states are exactly the "estado de rescate" that the brief (DetailsPanel: "Estado de rescate") and R9 require the details panel to surface. With the current design, a survivor being picked up (`HACIA_ENCUENTRO`), waiting for a truck (`ESPERANDO_RESCATE`), or riding one (`EN_CAMIONETA`) all display as `ACTIVO`, hiding the rescue state. The claim "igual que el backend" is false. (`docs/integracion.md` only lists ACTIVO/EVACUADO/ELIMINADO, so the design followed a doc that is itself incomplete relative to `domain.py`.)

Fix: Extend the visual model to preserve the rescue/transit states and show them in the DetailsPanel:

```ts
export type SurvivorState =
  | 'ACTIVO' | 'CAMINANDO' | 'HACIA_ENCUENTRO' | 'ESPERANDO_RESCATE'
  | 'EN_CAMIONETA' | 'EVACUADO' | 'ELIMINADO';
// asSurvivorState: case-insensitive; unknown -> 'ACTIVO' (keep safe degrade).
```

Map the rescue states to readable labels in the DetailsPanel (e.g. CAMINANDO → "Caminando", HACIA_ENCUENTRO → "En camino al punto de encuentro", ESPERANDO_RESCATE → "Esperando rescate", EN_CAMIONETA → "En camioneta"). Update R9 to require the rescue state. Note that metric counts remain unaffected (they use `metricas.activos/evacuados/eliminados`).

### MEDIUM-2 — `RawMetrics` omits 7 fields the backend provides, including rescue metrics marked "pending"

Where: `design.md` (`RawMetrics` interface, "Campos pendientes" item 1, R8, R20); `requirements.md` R8/R20.

Problem: `RawMetrics` declares 18 keys and claims it is aligned to `backend/app/evaluation/metrics.py`. `metrics.summary()` actually returns **25** keys; the design omits: `vivosFinales`, `evacuadosCaminando`, `evacuadosCamioneta`, `rescatesCompletados`, `rescatesCancelados`, `distanciaCaminada_m`, `distanciaTransportada_m`. Several of these are the rescue/rescue-outcome metrics that R20 ("Rescate Pro … estados de rescate") cares about. The "Campos pendientes" list treats the camionetas/rescate scheme as pending, but the rescue **metrics** (`rescatesCompletados`, `evacuadosCamioneta`, `rescatesCancelados`) are already provided by the backend now. The "alineado 1:1 a metrics.py (fuente de verdad)" claim is therefore inaccurate, and the "pending" classification understates what is available for R20.

Fix: Add the 7 missing keys to `RawMetrics` (all nullable/number as in `metrics.summary`), and surface the rescue metrics in the UI per R20 (e.g. `rescatesCompletados`, `evacuadosCamioneta`, `rescatesCancelados`). Remove rescue-metrics from the "pending" list; keep only genuinely pending items there. Since `metricas` is `additionalProperties: true` in the OpenAPI / `dict` in `domain.py`, the extra keys are safe to carry.

### NIT-1 — `raw.ts` "1:1 a domain.py" claim is overstated; OpenAPI is stale

Where: `design.md` ("Tipos centralizados" intro, `RawStateView`, `RawSurvivor`, `RawShelter`).

Problem: `raw.ts` is described as "alineado 1:1 a `contracts/openapi.yaml` + `backend/app/models/domain.py` (fuente de verdad)". It actually tracks the (stale) OpenAPI and omits fields that exist in `domain.py` but not in the OpenAPI:
- `StateView`: `estrategia` (`"Base"`), `funcionalidadesPro` (`dict[str,bool]`), `riesgo` (`dict`).
- `SurvivorView`: `camionetaId`, `distanciaCaminada_m`, `distanciaEnCamioneta_m`, `modoEvacuacion` (`"caminando"` | `"camioneta"`).
- `ShelterView`: `plazas_disponibles`, `sobrevivientesAsignados`, `idAnterior`.

The OpenAPI itself is stale (it also misses the `VehicleView` `$ref` — see HIGH-1). None of these omitted fields are rendered in Fase 1, so functional impact is low, but the "1:1 / fuente de verdad" claim is materially false and is the same root cause as HIGH-1 (trusting the OpenAPI over `domain.py`). `modoEvacuacion`/`camionetaId` could also enrich the R9/R20 rescue display.

Fix: Either carry these fields in `raw.ts` to honor the 1:1 claim, or retract the "1:1 a domain.py" wording and document `raw.ts` as "the OpenAPI subset plus fields consumed by Fase 1, with the rest intentionally omitted". Recommend explicitly flagging to the backend that `contracts/openapi.yaml` and `docs/estado.example.json` are stale and must be regenerated.

### NIT-2 — `'CERRADO'` shelter state is an unverified assumption

Where: `design.md` (adapter `availableRefuges = refuges.filter(r => r.disponible > 0 && r.estado !== 'CERRADO').length`).

Problem: `domain.py` defines `Shelter.status` with default `"ABIERTO"` and no `CERRADO` literal; `world.view()`/`ShelterView.estado` carries whatever `r.status` is. The `!== 'CERRADO'` guard assumes a state that may never occur. It is defensive (harmless if absent) but unverified.

Fix: Either confirm the full set of shelter states with the backend, or base availability solely on `disponible > 0` / the computed `llena` flag and drop the `!== 'CERRADO'` clause (or keep it but document it as a defensive guard against a future state).

### NIT-3 — `disponible` is recomputed instead of using the backend-provided `plazas_disponibles`

Where: `design.md` (adapter: `disponible: r.capacidad_maxima - r.ocupacion - r.plazas_reservadas`).

Problem: `ShelterView` (and `domain.py`) already provides `plazas_disponibles = capacity - occupied - reserved`. The design recomputes the same value client-side. The values match, so this is harmless, but it duplicates backend logic and would drift if the backend's definition changes.

Fix: Consume `r.plazas_disponibles` directly for `disponible` (and keep the overflow cap as a defensive fallback), or document that the recomputation is intentional.

---

## Verified Assumptions (confirmed against source)

- `/health` returns `{"status":"ok","service":"manta-zombie-escape"}` (`application.py`); the design's `RawHealth { status; service }` is correct (more precise than the OpenAPI's open object).
- `/estado` returns `coordinator.published_state`, set only after `w.phase = "publicado"` (`coordinator.py` `step()`). The `decision` phase is internal and never exposed. Design claim verified. `estado.example.json` confirms `fase: "publicado"`.
- `/mapa` and `/estado` are public (no `security` in OpenAPI); `/paso` is the only secured endpoint (`APIKeyHeader` `x-api-key`, `secrets.compare_digest`). The design correctly forbids `POST /paso` from the browser, sends no `x-api-key`, and restricts the browser to public GETs. (`/mapa` is a legitimate public GET: the graph is not in `/estado`.)
- `geometria` is ordered `[lng, lat]` (`mapa.example.json` first point `[-80.704655, -0.971904]`); the adapter inverts to `{lat, lng}`. Verified. Edge IDs follow `E-<origenOSM>-<destinoOSM>-<clave>` (e.g. `E-363642664-363643390-0`). Verified.
- `ZombieView = {id, nodo, tipo}`; dormidos are filtered from `/estado` (`world.view()`: `if z.kind != "dormido"`); a woken dormido becomes `caminante` (`activate_sleepers()` sets `z.kind = "caminante"`). Design claim (dormido layer empty in real) verified.
- `aristasBloqueadas` is a required `StateView` field (OpenAPI) and a list of edge IDs (`world.view()`). Design uses it directly and matches against `MapView.aristas[].id`. Verified.
- `rutas` is keyed by `survivorId -> planned_route`, only for survivors in `FOOT_STATES` (`world.view()`). Design handling matches. Verified.
- Refugios carry `lat`/`lng` directly (`world.view()` reads them from the graph node; `ShelterView` requires `lat`/`lng`). Design uses refugio `lat`/`lng` without `nodeMap`. Verified. Four refugios with capacities 40/50/60/70 are enforced (`scenario_config.py` raises otherwise). R19 verified.
- `mapaVersion`/`versionGrafo` are graph/map versions, not turn versions (`world.view()`). The design correctly gates publication on `(ronda, turno)` and re-caches `/mapa` only when `mapaVersion` changes. Verified. `/mapa` is computed once at app creation (`application.py`: `app.state.base_map = map_view(...)`), supporting load-once. Verified.
- Gating rule matches `docs/integracion.md`: "Dentro de una ronda descartar respuestas con turno menor; ronda cambia y turno vuelve a 0 al reiniciar." Design `shouldCommit` matches. Verified.
- `metricas` keys the design actually consumes (`sobrevivientesIniciales`, `activos`, `evacuados`, `eliminados`, `latenciaP95Ms`) all exist in `metrics.summary()`. Verified (subset).
- `estadoSimulacion` is `EN_CURSO`/`FINALIZADA` (`world.view()`). Verified. Survivor `estado` is uppercase (example shows `ACTIVO`); zombie `tipo` lowercase (`caminante`); refugio `estado` `ABIERTO`. Verified.
- Polling 1 s / turns 2 s match the brief; the design's default `VITE_POLL_MS=1000` follows the brief and notes `integracion.md`'s softer 2 s recommendation. Reasonable, documented interpretation.

## Unverified / Wrong Assumptions

- **WRONG** — "camionetas es `[]` hasta Fase 3" and "schema = `additionalProperties: true` sin esquema". `domain.py` defines `VehicleView` fully; `scenario_config.py` loads 5 trucks from `fleet.json`; `world.view()` serializes 5 populated `VehicleView` objects. OpenAPI + `estado.example.json` + `integracion.md` are stale here. (HIGH-1)
- **WRONG** — "`SurvivorState` = ACTIVO/EVACUADO/ELIMINADO, igual que el backend." `domain.py` has 7 states; the omitted ones are the rescue states the brief requires. (MEDIUM-1)
- **WRONG/PARTIAL** — "`RawMetrics` alineado 1:1 a `metrics.py`." Omits 7 fields incl. rescue metrics. (MEDIUM-2)
- **WRONG** — "`raw.ts` alineado 1:1 a `domain.py`." Omits `estrategia`/`funcionalidadesPro`/`riesgo`, `SurvivorView` extras, `ShelterView` extras; the OpenAPI is stale. (NIT-1)
- **UNVERIFIED** — refugio `estado` can be `'CERRADO'`. `domain.py` only defaults to `"ABIERTO"`; no `CERRADO` literal. (NIT-2)
