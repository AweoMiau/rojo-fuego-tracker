#!/usr/bin/env python3
"""Arma juego.json y los íconos de la app a partir de los datos del repo de saves.

Uso:
    python herramientas/construir.py RUTA_AL_REPO_DE_SAVES

juego.json es lo que usa el formulario de objetivos: especies con los movimientos que
aprenden en Rojo Fuego, movimientos, objetos, MT y naturalezas. Son datos públicos de
PokeAPI; nada de la partida.
"""

import json
import sys
from pathlib import Path

from PIL import Image

SITIO = Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    datos = json.loads((Path(sys.argv[1]) / "datos" / "rojo_fuego.json").read_text(encoding="utf-8"))

    mt_por_movimiento = {str(v["mov"]): v["nombre"] for v in datos["mt"].values()}
    juego = {
        "especies": {
            num: {
                "nombre": e["nombre"],
                "tipos": e["tipos"],
                "viene_de": e["viene_de"],
                "aprende": e["aprende"],
            }
            for num, e in datos["especies"].items()
        },
        "movimientos": datos["movimientos"],
        "mt": mt_por_movimiento,
        "objetos": sorted(set(datos["objetos"].values())),
        "naturalezas": datos["naturalezas"],
    }
    salida = SITIO / "juego.json"
    salida.write_text(json.dumps(juego, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Listo: %s (%d KB)" % (salida.name, salida.stat().st_size // 1024))

    # Íconos: el sprite de Charizard ampliado sin suavizar, sobre el rojo de la app.
    sprite = Image.open(SITIO / "sprites" / "6.png").convert("RGBA")
    caja = sprite.getbbox()
    sprite = sprite.crop(caja)
    for tam, nombre in ((180, "apple-touch-icon.png"), (192, "icono-192.png"), (512, "icono-512.png")):
        icono = Image.new("RGBA", (tam, tam), (207, 58, 46, 255))
        escala = max(1, int(tam * 0.78) // max(sprite.size))
        grande = sprite.resize((sprite.width * escala, sprite.height * escala), Image.NEAREST)
        icono.alpha_composite(grande, ((tam - grande.width) // 2, (tam - grande.height) // 2))
        icono.convert("RGB").save(SITIO / nombre)
    print("Listo: íconos")


if __name__ == "__main__":
    main()
