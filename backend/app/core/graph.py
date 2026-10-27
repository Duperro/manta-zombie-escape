"""Directed multigraph I/O. Node-only decisions choose the fastest open parallel edge."""
import hashlib
import json
import math
import os
from pathlib import Path
import networkx as nx
from app.models.domain import MapView

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.getenv("MANTA_DATA_DIR",str(ROOT / "data")))
DEFAULT_MAP = DATA_DIR / "maps/manta_graph.json"


def edges(graph):
    if graph.is_multigraph():
        yield from graph.edges(keys=True, data=True)
    else:
        for u, v, attrs in graph.edges(data=True):
            yield u, v, None, attrs


def traversable(graph):
    result = nx.DiGraph()
    result.add_nodes_from(graph.nodes(data=True))
    for u, v, _, attrs in sorted(edges(graph), key=lambda row: (row[0], row[1], str(row[2]))):
        if attrs["bloqueada"]:
            continue
        if not result.has_edge(u,v) or (attrs["cost"], attrs.get("id", "")) < (result[u][v]["cost"], result[u][v].get("id", "")):
            result.add_edge(u,v,**attrs)
        if not graph.is_directed():
            result.add_edge(v,u,**attrs)
    return result


def map_view(graph):
    nodes = [dict(id=n,lat=a["lat"],lng=a["lng"],sector=a.get("sector")) for n,a in graph.nodes(data=True)]
    roads = []
    for u,v,k,a in edges(graph):
        roads.append(dict(id=a.get("id",f"E-{u}-{v}"),origen=u,destino=v,
            distancia_m=a["distancia_m"],tipo=a["tipo"],velocidad_m_s=a["velocidad_m_s"],
            tiempo_estimado_s=a["cost"],bloqueada=a["bloqueada"],osmids=a.get("osmids",[]),
            geometria=a.get("geometria",[[graph.nodes[u]["lng"],graph.nodes[u]["lat"]],
                                        [graph.nodes[v]["lng"],graph.nodes[v]["lat"]]])))
    return MapView(version=graph.graph.get("version","demo-v1"),atribucion="© OpenStreetMap contributors, ODbL" if graph.is_multigraph() else "Grafo sintético",
                   nodos=nodes, aristas=roads, sectores=graph.graph.get("sectores",{}),metadata=graph.graph.get("metadata",{}))


def validate_map(data):
    model = MapView.model_validate(data)
    if not model.nodos or len({n.id for n in model.nodos}) != len(model.nodos):
        raise ValueError("Nodos vacíos o duplicados")
    if len({e.id for e in model.aristas}) != len(model.aristas):
        raise ValueError("Aristas duplicadas")
    graph = nx.MultiDiGraph(version=model.version, sectores=model.sectores, metadata=model.metadata)
    for n in model.nodos:
        if not (math.isfinite(n.lat) and math.isfinite(n.lng) and -90 <= n.lat <= 90 and -180 <= n.lng <= 180):
            raise ValueError("Coordenadas inválidas")
        graph.add_node(n.id,lat=n.lat,lng=n.lng,sector=n.sector)
    for e in model.aristas:
        if e.origen not in graph or e.destino not in graph:
            raise ValueError("Extremo inexistente")
        if e.tipo not in {"avenida","calle","callejón","puente"}:
            raise ValueError("Tipo de calle inválido")
        if not all(math.isfinite(v) and v > 0 for v in [e.distancia_m,e.velocidad_m_s,e.tiempo_estimado_s]):
            raise ValueError("Distancias y tiempos deben ser positivos")
        if not math.isclose(e.distancia_m/e.velocidad_m_s,e.tiempo_estimado_s,rel_tol=1e-6):
            raise ValueError("Tiempo de recorrido inconsistente")
        if len(e.geometria)<2 or any(len(p)!=2 or not (-180<=p[0]<=180 and -90<=p[1]<=90) for p in e.geometria):
            raise ValueError("Geometría inválida")
        attrs=e.model_dump(exclude={"id","origen","destino","tiempo_estimado_s"})
        graph.add_edge(e.origen,e.destino,key=e.id,id=e.id,cost=e.tiempo_estimado_s,**attrs)
    if not nx.is_strongly_connected(graph):
        raise ValueError("La red debe permitir rutas dirigidas entre todos los nodos")
    for name, sector in model.sectores.items():
        if sector["nodo"] not in graph:
            raise ValueError(f"Sector sin nodo: {name}")
    return graph


def load_map(path=DEFAULT_MAP, speeds=None):
    graph = validate_map(json.loads(Path(path).read_text(encoding="utf-8")))
    if speeds:
        for _,_,_,a in edges(graph):
            a["velocidad_m_s"] = speeds[a["tipo"]]
            a["cost"] = a["distancia_m"]/a["velocidad_m_s"]
    return graph
