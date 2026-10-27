from dataclasses import replace
import networkx as nx
from app.models.domain import Survivor,Vehicle,Zombie
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.routing.strategies import ProStrategy,PlanningContext
from app.simulator.world import demo_world
from app.simulator.events import apply_events
from app.models.domain import FOOT_STATES
from app.rescue import fleet

def world():
    w=demo_world(Settings(api_key='test',routing_strategy='pro'))
    w.zombies=[]
    w.survivors=[Survivor('S','N-0000',assigned_shelter='R-1')]
    w.vehicles=[Vehicle('V','N-0000')]
    assert w.reservations.reserve('R-1','S',0)
    return w

def test_five_configured_vehicles():
    w=build_world(Settings(api_key='test',routing_strategy='pro'))
    assert len(w.vehicles)==5 and len({v.id for v in w.vehicles})==5
    assert all(v.capacity==4 and v.node in w.graph for v in w.vehicles)


def test_grouping_hop_bound_preserves_unfiltered_planning_and_physics(monkeypatch):
    settings=Settings(api_key='test',routing_strategy='pro')
    config=read_scenario(default_scenario(3))
    original=fleet.nearby_origins

    def simulate(filter_origins):
        monkeypatch.setattr(fleet,'nearby_origins',filter_origins)
        w=build_world(settings,config)
        strategy=ProStrategy()
        frames=[]
        for turn in range(4):
            w.turn=turn
            apply_events(w)
            w.move_zombies()
            context=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,
                                    w.settings,w.turn,w.history,w.metrics)
            strategy.plan(context,w.observation())
            w.risk_view=strategy.risk.view()
            decisions={s.id:s.planned_route[1] if len(s.planned_route)>1 else s.node
                       for s in w.survivors if s.status in FOOT_STATES}
            w.resolve(decisions)
            w.assert_invariants()
            frames.append(w.view().model_dump(exclude={'metricas'}))
        return frames

    assert simulate(original)==simulate(lambda graph,target,limit:set(graph))

def test_no_pickup_at_distance_then_physical_pickup_and_delivery():
    w=world()
    s,v=w.survivors[0],w.vehicles[0]
    v.node='N-0001'
    v.meeting='N-0000'
    v.assigned=['S']; s.vehicle_id='V'; s.status='ESPERANDO_RESCATE'
    w.resolve({'S':'N-0000'})
    assert s.status=='ESPERANDO_RESCATE' and not v.passengers
    v.route=['N-0001','N-0000']
    w.turn=1; w.resolve({'S':'N-0000'})
    assert s.status=='EN_CAMIONETA' and v.passengers==['S'] and w.shelters[0].occupied==0
    v.route=['N-0000','N-0001','N-0002','N-0003','N-0004']
    w.turn=2; w.resolve({'S':'N-0009'})  # Ignored: passengers never walk independently.
    assert v.node==s.node=='N-0002' and s.status=='EN_CAMIONETA' and len(v.traversed)==2
    w.assert_invariants()
    w.turn=3; w.resolve({})
    assert s.node=='N-0004' and s.status=='EVACUADO' and s.evacuation_mode=='camioneta'
    assert w.shelters[0].occupied==1 and w.shelters[0].reserved==0 and v.trips==1
    w.resolve({})
    assert w.shelters[0].occupied==1 and v.trips==1
    w.assert_invariants()

def test_capacity_and_no_teleports_or_blocked_streets():
    w=world();v=w.vehicles[0]
    w.survivors=[Survivor(str(i),'N-0000',status='ESPERANDO_RESCATE',assigned_shelter='R-1',vehicle_id='V') for i in range(5)]
    w.reservations.release('S')
    for s in w.survivors: w.reservations.reserve('R-1',s.id)
    v.meeting='N-0000';v.assigned=[s.id for s in w.survivors]
    w.resolve({})
    assert len(v.passengers)==4 and len(v.assigned)==1
    v.route=['N-0000','N-0009']
    w.resolve({})
    assert v.node=='N-0000' and not v.traversed
    v.route=['N-0000','N-0001','N-0002']
    w.graph['N-0000']['N-0001']['bloqueada']=True
    w.resolve({})
    assert v.node=='N-0000' and not v.traversed

def test_vehicle_passengers_subject_to_opposite_bites_and_release():
    w=world();s,v=w.survivors[0],w.vehicles[0]
    s.status='EN_CAMIONETA';s.vehicle_id='V';v.passengers=['S']
    v.route=['N-0000','N-0001','N-0002']
    w.traversed=[('N-0002','N-0001')]
    w.resolve({})
    assert s.status=='ELIMINADO' and not v.passengers
    assert s.elimination_cause=='incidente_camioneta' and not w.reservations.snapshot()
    w.assert_invariants()

