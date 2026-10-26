"""Formes libres : meubles faits de panneaux plats découpés (plaques) et de panneaux cintrés (rubans), en mm.

Repère (le même que le rendu Blender) : x = largeur (gauche -> droite), y = profondeur (0 = façade, D = fond), z = hauteur depuis le sol.

Un meuble en formes libres est une liste de pièces, chacune de l'un des deux types :
  plaque : un contour plan quelconque (liste de points [x, y, z], dans un même plan), épaissi de `ep` mm
           perpendiculairement à son plan. Dessus incliné, côté en biais, côté à coins arrondis, fond trapézoïdal…
  ruban  : un panneau cintré (ou un panneau droit en biais) : un chemin 2D `chemin` (suite de points [u, v], une courbe
           est découpée en petits segments), étiré sur l'axe `axe` ('x', 'y' ou 'z') entre `de` et `a`, d'épaisseur `ep`.
           axe 'z' : chemin dans le plan (x, y) ; axe 'x' : chemin dans (y, z) ; axe 'y' : chemin dans (x, z).

Chaque pièce porte `nom`, `ep` (19 mm par défaut), `chants` ('tous', 'aucun' ou la liste des numéros de côtés du contour),
`cat` ('struct' ou 'facade') et `cintre` (True pour un panneau courbé : ce qui servira plus tard à chiffrer le cintrage).

Ce fichier ne dépend pas de Blender : il sert au rendu, aux contrôles et à générer des JSON d'essai.
"""
import json, math, sys

EP = 19.0


# ───────────────────────────── géométrie ─────────────────────────────
def _sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def _cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def _norm(v):
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return [v[0] / n, v[1] / n, v[2] / n]
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def arc(cx, cy, r, a0, a1, n=24):
    """Points d'un arc de cercle (angles en degrés), n segments."""
    return [[cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))] for i in range(n + 1)]


def arc_fleche(x0, x1, y_ref, fleche, n=24):
    """Arc de la façade bombée : de x0 à x1 (cordes), `fleche` mm de saillie au milieu. y = y_ref aux extrémités et y_ref - fleche au milieu."""
    W = x1 - x0
    if fleche <= 0: return [[x0, y_ref], [x1, y_ref]]
    R = (W * W / 4.0 + fleche * fleche) / (2.0 * fleche)
    xc = (x0 + x1) / 2.0
    pts = []
    for i in range(n + 1):
        x = x0 + W * i / n
        dx = x - xc
        pts.append([x, y_ref - fleche + (R - math.sqrt(max(0.0, R * R - dx * dx)))])
    return pts


def contour_ruban(piece):
    """Contour fermé (2D) d'un ruban : le chemin, puis le chemin décalé de `ep` du côté choisi (sens 1 = à gauche du sens de parcours)."""
    ch = piece["chemin"]; ep = piece.get("ep", EP); sens = piece.get("sens", 1)
    n = len(ch); off = []
    for i, p in enumerate(ch):
        a = ch[max(0, i - 1)]; b = ch[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / l * sens, tx / l * sens
        off.append([p[0] + nx * ep, p[1] + ny * ep])
    return [list(p) for p in ch] + [list(p) for p in reversed(off)]


def points3d_ruban(piece, niveau):
    """Contour du ruban placé dans l'espace, à la cote `niveau` de son axe."""
    c = contour_ruban(piece); ax = piece["axe"]
    if ax == "z": return [[u, v, niveau] for u, v in c]
    if ax == "x": return [[niveau, u, v] for u, v in c]
    return [[u, niveau, v] for u, v in c]


def vecteur_extrusion(piece):
    """(points de départ 3D, vecteur d'extrusion) : à extruder pour obtenir le volume de la pièce."""
    if piece["type"] == "ruban":
        de, a = piece["de"], piece["a"]
        pts = points3d_ruban(piece, de)
        v = {"x": [a - de, 0, 0], "y": [0, a - de, 0], "z": [0, 0, a - de]}[piece["axe"]]
        return pts, v
    pts = piece["points"]
    n = _norm(_cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0])))
    ep = piece.get("ep", EP) * piece.get("sens", 1)
    return pts, [n[0] * ep, n[1] * ep, n[2] * ep]


