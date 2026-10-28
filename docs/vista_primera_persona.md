# Vista "Seguir" en primera persona

Al hacer clic en un sobreviviente del mapa aparece **Seguir en primera persona**. Se abre una
vista 3D a la altura de sus ojos que avanza por las mismas calles y al mismo ritmo (2 s por
turno) que el mapa, con los mismos datos de `/estado`. No cambia el simulador ni `/paso`.

| Pieza | Archivo | Qué hace |
|---|---|---|
| Ciudad | `frontend/src/firstperson/city.ts` | Calles reales del grafo (OSM) con asfalto, veredas, bordillos y líneas; fachadas con ventanas, rejas y persianas; tinacos y varillas en techos; palmeras, alumbrado y mar |
| Apocalipsis | `frontend/src/firstperson/apocalypse.ts` | Autos abandonados, volcados y quemados, patrulleros con baliza, incendios con humo, escombros, basura, sangre, barricadas (también en calles bloqueadas) y ceniza |
| Infectados | `frontend/src/firstperson/infected.ts` | Figuras humanas delgadas (diseño propio) con rodillas y codos, piel y ropa con textura, ojos hundidos |
| Brazos | `frontend/src/firstperson/arms.ts` | Brazos en primera persona que se balancean al correr; linterna en la mano derecha |
| Motor | `frontend/src/firstperson/engine.ts` | Cámara, movimiento continuo entre turnos, minimapa, HUD y caída al ser mordido |
| Vista | `frontend/src/firstperson/FirstPersonView.tsx` | Pantalla completa, HUD (refugio, zombie más cercano, turno) y fin (a salvo / no lo logró) |
| Carga | `frontend/src/components/LoadingScreen.tsx` | Pantalla inicial que descarga la vista 3D y los datos de la ciudad antes de mostrar el panel |

**Tecnología:** [three.js](https://threejs.org) (WebGL). Se descarga aparte (~140 KB gzip) solo
para la vista 3D, así que el panel principal no pesa más. Funciona en cualquier navegador con
WebGL (Chrome, Edge, Firefox, Safari; también en celular).

**Realismo sin 4K:** noche del 31 de octubre con niebla, luna y linterna. Las luces de la
calle son "falsas" (halo + charco de luz en el suelo), así que se ve creíble con muy pocos
recursos. Los infectados tienen rodillas y codos: el caminante cojea y arrastra un pie, el
corredor esprinta inclinado y las hordas son grupos con un anillo rojo (zona bloqueada).

**Movimiento sin saltos:** cada turno se encadena al anterior desde la posición visual actual y
dura lo mismo que el intervalo real entre turnos. Si el sobreviviente avanza más de una calle,
se reconstruye el camino por el grafo. El simulador mueve una calle (50–150 m) cada 2 s, que a
pie tomaría 20–40 s: por eso el HUD indica **"Cámara rápida ×N"**.

**Minimapa** (arriba a la derecha): norte arriba, ~260 m alrededor; calles (bloqueadas en rojo),
ruta planificada, refugios y zombies; la flecha es hacia donde mira el sobreviviente.

## Edificios reales de Manta (recomendado)

Por defecto los edificios son procedurales (casas de 1–3 pisos con colores de la costa y torres
solo cerca del malecón). Para usar las **huellas y alturas reales de OpenStreetMap**:

```bash
cd backend
python scripts/fetch_manta_city.py          # descarga edificios + línea de costa
```

Genera `frontend/public/manta/ciudad.json`. Súbanlo al repo y reconstruyan el frontend; la vista
lo detecta sola. Si su red bloquea Overpass: `python scripts/fetch_manta_city.py --consulta`,
pegar la consulta en https://overpass-turbo.eu, exportar *raw OSM data* y luego
`python scripts/fetch_manta_city.py --archivo export.json`.

## Límites conocidos

- Figuras low-poly hechas con código (sin modelos descargados ni licencias de terceros).
- Sin la costa real, el mar es una aproximación (calle más al norte ±1,2 km).
- Los dormidos no se ven hasta despertar, igual que para el algoritmo.
