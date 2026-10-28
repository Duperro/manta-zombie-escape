"""Riesgo adicional calculado SOLO con información observable (sin trampas).

Complementa la predicción de corredores (prediction.py) con dos ideas simples:

1. Trampas: en la ronda 3 casi todas las mordidas ocurrían en nodos con 1 o 2
   salidas (callejones y pasillos). Si un zombie llega al nodo, quedarse es
   mordida y salir por la calle por donde vino es "cruce opuesto". Se penalizan
   esos nodos solo cuando hay zombies visibles cerca (radio según el tipo).
2. Dormidos: son invisibles, pero no se mueven y despiertan si un sobreviviente
   queda a 2 nodos o menos. Por eso, toda zona por la que ya pasó alguien sin
   despertar a nadie está "verificada". Se penaliza un poco lo no verificado.

Probado y descartado: penalizar a los vecinos de los caminantes según la paridad
del turno aumentó las mordidas en las semillas probadas (ver docs/mejoras_algoritmo.md).

El resultado es un diccionario nodo -> nivel de riesgo (misma escala que RiskMap,
0..1), que RiskRoutes multiplica por risk_weight y suma al costo de la calle.
"""
import networkx as nx

from app.routing.planner import Observation

RIESGO_TRAMPA = .45              # nodo con pocas salidas y zombies cerca
SALIDAS_TRAMPA = 2               # 1 = callejón sin salida; 2 = pasillo (un zombie por cada lado)
RADIO_TRAMPA = {"caminante": 2, "corredor": 5, "horda": 1}  # corredor: detecta a 3 y corre 2
RIESGO_NO_VERIFICADO = .03       # posible dormido oculto
RIESGO_CAMINANTE = 1.4           # contacto: el caminante elige 1 de sus salidas al azar (en turno par)
RIESGO_CORREDOR_2 = .9           # a 2 calles o menos de un corredor: puede alcanzarte el próximo turno
RADIO_DORMIDO = 2                # regla del enunciado: despierta a 2 nodos o menos


class ThreatModel:
    """Vive mientras dure la ronda (una instancia por estrategia)."""

    def __init__(self):
        self.verified: set[str] = set()

    def update_verified(self, state: Observation):
        """Marca como libres de dormidos los nodos desde los que un dormido habría
        alcanzado a algún sobreviviente vivo en 2 saltos (y por tanto despertado)."""
        reverse = state.graph.reverse(copy=False)
        for _, node in state.people:
            if node in state.graph:
                self.verified.update(nx.single_source_shortest_path_length(reverse, node, cutoff=RADIO_DORMIDO))

    def penalties(self, state: Observation) -> dict[str, float]:
        self.update_verified(state)
        graph = state.graph
        risk: dict[str, float] = {}

        def add(node, level):
            if level > risk.get(node, 0):
                risk[node] = level

        # Contacto en el próximo turno (los zombies se mueven antes que los sobrevivientes):
        # el caminante, si le toca moverse, cae en una de sus salidas; el corredor llega a 2 calles.
        walker_moves_next = (state.turn + 1) % 2 == 0
        for _, node, kind in state.zombies:
            if node not in graph:
                continue
            if kind == "caminante" and walker_moves_next:
                exits = [n for n in graph.successors(node) if n not in state.horde_nodes]
                for n in exits:
                    add(n, min(0.95, RIESGO_CAMINANTE / len(exits)))
            elif kind == "corredor":
                # Detecta a 3 calles y corre 2: a ≤2 te alcanza ya; a 3-4 te empieza a perseguir.
                for n, hops in nx.single_source_shortest_path_length(graph, node, cutoff=4).items():
                    if hops:
                        add(n, RIESGO_CORREDOR_2 if hops <= 2 else .6 if hops == 3 else .3)

        # Nodos con pocas salidas al alcance de algún zombie: ahí un zombie puede
        # acorralar (quedarse = mordida en el nodo; salir por su calle = cruce).
        near_zombies: set[str] = set()
        undirected = graph.to_undirected(as_view=True)
        for _, node, kind in state.zombies:
            if node in graph:
                near_zombies.update(nx.single_source_shortest_path_length(
                    undirected, node, cutoff=RADIO_TRAMPA.get(kind, 2)))
        for node in near_zombies:
            exits = sum(1 for n in graph.successors(node) if n not in state.horde_nodes)
            if exits <= SALIDAS_TRAMPA and node not in state.shelters:
                add(node, RIESGO_TRAMPA * (1 if exits <= 1 else .6))  # callejón > pasillo

        for node in graph:
            if node not in self.verified:
                add(node, RIESGO_NO_VERIFICADO)
        return risk