def aire_polygone_3d(pts):
    s = [0.0, 0.0, 0.0]
    for i in range(len(pts)):
        c = _cross(pts[i], pts[(i + 1) % len(pts)])
        s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]]
    return math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2) / 2.0


def stats(piece):
    """Surface (m²), périmètre (m), longueur de chant (m) d'une pièce, comme le calcul de prix."""
    ep = piece.get("ep", EP)
    if piece["type"] == "ruban":
        ch = piece["chemin"]
        L = sum(math.hypot(ch[i + 1][0] - ch[i][0], ch[i + 1][1] - ch[i][1]) for i in range(len(ch) - 1))
        h = piece["a"] - piece["de"]
        surf = L * h / 1e6
        aretes = [L, h, L, h]          # dessus et dessous du ruban (longueur développée), deux tranches d'extrémité
        perim = 2 * (L + h)
        chants = {"tous": perim, "aucun": 0.0}
        sel = piece.get("chants", "tous")
        mm = chants[sel] if isinstance(sel, str) else sum(aretes[i] for i in sel if i < 4)
        return {"surface_m2": surf, "perimetre_m": perim / 1000, "chant_m": mm / 1000, "developpee_mm": L}
    pts = piece["points"]
    surf = aire_polygone_3d(pts) / 1e6
    segs = [math.sqrt(sum(d * d for d in _sub(pts[(i + 1) % len(pts)], pts[i]))) for i in range(len(pts))]
    perim = sum(segs)
    sel = piece.get("chants", "tous")
    mm = perim if sel == "tous" else (0.0 if sel == "aucun" else sum(segs[i] for i in sel if i < len(segs)))
    return {"surface_m2": surf, "perimetre_m": perim / 1000, "chant_m": mm / 1000}


def bbox(pieces):
    xs, ys, zs = [], [], []
    for p in pieces:
        if p.get("visible") is False: continue
        pts, v = vecteur_extrusion(p)
        for q in pts + [[q[0] + v[0], q[1] + v[1], q[2] + v[2]] for q in pts]:
            xs.append(q[0]); ys.append(q[1]); zs.append(q[2])
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def toutes_pieces(cfg, seulement_prix=False):
    out = []
    for f in cfg.get("formes_libres") or []:
        out += [p for p in f.get("pieces", []) if not (seulement_prix and p.get("prix") is False)]
    return out


# ───────────────────────────── fabricants de pièces ─────────────────────────────
def plaque(nom, pts, vers, ep=EP, chants="tous", cat="struct", cintre=False, visible=True, prix=True, decor=None):
    """Plaque dont l'épaisseur est dirigée du côté de `vers` (vecteur approximatif, ex. (0, 0, -1) = vers le bas)."""
    n = _norm(_cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0])))
    sens = 1 if _dot(n, vers) >= 0 else -1
    d = {"type": "plaque", "nom": nom, "points": [[round(c, 2) for c in p] for p in pts], "ep": ep, "sens": sens, "chants": chants, "cat": cat, "cintre": cintre}
    if not visible: d["visible"] = False
    if not prix: d["prix"] = False
    if decor: d["decor"] = decor
    return d


def ruban(nom, axe, chemin, de, a, ep=EP, sens=1, chants="tous", cat="facade", cintre=True, decor=None):
    d = {"type": "ruban", "nom": nom, "axe": axe, "chemin": [[round(c, 2) for c in p] for p in chemin], "de": de, "a": a, "ep": ep, "sens": sens, "chants": chants, "cat": cat, "cintre": cintre}
    if decor: d["decor"] = decor
    return d


def _forme(nom, pieces, **extra):
    d = {"nom": nom, "pieces": pieces}; d.update(extra); return d


