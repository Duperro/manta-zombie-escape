# Inicio rápido para compañeros

Esta guía ejecuta el dashboard y el simulador completo en cada computadora.

Alternativa sin instalar Python ni Node en el host: [Docker Compose](docker-local.md).
Ese modo usa un dashboard público de lectura y comandos privados del operador;
el modal descrito aquí corresponde al desarrollo local con Vite.
No necesita XAMPP, una base de datos ni AWS. Cada computadora mantiene su propia
ejecución en memoria. El mapa vial está incluido; las imágenes del mapa de fondo
requieren Internet.

## Requisitos

- Git y acceso al repositorio.
- Python 3.12 (también compatible con 3.11).
- Node.js 24 y npm.
- Puertos locales 8000 y 5173 disponibles.

## Descargar la versión integrada

```shell
git clone --branch main https://github.com/Duperro/manta-zombie-escape.git
cd manta-zombie-escape
```

Si el repositorio es privado, GitHub solicitará acceso mediante la autenticación
de Git instalada en la computadora.

## Windows: instalar una vez

En PowerShell, desde la carpeta principal del proyecto:

```powershell
py -3.12 -m venv backend/.venv312
cd backend
.\.venv312\Scripts\python.exe -m pip install -e ".[test]"
cd ..\frontend
npm.cmd ci
cd ..
```

No copiar entornos virtuales ni `node_modules` de otra computadora. Esta
instalación incluye `sniffio`, necesario para evitar la regresión de latencia
documentada en [latencia_pro.md](latencia_pro.md).

## Windows: iniciar en dos terminales

Terminal 1, desde la carpeta principal del proyecto:

```powershell
cd backend
$env:API_KEY='mi-clave-local'
$env:ROUTING_STRATEGY='pro'
.\.venv312\Scripts\python.exe -m app.dashboard_server
```

Esperar a que responda <http://127.0.0.1:8000/health> con `"status": "ok"`.
El arranque inicial puede tardar mientras se prepara el mapa y la planificación.

Terminal 2, desde la carpeta principal del proyecto:

```powershell
cd frontend
$env:API_KEY='mi-clave-local'
$env:VITE_DATA_SOURCE='api'
npm.cmd run dev
```

Cada compañero puede elegir su propia clave local. Debe ser la misma en ambas
terminales de su computadora; no debe publicarse ni llamarse `VITE_API_KEY`.
Las variables se definen de nuevo al abrir terminales nuevas. Copiar
`.env.example` no carga automáticamente las variables del backend.

Abrir **<http://127.0.0.1:5173>** y dejar ambas terminales abiertas.

## Linux y macOS

Con Python 3.12 y Node 24 instalados, desde la carpeta principal:

```bash
python3.12 -m venv backend/.venv312
cd backend
.venv312/bin/python -m pip install -e '.[test]'
cd ../frontend
npm ci
cd ..
```

Terminal 1, desde la carpeta principal:

```bash
cd backend
export API_KEY='mi-clave-local'
export ROUTING_STRATEGY=pro
.venv312/bin/python -m app.dashboard_server
```

Terminal 2, desde la carpeta principal:

```bash
cd frontend
export API_KEY='mi-clave-local'
export VITE_DATA_SOURCE=api
npm run dev
```

Usar la misma clave en ambas terminales y abrir la misma dirección del dashboard.
La validación local documentada del proyecto se realizó en Windows; estos
comandos usan las rutas estándar de entornos virtuales en Linux/macOS.

## Utilizar el dashboard

1. Abrir **Pruebas de fuego**.
2. Elegir ronda, supervivientes, zombies, turnos, semilla y estrategia.
3. Elegir **Pro** para observar recogidas y transporte en furgonetas.
4. Opcionalmente activar las averías y configurar probabilidades y reparación.
5. Pulsar **Iniciar** o **Reiniciar**. Reiniciar reemplaza la ejecución actual.
6. Seleccionar elementos en el mapa para consultar sus tarjetas.

La capa de dormidos es una opción local de depuración: visualizarla no entrega
sus posiciones ocultas al algoritmo. Una furgoneta averiada muestra el contador
de reparación. La semilla permite repetir el escenario con la misma configuración.

Al terminar una ronda, el servidor sigue abierto y permite iniciar otra.
Para cerrar, pulsar **Ctrl+C en ambas terminales**. Al cerrar el backend se pierde
el estado de la ejecución. En el siguiente uso solo repetir los comandos de
arranque; no hace falta reinstalar las dependencias en cada inicio.

## Actualizar una instalación

Detener los servidores. Desde la carpeta principal de una copia sin cambios
locales pendientes:

```shell
git switch main
git pull --ff-only origin main
```

Repetir la instalación de dependencias del backend y `npm ci`, y volver a iniciar
ambos servidores. No hace falta volver a crear un entorno virtual ya existente.

## Solución de problemas

| Síntoma | Comprobación |
| --- | --- |
| No reconoce `py`, Python, Node o npm | Instalar los requisitos y abrir otra terminal. |
| Dashboard desconectado o error 502 | Esperar el arranque y comprobar `/health` en el puerto 8000. |
| Error 401 o controles no disponibles | Definir la misma `API_KEY` en las dos terminales y reiniciar ambos servidores. |
| Puerto ocupado | Detener la otra instancia antes de iniciar esta. Usar 8000 y 5173. |
| Se muestra una demostración | Definir `VITE_DATA_SOURCE=api` y reiniciar el frontend. |
| No aparecen las imágenes de fondo | Comprobar Internet; el grafo vial local sigue incluido. |

Usar `app.dashboard_server` para el modal de pruebas. No ejecutar a la vez la CLI
ni otro Uvicorn en el puerto 8000. El archivo histórico `app/main.py` no es la
entrada de esta versión. `npm run build` verifica la compilación; para estos
controles locales se utiliza `npm run dev`.

## Reportes y verificación

Los resultados y capturas de corridas se generan localmente en `reports/` y están
excluidos de Git. Solo se incluyen las guías README de ese directorio. Los
resúmenes y comandos reproducibles están en `docs/`; no se necesita descargar
reportes para ejecutar el programa.

Validación de la entrega previa en Windows: 103 pruebas del backend y 36 del frontend aprobadas,
build correcto y dos ejecuciones de Pro por TCP sin errores ni peticiones mayores
de 500 ms. Detalles y límites en [latencia_pro.md](latencia_pro.md).
La validación posterior de Compose se resume en [validacion_docker.md](validacion_docker.md).
