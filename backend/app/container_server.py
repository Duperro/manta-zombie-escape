"""One persistent application/clock owner on the private container network."""
import uvicorn

from app.api.application import create_app
from app.core.config import Settings


def create_container_app():
    settings = Settings.from_env()
    if settings.turn_seconds != 2:
        raise ValueError('El servicio Docker requiere TURN_SECONDS=2')
    return create_app(settings, dashboard_controls=True,
                      control_base_url='http://127.0.0.1:8000')


def main():
    uvicorn.run(create_container_app(), host='0.0.0.0', port=8000, workers=1,
                access_log=False, proxy_headers=False, log_level='warning')


if __name__ == '__main__':
    main()
