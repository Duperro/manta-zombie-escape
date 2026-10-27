"""Private operator client. Never constructs a World or another clock owner."""
import argparse
import json
from pathlib import Path
import sys

import httpx

from app.api.simulation_control import BreakdownConfig, BreakdownRule, SimulationRequest
from app.core.config import Settings
from app.core.scenario_config import default_scenario, read_scenario


def round_request(number, settings, *, turns=None, seed=None):
    scenario = read_scenario(default_scenario(number))
    return SimulationRequest(
        ronda=number, sobrevivientes=scenario.sobrevivientes,
        zombies=scenario.zombies, turnos=turns or scenario.turnos,
        semilla=settings.seed if seed is None else seed, estrategia=settings.routing_strategy,
        distribucion=scenario.distribucion,
        averias=BreakdownConfig(activadas=settings.vehicle_breakdowns, **{
            kind: BreakdownRule(probabilidad=settings.vehicle_breakdown_chances[kind],
                                turnos=settings.vehicle_repair_turns[kind])
            for kind in settings.vehicle_breakdown_chances}),
    )


def main():
    parser = argparse.ArgumentParser(description='Operación privada del simulador persistente')
    commands = parser.add_subparsers(dest='command', required=True)
    start = commands.add_parser('start', help='Iniciar o reiniciar una ronda en el mismo servidor')
    source = start.add_mutually_exclusive_group()
    source.add_argument('--round', type=int, choices=[1, 2, 3])
    source.add_argument('--config', help='JSON SimulationRequest; usar - para stdin')
    start.add_argument('--turns', type=int, choices=range(1, 151), metavar='1..150')
    start.add_argument('--seed', type=int)
    commands.add_parser('status', help='Estado privado de ejecución, sin credenciales')
    commands.add_parser('export', help='Último estado público y métricas en JSON por stdout')
    args = parser.parse_args()
    try:
        settings = Settings.from_env()
        with httpx.Client(base_url='http://127.0.0.1:8000', trust_env=False, timeout=60) as client:
            if args.command == 'start':
                if args.config:
                    if args.turns is not None or args.seed is not None:
                        parser.error('--config ya define turnos y semilla; no combinar con esas opciones')
                    raw = sys.stdin.read() if args.config == '-' else Path(args.config).read_text(encoding='utf-8-sig')
                    config = SimulationRequest.model_validate_json(raw)
                else:
                    config = round_request(args.round or 1, settings, turns=args.turns, seed=args.seed)
                response = client.post('/control/iniciar', json=config.model_dump(),
                                       headers={'x-api-key': settings.api_key})
            elif args.command == 'status':
                response = client.get('/control/estado', headers={'x-api-key': settings.api_key})
            else:
                response = client.get('/estado')
            if not response.is_success:
                raise ValueError(f'El servidor respondió HTTP {response.status_code}')
            print(json.dumps(response.json(), ensure_ascii=False, indent=2))
    except (httpx.HTTPError, ValueError, OSError) as exc:
        print(f'Operación fallida ({type(exc).__name__}); revisa configuración y estado del servidor.', file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
