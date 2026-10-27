import json
from app.core.graph import ROOT, DEFAULT_MAP, load_map


def test_expansion_preserves_every_original_road_and_its_geometry():
    previous=json.loads((ROOT/'data/maps/archive/manta_graph_306.json').read_text(encoding='utf-8'))
    current=json.loads(DEFAULT_MAP.read_text(encoding='utf-8'))
    nodes={n['id'] for n in current['nodos']}
    assert {n['id'] for n in previous['nodos']} <= nodes
    roads={e['id']:e for e in current['aristas']}
    for old in previous['aristas']:
        assert old['id'] in roads
        for field in ['origen','destino','geometria','osmids','distancia_m']:
            assert roads[old['id']][field]==old[field]
    assert current['version'] != previous['version']
    assert len(current['nodos'])>=1500 and len(current['aristas'])>3000
    assert min(n['lng'] for n in current['nodos'])<min(n['lng'] for n in previous['nodos'])
    assert max(n['lng'] for n in current['nodos'])>max(n['lng'] for n in previous['nodos'])
    assert min(n['lat'] for n in current['nodos'])<min(n['lat'] for n in previous['nodos'])
    assert max(n['lat'] for n in current['nodos'])>max(n['lat'] for n in previous['nodos'])


def test_expanded_map_keeps_refuges_fleet_and_osm_identifiers():
    graph=load_map()
    for name in ['shelters','fleet']:
        records=json.loads((ROOT/f'data/scenarios/{name}.json').read_text(encoding='utf-8'))
        assert all(item['nodo'] in graph for item in records)
    assert all(n.startswith('N-') and n[2:].isdigit() for n in graph)
    assert all(a['osmids'] and len(a['geometria'])>=2 for _,_,a in graph.edges(data=True))
