from concurrent.futures import ThreadPoolExecutor
import pytest
from app.models.domain import Shelter, Survivor
from app.storage.reservations import MemoryReservations
from app.rescue.shelters import ShelterAllocator
from app.routing.risk_routes import RiskRoutes
from app.routing.prediction import RiskMap
from app.core.config import Settings
from app.simulator.world import demo_world

def test_atomic_reserve_switch_release_confirm():
    a,b=Shelter('a','a',1),Shelter('b','b',1)
    store=MemoryReservations([a,b])
    assert store.reserve('a','S',1)
    assert store.reserve('a','S',1) and a.reserved==1
    assert store.reserve('b','S',2) and a.reserved==0 and b.reserved==1
    assert store.confirm('b','S') and b.occupied==1 and b.reserved==0
    assert store.confirm('b','S') and b.occupied==1
    assert not store.reserve('b','another',2)
    assert store.reserve('a','X',2)
    store.release('X')
    assert store.available('a')==1

def test_concurrent_reservations_cannot_oversubscribe():
    refuge=Shelter('r','n',4)
    store=MemoryReservations([refuge])
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda i:store.reserve('r',f'S-{i}',1),range(200)))
    assert sum(results)==4 and refuge.reserved==4 and store.available('r')==0
    before=store.snapshot()
    with pytest.raises(ValueError): store.replace({str(i):'r' for i in range(5)},store.version)
    assert store.snapshot()==before
    with pytest.raises(ValueError): store.replace({},store.version-1)

def test_global_capacity_and_inaccessible_shelter():
    world=demo_world(Settings(api_key='test'))
    world.reservations=MemoryReservations(world.shelters)
    world.zombies=[]
    world.shelters[0].capacity=2
    world.survivors=[Survivor(f'S-{i}','N-0000') for i in range(5)]
    snapshot=world.observation()
    routes=RiskRoutes(snapshot,RiskMap.empty(0),0)
    first=ShelterAllocator().assign(world,routes)
    assert len(first)==2 and world.shelters[0].reserved==2
    second=ShelterAllocator().assign(world,routes)
    assert first==second
    world.graph['N-0000']['N-0001']['bloqueada']=True
    routes=RiskRoutes(world.observation(),RiskMap.empty(0),0)
    assert not ShelterAllocator().assign(world,routes)
    assert world.shelters[0].reserved==0

def test_confirmed_transport_reduces_time_without_discounting_risk():
    w=demo_world(Settings(api_key='test'))
    w.zombies=[]
    routes=RiskRoutes(w.observation(),RiskMap.empty(0),0)
    choice=routes.choice('N-0000','N-0004')
    s=w.survivors[0]
    walking=ShelterAllocator.route_cost(s,choice,routes,w.settings)[0]
    s.status='EN_CAMIONETA'
    aboard=ShelterAllocator.route_cost(s,choice,routes,w.settings)[0]
    assert aboard==walking/2
