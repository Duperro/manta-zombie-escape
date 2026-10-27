"""Real HTTP load: 200 actors per batch, bounded in-flight requests as in the coordinator."""
import argparse
import asyncio
import json
from pathlib import Path
import time
import httpx
import uvicorn
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.evaluation.metrics import percentile

async def run(args):
    settings=Settings.from_env()
    app=create_app(settings,build_world(settings,read_scenario(default_scenario(3))))
    world=app.state.coordinator.world
    before=world.reservations.snapshot()
    graph=app.state.coordinator.snapshot.graph
    blocked=world.horde_nodes()
    requests=[dict(sobrevivienteId=s.id,nodoActual=s.node,turno=0) for s in world.survivors]
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=0,log_level='error'))
    task=asyncio.create_task(server.serve())
    samples,queues=[],[]
    errors=0
    try:
        while not server.started:
            if task.done(): await task;raise RuntimeError('Server failed')
            await asyncio.sleep(.01)
        port=server.servers[0].sockets[0].getsockname()[1]
        sem=asyncio.Semaphore(args.concurrency)
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',trust_env=False,
                limits=httpx.Limits(max_connections=args.concurrency,max_keepalive_connections=args.concurrency)) as client:
            async def request(body):
                nonlocal errors
                queued=time.perf_counter()
                async with sem:
                    start=time.perf_counter()
                    queues.append((start-queued)*1000)
                    try:
                        async with asyncio.timeout(.5):
                            result=await client.post('/paso',json=body,headers={'x-api-key':settings.api_key},timeout=.5)
                            result.raise_for_status()
                            data=result.json()
                            assert set(data)=={'siguienteNodo'}
                            origin,dest=body['nodoActual'],data['siguienteNodo']
                            assert dest==origin or graph.has_edge(origin,dest) and dest not in blocked
                    except (httpx.HTTPError,TimeoutError,AssertionError): errors+=1
                    finally: samples.append((time.perf_counter()-start)*1000)
            for _ in range(args.batches):
                await asyncio.gather(*(request(body) for body in requests))
    finally:
        server.should_exit=True
        await task
    assert world.reservations.snapshot()==before,'HTTP must never mutate reservations'
    report=dict(estrategia=settings.routing_strategy,actores=200,lotes=args.batches,concurrencia=args.concurrency,
        solicitudes=len(samples),errores=errors,sobre500ms=sum(t>500 for t in samples),
        promedioMs=sum(samples)/len(samples),p50Ms=percentile(samples,.5),p95Ms=percentile(samples,.95),
        p99Ms=percentile(samples,.99),colaP95Ms=percentile(queues,.95),disponibilidad=1-errors/len(samples),
        metodologia='HTTP TCP real; cola del semáforo separada. Reintentos del turno 0 sobre 200 actores, sin avanzar el mundo.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)
    return report

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--batches',type=int,choices=range(1,101),default=10)
    parser.add_argument('--concurrency',type=int,choices=range(1,201),default=4)
    parser.add_argument('--output',type=Path,default=Path('../reports/phase3_http_benchmark.json'))
    asyncio.run(run(parser.parse_args()))

if __name__=='__main__': main()
