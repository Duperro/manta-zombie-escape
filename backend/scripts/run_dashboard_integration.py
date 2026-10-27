"""Local QA server: real Pro rounds and HTTP decisions; never exposes a control endpoint."""
import argparse
import asyncio
from dataclasses import replace
import json
from pathlib import Path
import sys
import time
import httpx
import uvicorn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.evaluation.evaluator import evaluate_round,export_results

async def run(args):
    settings=replace(Settings.from_env(),routing_strategy='pro',turn_seconds=args.pace)
    configs=[read_scenario(default_scenario(n)) for n in [1,2,3]]
    app=create_app(settings,build_world(settings,configs[0]))
    public_calls={'/health':0,'/mapa':0,'/estado':0}
    @app.middleware('http')
    async def count_public(request,call_next):
        if request.method=='GET' and request.url.path in public_calls: public_calls[request.url.path]+=1
        return await call_next(request)
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=args.port,log_level='warning'))
    task=asyncio.create_task(server.serve())
    rows=[]
    try:
        while not server.started:
            if task.done(): await task;raise RuntimeError('QA server failed')
            await asyncio.sleep(.01)
        print('QA_READY',flush=True)
        await asyncio.sleep(args.delay)
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{args.port}',trust_env=False,
                limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)) as client:
            for index,config in enumerate(configs):
                if index: await app.state.coordinator.reset(build_world(settings,config))
                row=await evaluate_round(app.state.coordinator,client,fast=False)
                rows.append(row)
                export_results(rows,args.output)
                print(json.dumps({key:row[key] for key in ['ronda','turnos','evacuados','eliminados','activos','latenciaP95Ms','evacuadosCamioneta']}),flush=True)
        print('QA_ROUNDS_COMPLETE',flush=True)
        await asyncio.sleep(args.hold)
    finally:
        args.output.with_name(args.output.name+'_public_calls.json').write_text(json.dumps(public_calls,indent=2),encoding='utf-8')
        server.should_exit=True
        await task

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--pace',type=float,default=.25)
    parser.add_argument('--delay',type=float,default=10)
    parser.add_argument('--hold',type=float,default=30)
    parser.add_argument('--output',type=Path,default=Path('../reports/handoff_live_backend'))
    asyncio.run(run(parser.parse_args()))

if __name__=='__main__': main()
