from fastapi.testclient import TestClient
from app.api.application import create_app
from app.core.config import Settings

def test_public_get_cors_allowlist_and_private_step_stays_protected():
    app=create_app(Settings(api_key='test-cors',cors_origins=('http://localhost:5173',)))
    with TestClient(app) as client:
        response=client.get('/estado',headers={'Origin':'http://localhost:5173'})
        assert response.status_code==200
        assert response.headers['access-control-allow-origin']=='http://localhost:5173'
        assert 'access-control-allow-credentials' not in response.headers
        denied=client.get('/estado',headers={'Origin':'https://untrusted.example'})
        assert 'access-control-allow-origin' not in denied.headers
        preflight=client.options('/paso',headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'POST'})
        assert preflight.status_code==400
        assert client.post('/paso',json={'sobrevivienteId':'S-R1-0001','nodoActual':'N-1349201358','turno':0}).status_code==401

def test_cors_disabled_by_default_and_environment_parsed(monkeypatch):
    monkeypatch.setenv('API_KEY','test')
    monkeypatch.setenv('CORS_ORIGINS','http://localhost:5173, https://dashboard.example')
    assert Settings.from_env().cors_origins==('http://localhost:5173','https://dashboard.example')
    with TestClient(create_app(Settings(api_key='test'))) as client:
        assert 'access-control-allow-origin' not in client.get('/health',headers={'Origin':'http://localhost:5173'}).headers
