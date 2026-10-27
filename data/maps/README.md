Mapa activo: manta_graph.json, 1.507 nodos y 3.319 aristas dirigidas reales de OpenStreetMap. Versión manta-e14526d00c21d066.
Ampliación desde la fuente local de 7.208 nodos: cuadrícula territorial 4×4, caminos dirigidos y conservación de los 306 nodos/571 aristas anteriores. Sin calles sintéticas.
Regenerar desde backend/: python scripts/generate_manta_graph.py --target 1500 --coverage-grid 4 --preserve ../data/maps/archive/manta_graph_306.json
archive/manta_graph_306.json conserva el snapshot de los estudios históricos. Las posiciones de refugios y flota no se modificaron.
cache/ y manta_source.graphml son fuentes locales excluidas de Git. Requiere el extra maps; el JSON activo no requiere red al ejecutar.
Datos © OpenStreetMap contributors, ODbL. Sectores por cercanía a anclas, no límites administrativos. Detalles y límites en docs/mapa.md.
