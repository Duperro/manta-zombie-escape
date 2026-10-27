from app.core.graph import edges

def apply_events(world):
    for index, event in enumerate(world.events.get(world.turn, [])):
        if isinstance(event, tuple):
            targets = [a for u,v,_,a in edges(world.graph) if (u,v)==event or
                       (not world.graph.is_directed() and (v,u)==event)]
            event_id, kind = f"legacy-{world.turn}-{index}", "bloqueo_calle"
        else:
            event_id, kind = event["id"], event["tipo"]
            targets = [a for _,_,_,a in edges(world.graph) if a.get("id") in event["aristas"]]
            if len(targets) != len(event["aristas"]):
                raise ValueError("Evento referencia aristas inexistentes")
            if kind == "colapso_puente" and any(a["tipo"] != "puente" for a in targets):
                raise ValueError("Colapso exige un puente real etiquetado")
        if event_id in world.applied_events:
            continue
        changed = [a for a in targets if not a["bloqueada"]]
        for attrs in changed:
            attrs["bloqueada"] = True
        if changed:
            world.graph_version += 1
            for survivor in world.survivors:
                survivor.planned_route = []
            world.history.append({"id":event_id,"turno":world.turn,"tipo":kind,
                                  "aristas":[a.get("id", "demo-edge") for a in changed],
                                  "versionGrafo":world.graph_version})
        world.applied_events.add(event_id)
