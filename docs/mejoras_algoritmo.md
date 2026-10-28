# Mejoras del motor (rama `prueba`)

Resumen de los cambios hechos sobre `main` (fd55c87), por qué se hicieron y cómo se midieron.
Todas las pruebas usan las mismas condiciones iniciales (misma semilla = mismos zombies,
sobrevivientes y eventos) y la estrategia **Pro**.

## 1. Diagnóstico: ¿dónde mueren los sobrevivientes?

En la ronda 3 (semillas 11 y 23) se revisó cada mordida en el momento de la decisión:

- Prácticamente todas son `coincidencia_nodo` **sin ninguna salida segura**: el sobreviviente
  estaba en un nodo con 1 o 2 salidas (callejón o pasillo) y un zombie llegó a su nodo.
  Quedarse = mordida; salir por la calle por donde vino el zombie = cruce opuesto.
- Casi siempre el zombie es un **corredor** (detecta a 3 nodos y corre 2 por turno).
- Unos pocos casos fueron dormidos invisibles (inevitables con la información disponible).

Conclusión: el problema no es elegir mal en el último segundo, sino **entrar** en
callejones y pasillos cuando hay zombies cerca.

## 2. Cambios en el algoritmo

| Cambio | Archivo | Idea |
|---|---|---|
| Riesgo de **trampa** | `backend/app/routing/threats.py` | Nodos con ≤2 salidas al alcance de un zombie (caminante 2, corredor 5, horda 1 saltos) suman riesgo al costo de la ruta. Callejón (1 salida) pesa más que pasillo (2). |
| Zonas **verificadas** sin dormidos | `backend/app/routing/threats.py` | Un dormido despierta si alguien pasa a ≤2 nodos. Todo lo que ya recorrió algún sobreviviente sin despertar a nadie es seguro; lo no explorado tiene un costo pequeño. Solo usa información observable. |
| Integración | `risk_routes.py`, `strategies.py` | `RiskRoutes` suma `risk_weight × penalización` al costo de entrar a cada nodo. Se activa con `PRO_THREATS=true` (por defecto). |
| Desatascar (opcional) | `backend/app/routing/unstick.py` | Ruta "blanda" que trata a los zombies como costo alto en vez de muro, para quien quedó sin camino. **Desactivado por defecto** (`PRO_UNSTICK=false`): ver resultados. |

Probado y descartado: penalizar a los vecinos de los caminantes según la paridad del turno
(se mueven en turnos pares) aumentó las mordidas en las semillas probadas (7 y 11).

## 3. Resultados (ronda 3, 200 sobrevivientes, 5 semillas)

Eliminados (menos es mejor):

| Semilla | Antes | Trampa + dormidos (activo) | Trampa + desatascar |
|---:|---:|---:|---:|
| 7 | 15 | 15 | 20 |
| 11 | 17 | 17 | 32 |
| 23 | 17 | 18 | 16 |
| 31 | 16 | 15 | 34 |
| 42 | 24 | 21 | 27 |
| **Total** | **89** | **86** | 129 |

- La versión activa reduce las mordidas un ~3 % y mantiene los evacuados (824 → 823).
- "Desatascar" evacúa más personas (sus rutas existen) pero las acerca a zombies y las
  mordidas suben ~45 %. Como la supervivencia vale 50 % de la nota y la evacuación no
  suma directamente, queda apagado.

## 4. Tiempos de espera

| Antes | Ahora | Motivo |
|---|---|---|
| Cálculo de turno p50 ≈ 150 ms (ronda 3) | ≈ 65 ms | El grafo transitable se reconstruía 4 veces por turno; ahora se reutiliza mientras no cambien los bloqueos. El chequeo de "cruce" pasó de recorrer todas las calles × todos los zombies a una búsqueda en conjunto. Resultados idénticos (misma semilla → mismo final). |
| `HTTP_CONCURRENCY=4` (cola de ~450 ms en ronda 3) | 16 | Menos espera de las 200 llamadas a `/paso` por turno. |
| Mapa web consulta `/estado` cada 1 s | cada 0,5 s | El mapa refleja el turno nuevo antes. |

## 5. Rúbrica calculada

`metricas` ahora incluye `eficienciaPromedio` (turnos mínimos sin zombies ÷ turnos usados,
por evacuado), `tasaFallosEndpoint` y `notaRondaEstimada` (0–10 con 50/20/15/15).
`python -m app.evaluation.compare` calcula la **nota total de la prueba de fuego** con la
supervivencia ponderada R1×1, R2×2, R3×3.

## 6. Cómo repetir las pruebas

```bash
cd backend
API_KEY=x python -m app.evaluation.compare --seeds 7 11 23 --rounds 1 2 3
PRO_THREATS=false API_KEY=x python -m app.simulator.cli --strategy pro --round 3 --fast --seed 7
```

## 7. Eventos de ciudad

Turnos del enunciado (en `data/scenarios`): ronda 2, colapso de un puente en el turno 75;
ronda 3, bloqueo de una calle en el turno 50 y de una avenida entre los turnos 90 y 120.

- **Bloqueo de calle/avenida:** se aplica al inicio del turno; desde ese turno nadie la usa.
- **Colapso de puente:** ocurre mientras la gente se mueve. Quien cruzaba el puente en ese
  turno (a pie o en camioneta) cae y queda eliminado con causa `colapso_puente` (evento
  `caida_puente`). Los zombies no se ven afectados. En el mapa de Manta cada puente es un
  único tramo entre dos intersecciones, así que solo cae quien lo estaba cruzando justo en
  ese turno; quien espera en un extremo está en tierra firme.
- En ambos casos la arista desaparece del mapa en vivo, se borran las rutas planificadas y
  todas se recalculan; el panel muestra un aviso durante 15 turnos.
