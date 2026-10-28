"""Desatascar sobrevivientes sin ruta.

Problema detectado en la ronda 3 (semilla 7): unos 20 sobrevivientes terminaban la
ronda casi sin moverse. La ruta "dura" trata cada zombie visible como un muro, así
que cuando dos o tres zombies se paran en los únicos accesos de un barrio, Dijkstra
no encuentra camino, el sobreviviente queda sin refugio y espera para siempre.

Pero los zombies se mueven. Aquí se calcula una ruta "blanda": las hordas siguen
prohibidas (es una regla), pero el nodo de un zombie visible solo cuesta mucho.
El primer paso se valida con las reglas duras (nunca se entra al nodo de un zombie
ni se cruza a uno por la misma calle). Si el mejor paso seguro no acerca al refugio,
el sobreviviente espera en su sitio hasta que el acceso se libere.
"""
import networkx as nx

from app.models.domain import FOOT_STATES

RIESGO_NODO_ZOMBIE = 3.0   # x risk_weight: "pasa por aquí solo si no hay otra opción"
RIESGO_MAXIMO_PASO = .7    # no dar un paso hacia un nodo con persecución predicha


def unstick(context, state, routes):
    stuck = [s for s in context.survivors
             if s.status in FOOT_STATES and s.vehicle_id is None
             and len(s.planned_route or []) <= 1 and s.node in state.graph]
    targets = [n for n in state.shelters if n in state.graph and n not in state.horde_nodes]
    if not stuck or not targets:
        return

    zombie_nodes = {node for _, node, _ in state.zombies}
    weight = max(routes.weight, 1.0)

    def reverse_cost(a, b, _attrs):
        # En el grafo invertido, la arista a->b es la calle original b->a.
        if a in state.horde_nodes or b in state.horde_nodes:
            return None  # None = arista inexistente para networkx
        return routes.edge_cost(b, a) + (weight * RIESGO_NODO_ZOMBIE if a in zombie_nodes else 0)

    dist, paths = nx.multi_source_dijkstra(state.graph.reverse(copy=False), targets, weight=reverse_cost)

    for s in stuck:
        here = s.node
        if here not in dist or here in state.shelters:
            continue
        options = []
        for n in state.graph.successors(here):
            if (n in state.forbidden or n not in dist or not routes.allowed_edge(here, n)
                    or routes.risk.nodes.get(n, 0) >= RIESGO_MAXIMO_PASO):
                continue
            options.append((dist[n] + routes.edge_cost(here, n), dist[n], n))
        if not options:
            continue
        _, remaining, step = min(options)
        # Avanzar solo si el paso seguro acerca al refugio; si no, esperar a que se libere.
        if remaining < dist[here] or here in state.forbidden:
            s.planned_route = [here, *reversed(paths[step])]
