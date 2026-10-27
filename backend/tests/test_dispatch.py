import asyncio
import json

import httpx
import pytest

from app.api.application import create_app
from app.core.config import Settings
from app.models.domain import Survivor
from app.simulator.world import demo_world


@pytest.mark.parametrize('actors,concurrency',[(0,4),(1,4),(37,7),(200,4)])
def test_dispatch_calls_each_actor_once_and_preserves_concurrency(actors,concurrency):
    async def run():
        world=demo_world(Settings(api_key='test'))
        world.zombies=[]
        world.survivors=[Survivor(f'S-{i}','N-0000') for i in range(actors)]
        coordinator=create_app(world.settings,world).state.coordinator
        coordinator.concurrency=concurrency
        seen=[]
        active=maximum=0

        async def respond(request):
            nonlocal active,maximum
            active+=1
            maximum=max(maximum,active)
            try:
                body=json.loads(request.content)
                seen.append(body)
                await asyncio.sleep(.001)
                return httpx.Response(200,json={'siguienteNodo':body['nodoActual']})
            finally:
                active-=1

        # Transport stand-in tests dispatch accounting, not real TCP latency.
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond),base_url='http://test') as client:
            await coordinator.step(client)
        assert len(seen)==actors
        assert {b['sobrevivienteId'] for b in seen}=={s.id for s in world.survivors}
        assert all(b['turno']==1 and b['nodoActual']=='N-0000' for b in seen)
        assert maximum==min(actors,concurrency)
        assert len(world.metrics.latencies_ms)==actors
        assert world.metrics.http_errors==world.metrics.invalid_responses==0
        world.assert_invariants()

    asyncio.run(run())
