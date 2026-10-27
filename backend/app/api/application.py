import secrets
from fastapi import FastAPI, HTTPException, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import Settings
from app.models.domain import PasoRequest, PasoResponse, StateView, MapView
from app.core.graph import map_view
from app.core.scenario_config import build_world
from app.simulator.coordinator import Coordinator
from app.storage.repository import MemoryDecisionRepository


def create_app(settings=None, world=None, repository=None, *, dashboard_controls=False, control_base_url="http://127.0.0.1:8000"):
    settings = settings or Settings.from_env()
    world = world or build_world(settings)
    repository = repository or MemoryDecisionRepository()
    coordinator = Coordinator(world, repository)
    app = FastAPI(title="Manta Zombie Escape", version="0.3.0")
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
            allow_credentials=False, allow_methods=["GET"], allow_headers=["Accept", "Content-Type"])
    app.state.coordinator = coordinator
    app.state.base_map = map_view(world.graph)
    key_header = APIKeyHeader(name="x-api-key", auto_error=False)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "manta-zombie-escape"}

    @app.get("/estado", response_model=StateView)
    async def estado():
        state = coordinator.published_state
        if dashboard_controls:
            return state.model_copy(update={"runId": app.state.simulation_control.run_id})
        return state

    @app.get("/mapa", response_model=MapView)
    async def mapa():
        return app.state.base_map

    @app.post("/paso", response_model=PasoResponse,
              responses={401: {"description": "API key inválida"}, 409: {"description": "Turno o posición incompatible"},
                         404: {"description": "Sobreviviente desconocido"}})
    async def paso(body: PasoRequest, key: str | None = Security(key_header)):
        if key is None or not secrets.compare_digest(key.encode(), settings.api_key.encode()):
            raise HTTPException(401, "API key inválida")
        cached = coordinator.repository.get(body.turno, body.sobrevivienteId)
        if cached:
            if cached[0] != body.nodoActual:
                raise HTTPException(409, "Posición incompatible con la decisión registrada")
            return PasoResponse(siguienteNodo=cached[1])
        if body.turno != coordinator.snapshot.turn:
            raise HTTPException(409, "Turno no disponible")
        raise HTTPException(404, "Sobreviviente desconocido")

    if dashboard_controls:
        from app.api.simulation_control import install_controls
        install_controls(app, settings, control_base_url)

    return app
