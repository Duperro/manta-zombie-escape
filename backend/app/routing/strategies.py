from dataclasses import dataclass
from typing import Protocol
from app.models.domain import FOOT_STATES
from app.routing.planner import RoutePlanner
from app.routing.prediction import RunnerPredictor, RiskMap
from app.routing.risk_routes import RiskRoutes
from app.rescue.shelters import ShelterAllocator
from app.rescue.fleet import FleetPlanner

@dataclass
class PlanningContext:
    """Explicit boundary: no internal zombies, hidden coordinates, graph or RNG."""
    survivors: list
    shelters: list
    vehicles: list
    reservations: object
    settings: object
    turn: int
    history: list
    metrics: object

class EvacuationStrategy(Protocol):
    risk: RiskMap
    def plan(self,context: PlanningContext,state) -> None: ...

class BaseStrategy:
    def __init__(self):
        self.risk=RiskMap.empty(0)

    def plan(self,context,state):
        plans=RoutePlanner().plans(state)
        shelters={r.node:r.id for r in context.shelters}
        for s in context.survivors:
            if s.status in FOOT_STATES:
                s.planned_route=plans.get(s.id,[s.node])
                s.assigned_shelter=shelters.get(s.planned_route[-1])

class ProStrategy:
    def __init__(self):
        self.predictor=RunnerPredictor()
        self.allocator=ShelterAllocator()
        self.fleet=FleetPlanner()
        self.risk=RiskMap.empty(0)

    def plan(self,context,state):
        settings=context.settings
        self.risk=self.predictor.predict(state) if settings.pro_prediction else RiskMap.empty(state.turn)
        routes=RiskRoutes(state,self.risk,settings.risk_weight)
        for s in context.survivors:
            if s.status=="ACTIVO": s.status="CAMINANDO"
        if settings.pro_reservations:
            self.allocator.assign(context,routes)
        else:
            context.reservations.replace({},context.reservations.version)
            by_node={r.node:r.id for r in context.shelters}
            for s in context.survivors:
                if s.status not in {"EVACUADO","ELIMINADO"}:
                    best=routes.best(s.node)
                    s.assigned_shelter=by_node[best[1]] if best else None
        shelters={r.id:r for r in context.shelters}
        for s in context.survivors:
            if s.status in FOOT_STATES:
                r=shelters.get(s.assigned_shelter)
                choice=routes.choice(s.node,r.node) if r else None
                s.planned_route=choice[1] if choice else [s.node]
        if settings.pro_fleet:
            self.fleet.plan(context,state,routes)
        if settings.pro_prediction:
            self.safety_retreat(context,state,routes)

    def safety_retreat(self,context,state,routes):
        """Prefer a viable one-edge refuge from predicted pursuit over waiting to be caught."""
        for s in context.survivors:
            if s.status not in FOOT_STATES or s.vehicle_id is not None:
                continue
            path=s.planned_route or [s.node]
            intended=path[1] if len(path)>1 else s.node
            intended_risk=self.risk.nodes.get(intended,0)+.75*self.risk.edges.get((intended,s.node),0)
            if intended in state.forbidden:
                intended_risk=float('inf')  # An observed collision outranks every uncertain future penalty.
            if intended_risk<context.settings.retreat_risk_threshold or s.node not in state.graph:
                continue
            candidates=[]
            for n in sorted(state.graph.successors(s.node)):
                if n not in routes.graph or not routes.allowed_edge(s.node,n):
                    continue
                exposure=self.risk.nodes.get(n,0)+.75*self.risk.edges.get((n,s.node),0)
                if exposure>intended_risk-context.settings.retreat_min_improvement:
                    continue
                best=routes.best(n)
                cost=best[0] if best else 1e6
                candidates.append((exposure,cost,n))
            if candidates:
                _,_,destination=min(candidates)
                s.planned_route=[s.node,destination]

def make_strategy(settings):
    return ProStrategy() if settings.routing_strategy=="pro" else BaseStrategy()
