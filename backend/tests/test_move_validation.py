"""Local edge validation must match the traversable directed multigraph."""
import networkx as nx
import pytest

from app.core.config import Settings
from app.core.graph import traversable
from app.models.domain import Zombie
from app.simulator.world import demo_world


@pytest.mark.parametrize('graph_type', [nx.Graph, nx.DiGraph, nx.MultiGraph, nx.MultiDiGraph])
def test_validation_matches_traversable_with_live_edge_changes(graph_type):
    world = demo_world(Settings(api_key='test'))
    world.zombies = []
    graph = graph_type()
    graph.add_nodes_from(['a', 'b', 'c'])
    graph.add_edge('a', 'b', cost=1, bloqueada=True)
    if graph.is_multigraph():
        graph.add_edge('a', 'b', cost=2, bloqueada=False)
    graph.add_edge('b', 'c', cost=1, bloqueada=False)
    world.graph = graph

    def compare():
        usable = traversable(graph)
        blocked = world.horde_nodes()
        for origin in [*graph, 'missing']:
            for dest in [*graph, 'missing', None]:
                expected = origin in graph and dest in graph and (
                    dest == origin or usable.has_edge(origin, dest) and dest not in blocked)
                assert world.valid(origin, dest) == expected

    compare()
    world.zombies = [Zombie('horde', 'c', 'horda')]
    compare()
    world.zombies = []
    for _, _, attrs in graph.edges(data=True):
        attrs['bloqueada'] = True
    compare()
    graph.add_edge('a', 'c', cost=3, bloqueada=False)
    compare()
