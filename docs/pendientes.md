# Pendientes después de Fase 3

Implementados: predicción de corredores, asignación/reservas, cinco vehículos, encuentros dinámicos, mundo compartido Base/Pro, métricas y comparaciones HTTP. Consultar fase3.md, resultados_fase3.md y verificacion_fase3.md.

Quedan para revisión posterior:
- Ampliar validación estadística a más semillas y distribuciones. Los tres escenarios medidos no garantizan una mejora universal ni significancia estadística.
- Afinar despacho y puestos sin sobreajustar una semilla. V-005 no realizó entregas en la comparación principal; no se forzó su uso. Las cinco unidades sí pasan pruebas físicas de recogida/entrega y capacidad.
- Optimización conjunta de reservas, grupos y ventanas temporales; el min-cost flow actual asigna plazas y el despacho posterior usa una heurística acotada.
- Mejorar predicción temporal más allá de un turno y probar decisiones contra variantes de reglas aclaradas por el jurado.
- Revisar con el equipo local cobertura y anclas del mapa reducido, que puede omitir rutas alternativas.
- Integración React y CORS GET implementados. Queda revisión visual final en navegador, capturas y validación del despliegue por el responsable AWS. WebSockets no son necesarios para el polling actual.

Producción: persistir mundo/snapshots, reservas/ocupaciones, runId/roundId, decisiones e historial; implementar transacciones condicionales y elegir un único coordinador líder. No ejecutar varios workers con memoria local. El reset de experimentos no debe borrar historia compartida: debe cambiar de namespace.

AWS: recomendaciones técnicas en fase3.md. No se configuró infraestructura, no se desplegó, no se hizo push/merge. La misión de traspaso autoriza el frontend y sus correcciones; ver traspaso_kiro.md.
