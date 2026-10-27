import csv
import json
from pathlib import Path
import time
import asyncio
import hashlib
from datetime import datetime, timezone
from dataclasses import asdict
from app.core.scenario_config import build_world

async def evaluate_round(coordinator,client,*,fast=True,manual=False,on_turn=None):
    world=coordinator.world
    started=time.perf_counter()
    for _ in range(world.max_turns):
        if manual:
            await asyncio.to_thread(input,"Enter para avanzar un turno: ")
        tick=time.perf_counter()
        state=await coordinator.step(client)
        if on_turn:
            on_turn(state)
        if not fast and not manual:
            await asyncio.sleep(max(0,world.settings.turn_seconds-(time.perf_counter()-tick)))
    parameters=asdict(world.settings)
    parameters.pop("api_key")
    canonical=world.view().model_dump()
    canonical.pop("metricas")
    canonical.pop("turnosTotales", None)
    canonical.pop("segundosPorTurno", None)
    canonical.pop("runId", None)  # Runtime metadata does not affect deterministic world signatures.
    signature=hashlib.sha256(json.dumps(canonical,sort_keys=True).encode()).hexdigest()
    return dict(ronda=world.round_number,semilla=world.settings.seed,algoritmo=world.settings.routing_strategy.title(),
        versionAlgoritmo="3.2.0",fechaUTC=datetime.now(timezone.utc).isoformat(),
        configuracion=parameters,escenario=world.scenario_config,huellaInicial=world.initial_fingerprint,firmaFinal=signature,
        concurrenciaHTTP=coordinator.concurrency,
        turnos=world.turn,duracionS=time.perf_counter()-started,
        mapaVersion=world.graph.graph.get("version","demo-v1"),**world.metrics.summary(world.survivors),
        ocupacionRefugios={r.id:dict(ocupacion=r.occupied,reservas=r.reserved,capacidad=r.capacity) for r in world.shelters},
        viajesCamionetas={v.id:v.trips for v in world.vehicles},
        distanciaCamionetas_m=sum(v.distance_m for v in world.vehicles),
        eventos=world.history,metricasTurnos=world.metrics.turn_records)

async def evaluate_scenarios(app,client,configs,settings,*,fast=True,on_turn=None):
    results=[]
    for index,config in enumerate(configs):
        # Fresh graph, RNG, actors, capacities, metrics and event history for each round.
        await app.state.coordinator.reset(build_world(settings,config),new_run=index==0)
        results.append(await evaluate_round(app.state.coordinator,client,fast=fast,on_turn=on_turn))
    return results

def export_results(results,output):
    output=Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.with_suffix(".json").write_text(json.dumps(dict(
        metodologia="Métricas locales; no equivalen a puntuación oficial. Percentiles nearest-rank sobre HTTP real, sin espera de semáforo.",
        rondas=results),ensure_ascii=False,indent=2),encoding="utf-8")
    summaries=[{k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v
                for k,v in r.items() if k not in {"eventos","metricasTurnos"}} for r in results]
    with output.with_suffix(".csv").open("w",encoding="utf-8",newline="") as file:
        writer=csv.DictWriter(file,fieldnames=list(summaries[0]))
        writer.writeheader()
        writer.writerows(summaries)
