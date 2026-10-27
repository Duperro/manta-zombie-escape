"""Runtime-only credentials; Compose mounts the key, never bakes it into images."""
import os
from pathlib import Path


def api_key_from_env():
    secret_file = os.getenv('API_KEY_FILE')
    if not secret_file:
        return os.getenv('API_KEY', '')
    if os.getenv('API_KEY'):
        raise ValueError('Definir solo API_KEY o API_KEY_FILE, no ambas')
    try:
        key = Path(secret_file).read_text(encoding='utf-8-sig').strip()
    except (OSError, UnicodeError):
        raise ValueError('No se pudo leer API_KEY_FILE') from None
    if not key:
        raise ValueError('API_KEY_FILE está vacío')
    return key
