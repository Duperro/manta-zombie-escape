import json
from pathlib import Path
import yaml
from app.api.application import create_app
from app.core.config import Settings
from app.core.scenario_config import build_world,read_scenario,default_scenario


def main():
    root = Path(__file__).resolve().parents[2]
    contract = create_app(Settings(api_key="contract-generation-only")).openapi()
    (root / "contracts").mkdir(exist_ok=True)
    (root / "contracts/openapi.yaml").write_text(yaml.safe_dump(contract, sort_keys=False, allow_unicode=True), encoding="utf-8")
    control_contract = create_app(Settings(api_key="contract-generation-only"), dashboard_controls=True).openapi()
    (root / "contracts/dashboard-control.openapi.yaml").write_text(yaml.safe_dump(control_contract, sort_keys=False, allow_unicode=True), encoding="utf-8")
    app = create_app(Settings(api_key="example-only"))
    state = app.state.coordinator.published_state
    (root / "docs/estado.example.json").write_text(json.dumps(state.model_dump(), indent=2), encoding="utf-8")
    (root / "docs/mapa.example.json").write_text(json.dumps(app.state.base_map.model_dump(),indent=2),encoding="utf-8")
    survivor=state.sobrevivientes[0]
    request=dict(sobrevivienteId=survivor.id,nodoActual=survivor.nodoActual,turno=state.turno)
    decision=app.state.coordinator.repository.get(state.turno,survivor.id)
    (root / "docs/paso.example.json").write_text(json.dumps(dict(peticion=request,
        respuesta={"siguienteNodo":decision[1]}),indent=2),encoding="utf-8")
    pro_settings=Settings(api_key="example-only",routing_strategy="pro")
    pro=create_app(pro_settings,build_world(pro_settings,read_scenario(default_scenario(3))))
    (root/"docs/estado.pro.example.json").write_text(json.dumps(pro.state.coordinator.published_state.model_dump(),
        ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
