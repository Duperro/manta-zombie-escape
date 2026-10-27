"""Opt-in real Compose acceptance: private operator + public Nginx, no new World."""
import argparse
import asyncio
import json
import re
import sys
import time

import httpx

from app.core.config import Settings
from app.evaluation.metrics import percentile
from app.models.domain import MapView, PasoResponse, StateView
from app.operator import round_request


def check_state(state, expected_people):
    assert len(state.sobrevivientes) == expected_people
    assert len(state.camionetas) == 5 and len(state.refugios) == 4
    assert all(z.tipo != 'dormido' for z in state.zombies)
    metrics = state.metricas
    assert metrics['evacuados'] + metrics['eliminados'] + metrics['activos'] == expected_people
    riders = [sid for vehicle in state.camionetas for sid in vehicle.pasajeros]
    assigned = [sid for vehicle in state.camionetas for sid in vehicle.sobrevivientesAsignados]
    assert len(riders) == len(set(riders)) and len(assigned) == len(set(assigned))
    assert set(riders) == {s.id for s in state.sobrevivientes if s.estado == 'EN_CAMIONETA'}
    assert all(len(v.pasajeros) + len(v.sobrevivientesAsignados) <= v.capacidad for v in state.camionetas)
    assert all(0 <= r.ocupacion + r.plazas_reservadas <= r.capacidad for r in state.refugios)


