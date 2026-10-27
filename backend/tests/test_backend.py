import asyncio
import socket
import threading
import time
import json
from pathlib import Path
import httpx
import pytest
import uvicorn
import yaml
from fastapi.testclient import TestClient
from app.api.application import create_app
from app.core.config import Settings
from app.models.domain import Survivor, Zombie
from app.routing.planner import RoutePlanner
from app.simulator.world import demo_world


@pytest.fixture
def settings():
    return Settings(api_key="test-key")


@pytest.fixture
def world(settings):
    return demo_world(settings)


def test_endpoints_and_auth(settings):
    with TestClient(create_app(settings,demo_world(settings))) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert len(client.get("/mapa").json()["nodos"]) == 10
        assert "nodos" not in client.get("/estado").json()
        body = dict(sobrevivienteId="S-0001", nodoActual="N-0000", turno=0)
        for headers in [{}, {"x-api-key": "wrong"}]:
            assert client.post("/paso", json=body, headers=headers).status_code == 401
        headers = {"x-api-key": settings.api_key}
        result = client.post("/paso", json=body, headers=headers)
        assert result.json() == {"siguienteNodo": "N-0001"}
        assert client.post("/paso", json=body, headers=headers).json() == result.json()
        assert client.post("/paso", json={**body, "nodoActual": "bad"}, headers=headers).status_code == 409
        assert client.post("/paso", json={**body, "turno": 999}, headers=headers).status_code == 409
        assert client.post("/paso", json={**body, "sobrevivienteId": "bad"}, headers=headers).status_code == 404
        assert client.post("/paso", json={**body, "turno": "0"}, headers=headers).status_code == 422


def test_valid_moves_blocked_and_no_route(world):
    assert world.valid("N-0000", "N-0001")
    assert not world.valid("N-0000", "N-0002")
    world.graph["N-0000"]["N-0001"]["bloqueada"] = True
    assert not world.valid("N-0000", "N-0001")
    assert RoutePlanner().next_node(world.observation(), "N-0000") == "N-0000"
    world.resolve({"S-0001": "not-a-node"})
    assert world.survivors[0].node == "N-0000"


def test_distance_speed_cost(world):
    # Faster two-edge alternative must beat a short but slow direct street.
    world.graph.add_edge("N-0000", "N-0004", distancia_m=50., tipo="calle", velocidad_m_s=.1,
                         bloqueada=False, cost=500.)
    assert RoutePlanner().next_node(world.observation(), "N-0000") == "N-0001"


def test_walker_every_two_turns(world):
    world.turn = 1
    world.move_zombies()
    assert world.zombies[0].node == "N-0009"
    world.turn = 2
    world.move_zombies()
    assert world.zombies[0].node == "N-0008"


def test_runner_chases_and_records_two_edges(world):
    world.zombies = [Zombie("Z", "N-0003", "corredor")]
    world.turn = 1
    world.move_zombies()
    assert [(t.origin,t.destination) for t in world.traversed] == [("N-0003", "N-0002"), ("N-0002", "N-0001")]
    world.survivors[0].node = "N-0002"
    world.resolve({"S-0001": "N-0003"})
    assert world.survivors[0].status == "ELIMINADO"


def test_horde_blocks_neighbors(world):
    world.zombies = [Zombie("H", "N-0002", "horda")]
    world.turn = 2
    world.move_zombies()
    assert world.zombies[0].node == "N-0002"
    assert world.horde_nodes() == {"N-0001", "N-0002", "N-0003"}
    assert RoutePlanner().next_node(world.observation(), "N-0000") == "N-0000"
    assert not world.valid("N-0000", "N-0001")


def test_configurable_horde_motion(settings):
    settings = Settings(api_key=settings.api_key, horde_move_probability=1)
    world = demo_world(settings)
    world.zombies[0].kind = "horda"
    world.move_zombies()
    assert world.zombies[0].node == "N-0008"


def test_sleeper_hidden_and_wakes_without_moving(world):
    world.zombies = [Zombie("hidden", "N-0003", "dormido")]
    before = world.observation()
    assert not world.view().zombies
    assert "N-0003" not in before.forbidden
    world.turn = 1
    world.move_zombies()
    world.resolve({"S-0001": "N-0001"})
    assert world.zombies[0].kind == "caminante"
    assert world.zombies[0].node == "N-0003"
    world.turn = 2
    world.move_zombies()
    assert world.zombies[0].node != "N-0003"


