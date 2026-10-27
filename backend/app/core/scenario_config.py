import json
from pathlib import Path
import random
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from app.core.graph import ROOT, DATA_DIR, load_map, edges
from app.models.domain import Shelter, Survivor, Zombie, Vehicle
from app.simulator.world import World, road_identity

SECTORS = ("Tarqui","Los Esteros","Barbasquillo","Jocay")

class CityEvent(BaseModel):
    model_config=ConfigDict(extra="forbid")
    id: str
    tipo: Literal["colapso_puente","bloqueo_calle"]
    turno: int | None = Field(default=None,ge=1,le=150)
    turnoAleatorio: tuple[int,int] | None = None
    tipoCalle: Literal["puente","avenida","calle","callejón"] | None = None
    aristas: list[str] | None = None

    @model_validator(mode="after")
    def valid_schedule(self):
        if (self.turno is None)==(self.turnoAleatorio is None):
            raise ValueError("Definir turno fijo o intervalo aleatorio")
        if self.turnoAleatorio and not 1<=self.turnoAleatorio[0]<=self.turnoAleatorio[1]<=150:
            raise ValueError("Intervalo de turnos inválido")
        return self

class ScenarioConfig(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ronda: int = Field(ge=1,le=3)
    nombre: str
    turnos: int = Field(default=150,ge=1,le=150)
    sobrevivientes: int = Field(ge=1)
    zombies: dict[str,int]
    distribucion: Literal["equilibrada","desigual","aleatoria"] = "equilibrada"
    pesosSectores: dict[str,float] = Field(default_factory=lambda:dict.fromkeys(SECTORS,1.0))
    eventos: list[CityEvent] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_counts(self):
        import math
        if set(self.zombies)!={"caminante","corredor","horda","dormido"} or any(n<0 for n in self.zombies.values()):
            raise ValueError("Conteos de zombies inválidos")
        if set(self.pesosSectores)!=set(SECTORS) or any(not math.isfinite(v) or v<0 for v in self.pesosSectores.values()) or sum(self.pesosSectores.values())<=0:
            raise ValueError("Pesos de sectores inválidos")
        if len({e.id for e in self.eventos})!=len(self.eventos):
            raise ValueError("IDs de evento duplicados")
        if any(e.turno and e.turno>self.turnos or e.turnoAleatorio and e.turnoAleatorio[1]>self.turnos for e in self.eventos):
            raise ValueError("Evento fuera de la ronda")
        return self

def read_scenario(path):
    return ScenarioConfig.model_validate_json(Path(path).read_text(encoding="utf-8"))

def default_scenario(number):
    return DATA_DIR/f"scenarios/round_{number}.json"

def resolve_events(config,graph,rng):
    result, selected = {}, set()
    records = list(edges(graph))
    for event in config.eventos:
        turn = event.turno if event.turno is not None else rng.randint(*event.turnoAleatorio)
        if event.aristas:
            ids=sorted(event.aristas)
            found = [a for _,_,_,a in records if a["id"] in ids]
            if len(found)!=len(ids) or any(a["bloqueada"] for a in found):
                raise ValueError("Evento con aristas inexistentes o bloqueadas")
            if event.tipo=="colapso_puente" and any(a["tipo"]!="puente" for a in found):
                raise ValueError("El colapso debe corresponder a un puente OSM")
        else:
            kind="puente" if event.tipo=="colapso_puente" else event.tipoCalle
            choices = sorted((a["id"],u,v,a) for u,v,_,a in records if a["id"] not in selected and not a["bloqueada"] and (kind is None or a["tipo"]==kind))
            if not choices:
                raise ValueError(f"No hay calles reales disponibles para {event.id}")
            _,u,v,attrs=rng.choice(choices)
            identity=road_identity(graph,u,v,attrs)
            ids=sorted(a["id"] for x,y,_,a in records if road_identity(graph,x,y,a)==identity)
        if selected.intersection(ids):
            raise ValueError("Eventos intentan bloquear la misma arista dos veces")
        selected.update(ids)
        result.setdefault(turn,[]).append(dict(id=event.id,tipo=event.tipo,aristas=ids))
    return result

def generate_survivors(world,config,rng):
    excluded=world.horde_nodes() | {r.node for r in world.shelters} | {z.node for z in world.zombies}
    valid=sorted(n for n in world.graph if n not in excluded)
    if not valid:
        raise ValueError("No hay posiciones iniciales seguras")
    if config.distribucion=="aleatoria":
        positions=[rng.choice(valid) for _ in range(config.sobrevivientes)]
    else:
        weights=dict.fromkeys(SECTORS,1.0) if config.distribucion=="equilibrada" else config.pesosSectores
        exact={s:config.sobrevivientes*weights[s]/sum(weights.values()) for s in SECTORS}
        counts={s:int(exact[s]) for s in SECTORS}
        for s in sorted(SECTORS,key=lambda s:(-(exact[s]-counts[s]),s))[:config.sobrevivientes-sum(counts.values())]:
            counts[s]+=1
        positions=[]
        for sector in SECTORS:
            choices=[n for n in valid if world.graph.nodes[n]["sector"]==sector]
            if counts[sector] and not choices:
                raise ValueError(f"Sector sin posiciones seguras: {sector}")
            positions.extend(rng.choice(choices) for _ in range(counts[sector]))
    return [Survivor(f"S-R{config.ronda}-{i+1:04}",n) for i,n in enumerate(positions)]

def build_world(settings, config=None, map_path=None):
    config=config or read_scenario(default_scenario(1))
    kwargs={} if map_path is None else {"path":map_path}
    graph=load_map(speeds=settings.speeds,**kwargs)
    shelter_data=json.loads((DATA_DIR/"scenarios/shelters.json").read_text(encoding="utf-8"))
    shelters=[]
    for record in shelter_data:
        if record["nodo"] not in graph:
            raise ValueError("Refugio fuera del grafo")
        shelters.append(Shelter(record["id"],record["nodo"],record["capacidad_maxima"],name=record["nombre"]))
    if len(shelters)!=4 or [s.capacity for s in shelters]!=[40,50,60,70]:
        raise ValueError("Se requieren cuatro refugios con capacidades 40/50/60/70")
    rng=random.Random(settings.seed)
    choices=sorted(set(graph)-{r.node for r in shelters})
    total=sum(config.zombies.values())
    if total>len(choices):
        raise ValueError("No hay suficientes posiciones para zombies únicos")
    starts=iter(rng.sample(choices,total))
    zombies=[]
    for kind in ["caminante","corredor","horda","dormido"]:
        for _ in range(config.zombies[kind]):
            zombies.append(Zombie(f"Z-{len(zombies)+1:04}",next(starts),kind))
    world=World(graph,[],zombies,shelters,settings,round_number=config.ronda,max_turns=config.turnos)
    world.survivors=generate_survivors(world,config,rng)
    world.events=resolve_events(config,graph,random.Random(f"{settings.seed}:city-events"))
    fleet_data=json.loads((DATA_DIR/"scenarios/fleet.json").read_text(encoding="utf-8"))
    if len(fleet_data)!=5 or len({v["id"] for v in fleet_data})!=5:
        raise ValueError("Se requieren exactamente cinco camionetas")
    for record in fleet_data:
        if record["nodo"] not in graph:
            raise ValueError("Camioneta fuera del mapa")
        world.vehicles.append(Vehicle(record["id"],record["nodo"]))
    world.scenario_config=config.model_dump()
    world.initial_fingerprint=world.fingerprint()
    return world
