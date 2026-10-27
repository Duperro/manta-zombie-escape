"""Atomic aggregate boundary for a future DynamoDB transaction/conditional version."""
from threading import RLock
from typing import Protocol

class ReservationRepository(Protocol):
    version: int
    def reserve(self,shelter_id: str,survivor_id: str,turn: int) -> bool: ...
    def release(self,survivor_id: str) -> None: ...
    def confirm(self,shelter_id: str,survivor_id: str) -> bool: ...
    def replace(self,assignments: dict[str,str],expected_version: int) -> None: ...
    def snapshot(self) -> dict[str,str]: ...

class MemoryReservations:
    def __init__(self,shelters):
        self.shelters={r.id:r for r in shelters}
        self._assignments={}
        self._confirmed={}
        self._lock=RLock()
        self.version=0

    def snapshot(self):
        with self._lock:
            return dict(self._assignments)

    def available(self,rid):
        with self._lock:
            r=self.shelters[rid]
            return r.capacity-r.occupied-r.reserved

    def _sync(self):
        for rid,r in self.shelters.items():
            r.reserved=sum(target==rid for target in self._assignments.values())
            assert 0<=r.occupied<=r.capacity and 0<=r.reserved<=r.capacity-r.occupied
        self.version+=1

    def reserve(self,shelter_id,survivor_id,turn=0):
        with self._lock:
            if survivor_id in self._confirmed:
                return False
            if self._assignments.get(survivor_id)==shelter_id:
                return True
            if shelter_id not in self.shelters or self.shelters[shelter_id].status!="ABIERTO" or self.available(shelter_id)<=0:
                return False
            self._assignments[survivor_id]=shelter_id
            self._sync()
            return True

    def release(self,survivor_id):
        with self._lock:
            if self._assignments.pop(survivor_id,None) is not None:
                self._sync()

    def replace(self,assignments,expected_version):
        with self._lock:
            if expected_version!=self.version:
                raise ValueError("Reservation version conflict")
            if any(s in self._confirmed for s in assignments) or any(r not in self.shelters for r in assignments.values()):
                raise ValueError("Invalid assignment")
            for rid,r in self.shelters.items():
                count=sum(target==rid for target in assignments.values())
                if r.occupied+count>r.capacity or count and r.status!="ABIERTO":
                    raise ValueError("Insufficient shelter capacity")
            if assignments!=self._assignments:
                self._assignments=dict(assignments)
                self._sync()

    def confirm(self,shelter_id,survivor_id):
        with self._lock:
            if survivor_id in self._confirmed:
                return self._confirmed[survivor_id]==shelter_id
            r=self.shelters[shelter_id]
            owned=int(self._assignments.get(survivor_id)==shelter_id)
            if r.status!="ABIERTO" or self.available(shelter_id)+owned<=0:
                return False
            self._assignments.pop(survivor_id,None)
            self._confirmed[survivor_id]=shelter_id
            r.occupied+=1
            self._sync()
            return True
