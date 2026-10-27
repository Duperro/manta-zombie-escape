import asyncio
from dataclasses import replace
import json
import time
from pathlib import Path
import httpx
import networkx as nx
import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.application import create_app
from app.core.config import Settings
from app.core.graph import DEFAULT_MAP, ROOT, load_map, validate_map, traversable, edges
from app.core.scenario_config import build_world, read_scenario, default_scenario, resolve_events
from app.evaluation.evaluator import evaluate_scenarios, export_results
from app.models.domain import Survivor, Zombie
from app.routing.planner import RoutePlanner
from app.simulator.collisions import Traversal, opposite_crossing, eliminate
from app.simulator.events import apply_events
from app.simulator.world import demo_world
from test_backend import serve

@pytest.fixture
def settings():
    return Settings(api_key="test-phase2",seed=7)

def test_local_map_and_routes_to_all_shelters(settings):
    graph=load_map()
    assert graph.is_multigraph() and graph.is_directed()
    assert len(graph)>=1500
    assert graph.graph["metadata"]["nodosFinales"]==len(graph)
    assert graph.graph["metadata"]["aristasFinales"]==graph.number_of_edges()
    assert nx.is_strongly_connected(graph)
    assert set(graph.graph["sectores"])=={"Tarqui","Los Esteros","Barbasquillo","Jocay"}
    for source in graph.graph["sectores"].values():
        for target in graph.graph["sectores"].values():
            assert nx.has_path(graph,source["nodo"],target["nodo"])
    shelters=build_world(settings).shelters
    assert [r.capacity for r in shelters]==[40,50,60,70]
    for shelter in shelters:
        reachable=nx.descendants(graph.reverse(copy=False),shelter.node)|{shelter.node}
        assert reachable==set(graph)

@pytest.mark.parametrize("defect",["duplicate-node","duplicate-edge","missing-node","negative-distance","nan-coordinate","wrong-time","disconnected"])
def test_map_rejects_corrupt_data(defect):
    data=json.loads(DEFAULT_MAP.read_text(encoding="utf-8"))
    if defect=="duplicate-node": data["nodos"].append(data["nodos"][0])
    if defect=="duplicate-edge": data["aristas"].append(data["aristas"][0])
    if defect=="missing-node": data["aristas"][0]["destino"]="missing"
    if defect=="negative-distance": data["aristas"][0]["distancia_m"]=-1
    if defect=="nan-coordinate": data["nodos"][0]["lat"]=float("nan")
    if defect=="wrong-time": data["aristas"][0]["tiempo_estimado_s"]=999999
    if defect=="disconnected": data["aristas"]=[]
    with pytest.raises(ValueError): validate_map(data)

def test_directed_parallel_roads_are_preserved():
    graph=load_map()
    u,v,k,a=next(iter(graph.edges(keys=True,data=True)))
    graph.add_edge(u,v,key="parallel",**{**a,"id":"parallel","cost":a["cost"]+1})
    a["bloqueada"]=True
    assert traversable(graph).has_edge(u,v)
    assert traversable(graph)[u][v]["id"]=="parallel"
    one_way=nx.MultiDiGraph()
    one_way.add_edge("a","b",id="e",cost=1,bloqueada=False)
    assert not traversable(one_way).has_edge("b","a")

@pytest.mark.parametrize("distribution",["equilibrada","desigual","aleatoria"])
def test_distribution_and_seed(settings,distribution):
    config=read_scenario(default_scenario(3)).model_copy(update={"distribucion":distribution,
        "pesosSectores":{"Tarqui":4.,"Los Esteros":2.,"Barbasquillo":1.,"Jocay":1.}})
    world=build_world(settings,config)
    second=build_world(settings,config)
    assert [(s.id,s.node) for s in world.survivors]==[(s.id,s.node) for s in second.survivors]
    assert world.events==second.events
    assert len(world.survivors)==200 and len(world.zombies)==48
    excluded=world.horde_nodes()|{r.node for r in world.shelters}|{z.node for z in world.zombies}
    assert all(s.node in world.graph and s.node not in excluded for s in world.survivors)
    counts={name:sum(world.graph.nodes[s.node]["sector"]==name for s in world.survivors) for name in config.pesosSectores}
    if distribution=="equilibrada": assert set(counts.values())=={50}
    if distribution=="desigual": assert counts=={"Tarqui":100,"Los Esteros":50,"Barbasquillo":25,"Jocay":25}
    different=build_world(replace(settings,seed=8),config)
    assert [s.node for s in world.survivors]!=[s.node for s in different.survivors]

