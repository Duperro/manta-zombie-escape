from dataclasses import replace
import math
import pytest
from fastapi.testclient import TestClient
from app.api.application import create_app
from app.core.config import Settings
from app.models.domain import Survivor, Vehicle, Zombie, Shelter
from app.simulator.world import demo_world, road_identity
from app.simulator.collisions import Traversal
from app.routing.strategies import ProStrategy, PlanningContext
from app.storage.reservations import MemoryReservations

KINDS=("caminante","corredor","horda","dormido")

def setup(kind="caminante",chance=1.,duration=2):
    settings=Settings(api_key="test-breakdowns",routing_strategy="pro",vehicle_breakdowns=True,
        vehicle_breakdown_chances=dict.fromkeys(KINDS,chance),vehicle_repair_turns=dict.fromkeys(KINDS,duration))
    w=demo_world(settings); w.survivors=[]
    w.vehicles=[Vehicle("V","N-0000",route=["N-0000","N-0001","N-0002"])]
    w.zombies=[Zombie("Z","N-0001",kind)]
    w.turn=1
    return w

@pytest.mark.parametrize("strategy",["base","pro"])
@pytest.mark.parametrize("kind",KINDS)
def test_contact_stops_microsteps_and_repairs_for_exact_future_turns(kind,strategy):
    w=setup(kind);w.settings=replace(w.settings,routing_strategy=strategy);v=w.vehicles[0]
    # Hordes prevent entering their blocked neighborhood; contact at a stationary node is physical.
    if kind=="horda":v.node="N-0001";v.route=[v.node]
    w.resolve({})
    assert v.node=="N-0001" and v.status=="AVERIADA" and v.repair_turns_remaining==2
    assert len(v.traversed)<=1 and v.breakdowns==1 and v.breakdown_cause==kind
    w.assert_invariants()
    w.zombies=[]
    for remaining in [1,0]:
        w.turn+=1;w.resolve({});w.assert_invariants()
        assert v.node=="N-0001" and v.repair_turns_remaining==remaining and not v.traversed
    assert v.status=="DISPONIBLE" and v.breakdown_cause is None
    v.route=[v.node,"N-0002","N-0003"]
    w.turn+=1;w.resolve({})
    assert v.node=="N-0003" and v.breakdowns==1
    assert sum(e["tipo"]=="camioneta_reparada" for e in w.history)==1

@pytest.mark.parametrize("disabled",[True,False])
def test_disabled_or_zero_probability_preserves_normal_movement(disabled):
    w=setup(chance=0. if not disabled else 1.)
    if disabled:w.settings=replace(w.settings,vehicle_breakdowns=False)
    w.resolve({});v=w.vehicles[0]
    assert v.node=="N-0002" and v.repair_turns_remaining==0 and not v.breakdowns


def test_pending_pickups_are_released_but_foot_shelter_reservation_remains():
    w=setup();v=w.vehicles[0]
    s=Survivor("S","N-0003",status="HACIA_ENCUENTRO",assigned_shelter="R-1",vehicle_id=v.id)
    w.survivors=[s];w.reservations.reserve("R-1",s.id)
    v.assigned=[s.id];v.meeting="N-0002"
    w.resolve({s.id:s.node});w.assert_invariants()
    assert s.vehicle_id is None and s.status=="CAMINANDO" and not v.assigned and v.meeting is None
    assert s.planned_route==[s.node] and w.reservations.snapshot()=={s.id:"R-1"}
    assert w.metrics.rescues_cancelled==1


