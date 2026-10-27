"""Download once with OSMnx; preserve directed roads, parallel edges and real geometry."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import networkx as nx
import osmnx as ox

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.config import Settings
from app.core.graph import ROOT, validate_map

BBOX = (-80.78,-1.00,-80.67,-0.935)

def is_bridge(value):
    values = value if isinstance(value,list) else [value]
    return any(v is not None and str(v).lower() not in {"no","false","0","none"} for v in values)

def classify(attrs):
    if is_bridge(attrs.get("bridge")):
        return "puente"
    highway = attrs.get("highway","")
    highways = highway if isinstance(highway,list) else [highway]
    names = str(attrs.get("name","")).lower()
    if "callejón" in names or "callejon" in names or attrs.get("service")=="alley":
        return "callejón"
    if any(t in {"motorway","trunk","primary","secondary","tertiary","motorway_link","trunk_link","primary_link","secondary_link"} for t in highways) or "avenida" in names:
        return "avenida"
    return "calle"

def select_network(source, sectors, target):
    largest = max(nx.strongly_connected_components(source),key=len)
    graph = source.subgraph(largest).copy()
    for sector in sectors.values():
        sector["osm_anchor"] = min(graph,key=lambda n:(
            (graph.nodes[n]["y"]-sector["lat"])**2+(graph.nodes[n]["x"]-sector["lng"])**2,n))
    anchors = [s["osm_anchor"] for s in sectors.values()]
    root = anchors[0]
    selected = {root}
    def connect(node):
        selected.update(nx.shortest_path(graph,root,node,weight="length"))
        selected.update(nx.shortest_path(graph,node,root,weight="length"))
    for anchor in anchors:
        connect(anchor)
    # Include a real OSM bridge so round 2 can collapse one without inventing a road.
    bridge = min(((u,v,k) for u,v,k,a in graph.edges(keys=True,data=True) if is_bridge(a.get("bridge"))),
                 key=lambda e:min((graph.nodes[e[0]]["y"]-s["lat"])**2+(graph.nodes[e[0]]["x"]-s["lng"])**2 for s in sectors.values()))
    connect(bridge[0]); connect(bridge[1])
    ranked = {name: sorted(graph,key=lambda n:((graph.nodes[n]["y"]-s["lat"])**2+
                    (graph.nodes[n]["x"]-s["lng"])**2,n)) for name,s in sectors.items()}
    cursors = dict.fromkeys(sectors,0)
    while len(selected)<target:
        before = len(selected)
        for name in sectors:
            while cursors[name]<len(graph) and ranked[name][cursors[name]] in selected:
                cursors[name]+=1
            if cursors[name]<len(graph):
                connect(ranked[name][cursors[name]])
            if len(selected)>=target:
                break
        if len(selected)==before:
            break
    return graph.subgraph(selected).copy()

def export_graph(graph, sectors, settings, source_count, source_edges):
    nodes, roads = [], []
    for n, a in sorted(graph.nodes(data=True)):
        sector = min(sectors,key=lambda name:(a["y"]-sectors[name]["lat"])**2+(a["x"]-sectors[name]["lng"])**2)
        nodes.append(dict(id=f"N-{n}",lat=a["y"],lng=a["x"],sector=sector))
    for u,v,k,a in sorted(graph.edges(keys=True,data=True)):
        coords = list(a["geometry"].coords) if "geometry" in a else [(graph.nodes[u]["x"],graph.nodes[u]["y"]),(graph.nodes[v]["x"],graph.nodes[v]["y"])]
        if abs(coords[0][0]-graph.nodes[u]["x"])+abs(coords[0][1]-graph.nodes[u]["y"]) > abs(coords[-1][0]-graph.nodes[u]["x"])+abs(coords[-1][1]-graph.nodes[u]["y"]):
            coords.reverse()
        osmids = a["osmid"] if isinstance(a["osmid"],list) else [a["osmid"]]
        kind = classify(a)
        speed = settings.speeds[kind]
        roads.append(dict(id=f"E-{u}-{v}-{k}",origen=f"N-{u}",destino=f"N-{v}",distancia_m=a["length"],
            tipo=kind,velocidad_m_s=speed,tiempo_estimado_s=a["length"]/speed,bloqueada=False,
            geometria=coords,osmids=sorted(str(i) for i in osmids)))
    version = "manta-"+hashlib.sha256(json.dumps([nodes,roads],sort_keys=True).encode()).hexdigest()[:16]
    sectors = {name:dict(lat=s["lat"],lng=s["lng"],nodo=f"N-{s['osm_anchor']}",consulta=s["query"],
                        fuente="https://nominatim.openstreetmap.org/search") for name,s in sectors.items()}
    return dict(version=version,atribucion="© OpenStreetMap contributors, ODbL",nodos=nodes,aristas=roads,sectores=sectors,
        metadata=dict(fuente="OpenStreetMap / OSMnx 2.0.2",overpass=ox.settings.overpass_url,
            bbox=list(BBOX),generadoUTC=datetime.now(timezone.utc).isoformat(),nodosFuente=source_count,
            aristasFuente=source_edges,nodosFinales=len(nodes),aristasFinales=len(roads),
            seleccion="Caminos dirigidos de ida/vuelta entre anclas y expansión por sector; subgrafo inducido.",
            sectores="Anclas Nominatim; asignación por cercanía, no polígonos administrativos.",
            simplificacion="OSMnx simplify=True; geometrías completas y osmids conservados; sin atajos sintéticos."))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--target",type=int,default=300)
    parser.add_argument("--overpass",default="https://overpass.kumi.systems/api")
    parser.add_argument("--output",type=Path,default=ROOT/"data/maps/manta_graph.json")
    args=parser.parse_args()
    ox.settings.cache_folder=str(ROOT/"data/maps/cache")
    ox.settings.requests_timeout=120
    ox.settings.overpass_url=args.overpass
    ox.settings.useful_tags_way=list(set(ox.settings.useful_tags_way+["bridge"]))
    source_path=ROOT/"data/maps/manta_source.graphml"
    if source_path.exists():
        source=ox.load_graphml(source_path)
    else:
        source=ox.graph_from_bbox(BBOX,network_type="drive",retain_all=True)
        ox.save_graphml(source,source_path)
    sectors_path=ROOT/"data/maps/sector_sources.json"
    if sectors_path.exists():
        sectors=json.loads(sectors_path.read_text(encoding="utf-8"))
    else:
        sectors={}
        for name in ["Tarqui","Los Esteros","Barbasquillo","Jocay"]:
            query=f"{name}, Manta, Ecuador"
            lat,lng=ox.geocode(query)
            sectors[name]=dict(lat=lat,lng=lng,query=query)
        sectors_path.write_text(json.dumps(sectors,indent=2),encoding="utf-8")
    graph=select_network(source,sectors,args.target)
    data=export_graph(graph,sectors,Settings(api_key="map-generation-only"),len(source),source.number_of_edges())
    validated=validate_map(data)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(dict(nodos=len(validated),aristas=validated.number_of_edges(),
                         fuertementeConectado=nx.is_strongly_connected(validated),
                         puentes=sum(a["tipo"]=="puente" for _,_,a in validated.edges(data=True))),indent=2))

if __name__=="__main__":
    main()
