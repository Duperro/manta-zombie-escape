"""Select a reproducible physical-contact fixture for QA, never a routing input or benchmark."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world, ScenarioConfig
from app.core.graph import ROOT

for seed in range(1,31):
    scenario=ScenarioConfig(ronda=3,nombre="Diagnóstico de averías",turnos=150,sobrevivientes=1,
        zombies=dict(caminante=0,corredor=0,horda=0,dormido=200))
    settings=Settings(api_key='diagnostic-only',seed=seed,routing_strategy='pro')
    world=build_world(settings,scenario)
    sleeping={z.node for z in world.zombies}
    if not any(v.node in sleeping for v in world.vehicles):continue
    app=create_app(settings,world)
    idle=[v.id for v in world.vehicles if v.node in sleeping and v.route==[v.node]]
    if idle:
        data=dict(ronda=3,sobrevivientes=1,zombies=scenario.zombies,turnos=150,semilla=seed,
                  estrategia='pro',distribucion='equilibrada',bloqueos=False,
                  averias=dict(activadas=True,**{kind:dict(probabilidad=1.,turnos=4) for kind in scenario.zombies}))
        (ROOT/'reports/breakdowns_demo_config.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
        print(json.dumps(dict(diagnostic=True,seed=seed,expectedIdleVehicles=idle,note='Fixture for contact verification only, not a scored scenario')),flush=True)
        break
else:raise RuntimeError('No diagnostic contact found in the bounded seed set')
