"""Paired experiments over real HTTP; fresh world, reservations, strategy and decision scope."""
import argparse
import asyncio
from dataclasses import replace
from datetime import datetime,timezone
import csv
import json
from pathlib import Path
import httpx
import uvicorn
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario
from app.evaluation.evaluator import evaluate_round,export_results

def score_estimate(rows):
    if {r['ronda'] for r in rows}!={1,2,3}:
        return dict(puntuacionTotal=None,motivo="Se necesitan las tres rondas")
    weighted=sum(r['ronda']*r['porcentajeSupervivencia'] for r in rows)/6
    return dict(supervivenciaPonderada=weighted,componenteSupervivenciaSobre50=weighted*.5,
                puntuacionTotal=None,componentesSinFormulaOficial=['eficiencia_20','latencia_15','disponibilidad_15'],
                nota="Estimación parcial, sin puntuación oficial total; vivos incluye no evacuados.")

def comparison_table(rows):
    base={(r['semilla'],r['ronda']):r for r in rows if r['experimento']=='base'}
    result=[]
    for r in rows:
        if r['experimento']=='base': continue
        a=base[(r['semilla'],r['ronda'])]
        result.append(dict(semilla=r['semilla'],ronda=r['ronda'],experimento=r['experimento'],
            evacuadosBase=a['evacuados'],evacuadosPro=r['evacuados'],
            mejoraEvacuacionPP=r['tasaEvacuacion']-a['tasaEvacuacion'],
            mejoraEvacuadosPorcentual=100*(r['evacuados']-a['evacuados'])/a['evacuados'] if a['evacuados'] else None,
            supervivenciaBase=a['porcentajeSupervivencia'],supervivenciaPro=r['porcentajeSupervivencia'],
            mejoraSupervivenciaPP=r['porcentajeSupervivencia']-a['porcentajeSupervivencia'],
            p95BaseMs=a['latenciaP95Ms'],p95ProMs=r['latenciaP95Ms'],
            evacuadosCamioneta=r['evacuadosCamioneta'],rescatesCancelados=r['rescatesCancelados']))
    return result

async def run(args):
    settings=Settings.from_env()
    configs=[read_scenario(args.scenario)] if args.scenario else [read_scenario(default_scenario(n)) for n in args.rounds]
    round_numbers=[config.ronda for config in configs]
    experiments=[('base',dict(routing_strategy='base')),('pro',dict(routing_strategy='pro'))]
    if args.ablations:
        experiments.extend([('pro_sin_prediccion',dict(routing_strategy='pro',pro_prediction=False)),
                            ('pro_sin_reservas',dict(routing_strategy='pro',pro_reservations=False)),
                            ('pro_sin_flota',dict(routing_strategy='pro',pro_fleet=False))])
    app=create_app(replace(settings,routing_strategy='base'))
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=args.port,log_level='error'))
    task=asyncio.create_task(server.serve())
    rows=[]
    try:
        while not server.started:
            if task.done():
                await task
                raise RuntimeError('HTTP server did not start')
            await asyncio.sleep(.01)
        port=server.servers[0].sockets[0].getsockname()[1]
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',trust_env=False,
                limits=httpx.Limits(max_connections=32,max_keepalive_connections=32)) as client:
            for seed in args.seeds:
                for name,overrides in experiments:
                    parameters=dict(seed=seed,pro_prediction=True,pro_reservations=True,pro_fleet=True)
                    parameters.update(overrides)
                    configured=replace(settings,**parameters)
                    for index,config in enumerate(configs):
                        await app.state.coordinator.reset(build_world(configured,config),new_run=index==0)
                        row=await evaluate_round(app.state.coordinator,client,fast=True)
                        row['experimento']=name
                        rows.append(row)
                        print(json.dumps({k:row[k] for k in ['semilla','ronda','experimento','evacuados','eliminados','activos',
                            'evacuadosCamioneta','latenciaP95Ms','erroresHTTP','duracionS']},ensure_ascii=False),flush=True)
                        # Save completed rounds progressively, even if a later run is interrupted.
                        export_results(rows,args.output)
    finally:
        server.should_exit=True
        await task
    for seed in args.seeds:
        for number in round_numbers:
            paired=[r['huellaInicial'] for r in rows if r['semilla']==seed and r['ronda']==number]
            assert len(set(paired))==1,'Initial conditions differ across strategies'
    table=comparison_table(rows)
    summary=dict(fechaUTC=datetime.now(timezone.utc).isoformat(),comparaciones=table,
        estimaciones=[dict(semilla=seed,experimento=name,**score_estimate([
            r for r in rows if r['semilla']==seed and r['experimento']==name]))
            for seed in args.seeds for name,_ in experiments])
    args.output.with_name(args.output.name+'_comparison').with_suffix('.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    with args.output.with_name(args.output.name+'_comparison').with_suffix('.csv').open('w',encoding='utf-8',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=list(table[0]))
        writer.writeheader();writer.writerows(table)
    return rows

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--seeds',type=int,nargs='+',default=[7])
    parser.add_argument('--rounds',type=int,nargs='+',choices=[1,2,3],default=[1,2,3])
    parser.add_argument('--scenario',type=Path)
    parser.add_argument('--ablations',action='store_true')
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--output',type=Path,default=Path('../reports/phase3_comparison'))
    asyncio.run(run(parser.parse_args()))

if __name__=='__main__':
    main()
