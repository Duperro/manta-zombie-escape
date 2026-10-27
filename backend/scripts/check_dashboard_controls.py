"""Live local acceptance test through Vite. Does not require a browser or expose the key."""
import json
from pathlib import Path
import time
import httpx


def main():
    base = "http://127.0.0.1:5173"
    origin = {"Origin": base}
    evidence = {}
    with httpx.Client(base_url=base, trust_env=False, timeout=20) as client:
        initial = client.get("/api/control/estado")
        initial.raise_for_status()
        config = dict(ronda=1, sobrevivientes=5, zombies=dict(caminante=0, corredor=0, horda=0, dormido=0),
                      turnos=2, semilla=7, estrategia="pro", distribucion="equilibrada", bloqueos=False)
        for headers in [{}, {"Origin":"https://untrusted.example"}]:
            assert client.post("/api/control/iniciar", json=config, headers=headers).status_code == 403
        with httpx.Client(base_url="http://127.0.0.1:8000", trust_env=False) as direct:
            assert direct.post("/control/iniciar", json=config).status_code == 401
            assert direct.get("/control/estado").status_code == 401
        evidence["protectedProxyAndBackend"] = True
        started = client.post("/api/control/iniciar", json=config, headers=origin)
        started.raise_for_status()
        run_id = started.json()["runId"]
        assert client.post("/api/control/iniciar", json={**config,"sobrevivientes":0}, headers=origin).status_code == 422
        assert client.get("/api/control/estado").json()["runId"] == run_id
        evidence["invalidConfigurationPreservesRun"] = True
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = client.get("/api/estado").json()
            if state["runId"] == run_id and state["estadoSimulacion"] == "FINALIZADA": break
            time.sleep(0.25)
        else: raise AssertionError("Run did not finish")
        assert state["turno"] == state["turnosTotales"] == 2
        assert state["metricas"]["solicitudesHTTP"] > 0
        assert state["metricas"]["erroresHTTP"] == 0
        assert not client.get("/api/control/estado").json()["ejecutando"]
        evidence["finishedThroughRealHTTP"] = True
        evidence["completedMetrics"] = state["metricas"]
        config.update(turnos=150, ronda=3, sobrevivientes=30, zombies=dict(caminante=10, corredor=2, horda=1, dormido=1))
        second = client.post("/api/control/iniciar", json=config, headers=origin).json()
        assert second["runId"] != run_id
        for count in [31,32,33]:
            response = client.post("/api/control/iniciar", json={**config,"sobrevivientes":count}, headers=origin)
            response.raise_for_status()
        state = client.get("/api/estado").json()
        assert state["turno"] == 0 and len(state["sobrevivientes"]) == 33
        assert state["runId"] == response.json()["runId"]
        assert len(state["camionetas"]) == 5 and len(state["refugios"]) == 4
        evidence["restartedCompletedAndRunningRuns"] = True
        evidence["lastRunId"] = state["runId"]
    output = Path(__file__).resolve().parents[2] / "reports/dashboard_control_live.json"
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in evidence.items() if k != "completedMetrics"}))


if __name__ == "__main__":
    main()
