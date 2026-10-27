"""Physical, seeded vehicle damage. Never used as a source of planner observations."""
import random
from app.simulator.collisions import opposite_crossing
from app.rescue.fleet import FleetPlanner


def try_breakdown(world, vehicle, origin, destination, road, attempted):
    if not world.settings.vehicle_breakdowns or vehicle.repair_turns_remaining:
        return False
    contacts={z.kind for z in world.zombies if z.node==destination}
    for track, _zid, kind in world.zombie_movements:
        if opposite_crossing(origin,destination,road,[track]):
            contacts.add(kind)
    for kind in ("horda","corredor","dormido","caminante"):
        if kind not in contacts or kind in attempted:
            continue
        attempted.add(kind)  # At most one roll per type, vehicle and turn.
        rng=random.Random(f"{world.settings.seed}:breakdown:round:{world.round_number}:vehicle:{vehicle.id}:turn:{world.turn}:type:{kind}")
        if rng.random() >= world.settings.vehicle_breakdown_chances[kind]:
            continue
        FleetPlanner().cancel(world,vehicle,"averia")
        vehicle.repair_turns_remaining=world.settings.vehicle_repair_turns[kind]
        vehicle.breakdown_cause=kind
        vehicle.breakdowns+=1
        vehicle.status="AVERIADA"
        world.history.append(dict(id=f"averia-{world.round_number}-{world.turn}-{vehicle.id}",turno=world.turn,
            tipo="averia_camioneta",camionetaId=vehicle.id,nodo=vehicle.node,causa=kind,
            turnosReparacion=vehicle.repair_turns_remaining))
        return True
    return False


def advance_repairs(world, repairing):
    for vehicle in world.vehicles:
        if vehicle.id not in repairing:
            continue
        vehicle.repair_turns_remaining-=1
        if vehicle.repair_turns_remaining:
            vehicle.status="AVERIADA"
        else:
            vehicle.breakdown_cause=None
            vehicle.status="REPLANIFICANDO" if vehicle.passengers else "DISPONIBLE"
            vehicle.route=[vehicle.node]
            world.history.append(dict(id=f"reparacion-{world.round_number}-{world.turn}-{vehicle.id}",turno=world.turn,
                tipo="camioneta_reparada",camionetaId=vehicle.id,nodo=vehicle.node))
