"""Persistent loopback-only server for starting/restarting runs from the dashboard."""
import argparse
import uvicorn
from app.api.application import create_app
from app.core.config import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Puerto inválido")
    app = create_app(Settings.from_env(), dashboard_controls=True,
                     control_base_url=f"http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, workers=1, log_level="warning")


if __name__ == "__main__":
    main()