def test_runner_respects_blocked_detection_and_tie(settings):
    world=demo_world(settings)
    world.zombies=[Zombie("runner","N-0003","corredor")]
    world.graph["N-0001"]["N-0002"]["bloqueada"]=True
    assert not world.near("N-0003","N-0000",3)
    world.move_zombies()
    assert all({t.origin,t.destination}!={"N-0001","N-0002"} for t in world.traversed)
    world=demo_world(settings)
    world.zombies=[Zombie("runner","N-0003","corredor")]
    world.survivors=[Survivor("S-Z","N-0002"),Survivor("S-A","N-0004")]
    world.move_zombies()
    assert world.traversed[0].destination=="N-0004"

def test_shelter_capacity_and_inactive_behavior(settings):
    world=demo_world(settings)
    world.zombies=[]
    world.shelters[0].capacity=1
    world.survivors=[Survivor("S-B","N-0003"),Survivor("S-A","N-0003")]
    world.turn=1
    world.resolve({"S-A":"N-0004","S-B":"N-0004"})
    assert world.shelters[0].occupied==1
    assert world.survivors[1].status=="EVACUADO"  # deterministic ID tie break
    assert world.survivors[0].status=="ACTIVO"
    assert RoutePlanner().next_node(world.observation(),"N-0004")=="N-0004"
    world.resolve({"S-A":"N-0005"})
    assert world.survivors[1].node=="N-0004" and world.shelters[0].occupied==1
    with TestClient(create_app(settings,world)) as client:
        response=client.post("/paso",headers={"x-api-key":settings.api_key},json={"sobrevivienteId":"S-A","nodoActual":"N-0004","turno":1})
        assert response.json()=={"siguienteNodo":"N-0004"}

def test_parallel_streets_do_not_cause_false_opposite_bite():
    assert not opposite_crossing("a","b","street-1",[Traversal("b","a","street-2")])
    assert opposite_crossing("a","b","street-1",[Traversal("b","a","street-1")])
    assert not opposite_crossing("a","a","street-1",[Traversal("a","a","street-1")])

def test_elimination_once_and_no_dead_survivor_activation(settings):
    world=demo_world(settings)
    s=world.survivors[0]
    eliminate(s,"cruce_opuesto",1,world.history)
    eliminate(s,"coincidencia_nodo",1,world.history)
    assert len(world.history)==1 and s.elimination_cause=="cruce_opuesto"
    world.zombies=[Zombie("hidden",s.node,"dormido")]
    world.activate_sleepers()
    assert world.zombies[0].kind=="dormido"

def test_bridge_event_and_no_duplicate_application(settings):
    world=build_world(settings,read_scenario(default_scenario(2)))
    world.turn=75
    apply_events(world)
    blocked=[a for _,_,_,a in edges(world.graph) if a["bloqueada"]]
    assert blocked and all(a["tipo"]=="puente" for a in blocked)
    assert world.graph_version==1
    apply_events(world)
    assert world.graph_version==1 and len(world.history)==1

def test_event_recalculates_alternative_and_invalidates_route(settings):
    world=demo_world(settings)
    world.zombies=[]
    world.graph.add_edge("N-0000","N-0002",distancia_m=300.,velocidad_m_s=1.,tipo="calle",bloqueada=False,cost=300.)
    assert RoutePlanner().next_node(world.observation(),"N-0000")=="N-0001"
    world.survivors[0].planned_route=["N-0000","N-0001","N-0002"]
    world.events={1:[("N-0000","N-0001")]}
    world.turn=1
    apply_events(world)
    assert world.survivors[0].planned_route==[]
    assert RoutePlanner().next_node(world.observation(),"N-0000")=="N-0002"
    assert not world.valid("N-0000","N-0001")

