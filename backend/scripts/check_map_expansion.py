"""Compare OSM snapshots and smoke-test all rounds without claiming ASGI timings as TCP latency."""
import asyncio
import json
from pathlib import Path
import sys
import time
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.config import Settings
from app.core.graph import ROOT, load_map
from app.core.scenario_config import build_world, read_scenario, default_scenario
from app.api.application import create_app

async def main():
    old=json.loads((ROOT/'data/maps/archive/manta_graph_306.json').read_text(encoding='utf-8'))
    new=json.loads((ROOT/'data/maps/manta_graph.json').read_text(encoding='utf-8'))
    def extent(data):
        ns=data['nodos'];return [min(n['lng'] for n in ns),min(n['lat'] for n in ns),max(n['lng'] for n in ns),max(n['lat'] for n in ns)]
    a,b=extent(old),extent(new)
    before={e['id']:e for e in old['aristas']};after={e['id']:e for e in new['aristas']}
    preserved=all(e in after and all(before[e][k]==after[e][k] for k in ['origen','destino','geometria','osmids']) for e in before)
    report=dict(before=dict(version=old['version'],nodes=len(old['nodos']),edges=len(old['aristas']),bounds=a),
        after=dict(version=new['version'],nodes=len(new['nodos']),edges=len(new['aristas']),bounds=b),
        boundingBoxAreaRatio=((b[2]-b[0])*(b[3]-b[1]))/((a[2]-a[0])*(a[3]-a[1])),
        allPreviousNodesPreserved={n['id'] for n in old['nodos']}<={n['id'] for n in new['nodos']},
        allPreviousRoadsAndGeometryPreserved=preserved,warmup=[])
    assert preserved and report['allPreviousNodesPreserved']
    for number in [1,2,3]:
        tick=time.perf_counter();settings=Settings(api_key='map-validation-only',routing_strategy='pro')
        app=create_app(settings,build_world(settings,read_scenario(default_scenario(number))))
        creation=time.perf_counter()-tick
        samples=[]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://local') as client:
            for _ in range(4):
                tick=time.perf_counter();await app.state.coordinator.step(client);samples.append(time.perf_counter()-tick)
        report['warmup'].append(dict(round=number,creationSeconds=round(creation,3),turnSeconds=[round(v,3)for v in samples],note='ASGI logic validation, not TCP latency'))
        print(json.dumps(report['warmup'][-1]),flush=True)
    (ROOT/'reports/map_expansion.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items()if k!='warmup'}),flush=True)
if __name__=='__main__':asyncio.run(main())
