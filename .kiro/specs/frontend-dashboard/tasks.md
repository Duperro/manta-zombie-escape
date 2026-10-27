# Tareas del traspaso — estado verificable

Los originales de Kiro se conservan en archive/. Cada cierre debe referenciar resultados en docs/traspaso_kiro.md; no se marca aprobada una verificación visual que no pudo ejecutarse.

- [x] T1 Auditar backend y conservar su implementación: 66 pruebas de línea base aprobadas.
- [x] T2 Corregir requisitos/diseño de camionetas, estados, métricas y disponibilidad.
- [x] T3 Crear frontend React/TS/Vite respetando proveedores y adaptadores de Kiro; dependencias y lockfile.
- [x] T4 Implementar mapa, geometrías, capas, rutas, riesgo y selección sobre Leaflet.
- [x] T5 Implementar paneles de entidades, cinco camionetas, refugios y 25 métricas.
- [x] T6 Implementar polling con cache, cleanup, generation y reconexión sin fallback demo.
- [x] T7 Implementar reproducción demo local, etiquetada y separada del modo real.
- [x] T8 Implementar CORS explícito para GET y host configurable en el simulador, sin cambiar /paso.
- [x] T9 Ejecutar build/TypeScript y pruebas unitarias/RTL iniciales; corregir fallos encontrados.
- [x] T10 Cerrar evidencia de integración HTTP de las tres rondas y los checks finales: 68 backend, 20 frontend y build aprobados; reports/handoff_frontend_live.json.
- [x] T11 Completar documentación de entrega AWS y matriz de resolución de hallazgos.
- [ ] T12 Revisión visual final en navegador: tiles, móvil, disposición y capturas. Bloqueada en este turno porque Computer Use terminó al no poder verificar la URL de Windows; no se intenta eludir ese bloqueo.

- [x] T13 Panel local de pruebas de fuego autorizado posteriormente: configuración/inicio/reinicio reales, autenticación en proxy de servidor, runId, 72 tests backend/25 frontend y aceptación HTTP real. Ver docs/pruebas_fuego.md.
