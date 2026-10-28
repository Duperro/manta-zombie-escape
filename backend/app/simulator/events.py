"""Eventos de ciudad: bloqueo de calles y colapso de puentes.

Turnos (ver data/scenarios): ronda 2 colapsa un puente en el turno 75; ronda 3
bloquea una calle en el turno 50 y una avenida entre los turnos 90 y 120.

- Bloqueo de calle/avenida: se aplica al INICIO del turno, antes de mover zombies.
  Desde ese mismo turno nadie la puede usar y todas las rutas se recalculan.
- Colapso de puente: ocurre MIENTRAS la gente se mueve en ese turno. Quien estaba
  cruzando el puente en ese momento (a pie o en camioneta) cae y queda eliminado;
  los zombies no se ven afectados. Al terminar el turno la arista desaparece del
  mapa y todas las rutas se recalculan en el turno siguiente.
"""
from app.core.graph import edges


def _targets(world, event, index):
    if isinstance(event, tuple):
        targets = [a for u,v,_,a in edges(world.graph) if (u,v)==event or
                   (not world.graph.is_directed() and (v,u)==event)]
        return f"legacy-{world.turn}-{index}", "bloqueo_calle", targets
    targets = [a for _,_,_,a in edges(world.graph) if a.get("id") in event["aristas"]]
    if len(targets) != len(event["aristas"]):
        raise ValueError("Evento referencia aristas inexistentes")
    if event["tipo"] == "colapso_puente" and any(a["tipo"] != "puente" for a in targets):
        raise ValueError("Colapso exige un puente real etiquetado")
    return event["id"], event["tipo"], targets


def _block(world, event_id, kind, targets, extra=None):
    """Quita las aristas del mapa en vivo y obliga a recalcular todas las rutas."""
    changed = [a for a in targets if not a["bloqueada"]]
    for attrs in changed:
        attrs["bloqueada"] = True
    if changed:
        world.graph_version += 1
        for survivor in world.survivors:
            survivor.planned_route = []
        world.history.append({"id":event_id,"turno":world.turn,"tipo":kind,
                              "aristas":[a.get("id", "demo-edge") for a in changed],
                              "versionGrafo":world.graph_version, **(extra or {})})
    world.applied_events.add(event_id)


def apply_events(world):
    """Inicio del turno: bloqueos inmediatos; los colapsos quedan pendientes."""
    world.pending_collapses = []
    for index, event in enumerate(world.events.get(world.turn, [])):
        event_id, kind, targets = _targets(world, event, index)
        if event_id in world.applied_events:
            continue
        if kind == "colapso_puente":
            world.pending_collapses.append((event_id, kind, targets))
        else:
            _block(world, event_id, kind, targets)


def collapse_bridges(world, movements):
    """Durante el turno: devuelve {sobrevivienteId: "colapso_puente"} con quienes
    cruzaban un puente que colapsa en este turno, y luego lo quita del mapa.

    movements: {id: (origen, destino, calle)} de los sobrevivientes a pie.
    """
    victims = {}
    world.collapsed_now = set()
    for event_id, kind, targets in getattr(world, "pending_collapses", []):
        ids = {a.get("id") for a in targets}
        bridge = {(u, v) for u, v, _, a in edges(world.graph) if a.get("id") in ids}
        if not world.graph.is_directed():
            bridge |= {(v, u) for u, v in bridge}
        world.collapsed_now |= bridge
        on_bridge = sorted(sid for sid, (origin, dest, _) in movements.items() if (origin, dest) in bridge)
        for vehicle in world.vehicles:
            if any((t["origen"], t["destino"]) in bridge for t in vehicle.traversed):
                on_bridge.extend(vehicle.passengers)
        for sid in on_bridge:
            victims[sid] = "colapso_puente"
        _block(world, event_id, kind, targets, {"sobrevivientesEnPuente": sorted(on_bridge)})
    world.pending_collapses = []
    return victims
