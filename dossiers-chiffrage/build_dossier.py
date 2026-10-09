#!/usr/bin/env python3
"""Dossier client Kōbō (A3 paysage, 5 pages) généré à partir d'un JSON de demande.

  python3 build_dossier.py <demande.json> [--client "Sanaa"] [--prix "1 850"] [--decor "Noyer"]
                           [--sortie dossier.pdf] [--skip-render] [--samples 48]

1. rend les 3 visuels 3D (render/make_visuals.py, Blender, GPU) — sauf --skip-render si déjà faits ;
2. rédige le contenu (demande, esquisse, points à confirmer, conditions) à partir du JSON ;
3. compose le PDF avec la mise en page du dossier « Sanaa » (positions relevées dans le PDF d'origine),
   via Chrome headless.
Aucun prix n'est calculé : « [prix] € HT » reste en place, sauf --prix.
"""
import html, json, math, re, subprocess, sys, textwrap, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
sys.path.insert(0, str(HERE / "render"))

NOMBRES = {1: "Une", 2: "Deux", 3: "Trois", 4: "Quatre", 5: "Cinq", 6: "Six", 7: "Sept", 8: "Huit", 9: "Neuf", 10: "Dix",
           11: "Onze", 12: "Douze", 13: "Treize", 14: "Quatorze", 15: "Quinze", 16: "Seize"}
DECORS_CONNUS = {1: ("Noyer", "Noyer, décor Lorenzo Walnut")}  # matId -> (libellé, texte client)
PLINTHE = 80


def nombre(n, f=False):
    w = NOMBRES.get(n, str(n))
    return w.lower() if f else w


def lignes(texte, largeur):
    return textwrap.wrap(texte, largeur, break_long_words=False)


# ───────────────────────────── lecture du JSON ─────────────────────────────
def lire(path):
    from spec_loader import load_spec  # même lecture que le rendu (caisson principal + caissons latéraux)
    return load_spec(str(path))


def analyse(cfg, decor_opt=None):
    cais = cfg["_caissons"]
    spec0 = cfg["_spec"]
    ep = spec0.get("panel_thickness_mm", 18)
    D = spec0["overall_mm"]["depth"]
    W = max(ox + sp["overall_mm"]["width"] for ox, sp in cais)
    H = max(sp["overall_mm"]["height"] for _, sp in cais)
    portes = sum(len(sp.get("doors", [])) for _, sp in cais)
    tiroirs = sum(len(sp.get("drawers", [])) for _, sp in cais)
    etageres = sum(len(sp.get("shelves", [])) for _, sp in cais)
    tringles = sum(len(sp.get("bars", [])) for _, sp in cais)
    comp = 0
    for _, sp in cais:
        comp += len(sp.get("separators", [])) + 1
    meuble = cfg.get("meuble") or {}
    mat_id = meuble.get("matId", cfg.get("matId"))
    label = decor_opt or meuble.get("matLabel") or cfg.get("matLabel") or (spec0.get("materials") or {}).get("material_body") or "Chêne"
    decor_txt, decor_connu = (DECORS_CONNUS[mat_id][1], True) if mat_id in DECORS_CONNUS and not decor_opt else (label, False)

    # compartiments sans aménagement > 1 m (A2)
    grands = []
    for ox, sp in cais:
        iH = sp["overall_mm"]["height"] - 2 * ep
        coupes = [0, iH]
        for s in sp.get("shelves", []):
            coupes += [s["y_bottom_mm"] - ep, s["y_top_mm"] - ep]
        for d in sp.get("drawers", []):
            coupes += [d["y_bottom_mm"] - ep, d["y_bottom_mm"] - ep + d["height_mm"]]
        for b in sp.get("bars", []):
            coupes += [b["y_center_mm"] - ep, b["y_center_mm"] - ep]
        coupes = sorted(set(coupes))
        for a, b in zip(coupes, coupes[1:]):
            if b - a > 1000 and not sp.get("bars"):
                grands.append(b - a)
    return dict(W=W, H=H, D=D, portes=portes, tiroirs=tiroirs, etageres=etageres, tringles=tringles, comp=comp,
                label=label, decor_txt=decor_txt, decor_connu=decor_connu, grands=grands, cais=cais,
                nb_cais=len(cais), tv=cfg.get("furniture_type") == "tv", side=cfg.get("tvSide") or {})