async def run(url):
    settings = Settings.from_env()
    auth = {'x-api-key': settings.api_key}
    async with httpx.AsyncClient(base_url=url, trust_env=False, timeout=30) as public, \
            httpx.AsyncClient(base_url='http://127.0.0.1:8000', trust_env=False, timeout=60) as private:
        assert (await private.get('/health')).json()['status'] == 'ok'
        assert (await public.get('/api/health')).json()['status'] == 'ok'
        index = await public.get('/')
        assert index.status_code == 200 and 'id="root"' in index.text
        assert (await public.get('/vista/mapa')).status_code == 200  # SPA fallback
        assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', index.text)
        assert assets
        for asset in assets:
            response = await public.get(asset)
            assert response.status_code == 200
            assert settings.api_key not in response.text
            assert 'x-api-key' not in response.text.lower() and 'API_KEY' not in response.text
        for path in ['/api/control/estado','/api/control/dormidos','/control/estado',
                     '/control/dormidos','/openapi.json','/docs','/.env']:
            assert (await public.get(path)).status_code == 404, path
        for path in ['/api/control/iniciar','/control/iniciar']:
            assert (await public.post(path, json={})).status_code == 404
            assert (await public.post(path, json={}, headers=auth)).status_code == 404
        assert (await private.get('/control/estado')).status_code == 401
        assert (await private.get('/control/dormidos')).status_code == 401
        assert (await private.post('/control/iniciar', json={})).status_code == 401
        assert (await public.get('/paso')).status_code == 405
        assert (await public.post('/api/estado',json={})).status_code == 405
        assert (await public.post('/paso',content='x'*17000)).status_code == 413
        city = MapView.model_validate((await public.get('/api/mapa')).json())
        assert len(city.nodos) == 1507 and len(city.aristas) == 3319

        config = round_request(3, settings)
        assert config.sobrevivientes == 200 and config.turnos == 150
        response = await private.post('/control/iniciar',json=config.model_dump(),headers=auth)
        response.raise_for_status()
        run_id = response.json()['runId']
        started = time.perf_counter()
        initial = StateView.model_validate((await public.get('/api/estado')).json())
        assert initial.turno == 0 and initial.runId == run_id
        check_state(initial, 200)
        bodies = [dict(sobrevivienteId=s.id,nodoActual=s.nodoActual,turno=0) for s in initial.sobrevivientes]
        assert (await public.post('/paso',json=bodies[0])).status_code == 401
        assert (await public.post('/paso',json=bodies[0],headers={'x-api-key':'incorrect'})).status_code == 401
        assert (await public.post('/paso',json={**bodies[0],'turno':'0'},headers=auth)).status_code == 422
        lengths, errors = [], []
        slots = asyncio.Semaphore(4)
        neighbours = {(e.origen,e.destino) for e in city.aristas}

        async def decision(body):
            async with slots:
                before = time.perf_counter()
                try:
                    async with asyncio.timeout(.5):
                        answer = await public.post('/paso',json=body,headers=auth,timeout=.5)
                        answer.raise_for_status()
                        payload = answer.json()
                        assert set(payload) == {'siguienteNodo'}
                        dest = PasoResponse.model_validate(payload,strict=True).siguienteNodo
                        assert dest == body['nodoActual'] or (body['nodoActual'],dest) in neighbours
                except (httpx.HTTPError, TimeoutError, ValueError, AssertionError) as exc:
                    errors.append(type(exc).__name__)
                finally:
                    lengths.append((time.perf_counter()-before)*1000)

        for _ in range(5):
            await asyncio.gather(*(decision(body) for body in bodies))
        print(json.dumps(dict(sondeoProxy=dict(solicitudes=len(lengths),errores=len(errors),
              tiposError=errors,p95Ms=percentile(lengths,.95),maxMs=max(lengths)))),file=sys.stderr,flush=True)
        assert not errors and max(lengths) <= 500, 'Fallo real de latencia/contrato en el proxy'
        seen, last_reported = {0}, -1
        deadline = time.monotonic() + 420
        while True:
            state = StateView.model_validate((await public.get('/api/estado')).json())
            assert state.runId == run_id and state.segundosPorTurno == 2
            check_state(state, 200)
            seen.add(state.turno)
            # Valid turn-0 idempotent retries also sample the public endpoint
            # throughout active CPU planning, not only before the first tick.
            await decision(bodies[state.turno % len(bodies)])
            if state.turno // 10 != last_reported:
                last_reported = state.turno // 10
                print(f'Compose: ronda 3, turno {state.turno}/150',file=sys.stderr,flush=True)
            status = (await private.get('/control/estado',headers=auth)).json()
            assert status['error'] is None
            if state.estadoSimulacion == 'FINALIZADA':
                break
            assert time.monotonic() < deadline, 'La ronda no terminó dentro de la ventana de prueba'
            await asyncio.sleep(1)
        elapsed = time.perf_counter()-started
        assert state.turno == 150 and len(seen) > 5 and elapsed >= 299
        assert state.metricas['erroresHTTP'] == state.metricas['respuestasInvalidas'] == 0
        assert state.metricas['rutasInvalidas'] == state.metricas['solicitudesSobre500ms'] == 0
        assert not errors and max(lengths) <= 500, 'Fallo de sondeo HTTP durante la ronda activa'
        await asyncio.sleep(3)
        retained = StateView.model_validate((await public.get('/api/estado')).json())
        assert retained.turno == 150 and retained.runId == run_id
        assert not (await private.get('/control/estado',headers=auth)).json()['ejecutando']

        # Restart through the existing coordinator, never by creating another server.
        restart = await private.post('/control/iniciar',json=round_request(1,settings,turns=2).model_dump(),headers=auth)
        restart.raise_for_status()
        next_id = restart.json()['runId']
        assert next_id != run_id
        next_state = StateView.model_validate((await public.get('/api/estado')).json())
        assert next_state.turno == 0 and next_state.ronda == 1
        await asyncio.sleep(6)
        next_state = StateView.model_validate((await public.get('/api/estado')).json())
        assert next_state.turno == 2 and next_state.estadoSimulacion == 'FINALIZADA'
        check_state(next_state, 20)
        print(json.dumps(dict(
            metodologia='Docker Compose real, Nginx→FastAPI por TCP; 1000 reintentos válidos del turno 0 más sondeos durante la ronda activa; operador privado, 2 s/turno; no AWS.',
            ronda3Completa=True,turnos=state.turno,duracionS=elapsed,
            nodos=len(city.nodos),aristas=len(city.aristas),metricasRonda3=state.metricas,
            pruebaProxy=dict(solicitudes=len(lengths),errores=len(errors),sobre500ms=sum(v>500 for v in lengths),
                            p95Ms=percentile(lengths,.95),p99Ms=percentile(lengths,.99),maxMs=max(lengths)),
            controlesPublicosBloqueados=True,contratoPasoConservado=True,
            estadoFinalRetenido=True,reinicioSinReconstruir=True,
            estadoTrasPrueba=dict(ronda=1,turno=2,finalizada=True)),ensure_ascii=False,indent=2))


def main():
    parser = argparse.ArgumentParser(description='Aceptación real de Compose: altera solo la ejecución del contenedor')
    parser.add_argument('--url',default='http://frontend:8080')
    args = parser.parse_args()
    asyncio.run(run(args.url))


if __name__ == '__main__':
    main()
