"""Lecture du JSON de demande (sans dépendance à Blender) : caisson principal + caissons latéraux."""
import json


def compartment(els, x, y, iW, iH):
    """Même règle que getCompartment() du configurateur : seules les étagères qui TRAVERSENT x (début < x < fin,
    moitiés d'une même étagère fusionnées) coupent l'intercalaire ; une étagère qui s'arrête contre lui ne le coupe pas."""
    by_y = {}
    for e in els:
        if e.get("type") != "shelf": continue
        sl = e["x_left_cm"] if e.get("x_left_cm") is not None else 0
        sr = e["x_right_cm"] if e.get("x_right_cm") is not None else iW
        if sl > x or sr < x: continue
        if e["y_cm"] not in by_y: by_y[e["y_cm"]] = [sl, sr]
        else: by_y[e["y_cm"]] = [min(by_y[e["y_cm"]][0], sl), max(by_y[e["y_cm"]][1], sr)]
    bot, top = 0, iH
    for ys, (l, r) in by_y.items():
        if l < x < r:
            if ys < y and ys > bot: bot = ys
            if ys > y and ys < top: top = ys
    return bot, top


def dedupe_elements(elements):
    """Retire les éléments identiques (même type + même clé/position) : un export peut contenir des portes en double."""
    seen, out = set(), []
    for e in elements or []:
        k = (e.get("type"), e.get("key"), e.get("y_cm"), e.get("x_cm"), e.get("x_left_cm"), e.get("x_right_cm"))
        if k in seen: continue
        seen.add(k); out.append(e)
    # intercalaires superposés (même position, même compartiment)
    seen_sep, res = set(), []
    for e in out:
        if e.get("type") in ("separator", "separator_simple"):
            b, t = compartment(out, e["x_cm"], e.get("y_cm", 0), 9999, 9999)
            k = (e["x_cm"], b, t)
            if k in seen_sep: continue
            seen_sep.add(k)
        res.append(e)
    return res


def dedupe_rects(items):
    seen, out = set(), []
    for d in items or []:
        k = (d.get("x_left_mm"), d.get("x_right_mm"), d.get("y_bottom_mm"), d.get("height_mm"))
        if k in seen: continue
        seen.add(k); out.append(d)
    return out


