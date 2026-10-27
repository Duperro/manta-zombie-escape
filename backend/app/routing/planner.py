from dataclasses import dataclass
import networkx as nx

@dataclass(frozen=True)
class Observation:
    turn: int
    graph: nx.DiGraph
    survivors: tuple[tuple[str, str], ...]
    shelters: tuple[str, ...]
    forbidden: frozenset[str]
    graph_version: int = 0
    zombies: tuple[tuple[str,str,str], ...] = ()
    horde_nodes: frozenset[str] = frozenset()
    zombie_edges: tuple[tuple[str,str,str], ...] = ()
    people: tuple[tuple[str,str], ...] = ()

class RoutePlanner:
    """One reverse Dijkstra per available shelter per snapshot, shared by all survivors."""
    def plans(self, state: Observation) -> dict[str, list[str]]:
        graph = nx.subgraph_view(state.graph, filter_node=lambda n:n not in state.forbidden,
                                 filter_edge=lambda u,v:not state.graph[u][v]["bloqueada"])
        candidates = {}
        for shelter in sorted(state.shelters):
            if shelter not in graph:
                continue
            costs, paths = nx.single_source_dijkstra(graph.reverse(copy=False), shelter, weight="cost")
            for node, cost in costs.items():
                candidate = (cost, shelter, list(reversed(paths[node])))
                if node not in candidates or candidate < candidates[node]:
                    candidates[node] = candidate
        return {sid:candidates[node][2] if node in candidates else [node] for sid,node in state.survivors}

    def next_node(self, state: Observation, current: str) -> str:
        temporary = Observation(state.turn,state.graph,(("query",current),),state.shelters,state.forbidden)
        path = self.plans(temporary)["query"]
        return path[1] if len(path)>1 else current
