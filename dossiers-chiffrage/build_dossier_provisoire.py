"""Générateur PROVISOIRE du dossier client Kōbō (A3 paysage).

Remplace build_dossier.py tant que le gabarit officiel est introuvable.
Positions d'images reprises de la spec (§7.1) ; le reste de la mise en page est une reconstitution.
Usage : python3 build_dossier_provisoire.py <dossier contenant donnees.json>
"""
import json, re, sys
from pathlib import Path
import fitz

FONTS = Path("/Applications/Wondershare Filmora Mac.app/Contents/Resources/Fonts")
W, H = 1190.55, 841.89  # A3 paysage en pt
BG, DARK, ACCENT, GREY = (1, .98, .94), (.1, .1, .1), (.80, .24, 0), (.55, .53, .5)
M = 60  # marge

IMG_POS = {  # champ -> (x, y, w, h) en pt, spec §7.1
    "img_demande": (660, 70, 505, 730),
    "img_ambiance": (30, 30, 735, 398),
    "img_cotes": (850, 60, 340, 740),
}


def font(page):
    for name, f in [("pr", "Poppins-Regular"), ("pl", "Poppins-Light"),
                    ("pm", "Poppins-Medium"), ("pb", "Poppins-Bold")]:
        page.insert_font(fontname=name, fontfile=str(FONTS / f"{f}.ttf"))


def new_page(doc, label=None):
    p = doc.new_page(width=W, height=H)
    font(p)
    p.draw_rect(p.rect, color=None, fill=BG)
    if label:
        p.insert_text((M, 58), label, fontname="pm", fontsize=11, color=ACCENT)
    p.insert_text((W - M - 70, H - 28), "KŌBŌ DESIGN", fontname="pm", fontsize=8, color=GREY)
    return p


def rich_line(p, x, y, text, size, color=DARK):
    """Ligne avec segments <b>…</b> rendus en Poppins Regular, le reste en Light."""
    for i, seg in enumerate(re.split(r"</?b>", text)):
        if not seg:
            continue
        fn = "pr" if i % 2 else "pl"
        p.insert_text((x, y), seg, fontname=fn, fontsize=size, color=color)
        ttf = "Poppins-Regular.ttf" if fn == "pr" else "Poppins-Light.ttf"
        x += fitz.Font(fontfile=str(FONTS / ttf)).text_length(seg, size)


def bullets(p, x, y, items, size=17, lead=30):
    for it in items:
        p.draw_circle((x + 4, y - size * .33), 3, color=None, fill=ACCENT)
        rich_line(p, x + 18, y, it, size)
        y += lead
    return y


def image_or_frame(p, dossier, field, value):
    x, y, w, h = IMG_POS[field]
    r = fitz.Rect(x, y, x + w, y + h)
    if value and (dossier / value).exists():
        p.insert_image(r, filename=str(dossier / value), keep_proportion=True)
        return
    p.draw_rect(r, color=GREY, width=.6, dashes="[4 4] 0")
    p.insert_textbox(r + (0, h / 2 - 10, 0, 0), f"[{field} manquant]", fontname="pl",
                     fontsize=11, color=GREY, align=1)


def draw_cotes(p, spec, total_h):
    """Élévation de face cotée, vectorielle, dans la zone img_cotes."""
    x0, y0, w, h = IMG_POS["img_cotes"]
    L, Hc, P, pl = 1900, total_h - 80, 530, 80
    s = min((w - 90) / L, (h - 120) / (Hc + pl))
    ox, base = x0 + 55, y0 + 40 + (Hc + pl) * s  # base = sol
    X = lambda v: ox + v * s
    Y = lambda v: base - (v + pl) * s
    lw = .7
    # caisson + plinthe
    p.draw_rect(fitz.Rect(X(0), Y(Hc), X(L), Y(0)), color=DARK, width=1)
    p.draw_rect(fitz.Rect(X(30), base - pl * s, X(L - 30), base), color=DARK, width=lw)
    p.draw_line((x0 + 20, base), (x0 + w - 10, base), color=GREY, width=.5)
    dh = Hc - 2430  # variante : portes basses raccourcies
    for d in spec["doors"]:
        yb = d["y_bottom_mm"] + (0 if d["y_bottom_mm"] < 100 else dh)
        hh = d["height_mm"] + (dh if d["y_bottom_mm"] < 100 else 0)
        p.draw_rect(fitz.Rect(X(d["x_left_mm"]), Y(yb + hh), X(d["x_right_mm"]), Y(yb)),
                    color=DARK, width=lw)

    def cote(a, b, txt, vertical, pos):
        col = ACCENT
        if vertical:
            p.draw_line((pos, a), (pos, b), color=col, width=.6)
            for yy in (a, b):
                p.draw_line((pos - 4, yy), (pos + 4, yy), color=col, width=.6)
            p.insert_text((pos - 5, (a + b) / 2 + 20), txt, fontname="pr", fontsize=9,
                          color=col, rotate=90)
        else:
            p.draw_line((a, pos), (b, pos), color=col, width=.6)
            for xx in (a, b):
                p.draw_line((xx, pos - 4), (xx, pos + 4), color=col, width=.6)
            tl = fitz.Font(fontfile=str(FONTS / "Poppins-Regular.ttf")).text_length(txt, 9)
            p.insert_text(((a + b - tl) / 2, pos - 5), txt, fontname="pr", fontsize=9, color=col)

    cote(X(0), X(L), f"L {L} mm", False, Y(Hc) - 14)
    cote(base, Y(Hc), f"H {total_h} mm", True, X(0) - 30)
    cote(Y(0), Y(Hc), f"{Hc}", True, X(L) + 14)
    cote(base, Y(0), f"{pl}", True, X(L) + 14)
    p.insert_text((X(0), base + 26), f"Profondeur {P} mm", fontname="pr", fontsize=9, color=ACCENT)


