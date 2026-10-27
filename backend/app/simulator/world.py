import random
import hashlib
import json
from dataclasses import dataclass, field
from types import MappingProxyType
import networkx as nx
from app.core.config import Settings
from app.core.graph import traversable, edges
from app.models.domain import Survivor, Zombie, Shelter, Vehicle, StateView, FOOT_STATES, SURVIVOR_STATES, living
from app.routing.planner import Observation
from app.simulator.collisions import Traversal, same_node, opposite_crossing, eliminate
from app.evaluation.metrics import Metrics
from app.storage.reservations import MemoryReservations

def road_identity(graph, u, v, attrs):
    if attrs.get("osmids"):
        geometry=tuple(tuple(point) for point in attrs.get("geometria",[]))
        return repr((tuple(sorted(attrs["osmids"])),min(geometry,tuple(reversed(geometry)))))
    return repr(tuple(sorted((u,v))))

@dataclass
class World:
    graph: nx.Graph
    survivors: list[Survivor]
    zombies: list[Zombie]
    shelters: list[Shelter]
    settings: Settings
    turn: int = 0
    phase: str = "publicado"
    events: dict[int,list] = field(default_factory=dict)
    round_number: int = 0
    max_turns: int = 150
    graph_version: int = 0
    history: list[dict] = field(default_factory=list)
    applied_events: set[str] = field(default_factory=set)
    metrics: Metrics = field(default_factory=Metrics)
    vehicles: list[Vehicle] = field(default_factory=list)
    risk_view: dict = field(default_factory=dict)
    scenario_config: dict = field(default_factory=dict)
    initial_fingerprint: str = ""

    def __post_init__(self):
        self.rng=random.Random(self.settings.seed)  # Legacy demo handle; decisions never receive this.
        self.traversed=[]
        self.reservations=MemoryReservations(self.shelters)

    def horde_nodes(self):
        blocked=set()
        for z in self.zombies:
            if z.kind=="horda":
                blocked.update([z.node,*self.graph.neighbors(z.node)])
                if self.graph.is_directed():
                    blocked.update(self.graph.predecessors(z.node))
        return blocked

    def near(self,a,b,radius):
        return b in nx.single_source_shortest_path_length(traversable(self.graph),a,cutoff=radius)

    def move_zombies(self):
        self.traversed=[]
        usable=traversable(self.graph)
        blocked=self.horde_nodes()
        ordinary=nx.subgraph_view(usable,filter_edge=lambda u,v:v not in blocked)
        for z in sorted(self.zombies,key=lambda z:z.id):
            rng=random.Random(f"{self.settings.seed}:zombie:{z.id}:turn:{self.turn}")
            if z.kind=="dormido" or z.kind=="caminante" and self.turn%2:
                continue
            if z.kind=="horda" and rng.random()>=self.settings.horde_move_probability:
                continue
            graph=usable if z.kind=="horda" else ordinary
            for _ in range(2 if z.kind=="corredor" else 1):
                neighbors=sorted(graph.successors(z.node))
                if not neighbors: break
                paths=nx.single_source_shortest_path(graph,z.node,cutoff=3) if z.kind=="corredor" else {}
                targets=sorted((len(paths[s.node])-1,s.id,s.node) for s in self.survivors
                               if living(s.status) and s.node in paths)
                if targets and targets[0][0]==0: break
                dest=paths[targets[0][2]][1] if targets else rng.choice(neighbors)
                self.traversed.append(Traversal(z.node,dest,road_identity(self.graph,z.node,dest,graph[z.node][dest])))
                z.node=dest

    def observation(self):
        graph=traversable(self.graph)
        for u,v in list(graph.edges):
            scalars={k:a for k,a in graph[u][v].items() if isinstance(a,(str,int,float,bool))}
            scalars["road_token"]=road_identity(self.graph,u,v,graph[u][v])
            attrs=MappingProxyType(scalars)
            graph._succ[u][v]=attrs
            graph._pred[v][u]=attrs
        for n in graph:
            graph._node[n]=MappingProxyType(dict(graph.nodes[n]))
        nx.freeze(graph)
        hordes=frozenset(self.horde_nodes())
        visible=tuple((z.id,z.node,z.kind) for z in self.zombies if z.kind!="dormido")
        forbidden=hordes|{node for _,node,_ in visible}
        people=tuple((s.id,s.node) for s in self.survivors if living(s.status))
        shelters=tuple(r.node for r in self.shelters if r.status=="ABIERTO" and
                       r.occupied+(0 if self.settings.routing_strategy=="pro" else r.reserved)<r.capacity)
        tracks=tuple((t.origin,t.destination,t.road) if isinstance(t,Traversal) else (*t,"") for t in self.traversed)
        return Observation(self.turn,graph,people,shelters,frozenset(forbidden),self.graph_version,
                           visible,hordes,tracks,people)

    def valid(self,origin,dest):
        if not isinstance(dest,str) or origin not in self.graph or dest not in self.graph:
            return False
        return dest==origin or (traversable(self.graph).has_edge(origin,dest) and dest not in self.horde_nodes())

    def activate_sleepers(self):
        usable=traversable(self.graph)
        for z in self.zombies:
            if z.kind=="dormido":
                nearby=nx.single_source_shortest_path_length(usable,z.node,cutoff=2)
                if any(s.node in nearby and living(s.status) for s in self.survivors):
                    z.kind="caminante"
                    self.history.append(dict(id=f"despertar-{z.id}",turno=self.turn,tipo="despertar",zombieId=z.id,nodo=z.node))

    def _bite(self,s,cause):
        self.reservations.release(s.id)
        eliminate(s,cause,self.turn,self.history)
        s.vehicle_id=None

    def _admit(self,s,refuge,mode):
        if not living(s.status) or not self.reservations.confirm(refuge.id,s.id):
            return False
        s.status,s.assigned_shelter,s.evacuation_turn="EVACUADO",refuge.id,self.turn
        s.evacuation_mode=mode
        s.planned_route=[]
        s.vehicle_id=None
        self.history.append(dict(id=f"evacuacion-{s.id}",turno=self.turn,tipo="evacuacion",
            sobrevivienteId=s.id,refugioId=refuge.id,modo=mode))
        return True

    def resolve(self,decisions):
        usable,blocked=traversable(self.graph),self.horde_nodes()
        foot=[s for s in self.survivors if s.status in FOOT_STATES]
        people={s.id:s for s in self.survivors}
        movements={}
        for s in foot:
            origin=s.node
            dest=decisions.get(s.id,origin)
            valid=isinstance(dest,str) and (dest==origin or usable.has_edge(origin,dest) and dest not in blocked)
            self.metrics.valid_moves+=int(valid)
            self.metrics.invalid_moves+=int(not valid)
            s.node=dest if valid else origin
            s.elapsed_turns+=1
            road=""
            if s.node!=origin:
                attrs=usable[origin][s.node]
                s.walking_distance_m+=attrs["distancia_m"]
                road=road_identity(self.graph,origin,s.node,attrs)
            movements[s.id]=(origin,s.node,road)

        # Vehicle paths use the same graph and restrictions; one physical edge per microstep.
        for v in self.vehicles:
            v.traversed=[]
            path=v.route if v.route and v.route[0]==v.node else [v.node]
            for dest in path[1:1+self.settings.vehicle_edges_per_turn]:
                origin=v.node
                if not usable.has_edge(origin,dest) or dest in blocked:
                    self.metrics.invalid_moves+=1
                    break
                attrs=usable[origin][dest]
                token=road_identity(self.graph,origin,dest,attrs)
                v.traversed.append(dict(origen=origin,destino=dest,aristaId=attrs.get("id"),
                                        calleFisica=token,distancia_m=attrs["distancia_m"]))
                v.distance_m+=attrs["distancia_m"]
                v.node=dest
            if v.node in path:
                v.route=path[path.index(v.node):]
            for sid in v.passengers:
                s=people[sid]
                s.node=v.node
                s.elapsed_turns+=1

        causes={}
        for s in foot:
            origin,dest,road=movements[s.id]
            if same_node(dest,self.zombies):
                causes[s.id]="coincidencia_nodo"
            elif opposite_crossing(origin,dest,road,self.traversed):
                causes[s.id]="cruce_opuesto"
        for v in self.vehicles:
            for sid in v.passengers:
                s=people[sid]
                for track in v.traversed:
                    s.vehicle_distance_m+=track["distancia_m"]
                    if same_node(track["destino"],self.zombies) or opposite_crossing(
                        track["origen"],track["destino"],track["calleFisica"],self.traversed):
                        causes[sid]="incidente_camioneta"
                        s.node=track["destino"]
                        break
                if not v.traversed and same_node(v.node,self.zombies):
                    causes[sid]="coincidencia_nodo_camioneta"
        self.activate_sleepers()
        for sid,cause in causes.items():
            self._bite(people[sid],cause)

        # Walking arrivals, followed by unloading: a transported person is not evacuated earlier.
        for s in sorted(foot,key=lambda s:s.id):
            if living(s.status):
                for refuge in self.shelters:
                    if s.node==refuge.node and self._admit(s,refuge,"caminando"): break
        for v in self.vehicles:
            delivered=0
            for sid in list(v.passengers):
                s=people[sid]
                if s.status=="EN_CAMIONETA":
                    for refuge in self.shelters:
                        if v.node==refuge.node and (s.assigned_shelter in {None,refuge.id}):
                            if self._admit(s,refuge,"camioneta"):
                                delivered+=1
                            break
            if delivered:
                v.trips+=1
            v.passengers=[sid for sid in v.passengers if people[sid].status=="EN_CAMIONETA"]
            for sid in list(v.assigned):
                s=people[sid]
                if s.status not in FOOT_STATES or s.vehicle_id!=v.id:
                    v.assigned.remove(sid)
                    self.metrics.rescues_cancelled+=1
                    self.history.append(dict(id=f"cancelacion-{self.turn}-{v.id}-{sid}",turno=self.turn,
                        tipo="rescate_cancelado",sobrevivienteId=sid,camionetaId=v.id,motivo="actor_inactivo"))
                    continue
                if v.meeting==v.node==s.node and len(v.passengers)<v.capacity:
                    refuge=next((r for r in self.shelters if r.id==s.assigned_shelter),None)
                    own=self.reservations.snapshot().get(s.id)
                    if refuge is None or refuge.status!="ABIERTO" or self.reservations.available(refuge.id)+int(own==refuge.id)<=0:
                        continue
                    s.status="EN_CAMIONETA"
                    s.planned_route=[]
                    v.passengers.append(sid)
                    v.assigned.remove(sid)
                    self.history.append(dict(id=f"embarque-{self.turn}-{sid}",turno=self.turn,tipo="embarque",
                        sobrevivienteId=sid,camionetaId=v.id,nodo=s.node,refugioId=s.assigned_shelter))
            if v.assigned and v.node==v.meeting:
                v.waiting_turns+=1
            else:
                v.waiting_turns=0
            if not v.passengers and not v.assigned:
                v.status="DISPONIBLE"
                v.meeting,v.shelter_id=None,None
                v.route=[v.node]
            elif v.passengers and not v.assigned:
                v.status="HACIA_REFUGIO"
                v.meeting=None

    def assert_invariants(self):
        people={s.id:s for s in self.survivors}
        assert len(people)==len(self.survivors)
        assert all(s.node in self.graph for s in self.survivors)
        assert all(s.status in SURVIVOR_STATES for s in self.survivors)
        riders=[sid for v in self.vehicles for sid in v.passengers]
        assigned=[sid for v in self.vehicles for sid in v.assigned]
        assert len(riders)==len(set(riders)) and len(assigned)==len(set(assigned))
        for v in self.vehicles:
            assert v.node in self.graph and len(v.passengers)<=v.capacity<=4
            assert len(v.passengers)+len(v.assigned)<=v.capacity
            assert len(v.traversed)<=self.settings.vehicle_edges_per_turn
            assert all(people[sid].status=="EN_CAMIONETA" and people[sid].vehicle_id==v.id and
                       people[sid].node==v.node for sid in v.passengers)
            assert all(people[sid].status in FOOT_STATES and people[sid].vehicle_id==v.id for sid in v.assigned)
            for track in v.traversed:
                assert self.valid(track["origen"],track["destino"])
        assert {s.id for s in self.survivors if s.status=="EN_CAMIONETA"}==set(riders)
        assert {s.id for s in self.survivors if s.status in FOOT_STATES and s.vehicle_id is not None}==set(assigned)
        reservations=self.reservations.snapshot()
        assert all(sid in people and living(people[sid].status) and people[sid].assigned_shelter==rid for sid,rid in reservations.items())
        for r in self.shelters:
            assert 0<=r.occupied<=r.capacity and 0<=r.reserved<=r.capacity-r.occupied
            assert r.reserved==sum(rid==r.id for rid in reservations.values())
            assert r.occupied==sum(s.status=="EVACUADO" and s.assigned_shelter==r.id for s in self.survivors)

    def fingerprint(self):
        data=dict(survivors=sorted((s.id,s.node) for s in self.survivors),
            zombies=sorted((z.id,z.node,z.kind) for z in self.zombies),
            shelters=sorted((r.id,r.node,r.capacity) for r in self.shelters),
            vehicles=sorted((v.id,v.node,v.capacity) for v in self.vehicles),events=self.events,
            graph=self.graph.graph.get("version","demo-v1"))
        return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

    def view(self):
        reserved=self.reservations.snapshot()
        return StateView(turnosTotales=self.max_turns,segundosPorTurno=self.settings.turn_seconds,turno=self.turn,fase=self.phase,ronda=self.round_number,
            estadoSimulacion="FINALIZADA" if self.turn>=self.max_turns else "EN_CURSO",
            versionGrafo=self.graph_version,mapaVersion=self.graph.graph.get("version","demo-v1"),
            sobrevivientes=[dict(id=s.id,nodo=s.node,nodoActual=s.node,estado=s.status,
                refugioAsignado=s.assigned_shelter,rutaPlanificada=s.planned_route,
                turnosTranscurridos=s.elapsed_turns,turnoEvacuacion=s.evacuation_turn,causaEliminacion=s.elimination_cause,
                camionetaId=s.vehicle_id,distanciaCaminada_m=s.walking_distance_m,
                distanciaEnCamioneta_m=s.vehicle_distance_m,modoEvacuacion=s.evacuation_mode) for s in self.survivors],
            zombies=[dict(id=z.id,nodo=z.node,tipo=z.kind) for z in self.zombies if z.kind!="dormido"],
            refugios=[dict(id=r.id,nodo=r.node,capacidad=r.capacity,capacidad_maxima=r.capacity,ocupacion=r.occupied,
                nombre=r.name,lat=self.graph.nodes[r.node]["lat"],lng=self.graph.nodes[r.node]["lng"],
                plazas_reservadas=r.reserved,estado=r.status,plazas_disponibles=r.capacity-r.occupied-r.reserved,
                sobrevivientesAsignados=sorted(sid for sid,rid in reserved.items() if rid==r.id),
                idAnterior=f"R-{int(r.id.split('-')[1])}" if r.id.startswith("R-00") else None) for r in self.shelters],
            nodosBloqueados=sorted(self.horde_nodes()),
            camionetas=[dict(id=v.id,nodoActual=v.node,estado=v.status,capacidad=v.capacity,pasajeros=v.passengers,
                capacidadUtilizada=len(v.passengers),sobrevivientesAsignados=v.assigned,puntoEncuentro=v.meeting,
                refugioDestino=v.shelter_id,rutaPlanificada=v.route,aristasRecorridasEnTurno=[
                    {k:value for k,value in t.items() if k!="calleFisica"} for t in v.traversed],
                viajesRealizados=v.trips,distanciaRecorrida_m=v.distance_m) for v in self.vehicles],
            aristasBloqueadas=[a.get("id",f"E-{u}-{v}") for u,v,_,a in edges(self.graph) if a["bloqueada"]],
            rutas={s.id:s.planned_route for s in self.survivors if s.status in FOOT_STATES},
            metricas=self.metrics.summary(self.survivors),eventosRecientes=self.history[-50:],
            estrategia=self.settings.routing_strategy.title(),
            funcionalidadesPro=dict(prediccion=self.settings.routing_strategy=="pro" and self.settings.pro_prediction,
                reservas=self.settings.routing_strategy=="pro" and self.settings.pro_reservations,
                flota=self.settings.routing_strategy=="pro" and self.settings.pro_fleet),riesgo=self.risk_view)

def demo_world(settings):
    graph=nx.Graph()
    for i in range(10):
        graph.add_node(f"N-{i:04}",lat=-.95+i*.001,lng=-80.73)
    for i in range(9):
        kind="puente" if i==5 else "calle"
        speed=settings.speeds[kind]
        graph.add_edge(f"N-{i:04}",f"N-{i+1:04}",distancia_m=100.,tipo=kind,
                       velocidad_m_s=speed,bloqueada=False,cost=100/speed)
    return World(graph,[Survivor("S-0001","N-0000")],[Zombie("Z-0001","N-0009")],[Shelter("R-1","N-0004")],settings)
