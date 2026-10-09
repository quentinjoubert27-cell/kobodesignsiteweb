#!/usr/bin/env python3
"""Rendus rapides pour le devis : meuble fermé + portes et tiroirs ouverts (≈ 1 min par meuble).

  python3 rendus.py                 -> traite tous les .json du dossier ~/Desktop/A-traiter (ceux pas encore faits)
  python3 rendus.py fichier.json    -> traite ce fichier

Produit, à côté du JSON : <nom>-rendu-ferme.png et <nom>-rendu-ouvert.png
(les mots « ferme » / « ouvert » dans le nom permettent à l'admin de les ranger tout seul dans le PDF du devis).
"""
import os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOSSIER = Path.home() / "Desktop" / "A-traiter"
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")


def traiter(js):
    out_f, out_o = js.with_name(js.stem + "-rendu-ferme.png"), js.with_name(js.stem + "-rendu-ouvert.png")
    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([BLENDER, "-b", "-P", str(HERE / "render" / "render_meuble.py"), "--", str(js), tmp, "--only", "pair", "--samples", "40"],
                           capture_output=True, text=True)
        if not (Path(tmp) / "rendu-ouvert.png").exists():
            print("ÉCHEC", js.name, r.stdout[-600:], r.stderr[-600:]); return False
        shutil.move(str(Path(tmp) / "rendu-ferme.png"), out_f); shutil.move(str(Path(tmp) / "rendu-ouvert.png"), out_o)
    print("OK  %s  (%.0f s)" % (js.name, time.time() - t0))
    return True


def main():
    args = [Path(a).expanduser().resolve() for a in sys.argv[1:]]
    if not args:
        DOSSIER.mkdir(exist_ok=True)
        args = [j for j in sorted(DOSSIER.glob("*.json")) if not (j.with_name(j.stem + "-rendu-ouvert.png")).exists()]
    if not args:
        print("Rien à traiter : dépose un fichier .json dans", DOSSIER); return
    for js in args:
        traiter(js)


if __name__ == "__main__":
    main()