# ───────────────────────────── formes de départ ─────────────────────────────
def caisson_dessus_incline(x0, W, Hg, Hd, D, z0=0, ep=EP, nom="Caisson dessus incliné"):
    """Caisson à dessus incliné : hauteur Hg côté gauche, Hd côté droit (mm)."""
    zl, zr = z0 + Hg, z0 + Hd
    P = [
        plaque("Côté gauche", [[x0, 0, z0], [x0, D, z0], [x0, D, zl], [x0, 0, zl]], (1, 0, 0), ep),
        plaque("Côté droit", [[x0 + W, 0, z0], [x0 + W, D, z0], [x0 + W, D, zr], [x0 + W, 0, zr]], (-1, 0, 0), ep),
        plaque("Dessous", [[x0 + ep, 0, z0], [x0 + W - ep, 0, z0], [x0 + W - ep, D, z0], [x0 + ep, D, z0]], (0, 0, 1), ep),
        plaque("Dessus incliné", [[x0, 0, zl], [x0 + W, 0, zr], [x0 + W, D, zr], [x0, D, zl]], (0, 0, -1), ep, cintre=False),
        plaque("Fond", [[x0 + ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, zr - ep], [x0 + ep, D - 8, zl - ep]], (0, 1, 0), 8, chants="aucun"),
    ]
    return _forme(nom, P, type="dessus_incline", params={"x0": x0, "W": W, "Hg": Hg, "Hd": Hd, "D": D, "z0": z0})


def caisson_biais(x0, W, H, D, decalage, z0=0, ep=EP, nom="Caisson à côtés en biais"):
    """Caisson dont les côtés penchent : le haut est décalé de `decalage` mm vers la droite (négatif = vers la gauche)."""
    xb, xt = x0, x0 + decalage
    P = [
        plaque("Côté gauche (biais)", [[xb, 0, z0], [xb, D, z0], [xt, D, z0 + H], [xt, 0, z0 + H]], (1, 0, 0), ep),
        plaque("Côté droit (biais)", [[xb + W, 0, z0], [xb + W, D, z0], [xt + W, D, z0 + H], [xt + W, 0, z0 + H]], (-1, 0, 0), ep),
        plaque("Dessous", [[xb + ep, 0, z0], [xb + W - ep, 0, z0], [xb + W - ep, D, z0], [xb + ep, D, z0]], (0, 0, 1), ep),
        plaque("Dessus", [[xt, 0, z0 + H], [xt + W, 0, z0 + H], [xt + W, D, z0 + H], [xt, D, z0 + H]], (0, 0, -1), ep),
        plaque("Fond", [[xb, D - 8, z0], [xb + W, D - 8, z0], [xt + W, D - 8, z0 + H], [xt, D - 8, z0 + H]], (0, 1, 0), 8, chants="aucun"),
    ]
    return _forme(nom, P, type="biais", params={"x0": x0, "W": W, "H": H, "D": D, "decalage": decalage, "z0": z0})


def caisson_facade_courbe(x0, W, H, D, fleche, z0=0, ep=EP, nom="Caisson façade courbe"):
    """Caisson dont la façade est bombée de `fleche` mm vers l'avant (au milieu)."""
    front = arc_fleche(x0, x0 + W, fleche, fleche)      # y de la face avant : `fleche` aux extrémités, 0 au milieu
    cont = [[p[0], p[1]] for p in front] + [[x0 + W, D], [x0, D]]
    haut = [[x, y, z0 + H - ep] for x, y in cont]
    bas = [[x, y, z0] for x, y in cont]
    P = [
        plaque("Dessous", bas, (0, 0, 1), ep),
        plaque("Dessus", [[x, y, z0 + H] for x, y in cont], (0, 0, -1), ep),
        plaque("Côté gauche", [[x0, fleche, z0], [x0, D, z0], [x0, D, z0 + H], [x0, fleche, z0 + H]], (1, 0, 0), ep),
        plaque("Côté droit", [[x0 + W, fleche, z0], [x0 + W, D, z0], [x0 + W, D, z0 + H], [x0 + W, fleche, z0 + H]], (-1, 0, 0), ep),
        plaque("Fond", [[x0 + ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, z0 + H - ep], [x0 + ep, D - 8, z0 + H - ep]], (0, 1, 0), 8, chants="aucun"),
        ruban("Façade courbe", "z", front, z0 + ep, z0 + H - ep, ep, sens=1, cat="facade"),
    ]
    return _forme(nom, P, type="facade_courbe", params={"x0": x0, "W": W, "H": H, "D": D, "fleche": fleche, "z0": z0})


