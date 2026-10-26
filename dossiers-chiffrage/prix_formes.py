#!/usr/bin/env python3
"""Prix d'un meuble en formes libres, même calcul que l'admin (surface réelle, découpe sur tout le périmètre, chant réel).

  python3 prix_formes.py fichier.json [--m2 50] [--decoupe 1.5] [--chant 4.5] [--coef 2]

--m2 : prix du panneau au m² (celui de « Matériaux & Prix » dans l'admin). Le cintrage n'est pas encore chiffré.
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "render"))
import formes


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__); return
    opt = {"m2": 50.0, "decoupe": 1.5, "chant": 4.5, "coef": 2.0}
    i = 1
    while i < len(a):
        opt[a[i].lstrip("-")] = float(a[i + 1]); i += 2
    cfg = json.load(open(a[0], encoding="utf-8"))
    S = ML = CML = 0.0
    print("%-46s %9s %9s %9s %10s" % ("Pièce", "m²", "découpe m", "chant m", "coût €"))
    for f in cfg.get("formes_libres") or []:
        for p in f.get("pieces", []):
            if p.get("prix") is False: continue
            s = formes.stats(p)
            cout = s["surface_m2"] * opt["m2"] + s["perimetre_m"] * opt["decoupe"] + s["chant_m"] * opt["chant"]
            S += s["surface_m2"]; ML += s["perimetre_m"]; CML += s["chant_m"]
            print("%-46s %9.3f %9.2f %9.2f %10.2f%s" % ((p["nom"] + " (" + f["nom"] + ")")[:46], s["surface_m2"], s["perimetre_m"], s["chant_m"], cout, "  cintré" if p.get("cintre") else ""))
    cout = S * opt["m2"] + ML * opt["decoupe"] + CML * opt["chant"]
    # quincaillerie et usinages (mêmes prix que l'admin) d'après le bloc "quincaillerie" du JSON
    qc = cfg.get("quincaillerie") or {}
    a, t, c = qc.get("angles", 0), qc.get("tiroirs", 0), qc.get("charnieres", 0)
    lignes = [("Usinage des angles", a, 10), ("Vis", a * 4, 0.5), ("Tourillons", a * 4, 0.3), ("Coulisses de tiroirs", t, 10), ("Kits tiroirs", t, 75),
              ("Usinage charnières", c * 2, 1.75), ("Charnières", c, 10)]
    print("-" * 90)
    for nom, n, pu in lignes:
        if n:
            print("%-46s %9s %9s %9s %10.2f" % (nom + " x%g" % n, "", "", "", n * pu)); cout += n * pu
    print("Total : %.3f m² · découpe %.2f m · chant %.2f m" % (S, ML, CML))
    print("Coût de fabrication : %.2f € · Prix de vente HT (x%g) : %.2f €" % (cout, opt["coef"], cout * opt["coef"]))
    print("(cintrage / usinage spécial non compté)")


if __name__ == "__main__":
    main()
