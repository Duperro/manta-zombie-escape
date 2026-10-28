"""Collision rules independent of routing, including every runner substep."""
from dataclasses import dataclass
from app.models.domain import living

@dataclass(frozen=True)
class Traversal:
    origin: str
    destination: str
    road: str

def same_node(node, zombies):
    return any(z.node == node for z in zombies)

def opposite_crossing(origin, destination, road, traversals):
    if origin == destination:
        return False
    for t in traversals:
        if isinstance(t, tuple):
            if t == (destination, origin):
                return True
        elif (t.origin, t.destination, t.road) == (destination, origin, road):
            return True
    return False

def eliminate(survivor, cause, turn, history):
    if not living(survivor.status):
        return
    survivor.status = "ELIMINADO"
    survivor.elimination_cause = cause
    survivor.planned_route = []
    kind = "caida_puente" if cause == "colapso_puente" else "mordida"
    history.append({"id":f"{kind}-{turn}-{survivor.id}","turno":turn,"tipo":kind,
                    "sobrevivienteId":survivor.id,"nodo":survivor.node,"causa":cause})
