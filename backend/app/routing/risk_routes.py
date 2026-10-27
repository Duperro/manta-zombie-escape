"""Shared reverse trees; mandatory restrictions are removed, uncertainty adds cost."""
import networkx as nx
from app.routing.planner import Observation
from app.routing.prediction import RiskMap

class RiskRoutes:
    def __init__(self, state: Observation, risk: RiskMap, weight: float):
        self.state,self.risk,self.weight=state,risk,weight
        self.graph=nx.DiGraph()
        self.graph.add_nodes_from((n,a) for n,a in state.graph.nodes(data=True) if n not in state.forbidden)
        for u,v,a in state.graph.edges(data=True):
            if u in self.graph and v in self.graph and self.allowed_edge(u,v):
                self.graph.add_edge(u,v,**dict(a),weighted_cost=self.edge_cost(u,v))
        self.trees={}
        self.sources={}
        for shelter in sorted(state.shelters):
            self.add_target(shelter)

    def allowed_edge(self,u,v):
        if not self.state.graph.has_edge(u,v) or self.state.graph[u][v]["bloqueada"]:
            return False
        token=self.state.graph[u][v].get("road_token","")
        return not any((a,b)==(v,u) and (not token or token==road) for a,b,road in self.state.zombie_edges)

    def edge_cost(self,u,v):
        return self.state.graph[u][v]["cost"]+self.weight*(self.risk.nodes.get(v,0)+.75*self.risk.edges.get((v,u),0))

    def add_target(self,target):
        if target not in self.trees and target in self.graph:
            costs,paths=nx.single_source_dijkstra(self.graph.reverse(copy=False),target,weight="weighted_cost")
            self.trees[target]=(costs,{n:list(reversed(p)) for n,p in paths.items()})

    def choice(self,node,target):
        self.add_target(target)
        if target not in self.trees:
            return None
        costs,paths=self.trees[target]
        if node in paths:
            return costs[node],paths[node]
        # A survivor may escape an occupied origin; forbidden nodes are never destinations.
        if node not in self.state.graph:
            return None
        options=[(self.edge_cost(node,n)+costs[n],[node,*paths[n]])
                 for n in self.state.graph.successors(node) if n in costs and self.allowed_edge(node,n)]
        return min(options) if options else None

    def best(self,node):
        options=[(choice[0],target,choice[1]) for target in sorted(self.state.shelters)
                 if (choice:=self.choice(node,target)) is not None]
        return min(options) if options else None

    def path_between(self,source,target):
        if source not in self.sources:
            graph=self.graph
            if source not in graph and source in self.state.graph:
                graph=graph.copy()
                graph.add_node(source)
                for n in self.state.graph.successors(source):
                    if n in self.graph and self.allowed_edge(source,n):
                        graph.add_edge(source,n,weighted_cost=self.edge_cost(source,n))
            if source not in graph:
                self.sources[source]=({}, {})
            else:
                self.sources[source]=nx.single_source_dijkstra(graph,source,weight="weighted_cost")
        costs,paths=self.sources[source]
        return (costs[target],paths[target]) if target in paths else None
