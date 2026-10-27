"""Bounded, deterministic rescue-benefit heuristic with stable physical rendezvous."""
import math
from app.models.domain import FOOT_STATES, living


def nearby_origins(graph, target, max_edges):
    """Conservative directed hop bound; weighted routes are still checked below."""
    nearby=frontier={target}
    for _ in range(max_edges):
        frontier={origin for node in frontier for origin in graph.predecessors(node)}
        nearby=nearby|frontier
    return nearby

class FleetPlanner:
    def cancel(self,world,vehicle,reason):
        people={s.id:s for s in world.survivors}
        for sid in list(vehicle.assigned):
            s=people.get(sid)
            if s and s.status in FOOT_STATES and s.vehicle_id==vehicle.id:
                s.status="CAMINANDO"
                s.vehicle_id=None
                if reason=="averia": s.planned_route=[s.node]
                world.metrics.rescues_cancelled+=1
                world.history.append(dict(id=f"cancelacion-{world.turn}-{vehicle.id}-{sid}",turno=world.turn,
                    tipo="rescate_cancelado",sobrevivienteId=sid,camionetaId=vehicle.id,motivo=reason))
        vehicle.assigned=[]
        vehicle.meeting=None
        vehicle.waiting_turns=0
        vehicle.route=[vehicle.node]
        vehicle.status="REPLANIFICANDO" if vehicle.passengers else "DISPONIBLE"

    def plan(self,world,state,routes):
        people={s.id:s for s in world.survivors}
        shelters={r.id:r for r in world.shelters}
        assigned=set()
        settings=world.settings
        for vehicle in world.vehicles:
            if vehicle.repair_turns_remaining:
                self.cancel(world,vehicle,"averia")
                vehicle.status="AVERIADA"

        def destination(s):
            r=shelters.get(s.assigned_shelter)
            return r if r and r.status=="ABIERTO" and r.occupied<r.capacity else None

        def walking(s):
            r=destination(s)
            return routes.choice(s.node,r.node) if r else None

        def exposure(s):
            choice=walking(s)
            return max([routes.risk.nodes.get(s.node,0),*[
                routes.risk.nodes.get(n,0) for n in (choice[1][:4] if choice else [])]])

        candidates=[s for s in people.values() if s.status in FOOT_STATES and destination(s)]
        candidates.sort(key=lambda s:(-(settings.rescue_risk_weight*exposure(s)+
            (len(walking(s)[1]) if walking(s) else 100)),s.id))
        candidates=candidates[:settings.pickup_candidates]

        for v in sorted(world.vehicles,key=lambda v:v.id):
            if v.repair_turns_remaining: continue
            v.passengers=[sid for sid in v.passengers if sid in people and people[sid].status=="EN_CAMIONETA"]
            viable=[sid for sid in v.assigned if sid in people and people[sid].status in FOOT_STATES and
                    people[sid].vehicle_id==v.id and destination(people[sid])]
            invalid=(len(viable)!=len(v.assigned) or any(sid in assigned for sid in viable))
            if v.meeting is not None:
                invalid=invalid or v.meeting not in routes.graph or routes.risk.nodes.get(v.meeting,0)>=settings.meeting_risk_threshold
                invalid=invalid or routes.path_between(v.node,v.meeting) is None
                invalid=invalid or any(routes.path_between(people[sid].node,v.meeting) is None for sid in viable)
                invalid=invalid or any(routes.choice(v.meeting,destination(people[sid]).node) is None for sid in viable)
                invalid=invalid or v.waiting_turns>settings.meeting_max_wait or len(v.passengers)>=v.capacity
            if invalid:
                self.cancel(world,v,"encuentro_inviable_o_peligroso")
                viable=[]
            if v.passengers and not viable:
                options=[]
                for sid in v.passengers:
                    r=destination(people[sid])
                    choice=routes.choice(v.node,r.node) if r else None
                    if choice:
                        options.append((choice[0],r.id,choice[1]))
                if options:
                    _,v.shelter_id,v.route=min(options)
                    v.status="HACIA_REFUGIO"
                else:
                    v.route=[v.node]
                    v.status="REPLANIFICANDO"
                continue
            if viable and v.meeting:
                # Re-optimize a small set only if the improvement exceeds hysteresis.
                primary=people[min(viable)]
                r=destination(primary)
                walk=walking(primary)
                points=[v.meeting,primary.node,*(walk[1][1:3] if walk else [])]
                options=[]
                for point in list(dict.fromkeys(points))[:settings.meeting_candidates]:
                    if point not in routes.graph or routes.risk.nodes.get(point,0)>=settings.meeting_risk_threshold:
                        continue
                    truck=routes.path_between(v.node,point)
                    drop=routes.choice(point,r.node)
                    feet=[routes.path_between(people[sid].node,point) for sid in viable]
                    if not truck or not drop or any(path is None for path in feet):
                        continue
                    foot_eta=max(len(path[1])-1 for path in feet)
                    truck_eta=math.ceil((len(truck[1])-1)/settings.vehicle_edges_per_turn)
                    if abs(foot_eta-truck_eta)>settings.meeting_max_wait:
                        continue
                    score=max(foot_eta,truck_eta)+math.ceil((len(drop[1])-1)/settings.vehicle_edges_per_turn)
                    score+=settings.rescue_risk_weight*routes.risk.nodes.get(point,0)
                    options.append((score,point))
                current=next((score for score,point in options if point==v.meeting),None)
                if options:
                    score,point=min(options)
                    if current is None or score<current*(1-settings.reassignment_improvement) and current-score>=1:
                        old=v.meeting
                        v.meeting=point
                        v.waiting_turns=0
                        world.history.append(dict(id=f"encuentro-{world.turn}-{v.id}",turno=world.turn,
                            tipo="encuentro_actualizado",camionetaId=v.id,anterior=old,nodo=point))
                v.assigned=viable
                targets={people[sid].assigned_shelter for sid in viable}
                if v.shelter_id not in targets:
                    v.shelter_id=min(targets)
                v.route=routes.path_between(v.node,v.meeting)[1]
                v.status="RECOGIENDO" if v.node==v.meeting else "HACIA_RECOGIDA"
                assigned.update(viable)
                for sid in viable:
                    s=people[sid]
                    s.planned_route=routes.path_between(s.node,v.meeting)[1]
                    s.status="ESPERANDO_RESCATE" if s.node==v.meeting else "HACIA_ENCUENTRO"
                continue
            if v.passengers:
                continue
            best=None
            for s in candidates:
                if s.id in assigned or s.vehicle_id not in {None,v.id}:
                    continue
                r=destination(s)
                walk=walking(s)
                foot_eta=len(walk[1])-1 if walk else 100
                danger=exposure(s)
                if foot_eta<=2 and danger<.5:
                    continue
                points=[s.node]
                if walk:
                    points.extend(walk[1][1:3])
                if s.node in state.graph:
                    points.extend(sorted(state.graph.successors(s.node)))
                points=list(dict.fromkeys(points))[:settings.meeting_candidates]
                for point in points:
                    if point not in routes.graph or routes.risk.nodes.get(point,0)>=settings.meeting_risk_threshold:
                        continue
                    foot=routes.path_between(s.node,point)
                    pickup=routes.path_between(v.node,point)
                    drop=routes.choice(point,r.node)
                    if not foot or not pickup or not drop:
                        continue
                    foot_time=len(foot[1])-1
                    truck_time=math.ceil((len(pickup[1])-1)/settings.vehicle_edges_per_turn)
                    if abs(foot_time-truck_time)>settings.meeting_max_wait:
                        continue
                    rescue_eta=max(foot_time,truck_time)+1+math.ceil((len(drop[1])-1)/settings.vehicle_edges_per_turn)
                    benefit=foot_eta-rescue_eta+settings.rescue_risk_weight*danger-.15*truck_time
                    if benefit<settings.rescue_min_benefit:
                        continue
                    candidate=(-benefit,rescue_eta,s.id,point,pickup[1],foot[1],r.id)
                    if best is None or candidate[:4]<best[:4]:
                        best=candidate
            if best is None:
                v.status="DISPONIBLE"
                v.route=[v.node]
                v.meeting=None
                continue
            _,_,sid,point,v.route,foot_path,v.shelter_id=best
            v.meeting=point
            v.assigned=[sid]
            v.status="RECOGIENDO" if v.node==point else "HACIA_RECOGIDA"
            assigned.add(sid)
            primary=people[sid]
            primary.vehicle_id=v.id
            primary.planned_route=foot_path
            primary.status="ESPERANDO_RESCATE" if primary.node==point else "HACIA_ENCUENTRO"
            # Group nearby people sharing the same reserved destination; no duplicate assignments.
            max_walk=min(2,settings.meeting_max_wait)
            nearby=nearby_origins(state.graph,point,max_walk)
            for s in sorted(people.values(),key=lambda s:s.id):
                if len(v.assigned)>=v.capacity:
                    break
                if s.id in assigned or s.status not in FOOT_STATES or s.vehicle_id is not None or s.assigned_shelter!=v.shelter_id or s.node not in nearby:
                    continue
                choice=routes.path_between(s.node,point)
                if choice and len(choice[1])-1<=max_walk:
                    v.assigned.append(s.id)
                    assigned.add(s.id)
                    s.vehicle_id=v.id
                    s.planned_route=choice[1]
                    s.status="ESPERANDO_RESCATE" if s.node==point else "HACIA_ENCUENTRO"
