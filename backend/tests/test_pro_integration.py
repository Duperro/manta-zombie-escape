import asyncio
from dataclasses import replace
import json
import httpx
import pytest
import uvicorn
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.evaluation.evaluator import evaluate_round
from app.models.domain import FOOT_STATES,Vehicle
from app.simulator.world import demo_world

def test_initial_pairing_same_world_and_five_vehicles():
    base=build_world(Settings(api_key='test'),read_scenario(default_scenario(3)))
    pro=build_world(Settings(api_key='test',routing_strategy='pro'),read_scenario(default_scenario(3)))
    assert base.initial_fingerprint==pro.initial_fingerprint
    assert base.events==pro.events and len(pro.vehicles)==5
    assert [(z.id,z.node,z.kind) for z in base.zombies]==[(z.id,z.node,z.kind) for z in pro.zombies]

def test_planning_boundary_has_no_hidden_information_and_risk_updates():
    settings=Settings(api_key='test',routing_strategy='pro')
    world=build_world(settings,read_scenario(default_scenario(3)))
    app=create_app(settings,world)
    hidden={z.id for z in world.zombies if z.kind=='dormido'}
    snapshot=app.state.coordinator.snapshot
    assert not hidden.intersection(z[0] for z in snapshot.zombies)
    # Altering hidden positions does not change decisions, risk or assignments.
    before=app.state.coordinator.published_state.model_dump()
    for z in world.zombies:
        if z.kind=='dormido': z.node=world.survivors[0].node
    other=create_app(settings,world).state.coordinator.published_state.model_dump()
    assert other['riesgo']==before['riesgo']
    assert other['rutas']==before['rutas']
    assert other['refugios']==before['refugios']

def test_reservation_freed_when_walker_dies():
    w=demo_world(Settings(api_key='test',routing_strategy='pro'))
    s=w.survivors[0]
    s.assigned_shelter='R-1'
    w.reservations.reserve('R-1',s.id)
    w.zombies[0].node=s.node
    w.resolve({})
    assert s.status=='ELIMINADO' and not w.reservations.snapshot() and w.shelters[0].reserved==0

def test_switches_parse_and_independent_feature_flags(monkeypatch):
    monkeypatch.setenv('API_KEY','test')
    monkeypatch.setenv('ROUTING_STRATEGY','pro')
    monkeypatch.setenv('PRO_FLEET','false')
    monkeypatch.setenv('PRO_PREDICTION','0')
    settings=Settings.from_env()
    assert settings.routing_strategy=='pro' and not settings.pro_fleet and not settings.pro_prediction
    app=create_app(settings)
    state=app.state.coordinator.published_state
    assert state.funcionalidadesPro==dict(prediccion=False,reservas=True,flota=False)
    assert all(not v.sobrevivientesAsignados for v in state.camionetas)

def test_pro_reproducible_full_round_real_http(tmp_path):
    settings=Settings(api_key='test',routing_strategy='pro',seed=7)
    config=read_scenario(default_scenario(3))
    app=create_app(settings,build_world(settings,config))
    async def run():
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=0,log_level='error'))
        task=asyncio.create_task(server.serve())
        rows=[]
        audits=[]
        try:
            while not server.started:
                if task.done(): await task;raise RuntimeError('Server failed')
                await asyncio.sleep(.01)
            port=server.servers[0].sockets[0].getsockname()[1]
            async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',trust_env=False,
                limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)) as client:
                # 200 genuine HTTP requests, including consistent repeated decisions and reservations.
                initial=app.state.coordinator.published_state
                before=app.state.coordinator.world.reservations.snapshot()
                sem=asyncio.Semaphore(4)
                async def ask(s):
                    async with sem:
                        r=await client.post('/paso',headers={'x-api-key':'test'},json=dict(
                            sobrevivienteId=s.id,nodoActual=s.nodoActual,turno=0))
                        assert r.status_code==200 and set(r.json())=={'siguienteNodo'}
                        return r.json()
                await asyncio.gather(*(ask(s) for s in initial.sobrevivientes))
                assert app.state.coordinator.world.reservations.snapshot()==before
                audits.append([])
                def audit(state):
                    data=state.model_dump();data.pop('metricas')
                    audits[-1].append(data)
                rows.append(await evaluate_round(app.state.coordinator,client,on_turn=audit))
                await app.state.coordinator.reset(build_world(settings,config),new_run=True)
                audits.append([])
                rows.append(await evaluate_round(app.state.coordinator,client,on_turn=audit))
                state=(await client.get('/estado')).json()
                assert state['estrategia']=='Pro' and len(state['camionetas'])==5
                assert not any(z['tipo']=='dormido' for z in state['zombies'])
                # No passenger gets an invalid two-edge foot jump via /paso.
                w=app.state.coordinator.world
                w.assert_invariants()
        finally:
            server.should_exit=True
            await task
        if rows[0]['firmaFinal']!=rows[1]['firmaFinal']:
            first=next(i for i,(a,b) in enumerate(zip(*audits)) if a!=b)
            (tmp_path/'repro_diagnostic.json').write_text(json.dumps(dict(rows=rows,
                firstDifferentTurn=first+1,first=audits[0][first],second=audits[1][first]),indent=2),encoding='utf-8')
        return rows
    rows=asyncio.run(run())
    (tmp_path/'pro_repro_results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    assert all(r['erroresHTTP']==0 for r in rows),[(r['erroresHTTP'],r['solicitudesSobre500ms']) for r in rows]
    assert all(r['solicitudesSobre500ms']==0 and r['respuestasInvalidas']==0 for r in rows)
    assert rows[0]['huellaInicial']==rows[1]['huellaInicial']
    assert rows[0]['firmaFinal']==rows[1]['firmaFinal']
    assert rows[0]['huellaInicial']==rows[1]['huellaInicial']
    assert rows[0]['eventos']==rows[1]['eventos']
    assert all(r['turnos']==150 and r['rutasInvalidas']==0 and r['erroresHTTP']==0 for r in rows)
    assert rows[0]['evacuadosCamioneta']>0

def test_aboard_paso_stays_on_pre_movement_node():
    from fastapi.testclient import TestClient
    w=demo_world(Settings(api_key='test',routing_strategy='pro'))
    s=w.survivors[0];s.status='EN_CAMIONETA';s.vehicle_id='V'
    w.vehicles=[Vehicle('V',s.node,passengers=[s.id])]
    app=create_app(w.settings,w)
    with TestClient(app) as client:
        body=dict(sobrevivienteId=s.id,nodoActual=s.node,turno=0)
        a=client.post('/paso',headers={'x-api-key':'test'},json=body)
        b=client.post('/paso',headers={'x-api-key':'test'},json=body)
        assert a.json()==b.json()=={'siguienteNodo':s.node}

def test_entity_random_draws_independent_of_other_zombie_activity():
    from app.models.domain import Zombie
    a=demo_world(Settings(api_key='test'))
    b=demo_world(Settings(api_key='test'))
    a.zombies=[Zombie('A','N-0000'),Zombie('B','N-0009')]
    b.zombies=[Zombie('A','N-0000','dormido'),Zombie('B','N-0009')]
    for turn in range(1,11):
        a.turn=b.turn=turn
        a.move_zombies();b.move_zombies()
        assert a.zombies[1].node==b.zombies[1].node
