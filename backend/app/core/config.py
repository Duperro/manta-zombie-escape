import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    api_key: str
    seed: int = 7
    turn_seconds: float = 2.0
    horde_move_probability: float = 0.02  # "casi inmóvil": ~1 paso cada 50 turnos
    http_concurrency: int = 16
    routing_strategy: str = "base"
    pro_prediction: bool = True
    pro_reservations: bool = True
    pro_fleet: bool = True
    pro_threats: bool = True
    contact_bite: bool = True  # zombie que llega al nodo de un sobreviviente lo muerde al instante
    pro_unstick: bool = False  # experimental: +evacuados pero +mordidas (ver docs)
    risk_weight: float = 180.0
    reassignment_improvement: float = 0.25
    vehicle_edges_per_turn: int = 2
    meeting_candidates: int = 8
    pickup_candidates: int = 24
    meeting_max_wait: int = 8
    rescue_min_benefit: float = 1.0
    rescue_risk_weight: float = 8.0
    meeting_risk_threshold: float = 0.7
    retreat_risk_threshold: float = 0.7
    retreat_min_improvement: float = 0.25
    vehicle_breakdowns: bool = False
    vehicle_breakdown_chances: dict[str, float] = field(default_factory=lambda: {
        "caminante": .25, "corredor": .5, "horda": .8, "dormido": .35,
    })
    vehicle_repair_turns: dict[str, int] = field(default_factory=lambda: {
        "caminante": 2, "corredor": 3, "horda": 5, "dormido": 2,
    })
    cors_origins: tuple[str, ...] = ()
    speeds: dict[str, float] = field(default_factory=lambda: {
        "avenida": 1.5, "calle": 1.2, "callejón": 0.9, "puente": 1.0,
    })

    def __post_init__(self):
        kinds = {"caminante", "corredor", "horda", "dormido"}
        if set(self.vehicle_breakdown_chances) != kinds or any(not 0 <= p <= 1 for p in self.vehicle_breakdown_chances.values()):
            raise ValueError("Probabilidades de avería entre 0 y 1 para los cuatro tipos")
        if set(self.vehicle_repair_turns) != kinds or any(type(n) is not int or not 1 <= n <= 30 for n in self.vehicle_repair_turns.values()):
            raise ValueError("Reparaciones de 1 a 30 turnos para los cuatro tipos")
        if not self.api_key or not 0 <= self.horde_move_probability <= 1:
            raise ValueError("API_KEY requerida y probabilidad de horda entre 0 y 1")
        if self.turn_seconds <= 0 or any(v <= 0 for v in self.speeds.values()):
            raise ValueError("Duración y velocidades deben ser positivas")
        if not 1 <= self.http_concurrency <= 64:
            raise ValueError("HTTP_CONCURRENCY debe estar entre 1 y 64")
        if self.routing_strategy not in {"base","pro"}:
            raise ValueError("ROUTING_STRATEGY debe ser base o pro")
        import math
        if not all(math.isfinite(x) and x>=0 for x in [self.risk_weight,self.rescue_min_benefit,self.rescue_risk_weight]):
            raise ValueError("Penalizaciones deben ser finitas y no negativas")
        if not 0<=self.reassignment_improvement<1 or not 1<=self.vehicle_edges_per_turn<=2:
            raise ValueError("Umbral de reasignación o velocidad de vehículo inválidos")
        if min(self.meeting_candidates,self.pickup_candidates,self.meeting_max_wait)<1:
            raise ValueError("Límites de planificación deben ser positivos")
        if not all(0<=x<=1 for x in [self.meeting_risk_threshold,self.retreat_risk_threshold,self.retreat_min_improvement]):
            raise ValueError("Umbrales de riesgo deben estar entre 0 y 1")

    @classmethod
    def from_env(cls):
        from app.core.secrets import api_key_from_env
        defaults = cls(api_key=api_key_from_env())
        return cls(api_key=defaults.api_key, seed=int(os.getenv("SEED", "7")),
                   turn_seconds=float(os.getenv("TURN_SECONDS", "2")),
                   horde_move_probability=float(os.getenv("HORDE_MOVE_PROBABILITY", "0.02")),
                   http_concurrency=int(os.getenv("HTTP_CONCURRENCY","16")),
                   routing_strategy=os.getenv("ROUTING_STRATEGY","base").lower(),
                   pro_prediction=os.getenv("PRO_PREDICTION","true").lower() in {"true","1","yes"},
                   pro_reservations=os.getenv("PRO_RESERVATIONS","true").lower() in {"true","1","yes"},
                   pro_fleet=os.getenv("PRO_FLEET","true").lower() in {"true","1","yes"},
                   pro_threats=os.getenv("PRO_THREATS","true").lower() in {"true","1","yes"},
                   contact_bite=os.getenv("CONTACT_BITE","true").lower() in {"true","1","yes"},
                   pro_unstick=os.getenv("PRO_UNSTICK","false").lower() in {"true","1","yes"},
                   risk_weight=float(os.getenv("RISK_WEIGHT","180")),
                   reassignment_improvement=float(os.getenv("REASSIGNMENT_IMPROVEMENT",".25")),
                   vehicle_edges_per_turn=int(os.getenv("VEHICLE_EDGES_PER_TURN","2")),
                   meeting_candidates=int(os.getenv("MEETING_CANDIDATES","8")),
                   pickup_candidates=int(os.getenv("PICKUP_CANDIDATES","24")),
                   meeting_max_wait=int(os.getenv("MEETING_MAX_WAIT","8")),
                   rescue_min_benefit=float(os.getenv("RESCUE_MIN_BENEFIT","1")),
                   rescue_risk_weight=float(os.getenv("RESCUE_RISK_WEIGHT","8")),
                   meeting_risk_threshold=float(os.getenv("MEETING_RISK_THRESHOLD",".7")),
                   retreat_risk_threshold=float(os.getenv("RETREAT_RISK_THRESHOLD",".7")),
                   retreat_min_improvement=float(os.getenv("RETREAT_MIN_IMPROVEMENT",".25")),
                   vehicle_breakdowns=os.getenv("VEHICLE_BREAKDOWNS","false").lower() in {"true","1","yes"},
                   vehicle_breakdown_chances={kind:float(os.getenv(f"BREAKDOWN_CHANCE_{kind.upper()}",str(chance))) for kind,chance in defaults.vehicle_breakdown_chances.items()},
                   vehicle_repair_turns={kind:int(os.getenv(f"REPAIR_TURNS_{kind.upper()}",str(turns))) for kind,turns in defaults.vehicle_repair_turns.items()},
                   cors_origins=tuple(s.strip() for s in os.getenv("CORS_ORIGINS", "").split(",") if s.strip()),
                   speeds={k: float(os.getenv(f"SPEED_{name}", str(defaults.speeds[k])))
                           for k, name in [("avenida", "AVENIDA"), ("calle", "CALLE"),
                                           ("callejón", "CALLEJON"), ("puente", "PUENTE")]})
