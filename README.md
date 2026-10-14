# Tracker Rojo Fuego

Página para seguir una partida de Pokémon Rojo Fuego desde el teléfono: equipo con IV, EV y
naturaleza, cajas del PC, Pokédex con cómo conseguir cada Pokémon, mochila y objetivos.

Este repo solo tiene la página. **No tiene datos de ninguna partida**: la página los lee de un
repo privado (`tracker/datos.json`, que genera el repo de saves con cada save nuevo) usando un
token de GitHub que cada uno pega en su teléfono. Sin ese token, la página no muestra nada.

| Archivo | Para qué |
|---|---|
| `index.html`, `estilos.css`, `app.js` | La página |
| `juego.json` | Datos del juego para el formulario de objetivos (de [PokeAPI](https://pokeapi.co)) |
| `sprites/` | Sprites de Rojo Fuego / Verde Hoja (de [PokeAPI/sprites](https://github.com/PokeAPI/sprites)) |
| `herramientas/construir.py` | Regenera `juego.json` y los íconos desde el repo de saves |

Pokémon y sus sprites son de Nintendo / Game Freak / The Pokémon Company. Proyecto personal sin fines de lucro.