# ───────────────────────────── rédaction (règles du §7.1 de la spec) ─────────────────────────────
def redige(a, client, prix):
    portes, tiroirs, comp = a["portes"], a["tiroirs"], a["comp"]
    colonne = a["H"] >= 1800 and a["W"] <= 1500 and a["nb_cais"] == 1
    if portes and tiroirs: genre = "à portes et tiroirs"
    elif portes: genre = "à portes"
    elif tiroirs: genre = "à tiroirs"
    else: genre = "ouvert"
    if a["nb_cais"] == 1 and colonne: genre += ", type colonne"
    facades = []
    if portes: facades.append("%d porte%s" % (portes, "s" if portes > 1 else ""))
    if tiroirs: facades.append("%d tiroir%s" % (tiroirs, "s" if tiroirs > 1 else ""))
    dim = "H %d × L %d × P %d mm" % (a["H"], a["W"], a["D"])
    ht = a["H"] + PLINTHE

    if a["nb_cais"] > 1:
        b2 = "– %d caissons%s" % (a["nb_cais"], (", " + ", ".join(facades)) if facades else "")
    else:
        b2 = "– %d compartiment%s%s" % (comp, "s" if comp > 1 else "", (", " + ", ".join(facades)) if facades else "")
    demande_bullets = ["– Meuble sur mesure " + genre, b2, "– " + dim, "– " + a["decor_txt"]]
    demande_bullets = [b if len(b) <= 46 else b[:45].rsplit(",", 1)[0] for b in demande_bullets]   # ≤ 46 car. (gabarit)
    amb = []
    if portes: amb.append("des portes encastrées")
    if tiroirs: amb.append("des tiroirs")
    if a["etageres"]: amb.append("des étagères")
    if a["tringles"]: amb.append("%s tringle%s de penderie" % (nombre(a["tringles"], True), "s" if a["tringles"] > 1 else ""))
    amb_txt = amb[0] if len(amb) == 1 else (", ".join(amb[:-1]) + " et " + amb[-1]) if amb else "un aménagement ouvert"
    demande_par = ["Une esquisse vous est proposée ci-après."] + lignes(
        "Elle répond à ce programme, avec %s, une plinthe de %d mm sur pieds réglables et une fixation murale." % (amb_txt, PLINTHE), 42)

    if portes and tiroirs: titre = "Meuble à portes et tiroirs"
    elif portes: titre = "Meuble à portes encastrées"
    elif tiroirs: titre = "Meuble à tiroirs"
    else: titre = "Meuble ouvert"
    esq_b1 = "– " + ("%d caissons côte à côte, %d compartiments" % (a["nb_cais"], comp) if a["nb_cais"] > 1 else ("Type colonne, " if colonne else "") + "%d compartiment%s" % (comp, "s" if comp > 1 else ""))
    esq_b2 = "– " + dim
    esq_note = "hauteur totale plinthe comprise : %d mm" % ht
    esq_b3 = "– " + a["decor_txt"]
    esq_b4 = "– " + (", ".join(facades) + ", " if facades else "") + "plinthe %d mm sur pieds réglables" % PLINTHE
    if portes:
        phrase = "%s porte%s encastrée%s%s, sans poignée imposée." % (nombre(portes), "s" if portes > 1 else "", "s" if portes > 1 else "",
                 (" et %d tiroir%s" % (tiroirs, "s" if tiroirs > 1 else "")) if tiroirs else "")
    elif tiroirs:
        phrase = "%s tiroir%s, sans poignée imposée." % (nombre(tiroirs), "s" if tiroirs > 1 else "")
    else:
        phrase = "Meuble ouvert, sans façade."
    fixation = "Le meuble est fixé au mur contre le basculement."
    esq_par = lignes(phrase + " " + fixation, 42)

    # points à confirmer (alertes « client » A1, A2, A6, A8 + hauteur + mur)
    items = []
    if a["tv"] and not (a["side"].get("left") or a["side"].get("right") or a["side"].get("top")) and not a["etageres"]:
        items.append("Emplacement du téléviseur : dimensions de l'écran, position, appareils à loger, passage de câbles.")
    for g in sorted(set(a["grands"])):
        items.append("Aménagement du compartiment (%d mm de haut) : étagères, tiroirs, penderie ou autre." % g)
    if portes + tiroirs:
        n = portes + tiroirs
        items.append("Poignées ou ouverture par pression pour %s." % ("les %s façades" % nombre(n, True) if n > 1 else "la façade"))
    if not a["decor_connu"]:
        items.append("Finition %s : pouvez-vous nous confirmer le décor souhaité ?" % a["label"].lower())
    items.append("Hauteur totale : %d mm plinthe comprise, ou %d mm plinthe incluse (caisson réduit de %d mm)." % (ht, a["H"], PLINTHE))
    items.append("Nature du mur, pour le choix des chevilles de fixation.")
    confirmer = []
    for i, it in enumerate(items, 1):
        txt = "%d. %s" % (i, it)
        confirmer.append(lignes(txt, 58)[:2] if len(lignes(txt, 58)) > 2 else lignes(txt, 58))
    n = len(items)
    note = "Ces %s points nous permettent de finaliser le dessin avant fabrication." % NOMBRES.get(n, str(n)).lower()
    note_lignes = lignes(note, 36)

    return dict(client=client, titre="Meuble sur mesure", demande_bullets=demande_bullets, demande_par=demande_par,
                esq_titre=titre, esq_b1=esq_b1, esq_b2=esq_b2, esq_note=esq_note, esq_b3=esq_b3, esq_b4=esq_b4, esq_par=esq_par,
                prix=prix, confirmer=confirmer, confirmer_note=note_lignes)