def test_api_state_and_map_contract_hidden_zombies(settings):
    world=build_world(settings,read_scenario(default_scenario(3)))
    app=create_app(settings,world)
    with TestClient(app) as client:
        state=client.get("/estado").json()
        data=client.get("/mapa").json()
        ids={n["id"] for n in data["nodos"]}
        assert {"ronda","estadoSimulacion","aristasBloqueadas","rutas","metricas","eventosRecientes"}<=set(state)
        assert "nodos" not in state and "calles" not in state
        assert all(s["nodoActual"] in ids for s in state["sobrevivientes"])
        hidden={z.id for z in world.zombies if z.kind=="dormido"}
        assert not hidden.intersection(z["id"] for z in state["zombies"])
        assert len(state["zombies"])==40
        assert "api_key" not in json.dumps(state)
        world.turn=99  # unpublished internal mutation is not leaked
        assert client.get("/estado").json()["turno"]==0

def test_http_timeout_invalid_and_server_error_stay(settings):
    async def run_case(mode):
        target=FastAPI()
        @target.post("/paso")
        async def decision():
            if mode=="slow":
                await asyncio.sleep(.65)
                return {"siguienteNodo":"N-0001"}
            if mode=="invalid": return {"siguienteNodo":"N-0001","extra":1}
            from fastapi.responses import HTMLResponse
            return HTMLResponse("upstream failure",status_code=503)
        world=demo_world(settings)
        coordinator=create_app(settings,world).state.coordinator
        server,thread,sock,port=serve(target)
        try:
            async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}",trust_env=False) as client:
                await coordinator.step(client)
            assert world.survivors[0].node=="N-0000"
            assert len(world.metrics.latencies_ms)==1
            assert world.metrics.invalid_responses==int(mode=="invalid")
            assert world.metrics.http_errors==int(mode!="invalid")
        finally:
            server.should_exit=True
            await asyncio.to_thread(thread.join,5)
            sock.close()
    for mode in ["slow","invalid","error"]:
        asyncio.run(run_case(mode))

def test_three_complete_rounds_real_http_and_report(settings,tmp_path):
    app=create_app(settings)
    configs=[read_scenario(default_scenario(i)) for i in [1,2,3]]
    async def run():
        # Same event-loop topology as the production CLI, still through real TCP.
        server=uvicorn.Server(uvicorn.Config(app,host="127.0.0.1",port=0,log_level="error"))
        task=asyncio.create_task(server.serve())
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("HTTP server did not start")
                await asyncio.sleep(.01)
            port=server.servers[0].sockets[0].getsockname()[1]
            async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}",trust_env=False,
                                        limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)) as client:
                return await evaluate_scenarios(app,client,configs,settings)
        finally:
            server.should_exit=True
            await task
    reports=asyncio.run(run())
    assert [r["sobrevivientesIniciales"] for r in reports]==[20,80,200]
    assert [r["turnos"] for r in reports]==[150,150,150]
    assert [len([e for e in r["eventos"] if e["tipo"] in {"colapso_puente","bloqueo_calle"}]) for r in reports]==[0,1,2]
    for r in reports:
        assert r["evacuados"]+r["eliminados"]+r["activos"]==r["sobrevivientesIniciales"]
        assert r["rutasInvalidas"]==0 and r["solicitudesHTTP"]>0
        assert r["erroresHTTP"]==0
        assert len({e["id"] for e in r["eventos"]})==len(r["eventos"])
    assert len(app.state.coordinator.world.survivors)==200
    assert all(r.occupied<=r.capacity for r in app.state.coordinator.world.shelters)
    export_results(reports,tmp_path/"results")
    assert len(json.loads((tmp_path/"results.json").read_text(encoding="utf-8"))["rondas"])==3
    assert len((tmp_path/"results.csv").read_text(encoding="utf-8").splitlines())==4
    print("ROUND3 accelerated duration:",reports[-1]["duracionS"],"seconds; HTTP p95",reports[-1]["latenciaP95Ms"],"ms")
