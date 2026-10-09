#!/usr/bin/env python3
"""Génère les trois visuels du dossier client à partir d'un JSON exporté du configurateur.

  python3 make_visuals.py <export.json> [dossier_sortie] [--decor "Noyer"] [--samples 96] [--plinthe 80]

Sortie (dans dossier_sortie, par défaut un dossier à côté du JSON) :
  img_demande.png   1200 x 1735
  img_ambiance.png  1600 x  867
  img_cotes.png     1050 x 2284
Nécessite Blender (/Applications/Blender.app) et Pillow ; aucune dépendance au configurateur.
"""
import os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    src = Path(args[0]).resolve()
    out = Path(args[1]).resolve() if len(args) > 1 and not args[1].startswith("--") else src.parent / (src.stem + "-visuels")
    extra = args[2:] if len(args) > 1 and not args[1].startswith("--") else args[1:]
    out.mkdir(parents=True, exist_ok=True)
    cmd = [BLENDER, "-b", "-P", str(HERE / "render_meuble.py"), "--", str(src), str(out)] + extra
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or "Rendus terminés" not in r.stdout:
        print(r.stdout[-2000:], r.stderr[-2000:])
        sys.exit("Échec du rendu Blender")
    if (out / "_cotes_base.png").exists():
        sys.path.insert(0, str(HERE))
        from annotate_cotes import annotate
        annotate(str(out))
    for n in ("img_demande.png", "img_ambiance.png", "img_cotes.png"):
        print(("OK  " if (out / n).exists() else "--  ") + str(out / n))


if __name__ == "__main__":
    main()
