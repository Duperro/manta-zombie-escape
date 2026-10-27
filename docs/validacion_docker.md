# Validación Docker y entrega local — 27 de octubre de 2026

Rama de trabajo: `feat/docker-deployment`. No se crearon recursos AWS, no se
publicaron imágenes, no se hizo push ni merge. Los reportes por corrida permanecen
en `reports/`, ignorados por Git; este documento conserva únicamente el resumen.

## Entorno y alcance

- Windows con Docker Desktop, motor Linux 29.0.1 y Compose 2.40.3.
- Runtime del backend: Python 3.12.16 y **sniffio 1.3.1** comprobados dentro del contenedor.
- Nginx 1.30.6; compilación Node 24, solo dist en la imagen web final.
- Tres imágenes base fijadas por digest en los Dockerfile.
- Un proceso servidor, un worker y un coordinador; fases CPU secuenciales en un
  hilo del mismo proceso para no bloquear el bucle HTTP.
- Puerto público local: **127.0.0.1:8080**. Backend sin puerto publicado, solo red interna.
- Sin cambios de mapa, escenarios, velocidades, predicción, asignación ni física.

## Pruebas automatizadas finales

| Comprobación | Resultado |
| --- | --- |
| Backend completo, incluido TCP real | **111 aprobadas**, 1 advertencia de deprecación Starlette/AnyIO, sin fallos. |
| Cancelación/reinicio y disponibilidad durante CPU | Pruebas dirigidas aprobadas; la cancelación espera al escritor antes del reset. |
| Frontend Vitest | **38 aprobadas**. |
| Build frontend y verificación de bundle | Aprobados, sin marcadores de credenciales privadas. |
| Exportación y comparación OpenAPI | Aprobadas, sin cambios de contrato. |
| Compose build y up con espera de healthchecks | Ambos servicios healthy. |
| Nginx `-t` | Configuración válida. |

La suite backend incluye las tres rondas Base por TCP y dos ejecuciones Pro de
150 turnos, comparación de huellas/firmas e invariantes. No se desactivaron tests,
se relajaron aserciones ni se aumentó el plazo de 500 ms. Se deshabilitó únicamente
el plugin diagnóstico `faulthandler` en la ejecución local de Pytest.

## Aceptación real con contenedores

Ejecutada con `docker compose exec -T backend python -m app.evaluation.container_check`.
Utiliza el operador privado contra el mismo backend y atraviesa Nginx por TCP
para las lecturas y `/paso`; no crea otro mundo ni otro reloj.

| Caso | Resultado observado |
| --- | --- |
| `/health` interno y `/api/health` público | HTTP 200. |
| HTML, assets y ruta SPA | HTTP 200, assets sin el valor de la clave. |
| `/api/mapa` | 1.507 nodos y 3.319 aristas. |
| `/api/estado` | Turnos reales cambiantes; cinco furgonetas y cuatro refugios. |
| `/paso` con clave correcta | HTTP 200, solo `siguienteNodo`. |
| `/paso` sin clave o incorrecta | HTTP 401. |
| `/paso` con tipo de turno incorrecto | HTTP 422. |
| GET `/paso`, POST sobre lectura pública | HTTP 405. |
| Cuerpo mayor de 16 KiB | HTTP 413. |
| Controles públicos y debug | HTTP 404, incluso enviando la clave. |
| Controles internos sin clave | HTTP 401. |
| Estado final | Turno 150 retenido; el servidor sigue abierto. |
| Nueva ronda | runId nuevo, contador reiniciado y finalización de prueba breve sin reconstruir imágenes. |

### Ronda 3 real, Pro, semilla 7

150 turnos de dos segundos, **301,06 segundos** observados. No se utilizó `--fast`
ni se modificaron velocidades. Se revisaron estados y reservas durante la ronda;
el backend ejecuta sus invariantes después de cada turno.

| Métrica | Resultado |
| --- | ---: |
| Supervivientes iniciales | 200 |
| Evacuados | 158 (79 %) |
| Eliminados | 15 |
| Activos al finalizar | 27 |
| Vivos finales, incluidos los evacuados | 185 (92,5 %) |
| Evacuados caminando / en furgoneta | 143 / 15 |
| Rutas inválidas | 0 |
| Peticiones HTTP del coordinador | 7.704 |
| Errores / respuestas inválidas / peticiones >500 ms | 0 / 0 / 0 |
| HTTP interno p95 / p99 | 16,32 / 33,49 ms |

