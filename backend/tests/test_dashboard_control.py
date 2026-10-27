import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient
from app.api.application import create_app
from app.core.config import Settings
from app.api.simulation_control import SimulationRequest

HEADERS = {"x-api-key": "control-test"}


def make_app():
    return create_app(Settings(api_key="control-test", routing_strategy="pro"), dashboard_controls=True)


def test_controls_are_opt_in_and_require_key():
    with TestClient(create_app(Settings(api_key="control-test"))) as client:
        assert client.get("/control/estado", headers=HEADERS).status_code == 404
        assert client.post("/control/iniciar", json={}, headers=HEADERS).status_code == 404
    with TestClient(make_app()) as client:
        assert client.get("/control/estado").status_code == 401
        assert client.post("/control/iniciar", json={}).status_code == 401
        assert client.get("/control/estado", headers=HEADERS).status_code == 200
        assert client.post("/paso", json={"sobrevivienteId":"S-R1-0001","nodoActual":"N-unknown","turno":0}).status_code == 401


def test_configuration_validation_preserves_existing_run():
    app = make_app()
    with TestClient(app) as client:
        started = client.post("/control/iniciar", json={}, headers=HEADERS).json()
        for body in [{"sobrevivientes": 0}, {"sobrevivientes": 501}, {"turnos":151}, {"ronda":4},
                     {"semilla":-1}, {"turnos":1.5}, {"extra":True},
                     {"zombies":{"caminante":200,"corredor":1,"horda":0,"dormido":0}}]:
            assert client.post("/control/iniciar", json=body, headers=HEADERS).status_code == 422
        assert client.get("/control/estado", headers=HEADERS).json()["runId"] == started["runId"]
        assert client.get("/estado").json()["runId"] == started["runId"]


def test_restart_replaces_task_reservations_and_public_state():
    app = make_app()
    async def exercise():
        controller = app.state.simulation_control
        first = await controller.start(SimulationRequest(sobrevivientes=25, ronda=3, turnos=20, bloqueos=False))
        old_task = controller.task
        app.state.coordinator.world.turn = 15
        await asyncio.gather(*(controller.start(SimulationRequest(sobrevivientes=10 + i)) for i in range(3)))
        assert old_task.cancelled()
        tasks = [t for t in asyncio.all_tasks() if t.get_name() == "dashboard-simulation-owner" and not t.done()]
        assert tasks == [controller.task]
        assert first.runId != controller.run_id
        world = app.state.coordinator.world
        assert world.turn == 0 and len(world.survivors) == 12
        world.assert_invariants()
        assert app.state.coordinator.published_state.turnosTotales == 150
        await controller.stop()
        assert not controller.status().ejecutando
    asyncio.run(exercise())


def test_presets_keep_only_events_within_custom_duration():
    app = make_app()
    with TestClient(app) as client:
        response = client.post("/control/iniciar", headers=HEADERS, json={"ronda":3,"turnos":60,"sobrevivientes":30})
        assert response.status_code == 200
        world = app.state.coordinator.world
        assert list(world.events) == [50]
        response = client.post("/control/iniciar", headers=HEADERS, json={"ronda":3,"turnos":150,"bloqueos":False})
        assert response.status_code == 200 and not app.state.coordinator.world.events
        assert app.state.coordinator.published_state.metricas["solicitudesHTTP"] == 0


def test_sleepers_debug_is_authenticated_read_only_and_never_enters_planning():
    from app.core.scenario_config import build_world, read_scenario, default_scenario
    settings = Settings(api_key="control-test", routing_strategy="pro")
    world = build_world(settings, read_scenario(default_scenario(3)))
    app = create_app(settings, world, dashboard_controls=True)
    coordinator = app.state.coordinator
    sleepers = {z.id for z in world.zombies if z.kind == "dormido"}
    assert len(sleepers) == 8
    with TestClient(app) as client:
        before = client.get("/estado").json()
        snapshot = coordinator.snapshot
        decisions = {s.id:coordinator.repository.get(world.turn, s.id) for s in world.survivors}
        assert client.get("/control/dormidos").status_code == 401
        debug = client.get("/control/dormidos", headers=HEADERS)
        assert debug.status_code == 200 and debug.headers["cache-control"] == "no-store"
        assert {z["id"] for z in debug.json()["dormidos"]} == sleepers
        assert debug.json()["runId"] == before["runId"]
        assert not sleepers.intersection(z["id"] for z in before["zombies"])
        assert not sleepers.intersection(z[0] for z in snapshot.zombies)
        assert coordinator.snapshot is snapshot
        assert client.get("/estado").json() == before
        assert decisions == {s.id:coordinator.repository.get(world.turn, s.id) for s in world.survivors}
        target = next(z for z in world.zombies if z.kind == "dormido")
        world.survivors[0].node = target.node
        world.activate_sleepers()
        assert target.kind == "caminante"
        assert target.id not in {z["id"] for z in client.get("/control/dormidos", headers=HEADERS).json()["dormidos"]}
        assert target.id in {z["id"] for z in world.view().model_dump()["zombies"]}
    with TestClient(create_app(settings)) as client:
        assert client.get("/control/dormidos", headers=HEADERS).status_code == 404
