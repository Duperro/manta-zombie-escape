# Entrega al responsable AWS

**Procedimiento vigente:** [Docker local](docker-local.md), [preparación EC2 y
HTTPS](aws-predeploy.md) e [informe de validación Docker](validacion_docker.md).
La nueva entrega usa Compose, Nginx y `app.container_server`; el operador usa
`docker compose exec` y la clave montada. El backend no publica puerto al host y
el dashboard de producción es público de lectura. No hay cuenta ni despliegue
AWS configurado. La región, dominio, certificado y mediciones EC2 siguen pendientes.

## Referencia histórica del traspaso anterior

El contenido siguiente conserva el contexto de la entrega previa. Sus comandos
Docker individuales y sus límites sobre la CLI/runId no sustituyen el
procedimiento Compose vigente enlazado arriba.

No se crearon recursos, no se desplegó y no se modificó infra/. Esta entrega define requisitos; el responsable AWS decide los recursos y configura hosting/ingress.

## Artefactos

Backend: backend/Dockerfile, backend/pyproject.toml, backend/app/, data/ y .env.example. Frontend: frontend/package.json, package-lock.json, .env.example, vite.config.ts, src/ y public/. `npm ci && npm run build` produce frontend/dist/. Contratos: contracts/openapi.yaml y docs/estado.example.json / estado.pro.example.json. Reglas y resultados: fase3.md, verificacion_fase3.md y traspaso_kiro.md.

## Backend Docker (desde raíz)

```powershell
docker build -f backend/Dockerfile -t manta-backend:local .
docker run --rm -p 8000:8000 --env API_KEY --env ROUTING_STRATEGY=pro manta-backend:local
```

Definir API_KEY en la terminal o gestor de secretos antes; no escribir la clave en la imagen, Git, VITE_* o logs. El CMD sirve API con estado inicial; para una demo con avance usar el motor en el mismo contenedor:

```powershell
docker run --rm -p 8000:8000 --env API_KEY manta-backend:local python -m app.simulator.cli --host 0.0.0.0 --strategy pro --round all --seed 7
```

Un proceso y un worker; la CLI inicia su propio servidor y termina tras las rondas. Docker del backend ya existía y se conserva; el comando nuevo con --host fue implementado para exposición explícita. No se volvió a validar Docker durante este traspaso; las ejecuciones HTTP y tests se realizaron en Windows.

## Frontend y enrutamiento

Node 24 en el entorno de build. Servir dist/ como archivos estáticos. Compilar con VITE_DATA_SOURCE=api. Dos opciones:

- Mismo origen: VITE_API_BASE_URL=/api. El ingress debe proxificar solo GET /api/health, /api/mapa y /api/estado hacia los endpoints sin /api del backend. No proxificar /paso al dashboard.
- Dominio API distinto: VITE_API_BASE_URL=https://API-ELEGIDA, sin credenciales. Backend CORS_ORIGINS=https://FRONTEND-ELEGIDO (lista separada por comas si hay más). HTTPS en ambos. El frontend no lleva autenticación para las lecturas públicas.

BACKEND_PROXY_TARGET solo configura desarrollo; no afecta dist/. CORS no sustituye autenticación. POST /paso conserva x-api-key y debe limitarse al coordinador/consumidor autorizado mediante la infraestructura. Los GET /health, /mapa y /estado son públicos. No habilitar Access-Control-Allow-Origin * para secretos.

## Variables y operación

API_KEY obligatoria en backend. ROUTING_STRATEGY=pro; SEED=7; TURN_SECONDS=2; HTTP_CONCURRENCY=16. Ver .env.example y backend/config/pro.env.example para parámetros de Pro. Las variables no se cargan automáticamente desde ejemplos. CORS_ORIGINS vacío por defecto. MANTA_DATA_DIR apunta a datos locales; Docker lo fija en /service/data.

Memoria local: mundo, reservas, ocupación, decisiones e historial se pierden al reiniciar. No escalar a varios workers/réplicas sin persistencia transaccional y coordinador líder. No existe runId público para detectar reinicios en la misma ronda: recargar frontend al iniciar otro run. CLI es una demo finita; servicio de ejecución continua requiere un responsable explícito del ciclo de simulación. No agregar un bucle por GET.

Comprobar /health, contrato /paso, proxy/CORS, HTTPs, tiles OSM y diseño móvil después de configurar hosting. Esta configuración no fue desplegada ni probada en AWS. Capturas y revisión visual final pendientes según traspaso_kiro.md.


## Controles locales añadidos después del traspaso

El panel Pruebas de fuego utiliza app.dashboard_server, ligado exclusivamente a 127.0.0.1, y un proxy Vite que guarda la clave en su proceso. Es una herramienta local para esta revisión. No incluir /control en un ingress público sin autenticación/autorización de operadores, protección de origen y un proxy de servidor; no poner la clave en VITE_*. /paso sigue separado. Para AWS pueden mantenerse las lecturas públicas y el flujo CLI previo. Esta ampliación no modifica infra/ ni configura controles de producción.
