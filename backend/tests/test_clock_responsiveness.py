import asyncio
from contextlib import suppress
import threading

import httpx
import pytest

from app.api.application import create_app
from app.core.config import Settings
from app.simulator.world import demo_world


@pytest.mark.parametrize('cancel',[False,True])
def test_http_stays_responsive_and_cancel_waits_for_cpu_writer(cancel):
    async def run():
        world=demo_world(Settings(api_key='test'))
        world.zombies=[]
        app=create_app(world.settings,world)
        coordinator=app.state.coordinator
        started,release,finished=threading.Event(),threading.Event(),threading.Event()
        original=coordinator.strategy.plan

        def blocked_plan(context,state):
            started.set()
            try:
                release.wait(5)
                original(context,state)
            finally:
                finished.set()

        coordinator.strategy.plan=blocked_plan
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            clock=asyncio.create_task(coordinator.step(client))
            try:
                assert await asyncio.to_thread(started.wait,5)
                # Completion before releasing CPU work proves event-loop availability
                # without asserting a fragile machine-specific elapsed time.
                assert (await client.get('/health')).status_code==200
                published=(await client.get('/estado')).json()
                assert published['turno']==0 and not finished.is_set()
                body=dict(sobrevivienteId=world.survivors[0].id,nodoActual='N-0000',turno=0)
                assert (await client.post('/paso',json=body,headers={'x-api-key':'test'})).status_code==200
                if cancel:
                    clock.cancel()
                    await asyncio.sleep(0)
                    assert not clock.done()
                    assert coordinator.lock.locked()
                release.set()
                if cancel:
                    with pytest.raises(asyncio.CancelledError):
                        await clock
                    assert finished.is_set()
                    fresh=demo_world(world.settings)
                    fresh.zombies=[]
                    await coordinator.reset(fresh,new_run=True)
                    assert coordinator.world is fresh and fresh.turn==0
                    assert coordinator.published_state.turno==0
                else:
                    await clock
                    assert finished.is_set() and coordinator.published_state.turno==1
                    world.assert_invariants()
            finally:
                release.set()
                if not clock.done():
                    clock.cancel()
                with suppress(asyncio.CancelledError):
                    await clock

    asyncio.run(run())
