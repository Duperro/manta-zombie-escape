from dataclasses import dataclass, field
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

FOOT_STATES=frozenset({"ACTIVO","CAMINANDO","HACIA_ENCUENTRO","ESPERANDO_RESCATE"})
SURVIVOR_STATES=FOOT_STATES|{"EN_CAMIONETA","EVACUADO","ELIMINADO"}

def living(status: str) -> bool:
    return status not in {"EVACUADO","ELIMINADO"}


class PasoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sobrevivienteId: str = Field(min_length=1)
    nodoActual: str = Field(min_length=1)
    turno: int = Field(ge=0)


class PasoResponse(BaseModel):
    siguienteNodo: str


@dataclass
class Survivor:
    id: str
    node: str
    status: str = "ACTIVO"
    assigned_shelter: str | None = None
    planned_route: list[str] = field(default_factory=list)
    elapsed_turns: int = 0
    evacuation_turn: int | None = None
    elimination_cause: str | None = None
    vehicle_id: str | None = None
    walking_distance_m: float = 0.0
    vehicle_distance_m: float = 0.0
    evacuation_mode: str | None = None


@dataclass
class Zombie:
    id: str
    node: str
    kind: Literal["caminante", "corredor", "horda", "dormido"] = "caminante"


@dataclass
class Shelter:
    id: str
    node: str
    capacity: int = 40
    occupied: int = 0
    name: str = "Refugio"
    reserved: int = 0
    status: str = "ABIERTO"


@dataclass
class Vehicle:
    id: str
    node: str
    capacity: int = 4
    speed_multiplier: float = 2.0
    status: str = "DISPONIBLE"
    passengers: list[str] = field(default_factory=list)
    assigned: list[str] = field(default_factory=list)
    meeting: str | None = None
    shelter_id: str | None = None
    route: list[str] = field(default_factory=list)
    traversed: list[dict] = field(default_factory=list)
    trips: int = 0
    distance_m: float = 0.0
    waiting_turns: int = 0


class NodeView(BaseModel):
    id: str
    lat: float
    lng: float
    sector: str | None = None


class EdgeView(BaseModel):
    id: str
    origen: str
    destino: str
    distancia_m: float
    tipo: str
    velocidad_m_s: float
    bloqueada: bool
    tiempo_estimado_s: float
    geometria: list[list[float]]
    osmids: list[str] = Field(default_factory=list)


class SurvivorView(BaseModel):
    id: str
    nodo: str
    estado: str
    nodoActual: str
    refugioAsignado: str | None
    rutaPlanificada: list[str]
    turnosTranscurridos: int
    turnoEvacuacion: int | None
    causaEliminacion: str | None
    camionetaId: str | None = None
    distanciaCaminada_m: float = 0
    distanciaEnCamioneta_m: float = 0
    modoEvacuacion: str | None = None


class ZombieView(BaseModel):
    id: str
    nodo: str
    tipo: str


class ShelterView(BaseModel):
    id: str
    nodo: str
    capacidad: int
    ocupacion: int
    nombre: str
    lat: float
    lng: float
    capacidad_maxima: int
    plazas_reservadas: int
    estado: str
    plazas_disponibles: int = 0
    sobrevivientesAsignados: list[str] = Field(default_factory=list)
    idAnterior: str | None = None

class VehicleView(BaseModel):
    id: str
    nodoActual: str
    estado: str
    capacidad: int
    pasajeros: list[str]
    capacidadUtilizada: int
    sobrevivientesAsignados: list[str]
    puntoEncuentro: str | None
    refugioDestino: str | None
    rutaPlanificada: list[str]
    aristasRecorridasEnTurno: list[dict]
    viajesRealizados: int
    distanciaRecorrida_m: float


class StateView(BaseModel):
    runId: str | None = None
    turnosTotales: int = 150
    segundosPorTurno: float = 2.0
    turno: int
    fase: str
    ronda: int
    estadoSimulacion: str
    versionGrafo: int
    mapaVersion: str
    sobrevivientes: list[SurvivorView]
    zombies: list[ZombieView]
    refugios: list[ShelterView]
    nodosBloqueados: list[str]
    camionetas: list[VehicleView]
    aristasBloqueadas: list[str]
    rutas: dict[str, list[str]]
    metricas: dict
    eventosRecientes: list[dict]
    estrategia: str = "Base"
    funcionalidadesPro: dict[str,bool] = Field(default_factory=dict)
    riesgo: dict = Field(default_factory=dict)


class MapView(BaseModel):
    version: str
    atribucion: str
    nodos: list[NodeView]
    aristas: list[EdgeView]
    sectores: dict
    metadata: dict