def test_passengers_and_their_reservations_survive_repairs_and_can_be_delivered():
    w=setup();w.zombies=[];v=w.vehicles[0]
    s=Survivor("S",v.node,status="EN_CAMIONETA",assigned_shelter="R-1",vehicle_id=v.id)
    w.survivors=[s];v.passengers=[s.id];v.repair_turns_remaining=2;v.status="AVERIADA";v.route=[v.node]
    w.shelters.append(Shelter("R-2",v.node,10));w.reservations=MemoryReservations(w.shelters)
    w.reservations.reserve("R-1",s.id)
    def plan():
        ProStrategy().plan(PlanningContext(w.survivors,w.shelters,w.vehicles,w.reservations,w.settings,w.turn,w.history,w.metrics),w.observation())
    for remaining in [1,0]:
        plan();assert w.reservations.snapshot()=={s.id:"R-1"}
        w.turn+=1;w.resolve({});w.assert_invariants()
        assert s.status=="EN_CAMIONETA" and v.passengers==[s.id] and v.repair_turns_remaining==remaining
    plan();w.turn+=1;w.resolve({});w.assert_invariants()
    assert s.status=="EVACUADO" and s.evacuation_mode=="camioneta" and v.trips==1

@pytest.mark.parametrize("same_road",[True,False])
def test_opposite_crossing_uses_real_road_and_contact_type(same_road):
    w=setup("corredor",duration=3);w.zombies[0].node="N-0000"
    token=road_identity(w.graph,"N-0000","N-0001",w.graph["N-0000"]["N-0001"])
    track=Traversal("N-0001","N-0000",token if same_road else "parallel-road")
    w.traversed=[track];w.zombie_movements=[(track,"Z","corredor")]
    w.resolve({})
    assert w.vehicles[0].repair_turns_remaining==(3 if same_road else 0)


def test_hidden_contact_never_exposes_sleepers_to_observation():
    w=setup("dormido");w.vehicles[0].route=["N-0000"];w.zombies[0].node="N-0000"
    w.resolve({})
    assert w.vehicles[0].breakdown_cause=="dormido"
    assert not w.observation().zombies and not w.view().zombies
    assert w.view().camionetas[0].turnosReparacionRestantes==2


def test_seeded_damage_does_not_depend_on_unrelated_vehicle_draws():
    def run(extra):
        w=setup(chance=.5);v=w.vehicles[0]
        if extra:
            w.vehicles.insert(0,Vehicle("OTHER","N-0008"));w.zombies.append(Zombie("OTHER-Z","N-0008"))
        result=[]
        for turn in range(1,25):
            w.turn=turn
            if not v.repair_turns_remaining:v.node="N-0000";v.route=[v.node,"N-0001"]
            w.resolve({});w.assert_invariants();result.append((v.node,v.repair_turns_remaining,v.breakdowns))
        return result
    assert run(False)==run(True)==run(False)


def test_control_validates_rules_and_applies_settings_without_changing_paso():
    app=create_app(Settings(api_key="test-breakdowns"),dashboard_controls=True)
    headers={"x-api-key":"test-breakdowns"}
    with TestClient(app) as client:
        config={"averias":{"activadas":True,"caminante":{"probabilidad":1.,"turnos":4}}}
        response=client.post("/control/iniciar",json=config,headers=headers)
        assert response.status_code==200 and response.json()["configuracion"]["averias"]["activadas"]
        assert app.state.coordinator.world.settings.vehicle_breakdowns
        assert app.state.coordinator.world.settings.vehicle_repair_turns["caminante"]==4
        run=response.json()["runId"]
        for rule in [{"probabilidad":1.1,"turnos":4},{"probabilidad":.5,"turnos":0},{"probabilidad":.5,"turnos":1.5}]:
            assert client.post("/control/iniciar",json={"averias":{"caminante":rule}},headers=headers).status_code==422
        assert client.get("/control/estado",headers=headers).json()["runId"]==run
        assert set(app.openapi()["components"]["schemas"]["PasoResponse"]["properties"])=={"siguienteNodo"}

@pytest.mark.parametrize("chances,turns",[(dict.fromkeys(KINDS,float('nan')),dict.fromkeys(KINDS,2)),(dict.fromkeys(KINDS,.5),dict.fromkeys(KINDS,31))])
def test_invalid_settings_are_rejected(chances,turns):
    with pytest.raises(ValueError):Settings(api_key="test",vehicle_breakdown_chances=chances,vehicle_repair_turns=turns)