def caisson_coins_arrondis(x0, W, H, D, rayon, z0=0, ep=EP, nom="Caisson coins arrondis"):
    """Côtés (vue de profil) aux coins avant arrondis de rayon `rayon` mm ; dessus et dessous raccourcis d'autant, façade droite."""
    def profil():
        pts = [[D, 0]]                                   # (y, z) : fond bas
        pts += [[D, H]]                                  # fond haut
        pts += [[p[0], p[1]] for p in arc(rayon, H - rayon, rayon, 90, 180, 12)]   # coin avant haut
        pts += [[p[0], p[1]] for p in arc(rayon, rayon, rayon, 180, 270, 12)]      # coin avant bas
        return pts
    prof = profil()
    P = [
        plaque("Côté gauche", [[x0, y, z0 + z] for y, z in prof], (1, 0, 0), ep, cintre=True),
        plaque("Côté droit", [[x0 + W, y, z0 + z] for y, z in prof], (-1, 0, 0), ep, cintre=True),
        plaque("Dessous", [[x0 + ep, rayon, z0], [x0 + W - ep, rayon, z0], [x0 + W - ep, D, z0], [x0 + ep, D, z0]], (0, 0, 1), ep),
        plaque("Dessus", [[x0 + ep, rayon, z0 + H], [x0 + W - ep, rayon, z0 + H], [x0 + W - ep, D, z0 + H], [x0 + ep, D, z0 + H]], (0, 0, -1), ep),
        plaque("Fond", [[x0 + ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, z0 + ep], [x0 + W - ep, D - 8, z0 + H - ep], [x0 + ep, D - 8, z0 + H - ep]], (0, 1, 0), 8, chants="aucun"),
    ]
    return _forme(nom, P, type="coins_arrondis", params={"x0": x0, "W": W, "H": H, "D": D, "rayon": rayon, "z0": z0})