def test_node_bite(world):
    world.zombies[0].node = "N-0001"
    world.resolve({"S-0001": "N-0001"})
    assert world.survivors[0].status == "ELIMINADO"


def test_opposite_crossing(world):
    world.zombies[0].node = "N-0000"
    world.traversed = [("N-0001", "N-0000")]
    world.resolve({"S-0001": "N-0001"})
    assert world.survivors[0].status == "ELIMINADO"


def test_snapshot_does_not_change(world):
    snapshot = world.observation()
    world.graph["N-0000"]["N-0001"]["bloqueada"] = True
    assert not snapshot.graph["N-0000"]["N-0001"]["bloqueada"]
    with pytest.raises(TypeError):
        snapshot.graph["N-0000"]["N-0001"]["bloqueada"] = True


def test_generated_contract(settings):
    spec = yaml.safe_load((Path(__file__).resolve().parents[2] / "contracts/openapi.yaml").read_text(encoding="utf-8"))
    assert spec == create_app(settings).openapi()
    schema = spec["components"]["schemas"]["PasoResponse"]
    assert list(schema["properties"]) == ["siguienteNodo"]


def serve(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline:
            raise RuntimeError("HTTP server startup timeout")
        time.sleep(.01)
    return server, thread, sock, port


def run_live(settings, *, event=False):
    app = create_app(settings,demo_world(settings))
    coordinator = app.state.coordinator
    if event:
        coordinator.world.events = {1: [("N-0000", "N-0001")]}
    server, thread, sock, port = serve(app)

    async def exercise():
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
            states = []
            for _ in range(8):
                states.append((await coordinator.step(client)).model_dump())
            response = await client.post("/paso", headers={"x-api-key": settings.api_key},
                json={"sobrevivienteId": "S-0001", "nodoActual": "N-0000", "turno": 1})
            assert response.status_code == 200  # historical retry survives later turns
            return states
    try:
        return asyncio.run(exercise())
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive()


def test_real_http_full_simulation_and_reproducibility(settings):
    first = run_live(settings)
    second=run_live(settings)
    # Wall-clock measurements are intentionally excluded from deterministic state comparison.
    for states in [first,second]:
        for state in states:
            state.pop("metricas")
    assert first == second
    assert [state["sobrevivientes"][0]["nodo"] for state in first[:4]] == ["N-0001", "N-0002", "N-0003", "N-0004"]
    assert first[-1]["sobrevivientes"][0]["estado"] == "EVACUADO"


def test_events_apply_before_decision(settings):
    states = run_live(settings, event=True)
    assert states[0]["sobrevivientes"][0]["nodo"] == "N-0000"


def test_http_failure_stays(world, settings):
    app = create_app(settings, world)
    async def exercise():
        async with httpx.AsyncClient(base_url="http://127.0.0.1:1", trust_env=False) as client:
            await app.state.coordinator.step(client)
    asyncio.run(exercise())
    assert world.survivors[0].node == "N-0000"


def test_concurrent_survivors_and_single_turn_owner(settings):
    world = demo_world(settings)
    world.survivors = [Survivor(f"S-{i:04}", "N-0000") for i in range(20)]
    app = create_app(settings, world)
    coordinator = app.state.coordinator
    server, thread, sock, port = serve(app)

    async def exercise():
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
            results = await asyncio.gather(coordinator.step(client), coordinator.step(client))
            assert [r.turno for r in results] == [1, 2]
            assert all(s.nodo == "N-0002" for s in results[-1].sobrevivientes)
            requests = [client.post("/paso", headers={"x-api-key": settings.api_key},
                json={"sobrevivienteId":"S-0000", "nodoActual":"N-0001", "turno":2}) for _ in range(20)]
            responses = await asyncio.gather(*requests)
            assert all(r.status_code == 200 and r.json() == {"siguienteNodo":"N-0002"} for r in responses)
    try:
        asyncio.run(exercise())
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive()
