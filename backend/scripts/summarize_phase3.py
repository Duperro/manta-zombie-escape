"""Build a pitch-ready Markdown table from measured reports, without fabricating a score."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.graph import ROOT

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',type=Path,default=ROOT/'reports/phase3_release_v32.json')
    parser.add_argument('--output',type=Path,default=ROOT/'docs/resultados_fase3.md')
    args=parser.parse_args()
    rows=json.loads(args.input.read_text(encoding='utf-8'))['rondas']
    assert all(r['versionAlgoritmo']=='3.2.0' for r in rows)
    seeds=sorted({r['semilla'] for r in rows})
    lines=['# Resultados medidos Base vs. Pro — algoritmo 3.2.0','',
        'Fuente: reports/phase3_release_v32.json y su CSV; ejecución Docker Linux, HTTP TCP real. '+
        'Tres rondas de 150 turnos por estrategia y semilla. Los valores son resultados de simulación, no puntuación oficial.','',
        '| Semilla | Ronda | Evacuados Base → Pro | Vivos Base → Pro | Activos Pro | Evacuados en camioneta | p95 Pro |',
        '|---:|---:|---:|---:|---:|---:|---:|']
    for seed in seeds:
        for number in [1,2,3]:
            a=next(r for r in rows if r['semilla']==seed and r['ronda']==number and r['experimento']=='base')
            b=next(r for r in rows if r['semilla']==seed and r['ronda']==number and r['experimento']=='pro')
            assert a['huellaInicial']==b['huellaInicial']
            lines.append(f"| {seed} | {number} | {a['evacuados']} → {b['evacuados']} | {a['vivosFinales']} → {b['vivosFinales']} | {b['activos']} | {b['evacuadosCamioneta']} | {b['latenciaP95Ms']:.2f} ms |")
    base=[r for r in rows if r['experimento']=='base'];pro=[r for r in rows if r['experimento']=='pro']
    a=sum(r['evacuados'] for r in base);b=sum(r['evacuados'] for r in pro)
    live_a=sum(r['vivosFinales'] for r in base);live_b=sum(r['vivosFinales'] for r in pro)
    r3a=sum(r['vivosFinales'] for r in base if r['ronda']==3);r3b=sum(r['vivosFinales'] for r in pro if r['ronda']==3)
    lines.extend(['',f"Total evacuados: **{a} → {b}**, mejora relativa de **{100*(b-a)/a:.2f}%**. "+
        f"Total vivos: **{live_a} → {live_b}**. Ronda 3, vivos agregados: **{r3a} → {r3b}** sobre {200*len(seeds)} personas.",'',
        f"Pro realizó {sum(r['evacuadosCamioneta'] for r in pro)} evacuaciones en camioneta. "+
        f"Máximo p95 de sus ejecuciones: {max(r['latenciaP95Ms'] for r in pro):.2f} ms. "+
        f"Errores HTTP: {sum(r['erroresHTTP'] for r in rows)}; solicitudes sobre 500 ms: {sum(r['solicitudesSobre500ms'] for r in rows)}. "+
        f"Peticiones HTTP registradas: {sum(r['solicitudesHTTP'] for r in rows)}.",'',
        'Viajes con entrega, agregados sobre las nueve rondas Pro:', '', '| Camioneta | Viajes |','|---|---:|'])
    for vehicle in sorted(pro[0]['viajesCamionetas']):
        lines.append(f"| {vehicle} | {sum(r['viajesCamionetas'][vehicle] for r in pro)} |")
    lines.extend(['','No se fuerza utilizar un vehículo si la heurística no estima beneficio; cero viajes es un resultado que debe mostrarse. '+
        'La capacidad y operación física de las cinco unidades se comprueban también mediante pruebas controladas.','',
        'Las columnas de vivos incluyen activos al terminar: no deben mostrarse como evacuaciones. '+
        'Los percentiles de filas no se promedian como si fueran un percentil global. '+
        'La tabla de comparación y estimación parcial del componente de supervivencia está en phase3_release_v32_comparison.json/.csv. '+
        'El total oficial permanece sin calcular por falta de fórmulas de normalización.','',
        'Datos para gráficos: usar semilla/ronda/experimento como dimensiones, y evacuados/vivosFinales/evacuadosCamioneta/latenciaP95Ms como series. '+
        'Para atribución por función consultar phase3_ablation_v32.json; para presión de capacidad, phase3_capacity.json.'])
    args.output.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(args.output)

if __name__=='__main__': main()