# ───────────────────────────── mise en page (positions du PDF Sanaa, en pt) ─────────────────────────────
CSS = """
@font-face{font-family:Pop;font-weight:300;src:url('gabarit/fonts/Poppins-Light.ttf')}
@font-face{font-family:Pop;font-weight:400;src:url('gabarit/fonts/Poppins-Regular.ttf')}
@font-face{font-family:Pop;font-weight:700;src:url('gabarit/fonts/Poppins-Bold.ttf')}
@page{size:1190.55pt 841.89pt;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff}
.p{width:1190.55pt;height:841.89pt;position:relative;overflow:hidden;page-break-after:always;font-family:Pop,sans-serif;color:#231a20;background:#fff}
.p:last-child{page-break-after:auto}
.t{position:absolute;white-space:pre;font-weight:300;font-size:20pt;line-height:28pt}
.r{font-weight:400}.b{font-weight:700}.g{color:#6b6b6b}.R{text-align:right}.C{text-align:center}
.t b{font-weight:400}
.pied{position:absolute;left:0;top:802pt;width:1190.6pt;height:39.9pt}
.img{position:absolute;display:block}
.h{position:absolute;background:#d8d8d8;width:1.2pt}
"""


def T(x, y, txt, cls="", size=None, w=None, right=None):
    st = "top:%spt;" % y
    if right is not None: st += "right:%spt;" % (1190.55 - right)
    elif w is not None: st += "left:%spt;width:%spt;" % (x, w)
    else: st += "left:%spt;" % x
    if size: st += "font-size:%spt;line-height:%spt;" % (size, round(size * 1.4, 1))
    return '<div class="t %s" style="%s">%s</div>' % (cls, st, txt)


