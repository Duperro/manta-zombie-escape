# Preparación EC2: entrega al responsable AWS

**No se creó una cuenta, recurso, certificado ni despliegue AWS durante esta
fase.** Este documento es un procedimiento futuro. La región, cuenta/sandbox,
dominio, permisos y presupuesto deben confirmarse con el responsable antes de
ejecutarlo. Fecha objetivo comunicada: 28 de octubre de 2026, 10:00 a. m., Ecuador.

La entrega Docker se prepara en `feat/docker-deployment`; no se publica ni integra
en `main` sin autorización. Antes de clonar para AWS, integrar y publicar la
versión aprobada y anotar su SHA. No desplegar un `main` anterior sin Compose.

## 1. Cuenta, acceso y presupuesto

1. Confirmar cuenta AWS o sandbox y qué servicios/regiones permite. El sandbox
   puede limitar tipo de instancia, IAM, duración y direcciones públicas.
2. Proteger la cuenta con MFA y usar identidad/rol autorizado; no crear claves
   de acceso root ni poner credenciales AWS en este repositorio.
3. Acordar región con el equipo. **Pendiente de confirmación.** `us-east-1` se usa
   abajo solo como supuesto de costos, no como decisión del proyecto.
4. Configurar AWS Budget de costos, por ejemplo USD 10 para la prueba breve, con
   alertas reales al 50/80/100 % y pronóstico al 100 %, al correo del responsable.
   Confirmar la suscripción si corresponde. Un Budget avisa y no impone por sí
   solo un límite duro ni detiene inmediatamente una instancia.
5. Acordar hora de apagado y responsable. No asumir Free Tier ni créditos gratis.