No confundir personas vivas con evacuadas; no se calcula una puntuación oficial.

### Sondeo externo al proceso del servidor, a través de Nginx

1.000 reintentos válidos/idempotentes del turno 0 y sondeos durante la ronda activa:
**1.292 peticiones**, concurrencia máxima 4 en el lote inicial, cero errores y cero
excesos de 500 ms. P95 **30,03 ms**, p99 **49,55 ms**, máximo **99,88 ms**. La espera
del semáforo queda fuera de la medición; el intercambio TCP y validación están
dentro. Son decisiones ya registradas, no otra planificación ni una carga de
200 decisiones nuevas en cada turno. Las métricas del reloj se informan aparte.

Son mediciones Docker Desktop locales; **no acreditan rendimiento ni SLA AWS**.

## Verificaciones de seguridad finales

- `/paso` probado también desde el host: 200 con clave y 401 con clave incorrecta.
- Backend sin bindings de puerto al host y conectado a una red `internal`.
- Ambos servicios con filesystem de solo lectura y usuarios sin privilegios.
- Un único proceso `app.container_server` observado en `/proc`.
- Frontend sin Node, node_modules, archivo .env ni secreto montado.
- El valor real de la clave no aparece en assets, metadatos/historial de imagen ni logs revisados.
- Ningún error crítico en los logs finales. Los 401/404/405/413 de pruebas negativas son deliberados.
- API_KEY se lee en el backend desde un archivo Compose; no está en `VITE_*`,
  build-args, código React, configuración pública ni Git.

El dashboard de producción es de lectura; su modal y la capa de dormidos de
depuración no están presentes. El administrador opera por Docker/SSH, que es la
capa adicional de autorización, además de la clave exigida por FastAPI.

La revisión real de navegador confirmó conexión al backend, turnos avanzando,
cinco furgonetas encontrables por el buscador y tarjetas seleccionadas dentro
del mapa. Tras corregir Referer cargó también el fondo de OSM. El fallback ante
fallo de tiles conserva calles y entidades y tiene una prueba Leaflet específica.
Captura final local: `reports/docker_dashboard_final_20261027.png`.

## Hallazgos corregidos durante la validación

1. El CMD original no avanzaba turnos. Se reutilizó el controlador persistente
   existente en un entrypoint para la interfaz privada del contenedor.
2. El primer Nginx intentaba escribir `fastcgi_temp` en el filesystem de solo
   lectura. Se dirigieron todos los temporales a `/tmp`, conservando la restricción.
3. La primera aceptación por proxy detectó timeouts externos mientras se calculaba
   un turno, aunque el cliente interno no fallaba. La corrección del coordinador
   separa CPU del bucle HTTP y drena la fase al cancelar. Se repitió la suite y la
   aceptación completa después de corregirlo; los fallos previos no se presentan
   como aprobaciones.
4. Windows bloqueó la reinstalación de una dependencia nativa mientras Vite seguía
   abierto. Se detuvo solo la vista previa identificada y se repitió la instalación.
5. La revisión de navegador detectó tiles OSM bloqueados. Se corrigió la política
   de Referer del proxy conforme a OSM y se añadió un fallback que retira la capa
   fallida, conservando el grafo real y las entidades. No se cambiaron los datos ni
   se descargaron tiles para empaquetarlos.

## Evidencias locales

`reports/docker_backend_final_20261027.txt`,
`docker_frontend_final_tests_20261027.txt`, `docker_frontend_final_build_20261027.txt`,
`docker_acceptance_20261027_2.json`, `docker_security_final_20261027.json` y logs
de build/arranque. Los intentos anteriores se conservan con nombres distintos.
Estos archivos no se publican en GitHub y no son necesarios para ejecutar el programa.

## Pendiente para AWS

Cuenta/sandbox, región, presupuesto aprobado, instancia, DNS, certificado/renovación
HTTPS, Security Groups y mediciones desde Internet. La guía
[aws-predeploy.md](aws-predeploy.md) entrega los pasos al responsable. No se afirmó
que HTTPS público, costos de una cuenta real o rendimiento EC2 estén validados.
No hay persistencia compartida ni escalado horizontal. Reiniciar el proceso pierde
el mundo; exportar al host antes de reiniciar o parar.

Para repetir las pruebas y operar: [docker-local.md](docker-local.md).
