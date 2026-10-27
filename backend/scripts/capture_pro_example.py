"""Capture a real published HTTP state with passengers, for the frontend handoff."""
import asyncio
import json
from pathlib import Path
import sys
import httpx
import uvicorn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.core.graph import ROOT

async def run():
    settings=Settings(api_key='example-capture-only',routing_strategy='pro')
    world=build_world(settings,read_scenario(default_scenario(3)))
    app=create_app(settings,world)
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=0,log_level='error'))
    task=asyncio.create_task(server.serve())
    try:
        while not server.started:
            if task.done(): await task;raise RuntimeError('Server failed')
            await asyncio.sleep(.01)
        port=server.servers[0].sockets[0].getsockname()[1]
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',trust_env=False,
                limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)) as client:
            for _ in range(50):
                state=await app.state.coordinator.step(client)
                if any(v.pasajeros for v in state.camionetas):
                    response=await client.get('/estado')
                    response.raise_for_status()
                    hidden={z.id for z in world.zombies if z.kind=='dormido'}
                    assert not hidden.intersection(z['id'] for z in response.json()['zombies'])
                    path=ROOT/'docs/estado.pro.transporte.example.json'
                    path.write_text(json.dumps(response.json(),ensure_ascii=False,indent=2),encoding='utf-8')
                    print(f'Captured real HTTP state: turn {state.turno}, passengers '+str(sum(len(v.pasajeros) for v in state.camionetas)))
                    return
            raise RuntimeError('No boarding observed in first 50 turns')
    finally:
        server.should_exit=True
        await task

if __name__=='__main__': asyncio.run(run())
