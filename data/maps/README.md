Fase 2 usa manta_graph.json: 306 nodos reales y 571 aristas dirigidas de OpenStreetMap.
Regenerar desde backend/: python scripts/generate_manta_graph.py --target 300.
sector_sources.json conserva las anclas Nominatim usadas para el estudio.
cache/ y manta_source.graphml son fuentes descargadas locales, excluidas de Git.
Clasificación, metodología, licencia y limitaciones: docs/mapa.md en la raíz.
El grafo sintético anterior permanece accesible con --demo; no se usa por defecto.
