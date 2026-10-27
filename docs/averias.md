# Averías temporales de furgonetas

En Pruebas de fuego activar Averías temporales de furgonetas. Cada tipo permite probabilidad 0–100 % y reparación de 1–30 turnos. Apagado por defecto para conservar las pruebas anteriores. Configuración inicial: caminante 25 % / 2 turnos; corredor 50 % / 3; horda 80 % / 5; dormido 35 % / 2. No cambia el número de vehículos ni su capacidad.

## Regla física común

Se aplica en World tanto para Base como para Pro si está activada. Contacto significa coincidir con un zombie en un nodo de llegada, permanecer detenido en un nodo ocupado, o cruzarse en sentidos opuestos por la misma calle física. Una horda cercana o un riesgo predicho no bastan. Se revisa cada microtramo del vehículo; una avería detiene el resto del movimiento de ese turno. No se sortea más de una vez por tipo, furgoneta y turno; si coinciden varios tipos, se evalúan horda, corredor, dormido y caminante hasta que uno provoque daño.

El sorteo usa semilla, ronda, ID de vehículo, turno y tipo. No consume el RNG de zombies ni depende del orden o sorteos de otros vehículos. Mismo escenario, semilla y configuración reproducen los incidentes. Los contactos con dormidos se resuelven en el motor físico; sus posiciones no se añaden a Observation ni a /estado. El planificador solo utiliza que el vehículo está inmovilizado, sin consultar los registros internos de contacto.

## Reparación y pasajeros

Una avería de D turnos en T publica AVERIADA con D restantes. Los D turnos siguientes quedan completamente inmovilizados: para D=2, T+1 publica 1 y T+2 publica 0/reparada, aún sin movimiento. El vehículo vuelve a planificar y puede moverse desde T+3. Los contactos no renuevan el temporizador mientras se repara. Tras recuperarse puede volver a averiarse si sufre un nuevo contacto.

No recoge ni descarga durante la avería. Se cancelan sus recogidas pendientes, se liberan esas asignaciones para otros vehículos y las personas vuelven a caminar; conservan la reserva de refugio mientras siga válida. Los pasajeros supervivientes permanecen a bordo, ocupan sus plazas y conservan sus reservas durante la reparación. El asignador descuenta esas plazas antes de repartir el resto. Al reparar se replanifica y puede cambiar el destino si corresponde.

La avería no añade blindaje ni reemplaza las colisiones existentes: un contacto que antes eliminaba pasajeros sigue haciéndolo, liberando sus reservas. Una avería no convierte ni elimina por sí misma al superviviente. La reparación avanza por turnos del simulador, no por un reloj independiente; si finaliza la ronda, el contador conserva el estado final.

## API y mapa

POST /control/iniciar acepta averias con activadas y caminante/corredor/horda/dormido, cada uno {probabilidad: 0..1, turnos: 1..30}. El modal muestra porcentajes y convierte a fracciones. Rechaza datos fuera de rango sin destruir el run actual. No cambia POST /paso ni su autenticación. El servidor de pruebas permanece local/protegido como antes.

VehicleView añade turnosReparacionRestantes, causaAveria y averiasSufridas. El mapa muestra el vehículo rojo, herramienta y contador Nt; tooltip y tarjeta seleccionada muestran AVERIADA, turnos restantes y segundos aproximados según segundosPorTurno. La interfaz no inventa un reloj local: actualiza desde el backend. Al reparar se retiran el distintivo y el contador. Los eventos averia_camioneta y camioneta_reparada aparecen en el registro. Las 25 métricas existentes se conservan.

Settings admite VEHICLE_BREAKDOWNS, BREAKDOWN_CHANCE_CAMINANTE/CORREDOR/HORDA/DORMIDO y REPAIR_TURNS_CAMINANTE/CORREDOR/HORDA/DORMIDO. Ver .env.example y backend/config/pro.env.example. El control local define estos valores por ejecución y no modifica archivos. Contratos regenerados en contracts/openapi.yaml y dashboard-control.openapi.yaml; tipos de lectura actualizados.

## Verificación

Pruebas en backend/tests/test_breakdowns.py: Base/Pro, probabilidades cero/uno, duración exacta, parada en microtramo, cruces por calle física, pasajeros/reservas, cancelación, aislamiento de dormidos, RNG independiente y validación del contrato. Pruebas existentes de flota y reservas se conservan.

Frontend: controles convierten porcentajes, adaptador conserva campos con respaldo para frames anteriores, contrato rechaza AVERIADA sin contador, tarjeta y distintivo se actualizan al reparar. Reportes breakdowns_backend_targeted.txt, breakdowns_backend_full.txt, breakdowns_frontend_tests.txt y breakdowns_build.txt.

El diagnóstico prepare_breakdown_diagnostic.py selecciona un caso con contacto reproducible para verificar el ciclo por HTTP real; no es un escenario puntuado ni se utiliza como entrada del planificador. check_breakdowns_live.py observa la inmovilización y reparación. La configuración del operador se guarda antes y se restaura tras la comprobación visual.

Resultados de esta implementación (2026-10-27): 93 pruebas del backend pasaron en la suite completa y una falló por el umbral HTTP de 500 ms en Pro. La repetición aislada también falló: primera ejecución con 2 errores HTTP y 3 solicitudes sobre 500 ms; segunda ejecución sin errores ni excesos. No se modificaron límites ni se afirma cumplimiento del SLA. Queda pendiente diagnosticar esta regresión de latencia.

Actualización posterior del 2026-10-27: la incidencia de latencia anterior quedó resuelta al declarar la dependencia `sniffio` que faltaba en el entorno, además de reducir trabajo y tareas innecesarias. La nueva suite completa pasó con 103 pruebas del backend y 36 del frontend, build aprobado y ninguna petición medida de Pro superior a 500 ms. Ver [diagnóstico y validación final](latencia_pro.md); los reportes anteriores se conservan como evidencia histórica del fallo.

Frontend: 36 pruebas aprobadas y build de producción correcto. Diagnóstico por HTTP real: contador 4→3→2→1→0, vehículo inmóvil durante reparación y dormidos ocultos en el estado público. Prueba funcional de 20 turnos con 200 supervivientes: una avería, una reparación y reservas válidas; esta comprobación usa ASGI y no acredita latencia TCP. Revisión visual real en navegador: reports/breakdowns_controls.jpg y reports/breakdowns_map.jpg muestran el modal y la tarjeta de avería en un escenario controlado.
