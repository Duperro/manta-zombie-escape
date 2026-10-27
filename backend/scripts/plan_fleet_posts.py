"""Static graph-only deployment: no scenario seed or zombie coordinates are consulted."""
import json
from pathlib import Path
import sys
import networkx as nx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.graph import DATA_DIR,load_map

def plan():
    graph=load_map()
    refuges=json.loads((DATA_DIR/'scenarios/shelters.json').read_text(encoding='utf-8'))
    simple=nx.DiGraph(graph)
    walking={n:min(nx.shortest_path_length(simple,n,r['nodo']) for r in refuges) for n in graph}
    distance=dict(nx.all_pairs_shortest_path_length(simple))
    sectors=graph.graph['sectores']
    counts={sector:sum(graph.nodes[n]['sector']==sector for n in graph) for sector in sectors}
    selected=[]
    benefit=dict.fromkeys(graph,0.)
    for sector in [*sectors,None]:
        choices=[n for n in graph if n not in selected and (sector is None or graph.nodes[n]['sector']==sector)]
        def gain(vehicle):
            return sum(max(0,walking[n]-(distance[vehicle].get(n,10000)/2+1+walking[n]/2)-benefit[n])/
                       counts[graph.nodes[n]['sector']] for n in graph)
        node=min(choices,key=lambda n:(-gain(n),n))
        selected.append(node)
        for n in graph:
            benefit[n]=max(benefit[n],walking[n]-(distance[node].get(n,10000)/2+1+walking[n]/2))
    records=[dict(id=f'V-{i+1:03}',nodo=node,sector=graph.nodes[node]['sector'],
        criterio='Despliegue estático por beneficio marginal de rescate en saltos, sin posiciones de zombies ni semilla.')
        for i,node in enumerate(selected)]
    (DATA_DIR/'scenarios/fleet.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(records,ensure_ascii=True,indent=2))

if __name__=='__main__': plan()
