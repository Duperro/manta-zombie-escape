"""Offline presentation recordings, not live measurements or a frontend decision engine."""
import asyncio
import json
from pathlib import Path
import sys
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.api.application import create_app
from app.core.config import Settings
from app.core.graph import ROOT
from app.core.scenario_config import build_world,read_scenario,default_scenario

async def main():
    target=ROOT/'frontend/public/demo'
    target.mkdir(parents=True,exist_ok=True)
    for number in [1,2,3]:
        settings=Settings(api_key='offline-recording-only',routing_strategy='base' if number==1 else 'pro')
        app=create_app(settings,build_world(settings,read_scenario(default_scenario(number))))
        (target/'mapa.json').write_text(json.dumps(app.state.base_map.model_dump(),separators=(',',':')),encoding='utf-8')
        frames=[]
        def record(state):
            data=state.model_dump()
            for key in list(data['metricas']):
                if key.startswith('latencia') or key=='disponibilidadEndpoint': data['metricas'][key]=None
                if key in {'solicitudesHTTP','erroresHTTP','respuestasInvalidas','solicitudesSobre500ms'}: data['metricas'][key]=0
            frames.append(data)
        record(app.state.coordinator.published_state)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://offline') as client:
            for _ in range(14): record(await app.state.coordinator.step(client))
        (target/f'round_{number}.json').write_text(json.dumps(dict(
            notice='DEMOSTRACIÓN: reproducción preparada, no ejecución ni mediciones HTTP reales.',seed=7,frames=frames),
            separators=(',',':'),ensure_ascii=False),encoding='utf-8')
        print(f'Round {number}: {len(frames)} offline frames, no credentials exported')

if __name__=='__main__': asyncio.run(main())