def placard_sous_pente(D=550, ep=EP, nom="Placard sous pente"):
    """Placard sur toute la largeur d'un mur à rampant : 1900 mm, hauteur 1387 mm à gauche et 2144 mm à droite, 5 colonnes,
    cache-radiateur à lames et 3 tiroirs en bas (relevé d'un plan coté). Profondeur D à confirmer."""
    W, Hg, Hd = 1900, 1387, 2144
    k = (Hd - Hg) / float(W)
    cos = 1 / math.sqrt(1 + k * k)
    zt = lambda x: Hg + k * x - ep / cos                        # dessous du panneau de dessus incliné, à l'abscisse x
    col = [(19, 280), (299, 945), (964, 1257), (1276, 1569), (1588, 1881)]   # intérieurs des 5 colonnes
    ZB, ZS = 89, 754                                            # dessus du panneau de base ; dessous de l'étagère basse
    Dc = D - 8
    P = []
    P.append(plaque("Côté gauche", [[0, 0, 0], [0, D, 0], [0, D, zt(ep / 2)], [0, 0, zt(ep / 2)]], (1, 0, 0), ep))
    P.append(plaque("Côté droit", [[W, 0, 0], [W, D, 0], [W, D, zt(W - ep / 2)], [W, 0, zt(W - ep / 2)]], (-1, 0, 0), ep))
    xr = W - ep * k / cos                                      # l'épaisseur du dessus est perpendiculaire à la pente : on raccourcit le bord haut pour rester dans 1900 mm
    P.append(plaque("Dessus incliné", [[0, 0, Hg], [xr, 0, Hg + k * xr], [xr, D, Hg + k * xr], [0, D, Hg]], (0, 0, -1), ep))
    for nm, x0, zb in (("Montant A", 280, ZB), ("Montant B", 945, ZB), ("Montant C", 1257, ZS + ep), ("Montant D", 1569, ZS + ep)):
        xc = x0 + ep / 2
        P.append(plaque(nm, [[x0, 0, zb], [x0, Dc, zb], [x0, Dc, zt(xc)], [x0, 0, zt(xc)]], (1, 0, 0), ep))
    def etagere(nm, x0, x1, zb):
        return plaque(nm, [[x0, 0, zb], [x1, 0, zb], [x1, Dc, zb], [x0, Dc, zb]], (0, 0, 1), ep)
    P.append(etagere("Étagère basse colonne 1", col[0][0], col[0][1], ZS))
    P.append(etagere("Étagère basse colonne 2", col[1][0], col[1][1], ZS))
    P.append(etagere("Étagère basse colonnes 3-5", col[2][0], col[4][1], ZS))
    for i in (0, 1, 3, 4):
        P.append(etagere("Étagère 1082 colonne %d" % (i + 1), col[i][0], col[i][1], 1082))
    for i in (1, 2, 3):
        P.append(etagere("Étagère 1410 colonne %d" % (i + 1), col[i][0], col[i][1], 1410))
    P.append(etagere("Étagère 1738 colonne 5", col[4][0], col[4][1], 1738))
    P.append(plaque("Panneau de base", [[ep, 30, 70], [W - ep, 30, 70], [W - ep, Dc, 70], [ep, Dc, 70]], (0, 0, 1), ep))
    P.append(plaque("Plinthe", [[ep, 30, 0], [W - ep, 30, 0], [W - ep, 30, 70], [ep, 30, 70]], (0, 1, 0), ep))
    P.append(plaque("Fond", [[ep, D - 8, ZB], [W - ep, D - 8, ZB], [W - ep, D - 8, zt(W - ep)], [ep, D - 8, zt(ep)]], (0, 1, 0), 8, chants="aucun"))
    # 3 tiroirs : façades de 913 mm de large dans l'ouverture des colonnes 3 à 5
    for i, zb in enumerate((91, 313, 535)):
        P.append(plaque("Façade de tiroir %d" % (i + 1), [[966, 0, zb], [1879, 0, zb], [1879, 0, zb + 219], [966, 0, zb + 219]], (0, 1, 0), ep, cat="facade"))
    # cache-radiateur : panneau perforé dans un cadre (une pièce chiffrée, invisible) + lames dessinées pour l'aspect (non chiffrées)
    P.append(plaque("Panneau perforé (cache radiateur)", [[302, 0, 92], [942, 0, 92], [942, 0, 751], [302, 0, 751]], (0, 1, 0), ep, cat="facade", visible=False))
    P.append(plaque("Cadre bas", [[302, 0, 92], [942, 0, 92], [942, 0, 122], [302, 0, 122]], (0, 1, 0), ep, cat="facade", prix=False))
    P.append(plaque("Cadre haut", [[302, 0, 721], [942, 0, 721], [942, 0, 751], [302, 0, 751]], (0, 1, 0), ep, cat="facade", prix=False))
    P.append(plaque("Cadre gauche", [[302, 0, 122], [332, 0, 122], [332, 0, 721], [302, 0, 721]], (0, 1, 0), ep, cat="facade", prix=False))
    P.append(plaque("Cadre droit", [[912, 0, 122], [942, 0, 122], [942, 0, 721], [912, 0, 721]], (0, 1, 0), ep, cat="facade", prix=False))
    n, pas, lg = 17, 34.0, 22.0
    x = 332 + (580 - (n * pas - (pas - lg))) / 2.0
    for i in range(n):
        P.append(plaque("Lame %d" % (i + 1), [[x, 0, 122], [x + lg, 0, 122], [x + lg, 0, 721], [x, 0, 721]], (0, 1, 0), ep, cat="facade", prix=False))
        x += pas
    f = _forme(nom, P, type="placard_sous_pente", params={"D": D, "W": W, "Hg": Hg, "Hd": Hd})
    qc = {"angles": 38, "tiroirs": 3, "portes": 0, "charnieres": 0, "tringles": 0}
    return f, qc


