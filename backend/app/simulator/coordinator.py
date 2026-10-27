import asyncio
import time
import httpx
from app.routing.strategies import make_strategy, PlanningContext
from app.models.domain import FOOT_STATES, living
from app.models.domain import PasoResponse
from app.simulator.events import apply_events

class Coordinator:
    def __init__(self, world, repository, concurrency=None):
        self.world, self.repository = world, repository
        self.lock = asyncio.Lock()
        self.concurrency = concurrency or world.settings.http_concurrency
        self.strategy = make_strategy(world.settings)
        self.snapshot = world.observation()
        self.precompute()
        self.published_state = world.view()

    def precompute(self):
        w=self.world
        context=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
        self.strategy.plan(context,self.snapshot)
        w.risk_view=self.strategy.risk.view() if w.settings.routing_strategy=="pro" else {}
        for survivor in self.world.survivors:
            if survivor.status in FOOT_STATES:
                path = survivor.planned_route or [survivor.node]
                target = path[1] if len(path)>1 else survivor.node
            else:
                target = survivor.node
            self.repository.put_if_absent(self.snapshot.turn,survivor.id,survivor.node,target)

    async def reset(self, world, *, new_run=False):
        async with self.lock:
            if new_run:
                self.repository.reset_run()
            self.world = world
            self.strategy = make_strategy(world.settings)
            self.snapshot = world.observation()
            self.precompute()
            self.published_state = world.view()

    async def step(self, client: httpx.AsyncClient):
        async with self.lock:
            w = self.world
            if w.turn >= w.max_turns:
                raise ValueError("Ronda finalizada")
            start = time.perf_counter()
            w.turn += 1
            w.phase = "decision"
            apply_events(w)
            w.move_zombies()
            self.snapshot = w.observation()
            self.precompute()
            semaphore = asyncio.Semaphore(self.concurrency)
            metrics = w.metrics

            async def request(sid,node):
                async with semaphore:
                    before = time.perf_counter()
                    target = node
                    try:
                        async with asyncio.timeout(.5):
                            response = await client.post("/paso",headers={"x-api-key":w.settings.api_key},
                                json={"sobrevivienteId":sid,"nodoActual":node,"turno":w.turn},timeout=.5)
                            response.raise_for_status()
                            payload = response.json()
                            if not isinstance(payload,dict) or set(payload)!={"siguienteNodo"}:
                                raise ValueError("Contrato de respuesta inválido")
                            target = PasoResponse.model_validate(payload,strict=True).siguienteNodo
                    except (httpx.HTTPError,TimeoutError):
                        metrics.http_errors += 1
                    except (ValueError,KeyError,TypeError):
                        metrics.invalid_responses += 1
                    finally:
                        elapsed=(time.perf_counter()-before)*1000
                        metrics.latencies_ms.append(elapsed)
                        metrics.over_500ms += int(elapsed>500)
                        if elapsed>500:
                            target=node
                    return sid,target

            decisions=dict(await asyncio.gather(*(request(sid,node) for sid,node in self.snapshot.survivors)))
            w.resolve(decisions)
            # A published route begins at the current position, after this turn's movement.
            for survivor in w.survivors:
                if survivor.status in FOOT_STATES and survivor.node in survivor.planned_route:
                    survivor.planned_route=survivor.planned_route[survivor.planned_route.index(survivor.node):]
            w.phase="publicado"
            w.assert_invariants()
            metrics.turn_records.append(dict(turno=w.turn,duracionMs=(time.perf_counter()-start)*1000,
                                             activos=sum(living(s.status) for s in w.survivors)))
            self.published_state=w.view()
            return self.published_state