Referencia: [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

## 2. Instancia y estimación explícita

Propuesta inicial para validar: **Ubuntu Server 24.04 LTS oficial de Canonical,
x86_64, EC2 t3.medium (2 vCPU, 4 GiB), EBS gp3 de 20 GB cifrado**. La RAM da margen
para compilar Node 24 y ejecutar Docker junto al backend. No es un dimensionamiento
probado en EC2. t3.small tiene menos margen al construir imágenes. No usar varias
réplicas para compensar CPU: el estado es local y tiene un coordinador.

Ejemplo de presupuesto, Linux On-Demand en `us-east-1`, sin descuentos ni impuestos:

| Concepto | Supuesto unitario | 730 horas/mes |
| --- | --- | ---: |
| t3.medium | USD 0,0416/h | USD 30,37 |
| Una IPv4 pública | USD 0,005/h | USD 3,65 |
| 20 GB gp3 | USD 0,08/GB-mes, rendimiento base | USD 1,60 |
| Total ilustrativo | Sin transferencia, DNS, dominio, snapshots ni extras | **USD 35,62** |

Un día con esos supuestos ronda USD 1,17. Revisar precios actuales de la región
elegida en [Pricing Calculator](https://calculator.aws/) antes de crear recursos.
El almacenamiento y otros recursos retenidos pueden seguir cobrando tras apagar
EC2. Las IPv4 y Elastic IP deben revisarse y liberarse al finalizar si no se usan.
T3 es burstable: vigilar créditos y decidir Standard/Unlimited; Unlimited puede
añadir cargos y Standard puede limitar CPU al agotar créditos.

Fuentes oficiales: [T3](https://aws.amazon.com/ec2/instance-types/t3/),
[tabla de referencia de instancias](https://docs.aws.amazon.com/prescriptive-guidance/latest/optimize-costs-microsoft-workloads/right-size-selection.html),
[IPv4 pública](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/),
[EBS](https://aws.amazon.com/ebs/pricing/),
[créditos T3](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html).

## 3. Lanzamiento y red — solo por el responsable autorizado

Elegir VPC/subred con ruta a Internet si se necesita una URL pública y confirmar
la AMI oficial. Exigir IMDSv2. Usar clave SSH privada protegida o un mecanismo de
acceso administrado aprobado. No copiar secretos de otros compañeros.

Security Group propuesto:

| Puerto | Origen | Motivo |
| --- | --- | --- |
| 22/TCP | Solo IP administrativa `/32` | SSH; no abrir al mundo. |
| 80/TCP | Internet | Validación ACME y redirección a HTTPS. |
| 443/TCP | Internet o rango del jurado | Dashboard y POST /paso sobre TLS. |
| 8000 y 8080 | **Sin regla de entrada** | Backend privado y proxy local. |

No depender solo de UFW para puertos publicados por Docker. Compose deja Nginx
ligado a 127.0.0.1:8080 y no publica el backend. El Nginx del host termina TLS y
reenvía a ese puerto local. No cambiar `WEB_BIND` a 0.0.0.0 para solucionar HTTPS.

## 4. Docker Engine y Compose Plugin en Ubuntu limpio

Seguir el [procedimiento oficial](https://docs.docker.com/engine/install/ubuntu/)
si la AMI tiene paquetes previos o una versión distinta. Para Ubuntu 24.04 limpio:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

El grupo `docker` equivale prácticamente a acceso root. No añadir usuarios sin
necesidad; los ejemplos usan `sudo`. Confirmar hora del sistema y espacio libre.

## 5. Descargar la versión aprobada y preparar el secreto

```bash
git clone --branch main https://github.com/Duperro/manta-zombie-escape.git
cd manta-zombie-escape
git rev-parse HEAD
test -f compose.yaml || exit 1
test -f .env || cp .env.docker.example .env
mkdir -p .secrets
chmod 700 .secrets
if [ ! -f .secrets/api_key ]; then
  (umask 077; set -C; openssl rand -hex 32 > .secrets/api_key)
fi
```

Confirmar que el SHA coincide con el aprobado. Si el repositorio es privado,
configurar acceso de solo lectura mediante el mecanismo autorizado del equipo;
no incluir tokens en la URL de clonación ni en logs. La clave de la aplicación
no es una credencial AWS. No requiere contratar una API externa.

El usuario backend del contenedor tiene UID 1000. El archivo secreto debe ser
legible por ese UID; Ubuntu normalmente asigna UID 1000 al primer usuario.
Si difiere, ajustar propietario/ACL del archivo con el administrador. No hacer
la clave pública ni guardar su valor en `.env`, Git o un build-arg. Mantener copia
privada de recuperación según el procedimiento del equipo.

## 6. Construir y comprobar localmente en EC2

```bash
sudo docker compose config --quiet
sudo docker compose build
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=100
curl --fail http://127.0.0.1:8080/api/health
sudo docker compose exec -T backend python -m app.operator start --round 1
```

Esperar servicios healthy. No ejecutar CLI, otro Uvicorn, `--scale backend=2` ni
varios workers. Un reinicio de proceso pierde el mundo en memoria; un reinicio
de ronda reutiliza el proceso y conserva el servicio HTTP. No hay DynamoDB,
sesiones compartidas ni failover. Ver [docker-local.md](docker-local.md).

Antes de HTTPS se puede revisar privadamente mediante túnel SSH:

```bash
ssh -L 8080:127.0.0.1:8080 ubuntu@IP_EC2
```

Abrir 127.0.0.1:8080 en la computadora del operador. Ese túnel no constituye una
URL HTTPS pública para el jurado.

## 7. Dominio y HTTPS — requisito pendiente

Este procedimiento requiere un dominio/subdominio controlado por el equipo,
registro A hacia la IP pública y un certificado válido. Si cambia la IP, actualizar
DNS. Sin dominio/certificado confirmado **no está listo el despliegue público
seguro**. No presentar un certificado autofirmado como equivalente a uno confiable.

Una opción de terminación TLS es Nginx del host más Certbot. No forma un tercer
servicio Compose ni cambia los contenedores. Con DNS y Security Group listos:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/manta > /dev/null <<'NGINX'
server {
    listen 80;
    server_name dashboard.example.org;
    client_max_body_size 16k;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 3s;
        proxy_read_timeout 15s;
    }
}
NGINX
```

Sustituir `dashboard.example.org` por el dominio real antes de continuar:

```bash
sudo ln -s /etc/nginx/sites-available/manta /etc/nginx/sites-enabled/manta
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d dashboard.example.org --redirect
sudo certbot renew --dry-run
```

Revisar el [asistente oficial de Certbot](https://certbot.eff.org/instructions)
para el SO seleccionado. Confirmar renovación automática y vencimiento. Solo
después de probar HTTPS considerar HSTS. Nginx no conoce ni inyecta API_KEY.
No publicar una ruta alternativa hacia `/control` ni `/control/dormidos`.

## 8. Operación privada y aceptación desde Internet

El administrador entra por SSH y usa:

```bash
sudo docker compose exec -T backend python -m app.operator status
sudo docker compose exec -T backend python -m app.operator start --round 3
```

El dashboard público observa; no muestra el modal de inicio ni la capa de dormidos.
Para configurar averías o cantidades usar `start --config -` por stdin, como
indica la guía local. Ninguna clave llega al código React.

Desde una computadora externa comprobar:

1. HTTPS válido y redirección de HTTP; dashboard y tiles OSM.
2. `/api/health`, `/api/mapa` y `/api/estado`, con turnos que cambian realmente.
3. `/api/control/*`, `/control*`, `/docs` y `/openapi.json` bloqueados.
4. `/paso` con contrato obligatorio, 401 sin clave/clave errónea y 200 con clave,
   actor, nodo y turno compatibles. El cliente autorizado proporciona la clave;
   transportarla solo por HTTPS y no ponerla en argumentos públicos ni capturas.
5. Tres rondas completas: iniciar 1, 2 y 3 por el operador, esperar 150 turnos y
   exportar cada resultado antes de iniciar la siguiente. Tercera: 200 personas.
6. Cuatro refugios, cinco camionetas, rutas y ocupación cambiantes; estado final
   retenido y nueva ronda sin reconstruir contenedores.
7. Métricas reales de EC2: latencia por HTTPS, errores, CPU, RAM, créditos y logs.
   Los resultados de Docker Desktop no equivalen a resultados AWS.

La prueba incorporada `app.evaluation.container_check` valida contenedores y
Nginx por la red Docker. **No sustituye** esta prueba desde Internet ni acredita
certificado, Security Groups o latencia externa.

## 9. Monitoreo, reportes y cierre

```bash
sudo docker compose ps
sudo docker compose logs --tail=100
sudo docker stats --no-stream
df -h
free -m
```

En CloudWatch revisar CPUUtilization, créditos de CPU y status checks. La métrica
de RAM requiere agente/otra instrumentación; no afirmar que CloudWatch la mide
sin configurarlo. Revisar rotación de logs, disco y renovación TLS.

Exportar al host antes de reiniciar/parar, sin sobrescribir:

```bash
stamp=$(date -u +%Y%m%dT%H%M%S)
(set -C; sudo docker compose exec -T backend python -m app.operator export > "reports/ec2-$stamp.json")
(set -C; sudo docker compose logs --no-color > "reports/ec2-$stamp.log")
sudo docker compose restart
```

Para actualizar, detener/exportar, descargar la versión aprobada sin pisar cambios
locales y usar `sudo docker compose up -d --build`. Después iniciar otra ronda.
Para finalizar: exportar, `sudo docker compose down` y detener o terminar EC2 desde
la cuenta autorizada. Revisar EBS, snapshots, IPv4/Elastic IP, DNS y recursos
retenidos; detener contenedores por sí solo no detiene cobros de la instancia.
No borrar reportes ni secretos como parte de una limpieza automática.

## Ficha que debe devolver el compañero AWS

- Cuenta/sandbox y responsable, sin credenciales.
- Región confirmada, AMI, tipo de instancia y modo de créditos.
- SHA desplegado y digests de imágenes.
- Dominio, URL HTTPS del dashboard y **URL HTTPS exacta `/paso`** para el jurado.
- Certificado, renovación y reglas de red verificadas.
- Resultados de las tres rondas y latencia externa, separados de Docker local.
- CPU/RAM/disco observados y presupuesto/costos con fecha.
- Hora de cierre, recursos retenidos y responsable de detenerlos.

Hasta completar esa ficha, cuenta, región, DNS, TLS y mediciones AWS quedan
pendientes. No se añadió infraestructura ni se ejecutó ningún comando AWS.
