"""Live diagnostic through Vite. A deliberately forced contact is not a benchmark."""
import json
from pathlib import Path
import sys
import time
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.graph import ROOT
base='http://127.0.0.1:5173'
config=json.loads((ROOT/'reports/breakdowns_demo_config.json').read_text(encoding='utf-8'))
with httpx.Client(base_url=base,trust_env=False,timeout=20) as client:
    response=client.post('/api/control/iniciar',json=config,headers={'Origin':base})
    response.raise_for_status(); run=response.json()['runId']
    before=client.get('/api/estado').json()
    assert all(v['turnosReparacionRestantes']==0 for v in before['camionetas'])
    deadline=time.monotonic()+35;first=None;samples={}
    while time.monotonic()<deadline:
        state=client.get('/api/estado').json()
        assert state['runId']==run
        assert not any(z['tipo']=='dormido' for z in state['zombies'])
        vehicle=next(v for v in state['camionetas'] if v['id']=='V-005')
        if first is None and vehicle['estado']=='AVERIADA':
            first=dict(turn=state['turno'],node=vehicle['nodoActual'],duration=vehicle['turnosReparacionRestantes'])
            assert first['duration']==4
        if first is not None:
            elapsed=state['turno']-first['turn']
            assert vehicle['nodoActual']==first['node']
            assert vehicle['turnosReparacionRestantes']==max(0,4-elapsed)
            if elapsed>0:assert not vehicle['aristasRecorridasEnTurno']
            samples[state['turno']]=dict(turn=state['turno'],remaining=vehicle['turnosReparacionRestantes'],status=vehicle['estado'])
            if elapsed==4:
                assert vehicle['estado']!='AVERIADA'
                assert any(e['tipo']=='camioneta_reparada' and e.get('camionetaId')=='V-005' for e in state['eventosRecientes'])
                break
        time.sleep(.2)
    else:raise AssertionError('No complete breakdown/repair cycle observed')
    evidence=dict(diagnostic=True,runId=run,vehicleId='V-005',first=first,frames=list(samples.values()),
        stationaryThroughoutRepair=True,repairEventObserved=True,publicSleepersRemainHidden=True,
        note='Forced contact fixture only; previous operator configuration is restored after visual QA.')
    (ROOT/'reports/breakdowns_live.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps(evidence))
