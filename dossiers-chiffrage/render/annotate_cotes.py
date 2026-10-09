"""Trace les lignes de cote (flèches obliques + étiquettes) sur le rendu de base produit par render_meuble.py."""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

FONTS = ["/Applications/Wondershare Filmora Mac.app/Contents/Resources/Fonts/Poppins-Light.ttf", "/System/Library/Fonts/Helvetica.ttc"]


def annotate(out_dir):
    raw = Image.open(os.path.join(out_dir, "_cotes_base.png")).convert("RGBA")
    base = Image.new("RGB", raw.size, (255, 255, 255)); base.paste(raw, mask=raw.split()[3])
    dims = json.load(open(os.path.join(out_dir, "_cotes_dims.json")))["dims"]
    S = 2
    big = base.resize((base.width * S, base.height * S), Image.LANCZOS)
    dr = ImageDraw.Draw(big)
    fp = next((f for f in FONTS if os.path.exists(f)), None)
    font = ImageFont.truetype(fp, int(21 * S * base.width / 1050)) if fp else ImageFont.load_default()
    col = (135, 135, 135)
    k = base.width / 1050

    def seg(a, b, w=2):
        dr.line([(a[0] * S, a[1] * S), (b[0] * S, b[1] * S)], fill=col, width=max(1, int(w * S * k)))

    def tick(p, d):
        n = (-d[1], d[0]); s = 9 * k
        seg((p[0] - s * (d[0] + n[0]) * .7, p[1] - s * (d[1] + n[1]) * .7), (p[0] + s * (d[0] + n[0]) * .7, p[1] + s * (d[1] + n[1]) * .7), 2)

    for d in dims:
        seg(d["p0"], d["a"], 1); seg(d["p1"], d["b"], 1)
        seg(d["a"], d["b"], 2)
        v = (d["b"][0] - d["a"][0], d["b"][1] - d["a"][1]); n = math.hypot(*v) or 1; v = (v[0] / n, v[1] / n)
        tick(d["a"], v); tick(d["b"], v)
        mid = ((d["a"][0] + d["b"][0]) / 2, (d["a"][1] + d["b"][1]) / 2)
        ang = math.degrees(math.atan2(-(d["b"][1] - d["a"][1]), d["b"][0] - d["a"][0]))
        if ang > 90: ang -= 180
        if ang < -90: ang += 180
        txt = d["label"]
        tw = dr.textlength(txt, font=font); pad = 7 * S * k
        box = Image.new("RGBA", (int(tw + 2 * pad), int(font.size * 1.5)), (255, 255, 255, 0))
        bd = ImageDraw.Draw(box)
        bd.rectangle([0, 0, box.width, box.height], fill=(255, 255, 255, 230))
        bd.text((pad, box.height * 0.18), txt, font=font, fill=(70, 70, 70))
        if abs(ang) > 3: box = box.rotate(ang, expand=True, resample=Image.BICUBIC)
        big.paste(box, (int(mid[0] * S - box.width / 2), int(mid[1] * S - box.height / 2)), box)
    big.resize(base.size, Image.LANCZOS).save(os.path.join(out_dir, "img_cotes.png"))
    os.remove(os.path.join(out_dir, "_cotes_base.png")); os.remove(os.path.join(out_dir, "_cotes_dims.json"))


if __name__ == "__main__":
    annotate(sys.argv[1])
