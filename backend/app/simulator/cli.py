"""One owner process serves real HTTP and coordinates every round."""
import argparse
import asyncio
from dataclasses import replace
import json
from pathlib import Path
import httpx
import uvicorn
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world, read_scenario, default_scenario
from app.simulator.world import demo_world
from app.evaluation.evaluator import evaluate_round, export_results

async def run(args):
    settings=replace(Settings.from_env(),seed=args.seed) if args.seed is not None else Settings.from_env()
    if args.strategy:
        settings=replace(settings,routing_strategy=args.strategy)
    if args.demo:
        configs=[None]
        world=demo_world(settings)
    else:
        configs=[read_scenario(args.scenario)] if args.scenario else [
            read_scenario(default_scenario(n)) for n in ([1,2,3] if args.round=="all" else [int(args.round)])]
        world=build_world(settings,configs[0])
    app=create_app(settings,world)
    server=uvicorn.Server(uvicorn.Config(app,host=args.host,port=args.port,log_level="warning"))
    task=asyncio.create_task(server.serve())
    results=[]
    try:
        while not server.started:
            if task.done():
                await task
                raise RuntimeError("No se pudo iniciar HTTP")
            await asyncio.sleep(.01)
        limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)
        bound_port=server.servers[0].sockets[0].getsockname()[1]
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{bound_port}",trust_env=False,limits=limits) as client:
            for index, config in enumerate(configs):
                if index:
                    await app.state.coordinator.reset(build_world(settings,config))
                if args.turns is not None:
                    app.state.coordinator.world.max_turns=args.turns
                output=None
                if args.states:
                    args.states.parent.mkdir(parents=True,exist_ok=True)
                    output=args.states.open("w" if index==0 else "a",encoding="utf-8")
                def publish(state):
                    if output:
                        output.write(json.dumps(state.model_dump(),ensure_ascii=False)+"\n")
                    if args.verbose:
                        print(json.dumps(state.model_dump(),ensure_ascii=False),flush=True)
                try:
                    report=await evaluate_round(app.state.coordinator,client,fast=args.fast,manual=args.manual,on_turn=publish)
                finally:
                    if output:
                        output.close()
                results.append(report)
                print(json.dumps({k:v for k,v in report.items() if k not in {"eventos","metricasTurnos"}},ensure_ascii=False),flush=True)
        export_results(results,args.output or Path(f"../reports/{settings.routing_strategy}_phase3_seed{settings.seed}"))
    finally:
        server.should_exit=True
        await task
    return results

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--round",choices=["1","2","3","all"],default="1")
    parser.add_argument("--scenario",type=Path)
    parser.add_argument("--seed",type=int)
    parser.add_argument("--strategy",choices=["base","pro"])
    parser.add_argument("--demo",action="store_true")
    parser.add_argument("--turns",type=int,choices=range(1,151),metavar="1..150")
    parser.add_argument("--port",type=int,default=8000)
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--manual",action="store_true")
    parser.add_argument("--fast",action="store_true")
    parser.add_argument("--verbose",action="store_true")
    parser.add_argument("--states",type=Path)
    parser.add_argument("--output",type=Path)
    asyncio.run(run(parser.parse_args()))

if __name__=="__main__":
    main()
