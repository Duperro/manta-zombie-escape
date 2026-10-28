"""Descarga los EDIFICIOS y la COSTA reales de Manta (OpenStreetMap) para la vista 3D.

Resultado: frontend/public/manta/ciudad.json  ->  { "buildings": [{"p": [[lat, lng], ...], "h": metros}],
                                                    "coast": [[[lat, lng], ...], ...] }
Sin este archivo la vista "Seguir" usa edificios procedurales y una costa aproximada.

Uso (desde backend/, necesita internet; no requiere instalar nada extra):
    python scripts/fetch_manta_city.py
Si tu red bloquea Overpass, abre https://overpass-turbo.eu, pega la consulta que imprime
este script con --consulta, exporta "raw OSM data" y luego:
    python scripts/fetch_manta_city.py --archivo export.json

Datos © OpenStreetMap contributors (ODbL).
"""
import argparse
import hashlib
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GRAPH = ROOT / "data/maps/manta_graph.json"
OUTPUT = ROOT / "frontend/public/manta/ciudad.json"
OVERPASS = "https://overpass-api.de/api/interpreter"
FLOOR_M = 3.1


def bbox(margin_m=300):
    nodes = json.loads(GRAPH.read_text(encoding="utf-8"))["nodos"]
    lats = [n["lat"] for n in nodes]
    lngs = [n["lng"] for n in nodes]
    dlat = margin_m / 110540
    dlng = margin_m / (111320 * math.cos(math.radians(sum(lats) / len(lats))))
    return min(lats) - dlat, min(lngs) - dlng, max(lats) + dlat, max(lngs) + dlng


def query():
    s, w, n, e = bbox()
    area = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return f'[out:json][timeout:180];(way["building"]{area};way["natural"="coastline"]{area};);out geom;'


def height(tags, key):
    """Altura en metros: 'height' > 'building:levels' > estimación estable de 1 a 2 pisos."""
    raw = str(tags.get("height", "")).lower().replace("m", "").replace(",", ".").strip()
    try:
        if raw:
            return max(2.5, min(200.0, float(raw)))
    except ValueError:
        pass
    try:
        levels = float(str(tags.get("building:levels", "")).split(";")[0])
        if levels > 0:
            return min(200.0, levels * FLOOR_M + 0.4)
    except ValueError:
        pass
    seed = int(hashlib.md5(key.encode()).hexdigest()[:6], 16) / 0xFFFFFF
    return FLOOR_M + 0.4 if seed < 0.6 else 2 * FLOOR_M + 0.4  # Manta: casas de 1-2 pisos


def build(osm):
    buildings, coast = [], []
    for element in osm.get("elements", []):
        if element.get("type") != "way" or "geometry" not in element:
            continue
        points = [[round(p["lat"], 6), round(p["lon"], 6)] for p in element["geometry"] if p]
        tags = element.get("tags", {})
        if tags.get("natural") == "coastline":
            if len(points) >= 2:
                coast.append(points)
        elif "building" in tags and len(points) >= 4:
            if points[0] == points[-1]:
                points = points[:-1]  # el polígono se cierra solo al extruirlo
            buildings.append({"p": points, "h": round(height(tags, str(element.get("id"))), 1)})
    return {"fuente": "© OpenStreetMap contributors (ODbL)", "buildings": buildings, "coast": coast}


def download():
    data = urllib.parse.urlencode({"data": query()}).encode()
    request = urllib.request.Request(OVERPASS, data=data, headers={"User-Agent": "manta-zombie-escape/1.0"})
    with urllib.request.urlopen(request, timeout=200) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archivo", type=Path, help="JSON exportado desde overpass-turbo")
    parser.add_argument("--consulta", action="store_true", help="solo imprime la consulta Overpass")
    args = parser.parse_args()
    if args.consulta:
        print(query())
        return
    osm = json.loads(args.archivo.read_text(encoding="utf-8")) if args.archivo else download()
    city = build(osm)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(city, separators=(",", ":")), encoding="utf-8")
    print(f"{len(city['buildings'])} edificios y {len(city['coast'])} tramos de costa -> {OUTPUT} "
          f"({OUTPUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
