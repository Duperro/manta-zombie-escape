"""Opt-in local dashboard controls. The ordinary app/CLI keep their existing owner."""
import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import replace
import secrets
import time
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import HTTPException, Response, Security
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.scenario_config import ScenarioConfig, build_world, default_scenario, read_scenario


class ZombieCounts(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    caminante: int = Field(ge=0, le=200)
    corredor: int = Field(ge=0, le=200)
    horda: int = Field(ge=0, le=200)
    dormido: int = Field(ge=0, le=200)

    @model_validator(mode="after")
    def total_limit(self):
        if sum(self.model_dump().values()) > 200:
            raise ValueError("Máximo 200 zombies en total")
        return self


class BreakdownRule(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    probabilidad: float = Field(ge=0, le=1)
    turnos: int = Field(ge=1, le=30)


class BreakdownConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    activadas: bool = False
    caminante: BreakdownRule = Field(default_factory=lambda: BreakdownRule(probabilidad=.25, turnos=2))
    corredor: BreakdownRule = Field(default_factory=lambda: BreakdownRule(probabilidad=.5, turnos=3))
    horda: BreakdownRule = Field(default_factory=lambda: BreakdownRule(probabilidad=.8, turnos=5))
    dormido: BreakdownRule = Field(default_factory=lambda: BreakdownRule(probabilidad=.35, turnos=2))


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ronda: int = Field(default=1, ge=1, le=3)
    sobrevivientes: int = Field(default=20, ge=1, le=500)
    zombies: ZombieCounts = Field(default_factory=lambda: ZombieCounts(caminante=12, corredor=0, horda=0, dormido=0))
    turnos: int = Field(default=150, ge=1, le=150)
    semilla: int = Field(default=7, ge=0, le=2147483647)
    estrategia: Literal["base", "pro"] = "pro"
    distribucion: Literal["equilibrada", "aleatoria"] = "equilibrada"
    bloqueos: bool = True
    averias: BreakdownConfig = Field(default_factory=BreakdownConfig)


class SimulationStatus(BaseModel):
    runId: str
    ejecutando: bool
    configuracion: SimulationRequest | None
    error: str | None


class SleeperDebugItem(BaseModel):
    id: str
    nodo: str


class SleeperDebugView(BaseModel):
    runId: str
    ronda: int
    turno: int
    dormidos: list[SleeperDebugItem]


class SimulationControl:
    def __init__(self, coordinator, settings, base_url):
        self.coordinator, self.settings, self.base_url = coordinator, settings, base_url
        self.lock = asyncio.Lock()
        self.task = None
        self.config = None
        self.error = None
        self.run_id = str(uuid4())

    def status(self):
        return SimulationStatus(runId=self.run_id, ejecutando=self.task is not None and not self.task.done(),
                                configuracion=self.config, error=self.error)

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def start(self, config):
        async with self.lock:
            scenario = read_scenario(default_scenario(config.ronda)).model_dump()
            # Keep only events that fit the selected duration; no late event is silently moved earlier.
            events = [e for e in scenario["eventos"] if (e["turno"] or e["turnoAleatorio"][1]) <= config.turnos] if config.bloqueos else []
            scenario.update(sobrevivientes=config.sobrevivientes, zombies=config.zombies.model_dump(),
                            turnos=config.turnos, distribucion=config.distribucion, eventos=events)
            settings = replace(self.settings, seed=config.semilla, routing_strategy=config.estrategia,
                vehicle_breakdowns=config.averias.activadas,
                vehicle_breakdown_chances={kind:getattr(config.averias,kind).probabilidad for kind in ("caminante","corredor","horda","dormido")},
                vehicle_repair_turns={kind:getattr(config.averias,kind).turnos for kind in ("caminante","corredor","horda","dormido")})
            # Validation/build happen before stopping the previous run.
            try:
                world = build_world(settings, ScenarioConfig.model_validate(scenario))
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            await self.stop()
            await self.coordinator.reset(world, new_run=True)
            self.run_id, self.config, self.error = str(uuid4()), config, None
            self.task = asyncio.create_task(self.run(), name="dashboard-simulation-owner")
            return self.status()

    async def run(self):
        try:
            async with httpx.AsyncClient(base_url=self.base_url, trust_env=False,
                                         limits=httpx.Limits(max_connections=32, max_keepalive_connections=32)) as client:
                await asyncio.sleep(self.coordinator.world.settings.turn_seconds)
                while self.coordinator.world.turn < self.coordinator.world.max_turns:
                    tick = time.perf_counter()
                    await self.coordinator.step(client)
                    if self.coordinator.world.turn < self.coordinator.world.max_turns:
                        elapsed = time.perf_counter() - tick
                        await asyncio.sleep(max(0, self.coordinator.world.settings.turn_seconds - elapsed))
        except asyncio.CancelledError:
            raise
        except Exception:
            self.error = "La simulación se detuvo por un error interno. Revisa el registro del backend."
            import logging
            logging.getLogger(__name__).exception("Dashboard simulation failed")


def install_controls(app, settings, base_url):
    control = SimulationControl(app.state.coordinator, settings, base_url)
    app.state.simulation_control = control
    key_header = APIKeyHeader(name="x-api-key", auto_error=False)

    def authorize(key):
        if key is None or not secrets.compare_digest(key.encode(), settings.api_key.encode()):
            raise HTTPException(401, "API key inválida")

    @app.get("/control/estado", response_model=SimulationStatus, tags=["Control local"])
    async def status(key: str | None = Security(key_header)):
        authorize(key)
        return control.status()

    @app.get("/control/dormidos", response_model=SleeperDebugView, tags=["Control local"])
    async def sleeper_debug(response: Response, key: str | None = Security(key_header)):
        authorize(key)
        response.headers["Cache-Control"] = "no-store"
        # Read-only observer channel. Never merge this into Observation or /estado.
        async with control.coordinator.lock:
            world = control.coordinator.world
            return SleeperDebugView(runId=control.run_id, ronda=world.round_number, turno=world.turn,
                dormidos=[SleeperDebugItem(id=z.id, nodo=z.node) for z in world.zombies if z.kind == "dormido"])

    @app.post("/control/iniciar", response_model=SimulationStatus, tags=["Control local"])
    async def start(body: SimulationRequest, key: str | None = Security(key_header)):
        authorize(key)
        return await control.start(body)

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            await control.stop()
    app.router.lifespan_context = lifespan
