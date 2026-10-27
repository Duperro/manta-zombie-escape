"""Real HTTP check of the operator-only sleeper channel, restoring previous settings."""
import json
from pathlib import Path
import httpx

root = Path(__file__).resolve().parents[2]
base = "http://127.0.0.1:5173"
headers = {"Origin": base}
previous = json.loads((root / "reports/sleeper_debug_previous_config.json").read_text(encoding="utf-8-sig"))
evidence = {}
with httpx.Client(base_url=base, trust_env=False, timeout=15) as client:
    try:
        config = dict(ronda=3, sobrevivientes=1, zombies=dict(caminante=0,corredor=0,horda=0,dormido=8), turnos=2,
                      semilla=7, estrategia="pro", distribucion="equilibrada", bloqueos=False)
        start = client.post("/api/control/iniciar", json=config, headers=headers)
        start.raise_for_status()
        public_before = client.get("/api/estado").json()
        response = client.get("/api/control/dormidos")
        response.raise_for_status()
        debug = response.json()
        public_after = client.get("/api/estado").json()
        assert debug["runId"] == public_before["runId"] == public_after["runId"]
        assert debug["turno"] == public_before["turno"] == public_after["turno"] == 0
        assert len(debug["dormidos"]) == 8
        assert not public_after["zombies"]
        assert public_before == public_after
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/control/dormidos", headers={"Origin":"https://untrusted.example"}).status_code == 403
        with httpx.Client(base_url="http://127.0.0.1:8000", trust_env=False) as direct:
            assert direct.get("/control/dormidos").status_code == 401
        evidence = dict(sleepersInDebug=8, sleepersInPublicState=0, publicStateUnchanged=True,
                        backendRequiresKey=True, foreignOriginRejected=True, noStore=True)
        (root / "reports/sleeper_debug_live.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps(evidence))
    finally:
        if previous:
            restored = client.post("/api/control/iniciar", json=previous, headers=headers)
            restored.raise_for_status()
