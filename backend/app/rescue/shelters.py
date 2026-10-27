"""Min-cost capacity allocation with stable assignments, performed once per turn."""
import networkx as nx
from collections import Counter
from app.models.domain import living

class ShelterAllocator:
    @staticmethod
    def route_cost(survivor,choice,routes,settings):
        cost,path=choice
        if survivor.status=="EN_CAMIONETA":
            travel=sum(routes.state.graph[u][v]["cost"] for u,v in zip(path,path[1:]))
            # Transportation reduces travel time; it never discounts risk penalties.
            cost-=travel*(1-1/settings.vehicle_edges_per_turn)
        return cost,path

    def assign(self,world,routes):
        all_people=sorted((s for s in world.survivors if living(s.status)),key=lambda s:s.id)
        previous=world.reservations.snapshot()
        frozen={sid for v in world.vehicles if v.repair_turns_remaining for sid in v.passengers}
        pinned={s.id:previous[s.id] for s in all_people if s.id in frozen and s.id in previous}
        pinned_counts=Counter(pinned.values())
        people=[s for s in all_people if s.id not in pinned]
        if not people:
            world.reservations.replace(pinned,world.reservations.version)
            return pinned
        graph=nx.DiGraph()
        graph.add_node('source',demand=-len(people))
        graph.add_node('sink',demand=len(people))
        for refuge in world.shelters:
            if refuge.status=="ABIERTO":
                graph.add_edge('R:'+refuge.id,'sink',capacity=refuge.capacity-refuge.occupied-pinned_counts[refuge.id],weight=0)
        for s in people:
            person='S:'+s.id
            graph.add_edge('source',person,capacity=1,weight=0)
            graph.add_edge(person,'sink',capacity=1,weight=100_000_000)
            choices={r.id:choice for r in world.shelters if r.status=="ABIERTO" and
                     r.capacity>r.occupied and (choice:=routes.choice(s.node,r.node)) is not None}
            choices={rid:self.route_cost(s,choice,routes,world.settings) for rid,choice in choices.items()}
            old=choices.get(previous.get(s.id))
            for rid,(cost,path) in sorted(choices.items()):
                if old and rid!=previous[s.id] and cost>=old[0]*(1-world.settings.reassignment_improvement):
                    continue
                # Stable integer seconds*1000 and a small deterministic tie-break.
                penalty=0 if rid==previous.get(s.id) else .01
                graph.add_edge(person,'R:'+rid,capacity=1,weight=int(round((cost+penalty)*1000)))
        flow=nx.min_cost_flow(graph)
        result={**pinned,**{s.id:rid[2:] for s in people for rid,n in flow['S:'+s.id].items() if n and rid.startswith('R:')}}
        world.reservations.replace(result,world.reservations.version)
        for s in all_people:
            s.assigned_shelter=result.get(s.id)
        return result
