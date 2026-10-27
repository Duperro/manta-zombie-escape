"""A one-turn envelope, not knowledge of future targets, draws or hidden actors."""
from dataclasses import dataclass
from types import MappingProxyType
import networkx as nx
from app.routing.planner import Observation

@dataclass(frozen=True)
class RiskMap:
    turn: int
    nodes: object
    edges: object
    probable_paths: tuple[tuple[str,...], ...] = ()

    @classmethod
    def empty(cls,turn):
        return cls(turn,MappingProxyType({}),MappingProxyType({}))

    def view(self):
        return dict(turnoObservado=self.turn,turnoPredicho=self.turn+1,
                    nodos=dict(self.nodes),aristas=[dict(origen=u,destino=v,nivel=r) for (u,v),r in sorted(self.edges.items())])

class RunnerPredictor:
    def predict(self, state: Observation) -> RiskMap:
        graph=nx.subgraph_view(state.graph,
                              filter_edge=lambda u,v:v not in state.horde_nodes and not state.graph[u][v]["bloqueada"])
        nodes,roads,probable={}, {}, []
        for _,start,kind in state.zombies:
            if kind!="corredor" or start not in graph:
                continue
            nodes[start]=max(nodes.get(start,0),.2)
            frontier=[(start,)]
            for depth in range(2):
                expanded=[]
                for path in frontier:
                    for neighbor in sorted(graph.successors(path[-1])):
                        level=.7 if depth==0 else .45
                        nodes[neighbor]=max(nodes.get(neighbor,0),level)
                        roads[(path[-1],neighbor)]=max(roads.get((path[-1],neighbor),0),level)
                        expanded.append((*path,neighbor))
                frontier=expanded
            # Stronger weights for pursuit paths assuming the currently observed targets stay.
            at=start
            chase=[at]
            for _ in range(2):
                paths=nx.single_source_shortest_path(graph,at,cutoff=3)
                targets=sorted((len(paths[n])-1,sid,n) for sid,n in (state.people or state.survivors) if n in paths)
                if not targets or targets[0][0]==0:
                    break
                dest=paths[targets[0][2]][1]
                nodes[dest]=1.0
                roads[(at,dest)]=1.0
                chase.append(dest)
                at=dest
            if len(chase)>1:
                probable.append(tuple(chase))
        return RiskMap(state.turn,MappingProxyType(nodes),MappingProxyType(roads),tuple(probable))