def tete_de_lit(ep=EP, nom="Tête de lit avec colonnes", decor_haut="Blanc"):
    """Meuble de tête de lit (plan coté) : 2 colonnes (bas bois 100x50x99, haut blanc 100x40x177,9), 2 chevets au coin avant arrondi
    avec 2 étagères, fond de 10 cm et panneau capitonné central. 515,9 cm de large, 276,9 cm de haut, 50 cm de profondeur."""
    W, D = 5159, 500
    HB, HH = 990, 1779                  # bas (99 cm) et haut (177,9 cm)
    DH = 400                            # le haut des colonnes est en retrait de 10 cm
    P = []
    def caisson(prefixe, x0, x1, y0, y1, z0, z1, decor=None, bas=True):
        w = x1 - x0
        P.append(plaque(prefixe + " côté gauche", [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], (1, 0, 0), ep, decor=decor))
        P.append(plaque(prefixe + " côté droit", [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], (-1, 0, 0), ep, decor=decor))
        P.append(plaque(prefixe + " dessus", [[x0 + ep, y0, z1], [x1 - ep, y0, z1], [x1 - ep, y1, z1], [x0 + ep, y1, z1]], (0, 0, -1), ep, decor=decor))
        if bas:
            P.append(plaque(prefixe + " dessous", [[x0 + ep, y0, z0], [x1 - ep, y0, z0], [x1 - ep, y1, z0], [x0 + ep, y1, z0]], (0, 0, 1), ep, decor=decor))
        P.append(plaque(prefixe + " fond", [[x0 + ep, y1 - 8, z0 + ep], [x1 - ep, y1 - 8, z0 + ep], [x1 - ep, y1 - 8, z1 - ep], [x0 + ep, y1 - 8, z1 - ep]], (0, 1, 0), 8, chants="aucun", decor=decor))
        # deux portes de même largeur, façade posée devant le caisson
        lp = (w - 3 * 2) / 2.0
        for k in range(2):
            xa = x0 + 2 + k * (lp + 2)
            P.append(plaque(prefixe + " porte %d" % (k + 1), [[xa, y0, z0 + 2], [xa + lp, y0, z0 + 2], [xa + lp, y0, z1 - 2], [xa, y0, z1 - 2]], (0, 1, 0), ep, cat="facade", decor=decor))
    for sens, x0 in (("gauche", 0), ("droite", W - 1000)):
        caisson("Colonne %s bas" % sens, x0, x0 + 1000, 0, D, 0, HB)
        caisson("Colonne %s haut" % sens, x0, x0 + 1000, D - DH, D, HB, HB + HH, decor=decor_haut, bas=False)
    # fond / habillage derrière le bloc central (10 cm d'épaisseur, entre les deux colonnes)
    xa, xb = 1000, W - 1000
    P.append(plaque("Habillage face avant", [[xa, D - 100, 0], [xb, D - 100, 0], [xb, D - 100, HB], [xa, D - 100, HB]], (0, 1, 0), ep))
    P.append(plaque("Habillage dessus", [[xa, D - 100, HB - ep], [xb, D - 100, HB - ep], [xb, D, HB - ep], [xa, D, HB - ep]], (0, 0, -1), ep))
    P.append(plaque("Habillage dessous", [[xa, D - 100, 0], [xb, D - 100, 0], [xb, D, 0], [xa, D, 0]], (0, 0, 1), ep))
    # chevets : contour en plan à coin avant arrondi (rayon 210 mm)
    R, XL, XR = 210, 1100, 1693
    def contour(g):          # g = +1 : chevet gauche ; -1 : chevet droit (symétrique)
        pts = [[XL, 0], [XR - R, 0]] + [[p[0], p[1]] for p in arc(XR - R, R, R, -90, 0, 14)[1:]] + [[XR, D - 100], [XL, D - 100]]
        return [[(x if g > 0 else W - x), y] for x, y in pts]
    for g, nm in ((1, "gauche"), (-1, "droit")):
        c = contour(g)
        for z, lib, vers in ((0, "dessous", (0, 0, 1)), (HB - ep, "dessus", (0, 0, -1)), (90, "étagère basse", (0, 0, 1)), (490, "étagère lampe", (0, 0, 1))):
            P.append(plaque("Chevet %s %s" % (nm, lib), [[x, y, z] for x, y in c], vers, ep))
        xs = XL if g > 0 else W - XL
        P.append(plaque("Chevet %s côté extérieur" % nm, [[xs, 0, ep], [xs, D - 100, ep], [xs, D - 100, HB - ep], [xs, 0, ep + (HB - 2 * ep)]], (1 if g > 0 else -1, 0, 0), ep))
        chemin = [[p[0], p[1]] for p in arc(XR - R, R, R, -90, 0, 14)] + [[XR, D - 100]]
        chemin = [[(x if g > 0 else W - x), y] for x, y in chemin]
        P.append(ruban("Chevet %s paroi arrondie" % nm, "z", chemin, ep, HB - ep, ep, sens=1 if g > 0 else -1, cat="struct"))
    # panneau capitonné central (155,7 cm x ~36 cm), posé devant le fond
    cx = W / 2.0
    P.append(plaque("Panneau capitonné", [[cx - 778.5, D - 130, 470], [cx + 778.5, D - 130, 470], [cx + 778.5, D - 130, 830], [cx - 778.5, D - 130, 830]], (0, 1, 0), 30, cat="facade"))
    f = _forme(nom, P, type="tete_de_lit", params={"W": W, "D": D})
    qc = {"angles": 36, "tiroirs": 0, "portes": 8, "charnieres": 24, "tringles": 0}
    return f, qc