def build(dossier: Path):
    d = json.loads((dossier / "donnees.json").read_text())
    spec = json.loads((dossier / "export.json").read_text())["technical_spec"] \
        if (dossier / "export.json").exists() else None
    doc = fitz.open()

    # 1 — couverture
    p = new_page(doc)
    p.draw_rect(fitz.Rect(M, 300, M + 60, 304), color=None, fill=ACCENT)
    p.insert_text((M, 380), d["titre_couverture"], fontname="pb", fontsize=58, color=DARK)
    p.insert_text((M, 430), d["sous_titre"], fontname="pl", fontsize=24, color=DARK)
    p.insert_text((M, 700), d["client"], fontname="pm", fontsize=18, color=ACCENT)

    # 2 — demande
    p = new_page(doc, "DEMANDE")
    y = bullets(p, M, 160, d["demande_bullets"], 19, 36)
    y += 40
    for line in d["demande_paragraphe"]:
        rich_line(p, M, y, line, 17)
        y += 28
    image_or_frame(p, dossier, "img_demande", d["img_demande"])

    # 3 — esquisses
    esq = d["esquisses"]
    for e in esq:
        p = new_page(doc)
        image_or_frame(p, dossier, "img_ambiance", e["img_ambiance"])
        lab = e["etiquette"] if len(esq) > 1 else "ESQUISSE"
        p.insert_text((M - 30, 470), lab, fontname="pm", fontsize=11, color=ACCENT)
        p.insert_text((M - 30, 510), e["esquisse_titre"], fontname="pb", fontsize=26, color=DARK)
        y = bullets(p, M - 30, 555, [e["esquisse_bullet_1"], e["esquisse_bullet_2"]], 14, 24)
        p.insert_text((M - 30, y + 6), e["esquisse_note"], fontname="pm", fontsize=13, color=ACCENT)
        bullets(p, M - 30, y + 46, e["esquisse_bullets_3"], 13, 22)
        yy = 555
        for line in e["esquisse_paragraphe"]:
            rich_line(p, 430, yy, line, 13)
            yy += 22
        p.insert_text((430, 760), e["prix"], fontname="pb", fontsize=26, color=DARK)
        if not e["img_cotes"] and spec:
            total = int(re.search(r"(\d{4}) mm", e["esquisse_note"]).group(1))
            draw_cotes(p, spec, total)
        else:
            image_or_frame(p, dossier, "img_cotes", e["img_cotes"])

    # 4 — à confirmer
    if d["confirmer_items"]:
        p = new_page(doc, "POINTS À CONFIRMER AVEC VOUS")
        y = 150
        for i, it in enumerate(d["confirmer_items"], 1):
            p.insert_text((M, y), f"{i:02d}", fontname="pb", fontsize=16, color=ACCENT)
            for line in it.split("\n"):
                p.insert_text((M + 45, y), line, fontname="pl", fontsize=16, color=DARK)
                y += 25
            y += 22
        p.insert_text((M, y + 20), d["confirmer_note"], fontname="pr", fontsize=14, color=GREY)

    # 5 — conditions
    p = new_page(doc, "CONDITIONS")
    txt = d["conditions_premiere_phrase"] + " " + d["conditions"]
    p.insert_textbox(fitz.Rect(M, 130, W / 2, H - 80), txt, fontname="pl", fontsize=15, color=DARK)

    doc.set_metadata({"title": d["titre_pdf"], "author": "Kōbō Design"})
    out = dossier / "dossier-client.pdf"
    doc.save(out, garbage=3, deflate=True)
    print(out)


if __name__ == "__main__":
    build(Path(sys.argv[1]))
