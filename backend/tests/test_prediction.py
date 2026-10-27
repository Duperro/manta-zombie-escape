from dataclasses import replace
from types import MappingProxyType
import networkx as nx
from app.routing.planner import Observation
from app.routing.prediction import RunnerPredictor

def observation():
    g=nx.DiGraph()
    for a,b in [('a','b'),('b','c'),('c','d'),('b','x')]:
        g.add_edge(a,b,cost=1,bloqueada=False)
    return Observation(4,g,(("S","c"),),("d",),frozenset(),zombies=(("R","a","corredor"),))

def test_two_steps_pursuit_and_edges():
    state=observation()
    risk=RunnerPredictor().predict(state)
    assert set(risk.nodes)=={'a','b','c','x'} and 'd' not in risk.nodes
    assert risk.probable_paths==(('a','b','c'),)
    assert risk.edges[('b','c')]==1
    assert risk.turn==4 and risk.view()['turnoPredicho']==5

def test_respects_blocks_and_hordes():
    state=observation()
    state.graph['a']['b']['bloqueada']=True
    assert set(RunnerPredictor().predict(state).nodes)=={'a'}
    state.graph['a']['b']['bloqueada']=False
    state=replace(state,horde_nodes=frozenset({'b'}))
    assert set(RunnerPredictor().predict(state).nodes)=={'a'}

def test_no_hidden_or_future_input_and_immutable_result():
    import pytest
    state=replace(observation(),zombies=())
    assert not RunnerPredictor().predict(state).nodes
    risk=RunnerPredictor().predict(observation())
    with pytest.raises(TypeError): risk.nodes['secret']=1
    assert RunnerPredictor().predict(observation())==risk

def test_detection_radius_three():
    state=replace(observation(),survivors=(("S","d"),))
    assert RunnerPredictor().predict(state).probable_paths==(('a','b','c'),)
    state.graph.add_edge('d','e',cost=1,bloqueada=False)
    state=replace(state,survivors=(("S","e"),))
    assert not RunnerPredictor().predict(state).probable_paths

def test_route_avoids_prediction_and_opposite_edge():
    from app.routing.prediction import RiskMap
    from app.routing.risk_routes import RiskRoutes
    g=nx.DiGraph()
    for a,b in [('s','danger'),('danger','t'),('s','safe'),('safe','t')]:
        g.add_edge(a,b,cost=1,bloqueada=False)
    state=Observation(1,g,(("S","s"),),("t",),frozenset())
    risk=RiskMap(1,MappingProxyType({'danger':1}),MappingProxyType({('t','danger'):1}))
    assert RiskRoutes(state,risk,10).best('s')[2]==['s','safe','t']
    state=replace(state,zombie_edges=(('danger','s',''),))
    assert RiskRoutes(state,RiskMap.empty(1),0).best('s')[2]==['s','safe','t']

def test_can_escape_current_zombie_without_entering_forbidden_nodes():
    from app.routing.risk_routes import RiskRoutes
    from app.routing.prediction import RiskMap
    state=replace(observation(),forbidden=frozenset({'a'}))
    assert RiskRoutes(state,RiskMap.empty(4),0).best('a')[2]==['a','b','c','d']

def test_predictive_retreat_when_refuge_route_is_temporarily_unavailable():
    from app.routing.strategies import ProStrategy,PlanningContext
    from app.core.config import Settings
    from app.simulator.world import demo_world
    from app.models.domain import Zombie
    w=demo_world(Settings(api_key='test',routing_strategy='pro',pro_fleet=False))
    w.zombies=[Zombie('R','N-0002','corredor'),Zombie('W','N-0004')]
    w.survivors[0].node='N-0000'
    # A safe side street offers a retreat while the shelter is blocked by a visible walker.
    w.graph.add_node('SIDE',lat=-.96,lng=-80.73)
    w.graph.add_edge('N-0000','SIDE',cost=10,distancia_m=10,velocidad_m_s=1,tipo='calle',bloqueada=False)
    strategy=ProStrategy()
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    strategy.plan(ctx,w.observation())
    assert w.survivors[0].planned_route==['N-0000','SIDE']

def test_known_collision_escape_has_priority_even_without_reachable_shelter():
    from app.routing.strategies import ProStrategy,PlanningContext
    from app.core.config import Settings
    from app.simulator.world import demo_world
    from app.models.domain import Zombie
    w=demo_world(Settings(api_key='test',routing_strategy='pro',pro_fleet=False))
    w.shelters[0].status='CERRADO'
    w.zombies=[Zombie('R','N-0000','corredor')]
    strategy=ProStrategy()
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    strategy.plan(ctx,w.observation())
    assert w.survivors[0].planned_route==['N-0000','N-0001']