def escalier_meuble(D=605, ep=EP, nom="Escalier-meuble"):
    """Escalier-meuble (coupe d'un plan d'architecte) : 4 colonnes de rangement sous les marches (largeurs 443 / 527 / 525 / 350 mm),
    marches de 175 mm de giron et 187 mm de hauteur, plateforme à 1870 mm. Largeur de l'escalier (profondeur y) D : 605 mm à confirmer.
    Les tiroirs et la disposition des étagères sont une première lecture à confirmer."""
    T = 35                               # épaisseur des marches et de la plateforme
    xs = [0, 443, 970, 1495, 1845]      # limites des colonnes
    tops = {1: 1834, 2: 1834, 3: 1273, 4: 900}
    Dc = D - 8
    P = []
    def ver(nm, x, h):
        return plaque(nm, [[x, 0, 0], [x, Dc, 0], [x, Dc, h], [x, 0, h]], (1, 0, 0), ep)
    P.append(ver("Séparation colonnes 1-2", xs[1] - ep, tops[2]))
    P.append(ver("Séparation colonnes 2-3", xs[2] - ep, tops[2]))
    P.append(ver("Séparation colonnes 3-4", xs[3] - ep, tops[3]))
    P.append(plaque("Côté droit", [[xs[4], 0, 0], [xs[4], Dc, 0], [xs[4], Dc, tops[4]], [xs[4], 0, tops[4]]], (-1, 0, 0), ep))
    P.append(plaque("Fond (en gradins)", [[0, D - 8, 0], [xs[4], D - 8, 0], [xs[4], D - 8, tops[4]], [xs[3], D - 8, tops[4]], [xs[3], D - 8, tops[3]], [xs[2], D - 8, tops[3]], [xs[2], D - 8, tops[2]], [0, D - 8, tops[2]]], (0, 1, 0), 8, chants="aucun"))
    P.append(plaque("Panneau de base", [[0, 0, 0], [xs[4], 0, 0], [xs[4], Dc, 0], [0, Dc, 0]], (0, 0, 1), ep))
    # dessus des colonnes 3 et 4 (les marches posent dessus)
    for c, nm in ((3, "Dessus colonne 3"), (4, "Dessus colonne 4")):
        z = tops[c] - ep
        P.append(plaque(nm, [[xs[c - 1], 0, z], [xs[c], 0, z], [xs[c], Dc, z], [xs[c - 1], Dc, z]], (0, 0, 1), ep))
    # colonne 1 : étagères ouvertes (9 étagères, une toutes les marches)
    for k in range(1, 10):
        z = 187 * k - T
        P.append(plaque("Étagère colonne 1 n°%d" % k, [[0, 0, z], [xs[1] - ep, 0, z], [xs[1] - ep, Dc, z], [0, Dc, z]], (0, 0, 1), ep))
    # plateforme au-dessus des colonnes 1 et 2, puis marches 9 -> 5 avec leurs contremarches
    zp = 187 * 10
    P.append(plaque("Plateforme", [[0, 0, zp - T], [xs[2], 0, zp - T], [xs[2], D, zp - T], [0, D, zp - T]], (0, 0, 1), T))
    haut = [(9, 970), (8, 1145), (7, 1320), (6, 1495), (5, 1670)]
    for n, x0 in haut:
        zt = 187 * n
        P.append(plaque("Marche %d" % n, [[x0, 0, zt - T], [x0 + 175, 0, zt - T], [x0 + 175, D, zt - T], [x0, D, zt - T]], (0, 0, 1), T))
        P.append(plaque("Contremarche %d" % n, [[x0 + 175 - ep, 0, zt - 187], [x0 + 175, 0, zt - 187], [x0 + 175, D, zt - 187], [x0 + 175 - ep, D, zt - 187]][:0] or
                        [[x0 + 175 - ep, 0, zt - 187 + 0], [x0 + 175 - ep, D, zt - 187], [x0 + 175 - ep, D, zt - T], [x0 + 175 - ep, 0, zt - T]], (1, 0, 0), ep))
    # tiroirs : colonne 2 (3 tiroirs sous un placard), colonne 3 (5 tiroirs), colonne 4 (3 tiroirs)
    def tiroirs(col, n, zmax):
        x0, x1 = xs[col - 1] + 2 + (ep if col > 1 else 0), xs[col] - 2 - ep
        h = (zmax - 3 * (n + 1)) / float(n)
        for i in range(n):
            zb = 3 + i * (h + 3)
            P.append(plaque("Façade de tiroir col.%d n°%d" % (col, i + 1), [[x0, 0, zb], [x1, 0, zb], [x1, 0, zb + h], [x0, 0, zb + h]], (0, 1, 0), ep, cat="facade"))
    tiroirs(2, 3, 727); tiroirs(3, 5, tops[3] - ep); tiroirs(4, 3, tops[4] - ep)
    # placard de la colonne 2 : une porte au-dessus des tiroirs
    P.append(plaque("Porte colonne 2", [[xs[1] + 2, 0, 733], [xs[2] - ep - 2, 0, 733], [xs[2] - ep - 2, 0, tops[2] - 4], [xs[1] + 2, 0, tops[2] - 4]], (0, 1, 0), ep, cat="facade"))
    f = _forme(nom, P, type="escalier_meuble", params={"D": D})
    qc = {"angles": 40, "tiroirs": 11, "portes": 1, "charnieres": 3, "tringles": 0}
    return f, qc

