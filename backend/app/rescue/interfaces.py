from typing import Protocol
from app.routing.planner import Observation
from app.routing.prediction import RiskMap


class RiskPredictor(Protocol):
    def predict(self, observation: Observation) -> RiskMap: ...


class SeatReservations(Protocol):
    def reserve(self, shelter_id: str, survivor_id: str, turn: int) -> bool: ...


class FleetStrategy(Protocol):
    def plan(self, context, observation: Observation, routes) -> None: ...
