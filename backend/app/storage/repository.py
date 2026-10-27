from typing import Protocol


class DecisionRepository(Protocol):
    """Production adapter must implement atomic put-if-absent in shared storage."""
    def get(self, turn: int, survivor: str) -> tuple[str, str] | None: ...
    def put_if_absent(self, turn: int, survivor: str, current: str, target: str) -> tuple[str, str]: ...
    def reset_run(self) -> None: ...


class MemoryDecisionRepository:
    def __init__(self):
        self.decisions: dict[tuple[int, str], tuple[str, str]] = {}

    def get(self, turn, survivor):
        return self.decisions.get((turn, survivor))

    def put_if_absent(self, turn, survivor, current, target):
        return self.decisions.setdefault((turn, survivor), (current, target))

    def reset_run(self):
        """Production adapters should switch to a fresh run namespace, not delete history."""
        self.decisions={}