def page_html(pages_dir, d):
    e = html.escape
    def gras(s): return re.sub(r"&lt;b&gt;(.*?)&lt;/b&gt;", r"<b>\1</b>", e(s))
    pied = '<img class="pied" src="gabarit/pied-kobo.png">'
    out = []
    # 1 · couverture
    out.append('<div class="p">' + pied + '<div class="h" style="left:604pt;top:150pt;height:340pt;background:#231a20"></div>'
               + T(45, 176, e(d["titre"]), "b", 40) + T(0, 260, e(d["client"]), "", 20, right=600)
               + T(45, 322, "Étude de conception · Kōbō Design", "g", 13) + "</div>")
    # 2 · demande
    ys = [472, 496, 520, 544]
    s = pied + T(0, 30, "DEMANDE", "b", right=1154) + T(36, 432, "Votre projet", "r")
    s += "".join(T(36, y, e(t)) for y, t in zip(ys, d["demande_bullets"]))
    s += "".join(T(36, 594 + 24 * i, e(t)) for i, t in enumerate(d["demande_par"][:5]))
    s += '<img class="img" src="%s/img_demande.png" style="left:660pt;top:70pt;width:505pt;height:730.1pt">' % pages_dir
    out.append('<div class="p">' + s + "</div>")
    # 3 · esquisse
    s = pied + T(0, 30, "ESQUISSE", "b", right=1154)
    s += '<img class="img" src="%s/img_ambiance.png" style="left:30pt;top:30pt;width:735pt;height:398.3pt">' % pages_dir
    s += '<img class="img" src="%s/img_cotes.png" style="left:850pt;top:60pt;width:340pt;height:739.6pt">' % pages_dir
    s += T(51, 428, e(d["esq_titre"]), "r") + T(51, 468, e(d["esq_b1"])) + T(51, 492, e(d["esq_b2"]))
    s += T(65, 518, e(d["esq_note"]), "g", 15) + T(51, 536, e(d["esq_b3"])) + T(51, 560, e(d["esq_b4"]))
    s += "".join(T(51, 604 + 24 * i, gras(t)) for i, t in enumerate(d["esq_par"][:5]))
    s += T(0, 736, e(d["prix"]) + " € HT", "r C", 24, w=1190.55)
    s += T(0, 774, "Prix HT, hors livraison · meuble livré prêt à monter", "g C", 13, w=1190.55)
    out.append('<div class="p">' + s + "</div>")
    # 4 · à confirmer
    s = pied + T(0, 30, "À CONFIRMER", "b", right=1154) + T(51, 180, "Points à confirmer avec vous", "r")
    s += '<div class="h" style="left:760pt;top:180pt;height:400pt"></div>'
    y = 230
    for item in d["confirmer"]:
        for i, l in enumerate(item): s += T(51, y + 24 * i, e(l))
        y += 24 * len(item) + 18
    s += T(820, 180, "Kōbō Design", "r") + "".join(T(820, 228 + 23 * i, e(l), "g", 17) for i, l in enumerate(d["confirmer_note"]))
    out.append('<div class="p">' + s + "</div>")
    # 5 · conditions
    s = pied + T(0, 30, "CONDITIONS", "b", right=1154) + T(51, 180, "Conditions commerciales", "r")
    s += '<div class="h" style="left:760pt;top:180pt;height:400pt"></div>'
    cond = [(230, "Prix en euros HT, hors livraison. Fixation murale prévue."),
            (272, "Meuble livré prêt à monter, accompagné d'une notice illustrée et"),
            (296, "d'une vidéo de pose. Montage sans outillage spécifique."),
            (338, "Le coût de livraison sera confirmé dès communication du lieu de"), (362, "destination."),
            (404, "Délai de fabrication : 3 semaines à réception de l'acompte."), (432, "Solde avant envoi. Validité de l'offre : 30 jours.")]
    s += "".join(T(51, y, e(t)) for y, t in cond)
    droite = ["Mobilier sur mesure conçu, dessiné et", "fabriqué en France."]
    droite2 = ["Nous restons à votre disposition pour", "ajuster les dimensions, le nombre de", "compartiments ou la finition."]
    s += T(820, 180, "Kōbō Design", "r")
    s += "".join(T(820, 228 + 23 * i, e(t), "g", 17) for i, t in enumerate(droite))
    s += "".join(T(820, 297 + 23 * i, e(t), "g", 17) for i, t in enumerate(droite2))
    out.append('<div class="p">' + s + "</div>")
    return "<!doctype html><meta charset='utf-8'><title>%s – %s</title><style>%s</style>%s" % (e(d["titre"]), e(d["client"]), CSS, "".join(out))


def main():
    a = sys.argv[1:]
    if not a or a[0].startswith("-"):
        sys.exit(__doc__)
    src = Path(a[0]).resolve()
    opt = {"client": "[client]", "prix": "[prix]", "decor": None, "sortie": None, "samples": "48"}
    skip = False
    i = 1
    while i < len(a):
        if a[i] == "--skip-render": skip = True; i += 1
        else: opt[a[i].lstrip("-")] = a[i + 1]; i += 2
    out_pdf = Path(opt["sortie"]).resolve() if opt["sortie"] else src.with_name("dossier-" + src.stem + ".pdf")
    vis = src.with_name(src.stem + "-visuels")
    t0 = time.time()
    if not skip or not (vis / "img_cotes.png").exists():
        cmd = [sys.executable, str(HERE / "render" / "make_visuals.py"), str(src), str(vis), "--samples", opt["samples"]]
        if opt["decor"]: cmd += ["--decor", opt["decor"]]
        r = subprocess.run(cmd, capture_output=True, text=True)
        print(r.stdout[-600:])
        if r.returncode != 0: sys.exit("Échec du rendu : " + r.stderr[-800:])
    print("Rendus : %.0f s" % (time.time() - t0))
    cfg = lire(src)
    d = redige(analyse(cfg, opt["decor"]), opt["client"], opt["prix"])
    (src.with_name(src.stem + "-donnees.json")).write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    page = HERE / ("_dossier_%s.html" % src.stem)
    page.write_text(page_html(str(vis), d), encoding="utf-8")
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
                        "--print-to-pdf=" + str(out_pdf), "file://" + str(page)], capture_output=True, text=True)
    page.unlink(missing_ok=True)
    if not out_pdf.exists(): sys.exit("PDF non généré : " + r.stderr[-500:])
    print("Dossier : %s  (%.0f s au total)" % (out_pdf, time.time() - t0))


if __name__ == "__main__":
    main()
