import json
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

from app import container_server, operator
from app.core.config import Settings


def test_runtime_secret_file_and_invalid_configuration(monkeypatch, tmp_path):
    monkeypatch.delenv('API_KEY', raising=False)
    secret = tmp_path / 'key'
    secret.write_text('\ufeffprivate-test-key\n', encoding='utf-8')
    monkeypatch.setenv('API_KEY_FILE', str(secret))
    assert Settings.from_env().api_key == 'private-test-key'
    monkeypatch.setenv('API_KEY', 'ambiguous')
    with pytest.raises(ValueError, match='solo API_KEY'):
        Settings.from_env()
    monkeypatch.delenv('API_KEY')
    secret.write_text('', encoding='utf-8')
    with pytest.raises(ValueError, match='vacío'):
        Settings.from_env()
    secret.unlink()
    with pytest.raises(ValueError, match='No se pudo leer'):
        Settings.from_env()


def test_container_keeps_authenticated_controls_and_paso_contract(monkeypatch):
    monkeypatch.delenv('API_KEY_FILE', raising=False)
    monkeypatch.setenv('API_KEY', 'container-test-key')
    monkeypatch.setenv('TURN_SECONDS', '2')
    app = container_server.create_container_app()
    with TestClient(app) as client:
        assert client.get('/health').json()['status'] == 'ok'
        assert client.get('/control/estado').status_code == 401
        assert client.post('/control/iniciar', json={}).status_code == 401
        assert client.get('/control/dormidos').status_code == 401
        state = client.get('/estado').json()
        survivor = state['sobrevivientes'][0]
        body = dict(sobrevivienteId=survivor['id'], nodoActual=survivor['nodoActual'], turno=0)
        assert client.post('/paso', json=body).status_code == 401
        response = client.post('/paso', json=body, headers={'x-api-key':'container-test-key'})
        assert response.status_code == 200 and set(response.json()) == {'siguienteNodo'}
    monkeypatch.setenv('TURN_SECONDS', '.1')
    with pytest.raises(ValueError, match='TURN_SECONDS=2'):
        container_server.create_container_app()


def test_entrypoint_always_one_worker_on_private_container_interface(monkeypatch):
    app = object()
    monkeypatch.setenv('WEB_CONCURRENCY', '8')
    monkeypatch.setattr(container_server, 'create_container_app', lambda:app)
    captured = {}
    monkeypatch.setattr(container_server.uvicorn, 'run', lambda application, **kwargs:captured.update(app=application, **kwargs))
    container_server.main()
    assert captured['app'] is app
    assert captured['host'] == '0.0.0.0' and captured['workers'] == 1
    assert captured['port'] == 8000 and not captured['access_log']


def test_operator_uses_official_round_and_runtime_settings():
    settings = Settings(api_key='test', seed=23, routing_strategy='pro')
    config = operator.round_request(3, settings)
    assert config.sobrevivientes == 200 and config.turnos == 150
    assert config.zombies.model_dump() == dict(caminante=24, corredor=12, horda=4, dormido=8)
    assert config.semilla == 23 and config.estrategia == 'pro'
    assert operator.round_request(1, settings, turns=3, seed=8).turnos == 3
    assert operator.round_request(1, settings, turns=3, seed=8).semilla == 8


@pytest.mark.parametrize('code',[200,401])
def test_operator_contacts_existing_server_without_printing_key(monkeypatch, capsys, code):
    secret = 'operator-secret-never-print'
    monkeypatch.delenv('API_KEY_FILE', raising=False)
    monkeypatch.setenv('API_KEY', secret)
    monkeypatch.setattr(sys, 'argv', ['operator', 'status'])
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(code,json=dict(ejecutando=False,error=None))

    original = httpx.Client
    monkeypatch.setattr(operator.httpx, 'Client', lambda **kwargs:original(transport=httpx.MockTransport(handle), **kwargs))
    if code == 200:
        operator.main()
    else:
        with pytest.raises(SystemExit) as exc:
            operator.main()
        assert exc.value.code == 1
    output = capsys.readouterr()
    if code == 200:
        assert json.loads(output.out)['ejecutando'] is False
    assert secret not in output.out + output.err
    assert len(seen) == 1
    assert str(seen[0].url) == 'http://127.0.0.1:8000/control/estado'
    assert seen[0].headers['x-api-key'] == secret
