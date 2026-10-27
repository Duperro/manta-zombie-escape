"""Real TCP acceptance of the expanded map, active simulation and dashboard proxy."""
import json
from pathlib import Path
import sys
import time
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.graph import ROOT

base='http://127.0.0.1:5173'
previous=json.loads((ROOT/'reports/map_expansion_previous_config.json').read_text(encoding='utf-8-sig'))
config=previous or dict(ronda=3,sobrevivientes=200,zombies=dict(caminante=24,corredor=12,horda=4,dormido=8),turnos=150,semilla=7,estrategia='pro',distribucion='equilibrada',bloqueos=True)
with httpx.Client(base_url=base,trust_env=False,timeout=20) as client:
    assert client.get('/').status_code==200
    response=client.post('/api/control/iniciar',json=config,headers={'Origin':base})
    response.raise_for_status();run=response.json()['runId']
    data=client.get('/api/mapa').json()
    assert len(data['nodos'])>=1500 and len(data['aristas'])>3000
    coordinates={n['id']:(n['lat'],n['lng']) for n in data['nodos']}
    deadline=time.monotonic()+40
    observed=[]
    while time.monotonic()<deadline:
        frame=client.get('/api/estado').json()
        if frame['runId']==run:
            assert frame['mapaVersion']==data['version']
            assert len(frame['camionetas'])==5 and len(frame['refugios'])==4
            for entity in [*frame['sobrevivientes'],*frame['camionetas']]:
                assert entity['nodoActual'] in coordinates
                assert all(n in coordinates for n in entity['rutaPlanificada'])
            assert all(r['ocupacion']+r['plazas_reservadas']<=r['capacidad_maxima'] for r in frame['refugios'])
            observed.append(frame['turno'])
            if frame['turno']>=2:break
        time.sleep(.25)
    else:raise AssertionError('The expanded simulation did not advance')
    assert frame['metricas']['solicitudesHTTP']>0 and frame['metricas']['erroresHTTP']==0
    proof=dict(mapVersion=data['version'],nodes=len(data['nodos']),directedEdges=len(data['aristas']),
        publicTurns=sorted(set(observed)),trucks=5,shelters=4,positionsAndRoutesResolve=True,
        httpRequests=frame['metricas']['solicitudesHTTP'],httpErrors=frame['metricas']['erroresHTTP'],httpP95Ms=frame['metricas']['latenciaP95Ms'],
        note='Real HTTP through Vite; no claim of visual browser QA or production SLA')
    (ROOT/'reports/map_expansion_dashboard_live.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps(proof))