def test_unsafe_meeting_cancelled_and_returns_to_walking():
    w=world();s,v=w.survivors[0],w.vehicles[0]
    s.vehicle_id='V';s.status='HACIA_ENCUENTRO'
    v.meeting='N-0002';v.assigned=['S']
    w.zombies=[Zombie('Z','N-0002')]
    # Make alternative rescues unattractive, to inspect cancellation in isolation.
    w.settings=replace(w.settings,rescue_min_benefit=1000)
    planner=ProStrategy()
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    planner.plan(ctx,w.observation())
    assert v.meeting is None and s.status=='CAMINANDO' and s.vehicle_id is None
    assert w.metrics.rescues_cancelled==1
    assert any(e['tipo']=='rescate_cancelado' for e in w.history)

def test_successive_trips_and_no_double_vehicle_occupancy():
    w=world();s,v=w.survivors[0],w.vehicles[0]
    s.status='EN_CAMIONETA';s.vehicle_id='V';v.passengers=['S']
    v.node=s.node='N-0003';v.route=['N-0003','N-0004']
    w.resolve({});assert v.trips==1
    second=Survivor('S2','N-0003',assigned_shelter='R-1',status='ESPERANDO_RESCATE',vehicle_id='V')
    w.survivors.append(second);w.reservations.reserve('R-1','S2')
    v.assigned=['S2'];v.meeting='N-0003';v.route=['N-0004','N-0003']
    w.resolve({});assert second.status=='EN_CAMIONETA'
    v.route=['N-0003','N-0004'];w.resolve({})
    assert v.trips==2 and w.shelters[0].occupied==2
    w.assert_invariants()

def test_priority_not_just_nearest_and_stable_meeting():
    w=world()
    w.vehicles[0].node='N-0008'
    far=Survivor('FAR','N-0009',assigned_shelter='R-1')
    near=Survivor('NEAR','N-0003',assigned_shelter='R-1')
    w.survivors=[near,far]
    w.reservations.release('S')
    strategy=ProStrategy()
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    strategy.plan(ctx,w.observation())
    v=w.vehicles[0]
    assert 'FAR' in v.assigned and 'NEAR' not in v.assigned
    point=v.meeting
    strategy.plan(ctx,w.observation())
    assert v.meeting==point

def test_impossible_meeting_cancelled_on_block():
    w=world();s,v=w.survivors[0],w.vehicles[0]
    v.meeting='N-0002';v.assigned=['S'];s.vehicle_id='V';s.status='HACIA_ENCUENTRO'
    w.graph['N-0000']['N-0001']['bloqueada']=True
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    ProStrategy().plan(ctx,w.observation())
    assert not v.assigned and s.vehicle_id is None and v.meeting is None

def test_meeting_reoptimized_only_for_substantial_benefit():
    w=world();s,v=w.survivors[0],w.vehicles[0]
    v.meeting='N-0003';v.assigned=['S'];s.vehicle_id='V';s.status='HACIA_ENCUENTRO'
    ctx=PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics)
    ProStrategy().plan(ctx,w.observation())
    assert v.meeting=='N-0000'
    assert any(e['tipo']=='encuentro_actualizado' for e in w.history)

def test_all_five_vehicles_can_pick_up_and_evacuate_twenty_distinct_people():
    w=world()
    w.survivors=[]
    w.vehicles=[]
    w.reservations.release('S')
    for i in range(5):
        v=Vehicle(f'V-{i+1:03}','N-0000',meeting='N-0000')
        w.vehicles.append(v)
        for j in range(4):
            s=Survivor(f'S-{i}-{j}','N-0000',status='ESPERANDO_RESCATE',assigned_shelter='R-1',vehicle_id=v.id)
            w.survivors.append(s);v.assigned.append(s.id)
            assert w.reservations.reserve('R-1',s.id)
    w.resolve({})
    assert all(len(v.passengers)==4 for v in w.vehicles)
    for v in w.vehicles: v.route=['N-0000','N-0001','N-0002','N-0003','N-0004']
    w.turn=1;w.resolve({})
    w.turn=2;w.resolve({})
    assert all(s.status=='EVACUADO' and s.evacuation_mode=='camioneta' for s in w.survivors)
    assert all(v.trips==1 for v in w.vehicles)
    assert w.shelters[0].occupied==20 and not w.reservations.snapshot()
    w.assert_invariants()