def spec_from_elements(W, H, D, ep, elements):
    """Équivalent Python de buildTechSpec() du configurateur, pour un caisson latéral (dimensions en mm,
    éléments en cm dans le repère intérieur : y_cm / x_cm depuis l'angle intérieur bas-gauche)."""
    elements = dedupe_elements(elements)
    iW, iH = W - 2 * ep, H - 2 * ep
    sp = {"panel_thickness_mm": ep, "overall_mm": {"width": W, "height": H, "depth": D},
          "structural_panels": [
              {"type": "joue_gauche", "x_left_mm": 0, "x_right_mm": ep, "y_bottom_mm": 0, "y_top_mm": H},
              {"type": "joue_droite", "x_left_mm": W - ep, "x_right_mm": W, "y_bottom_mm": 0, "y_top_mm": H},
              {"type": "traverse_haute", "x_left_mm": ep, "x_right_mm": W - ep, "y_bottom_mm": H - ep, "y_top_mm": H},
              {"type": "traverse_basse", "x_left_mm": ep, "x_right_mm": W - ep, "y_bottom_mm": 0, "y_top_mm": ep},
              {"type": "fond", "x_left_mm": 0, "x_right_mm": W, "y_bottom_mm": 0, "y_top_mm": H}],
          "separators": [], "shelves": [], "bars": [], "doors": [], "drawers": []}
    shelves_cm = [e for e in elements if e.get("type") == "shelf"]
    for e in elements:
        t = e.get("type")
        if t in ("shelf", "shelf_simple"):
            ym = ep + round(e["y_cm"] * 10)
            sp["shelves"].append({"x_left_mm": ep + round(e.get("x_left_cm", 0) * 10), "x_right_mm": ep + round(e.get("x_right_cm", iW / 10) * 10),
                                  "y_bottom_mm": ym, "y_top_mm": ym + ep, "thickness_mm": ep, "depth_mm": D - ep})
        elif t in ("separator", "separator_simple"):
            cx = ep + round(e["x_cm"] * 10)
            bot, top = compartment(elements, e["x_cm"], e.get("y_cm", 0), iW / 10, iH / 10)
            sp["separators"].append({"x_left_mm": cx - ep // 2, "x_right_mm": cx + ep // 2, "y_bottom_mm": ep + bot * 10, "y_top_mm": ep + top * 10})
        elif t == "barre":
            xl = round(e.get("x_left_cm", 0) * 10); xr = round(e.get("x_right_cm", iW / 10) * 10)
            sp["bars"].append({"x_left_mm": ep + xl, "x_right_mm": ep + xr, "y_center_mm": ep + round(e["y_cm"] * 10), "diameter_mm": 28})
        elif t in ("porte", "tiroir"):
            bot, left, top, right = [float(v) for v in e["key"].split("_")]
            x_l = ep + round(left * 10); x_r = ep + round(right * 10)
            y_b, y_t = ep + round(bot * 10), ep + round(top * 10)
            rec = {"x_left_mm": x_l, "x_right_mm": x_r, "y_bottom_mm": y_b, "height_mm": y_t - y_b}
            sp["doors" if t == "porte" else "drawers"].append(rec)
    return sp


def load_spec(path):
    cfg = json.load(open(path, encoding="utf-8"))
    spec = cfg.get("technical_spec")
    if not spec and cfg.get("type") == "biblio":  # ancien export bibliothèque (cm)
        L, H, P = cfg["L_cm"] * 10, cfg["H_cm"] * 10, cfg["P_cm"] * 10
        spec = spec_from_elements(L, H, P, 18, cfg.get("elements", []))
    if not spec and cfg.get("meuble") and cfg.get("elements") is not None:  # export sans technical_spec : on le reconstruit
        m = cfg["meuble"]
        spec = spec_from_elements(round(m["L"] * 10), round(m["H"] * 10), round(m["P"] * 10), 18, cfg.get("elements", []))
    if not spec:
        raise SystemExit("JSON sans technical_spec : rien à dessiner.")
    spec["doors"] = dedupe_rects(spec.get("doors"))
    spec["drawers"] = dedupe_rects(spec.get("drawers"))
    # la liste d'éléments fait foi : l'ancien technical_spec comptait toutes les étagères sur la largeur complète
    if cfg.get("elements") is not None and cfg.get("meuble") and spec.get("overall_mm"):
        m = cfg["meuble"]
        rebuilt = spec_from_elements(spec["overall_mm"]["width"], spec["overall_mm"]["height"], spec["overall_mm"]["depth"], spec.get("panel_thickness_mm", 18), cfg["elements"])
        rebuilt["materials"] = spec.get("materials")
        spec = rebuilt
    cfg["_spec"] = spec
    ep = spec.get("panel_thickness_mm", 18)
    D = spec["overall_mm"]["depth"]; Lmain = spec["overall_mm"]["width"]
    # caissons : [(x_origine_mm, spec)] ; le principal part de 0, les latéraux se collent de part et d'autre
    cais = [(0, spec)]
    side = cfg.get("tvSide") or {}
    off = 0
    for r in side.get("left") or []:
        W = round(r["W_cm"] * 10); off += W
        cais.append((-off, spec_from_elements(W, round(r["H_cm"] * 10), D, ep, r.get("elements", []))))
    off = Lmain
    for r in side.get("right") or []:
        W = round(r["W_cm"] * 10)
        cais.append((off, spec_from_elements(W, round(r["H_cm"] * 10), D, ep, r.get("elements", []))))
        off += W
    if side.get("top"):
        print("Avertissement : caisson « dessus » (tvSide.top) non dessiné.")
    xmin = min(x for x, _ in cais)
    cfg["_caissons"] = [(x - xmin, sp) for x, sp in cais]
    return cfg


def count_raw(cfg):
    """Comptage fait directement sur le JSON brut (indépendant du dessin) : ce qui DOIT apparaître dans la 3D."""
    def tally(els):
        els = dedupe_elements(els or [])
        c = {"porte": 0, "tiroir": 0, "etagere": 0, "intercalaire": 0, "tringle": 0}
        for e in els:
            t = e.get("type")
            if t == "porte": c["porte"] += 1
            elif t == "tiroir": c["tiroir"] += 1
            elif t in ("shelf", "shelf_simple"): c["etagere"] += 1
            elif t in ("separator", "separator_simple"): c["intercalaire"] += 1
            elif t == "barre": c["tringle"] += 1
        return c
    tot = {"porte": 0, "tiroir": 0, "etagere": 0, "intercalaire": 0, "tringle": 0, "caissons": 0, "largeur_mm": 0}
    spec = cfg.get("technical_spec") or {}
    main_els = cfg.get("elements")
    if main_els is None and spec:   # pas de liste d'éléments : on retombe sur le technical_spec
        main_els = ([{"type": "porte", "key": "x%d" % i} for i, _ in enumerate(spec.get("doors", []))] + [{"type": "tiroir", "key": "y%d" % i} for i, _ in enumerate(spec.get("drawers", []))]
                    + [{"type": "shelf", "y_cm": i, "x_left_cm": 0, "x_right_cm": 1} for i, _ in enumerate(spec.get("shelves", []))]
                    + [{"type": "separator", "x_cm": i, "y_cm": 0} for i, _ in enumerate(spec.get("separators", []))])
    lists = [main_els or []]
    widths = [((cfg.get("meuble") or {}).get("L") or (spec.get("overall_mm") or {}).get("width", 0) / 10) * 10]
    side = cfg.get("tvSide") or {}
    for k in ("left", "right"):
        v = side.get(k) or []
        for r in (v if isinstance(v, list) else [v]):
            if r and r.get("W_cm"):
                lists.append(r.get("elements") or []); widths.append(r["W_cm"] * 10)
    for l in lists:
        c = tally(l)
        for k in c: tot[k] += c[k]
    tot["caissons"] = len(lists); tot["largeur_mm"] = round(sum(widths))
    return tot


def non_dessines(cfg):
    """Éléments présents dans le JSON que le rendu 3D ne dessine pas (à signaler plutôt que de les ignorer en silence)."""
    out = []
    side = cfg.get("tvSide") or {}
    if side.get("top"): out.append("caisson du dessus (tvSide.top)")
    if cfg.get("caisson2"): out.append("caisson d'angle")
    if cfg.get("cableHoles"): out.append("passage(s) de câbles")
    if cfg.get("plan"): out.append("plan de travail")
    if cfg.get("vasques"): out.append("vasque(s)")
    return out