def cfg_formes(formes, mat="Chêne", nom="Meuble en formes libres", ft="tv", quincaillerie=None):
    """JSON complet prêt pour le rendu et le calcul de prix, avec uniquement des formes libres."""
    pieces = [p for f in formes for p in f["pieces"] if p.get("visible", True)]
    lo, hi = bbox(pieces)
    return {
        "furniture_type": ft,
        "meuble": {"version_calcul": 2, "formes_seules": True, "L": round((hi[0] - lo[0]) / 10, 1), "H": round((hi[2] - lo[2]) / 10, 1), "P": round((hi[1] - lo[1]) / 10, 1),
                   "x_start_cm": 0, "matLabel": mat, "matId": 0, "mur_gauche": False, "mur_droit": False, "epaisseur_mm": EP},
        "elements": [], "formes_libres": formes, "nom_modele": nom,
        **({"quincaillerie": quincaillerie} if quincaillerie else {}),
    }


def ecrire(cfg, chemin):
    json.dump(cfg, open(chemin, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "formes-essai.json"
    F = [
        caisson_dessus_incline(0, 800, 600, 1100, 400),
        caisson_biais(900, 700, 800, 400, 250),
        caisson_facade_courbe(1700, 800, 700, 400, 120),
        caisson_coins_arrondis(2600, 600, 700, 400, 90),
    ]
    ecrire(cfg_formes(F), out)
    for p in toutes_pieces(json.load(open(out))):
        s = stats(p); print("%-24s %-7s %.3f m²  chant %.2f m" % (p["nom"], p["type"], s["surface_m2"], s["chant_m"]))


def ecrire_placard(chemin, D=550):
    f, qc = placard_sous_pente(D)
    ecrire(cfg_formes([f], mat="Chêne foncé", nom="Placard sous pente", quincaillerie=qc), chemin)


def ecrire_tete_de_lit(chemin):
    f, qc = tete_de_lit()
    ecrire(cfg_formes([f], mat="Noyer", nom="Tête de lit avec colonnes", quincaillerie=qc), chemin)


def ecrire_escalier(chemin):
    f, qc = escalier_meuble()
    ecrire(cfg_formes([f], mat="Chêne", nom="Escalier-meuble", quincaillerie=qc), chemin)
