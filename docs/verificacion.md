# Verificación de Fase 1

Ejecutada el 27 de octubre de 2026 en Windows, Python 3.12.14.

Desde backend/: `.venv312/Scripts/python.exe -m pytest -q`

Resultado: **16 passed, 1 warning in 3.58s**, código de salida 0.
La advertencia es una deprecación de alias BlockingPortal entre Starlette y AnyIO.
Las pruebas de red se ejecutaron con acceso localhost fuera del aislamiento que bloqueaba socketpair de asyncio en Windows.

Cobertura funcional: endpoints/autenticación/validación; idempotencia y conflictos; vecino válido y calle bloqueada; costo por velocidad; caminante/corredor/horda/dormido; dos aristas de corredor; mordidas por nodo y cruce opuesto; snapshot aislado; contrato generado sin diferencias; simulaciones TCP reproducibles; bloqueo por evento; fallback ante fallo HTTP; 20 sobrevivientes concurrentes; dos peticiones de avance serializadas y 20 reintentos concurrentes consistentes.

CLI ejecutada: `python -m app.simulator.cli --turns 8 --fast --port 8765`, con API_KEY temporal en entorno.
Resultado completo en simulacion.example.jsonl. Posiciones por turno: N-0001, N-0002, N-0003, N-0004; rescatado en turno 4 y permanece hasta turno 8. Código de salida 0.

Contrato generado con `python -m app.export_contract`; comparación exacta con app.openapi() dentro de las pruebas.

Docker: el cliente está instalado, pero `docker info` falla porque Docker Desktop Linux Engine no está iniciado. No se construyó ni ejecutó la imagen.
No se ejecutó una prueba de carga ni se afirma alcanzar p95 <=150 ms o SLA de 500 ms en producción.
No se verificaron instalación Linux, OSMnx, infraestructura, mapa real ni integración con frontend.
La carpeta recibida carece de .git; no hubo commits, push, merge ni despliegue.
