"""Rendus 3D du dossier client Kōbō, à partir du JSON exporté du configurateur.

Ne réutilise PAS le rendu du configurateur : le meuble est reconstruit depuis `technical_spec` (mm)
dans Blender (Cycles) pour obtenir les trois visuels du gabarit :
  img_demande  1200 x 1735  meuble contre un mur, sol clair, ombre douce
  img_ambiance 1600 x  867  meuble dans l'angle d'une pièce (parquet, murs)
  img_cotes    1050 x 2284  vue 3D cotée (L, H, P, hauteurs de portes, plinthe)

Usage :
  Blender -b -P render_meuble.py -- <export.json> <dossier_sortie> [--decor "Noyer"] [--plinthe 80]
          [--samples 96] [--scale 1.0] [--only demande,ambiance,cotes]
"""
import bpy, bmesh, json, sys, os, math, random, re
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
# textures : dossier « assets » à côté du script (assistant installé au démarrage) sinon le dépôt du site
REPO = os.path.join(HERE, "..", "assets") if os.path.isdir(os.path.join(HERE, "..", "assets")) else os.path.abspath(os.path.join(HERE, "..", ".."))

# décors du configurateur -> texture (sens du fil : horizontal dans l'image)
DECORS = {
    "chêne": "img/BOISCHENE.jpg", "chene": "img/BOISCHENE.jpg",
    "noyer": "img/NOYER.jpg", "chêne foncé": "img/CHENEFONCE.jpg", "sapelli": "img/SAPELLI.jpg",
    "frêne blanchi": "textures/caisson/freneblanchi.jpg", "bois blanc": "textures/caisson/boisblanc.jpg",
    "marron": "textures/caisson/boismarron.png", "taupe": "textures/caisson/boistaupe.jpg",
    "noir charbon": "textures/caisson/noircharbon.jpg", "noir mat": "textures/caisson/noirmat.jpg",
    "vert forêt": "textures/caisson/vertforet.jpg", "vert sauge": "img/VERTSAUGE.jpg",
    "bleu nuit": "textures/caisson/boisbleunuit.jpg", "bordeaux": "textures/caisson/boisbordeaux.jpg",
    "terracotta": "textures/caisson/terracotta.jpg", "jaune pâle": "textures/caisson/jaunepal.jpg",
    "crème": "textures/caisson/creme.png", "gris perle": "textures/caisson/boisgrisperle.jpg",
    "gris ardoise": "img/GRISARDOISE.jpg", "brun rosé": "img/BRUNROSE.jpg",
    "blanc gris": "textures/mineral/blanc_gris.jpg", "blanc multicolore": "textures/mineral/blanc_multicouleurs.jpg", "noir": "textures/mineral/noir.jpg",
}
FLAT_COLORS = {"blanc": (0.80, 0.79, 0.77)}
# décors clairs : la scène est trop lumineuse pour eux (meuble blanc sur mur clair = image blanche) -> exposition réduite
LIGHT_DECORS = {"blanc gris", "blanc multicolore", "blanc", "bois blanc", "frêne blanchi", "frene blanchi", "crème", "creme", "jaune pâle", "jaune pale", "bois gris perle", "gris perle"}


def parse_args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {"json": a[0], "out": a[1], "decor": None, "plinthe": 80, "samples": 48, "scale": 1.0,
           "only": "demande,ambiance,cotes"}
    i = 2
    while i < len(a):
        k = a[i].lstrip("-")
        opt[k] = a[i + 1]
        i += 2
    opt["plinthe"] = float(opt["plinthe"]); opt["samples"] = int(opt["samples"]); opt["scale"] = float(opt["scale"])
    return opt


# ───────────────────────────── lecture du JSON ─────────────────────────────
sys.path.insert(0, HERE)
from spec_loader import spec_from_elements, load_spec, count_raw, non_dessines


def decor_name(cfg, opt):
    if opt["decor"]:
        return opt["decor"]
    spec = cfg["_spec"]
    return ((cfg.get("meuble") or {}).get("matLabel") or cfg.get("matLabel") or (spec.get("materials") or {}).get("material_body") or cfg.get("mat") or "Chêne")


# ───────────────────────────── scène / matériaux ─────────────────────────────
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def mat_wood(name, tex_path, color=None, rough=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    set_specular(bsdf, 0.3)
    if tex_path and os.path.exists(tex_path):
        # deux échelles de la même texture mélangées : casse la répétition visible du motif
        uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV"
        image = bpy.data.images.load(tex_path)
        portrait = image.size[1] > image.size[0] * 1.2          # panneau entier, fil vertical dans l'image
        m["portrait"] = bool(portrait)
        def tex_node(scale, offset):
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (scale, scale, 1)
            mp.inputs["Location"].default_value = (offset[0], offset[1], 0)
            nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
            t = nt.nodes.new("ShaderNodeTexImage"); t.image = image; t.interpolation = "Smart"
            nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
            return t
        t1 = tex_node(1.0, (0, 0)); t2 = tex_node(1.0 if portrait else 0.43, (0.0, 0.0) if portrait else (0.31, 0.17))
        mix = nt.nodes.new("ShaderNodeMixRGB"); mix.inputs["Fac"].default_value = 0.5
        nt.links.new(t1.outputs["Color"], mix.inputs["Color1"]); nt.links.new(t2.outputs["Color"], mix.inputs["Color2"])
        nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.08
        nt.links.new(mix.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        bsdf.inputs["Base Color"].default_value = (*(color or (0.8, 0.8, 0.8)), 1)
    return m


def mat_plain(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    set_specular(b, 0.15)
    return m


def mat_parquet(name):
    """Parquet à lames : briques décalées + variation de teinte + veinage."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.42
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.35; brick.offset_frequency = 2
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.003
    brick.inputs["Brick Width"].default_value = 1.1
    brick.inputs["Row Height"].default_value = 0.12
    brick.inputs["Color1"].default_value = (0.40, 0.26, 0.14, 1)
    brick.inputs["Color2"].default_value = (0.58, 0.40, 0.24, 1)
    brick.inputs["Mortar"].default_value = (0.25, 0.16, 0.08, 1)
    nt.links.new(mp.outputs["Vector"], brick.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18
    noise.inputs["Detail"].default_value = 8
    mp2 = nt.nodes.new("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (1, 14, 1)  # veines allongées dans le sens des lames
    nt.links.new(tc.outputs["Object"], mp2.inputs["Vector"])
    nt.links.new(mp2.outputs["Vector"], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs["Fac"].default_value = 0.45
    nt.links.new(brick.outputs["Color"], mix.inputs["Color1"])
    nt.links.new(noise.outputs["Color"], mix.inputs["Color2"])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def add_box(name, x0, x1, y0, y1, z0, z1, mat, grain="v", rnd=None, pivot=None, rot_z=0.0):
    """Boîte alignée sur les axes, en mètres. y = profondeur depuis la façade. grain 'v' (vertical) ou 'h'."""
    sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
    if min(sx, sy, sz) <= 0:
        return None
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 + (v.co.x + 0.5) * sx
        v.co.y = y0 + (v.co.y + 0.5) * sy
        v.co.z = z0 + (v.co.z + 0.5) * sz
    uv = bm.loops.layers.uv.new("UV")
    ox, oy = (rnd or random).random(), (rnd or random).random()
    tile = 0.55  # un motif de texture = 0,55 m
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        plane = [i for i in range(3) if i != ax]            # axes dans le plan de la face
        # fil : vertical = axe z (2), horizontal = axe x (0) ; l'image a le fil dans le sens de u
        g = 2 if grain == "v" else 0
        if g in plane:
            ua, va = g, [i for i in plane if i != g][0]
        else:
            ua, va = plane[0], plane[1]
        portrait = bool(mat.get("portrait"))
        for l in f.loops:
            c = l.vert.co
            if portrait:   # u = travers du fil (1,2 m), v = sens du fil (2,4 m)
                l[uv].uv = (c[va] / 1.2 + ox, c[ua] / 2.4 + oy)
            else:
                l[uv].uv = (c[ua] / tile + ox, c[va] / tile + oy)
    if pivot:
        for v in bm.verts:
            v.co.x -= pivot[0]; v.co.y -= pivot[1]
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if pivot:
        ob.location = (pivot[0], pivot[1], 0); ob.rotation_euler = (0, 0, rot_z)
    ob.data.materials.append(mat)
    # chanfrein très fin pour accrocher la lumière sur les arêtes
    bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = 0.0008; bv.segments = 1
    return ob


def add_cyl(name, x0, x1, y, z, r, mat):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=x1 - x0, location=((x0 + x1) / 2, y, z), rotation=(0, math.pi / 2, 0))
    ob = bpy.context.active_object; ob.name = name
    ob.data.materials.append(mat)
    return ob


# ───────────────────────────── construction du meuble ─────────────────────────────
def hinge_sides(spec, ep):
    """Pour chaque porte, côté des charnières ('L' ou 'R') : un côté appuyé sur une joue ou un intercalaire.
    Règle : charnières côté extérieur du groupe de portes ; sinon le côté le mieux appuyé."""
    W = spec["overall_mm"]["width"]
    doors = spec.get("doors", [])
    seps = spec.get("separators", [])
    TOL = 16

    def cover(d, x):
        if x <= ep + TOL or x >= W - ep - TOL:
            return 1.0
        b, t = d["y_bottom_mm"], d["y_bottom_mm"] + d["height_mm"]
        sup = [(s_["y_bottom_mm"], s_["y_top_mm"]) for s_ in seps if abs((s_["x_left_mm"] + s_["x_right_mm"]) / 2 - x) <= TOL]
        segs = sorted([(max(b, lo - 5), min(t, hi + 5)) for lo, hi in sup if min(t, hi + 5) > max(b, lo - 5)])
        tot, cur = 0.0, -1e9
        for a, z in segs:
            a = max(a, cur)
            if z > a: tot += z - a; cur = z
        return min(1.0, tot / max(1, t - b))

    def neigh(d, side):
        for o in doors:
            if o is d: continue
            adj = abs(o["x_right_mm"] - d["x_left_mm"]) <= TOL if side == "L" else abs(o["x_left_mm"] - d["x_right_mm"]) <= TOL
            ov = min(o["y_bottom_mm"] + o["height_mm"], d["y_bottom_mm"] + d["height_mm"]) - max(o["y_bottom_mm"], d["y_bottom_mm"])
            if adj and ov > 10: return True
        return False

    out = []
    for d in doors:
        cl, cr = cover(d, d["x_left_mm"]), cover(d, d["x_right_mm"])
        nl, nr = neigh(d, "L"), neigh(d, "R")
        if nl and not nr: side = "R"
        elif nr and not nl: side = "L"
        elif cl != cr: side = "L" if cl > cr else "R"
        else: side = "L" if (d["x_left_mm"] + d["x_right_mm"]) / 2 < W / 2 else "R"
        out.append(side)
    return out


# ───────────────────────────── salle de bain : plan de travail + vasque(s) ─────────────────────────────
PLAN_TEX = {
    "evok": "dekton/evok.jpg", "kedar": "dekton/kedar.jpg", "keena": "dekton/keena.jpg", "thala": "dekton/thala.jpg", "zira": "dekton/zira.jpg",
    "arden blue": "silestone/ardenblue.jpg", "blanc elysée": "silestone/blancelysee.jpg", "blanc elysee": "silestone/blancelysee.jpg",
    "eternal calacatta gold": "silestone/calacattagold.jpg", "chateau brown": "silestone/chateaubrown.jpg",
    "eternal marquina": "silestone/elmarquina.jpg", "jardin emerald": "silestone/jardinemerald.jpg", "linen cream": "silestone/linencream.jpg",
    "miami white": "silestone/miamiwhite.jpg", "white arabesque": "silestone/whitearabesque.jpg",
    "blanc gris": "mineral/blanc_gris.jpg", "blanc multicolore": "mineral/blanc_multicouleurs.jpg", "noir": "mineral/noir.jpg",
}


def add_sdb_top(cfg, objs, W, H_top, D, rnd):
    """Plan de travail (collé au mur, déborde devant) et vasque(s) posée(s), d'après plan{} et vasques{} du JSON. Ne bloque jamais le rendu."""
    plan = cfg.get("plan") or {}
    if not plan.get("L") or not plan.get("P"):
        return
    try:
        L, P = plan["L"] / 100.0, plan["P"] / 100.0
        ep = plan.get("Ep_cm") or (plan.get("Ep") if (plan.get("Ep") or 0) >= 1 else 0) or 4
        ep = ep / 100.0
        label = str(plan.get("matLabel") or "").strip().lower()
        tex = PLAN_TEX.get(label)
        pm = mat_wood("plan", os.path.join(REPO, "textures", tex) if tex else None, (0.78, 0.76, 0.72), 0.25)
        cx = W / 2 + ((plan.get("depassD_cm") or 0) - (plan.get("depassG_cm") or 0)) / 200.0   # plan décalé si débordements différents
        y1 = D                     # fond du plan contre le mur (comme le fond du meuble)
        y0 = D - P
        z0 = H_top
        o = add_box("plan", cx - L / 2, cx + L / 2, y0, y1, z0, z0 + ep, pm, "h", rnd)
        if o:
            objs.append(o)
        encastree = (cfg.get("vasques") or {}).get("pose") == "encastree"
        vas = cfg.get("vasques") or {}
        nb = vas.get("nb")
        nb = 1 if nb is None else int(nb)
        if nb <= 0:
            return
        vid = vas.get("id") or "v1"
        glb = os.path.join(REPO, "models", "vasque-%s.glb" % vid) if not str(vid).startswith("vasque") else os.path.join(REPO, "models", "%s.glb" % vid)
        if not os.path.exists(glb):
            print("vasque introuvable :", glb)
            return
        VW, VD = (vas.get("W") or 50) / 100.0, (vas.get("D") or 35) / 100.0
        pts = [(vas.get("vx") or 0.0, vas.get("vz") or 0.0)]
        if nb >= 2:
            pts.append((vas.get("vx2") or 0.0, vas.get("vz2") or 0.0))
        for k, (vx, vz) in enumerate(pts):
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=glb)
            new = [ob for ob in bpy.data.objects if ob not in before]
            meshes = [ob for ob in new if ob.type == "MESH"]
            if not meshes:
                continue
            root = bpy.data.objects.new("vasque_root_%d" % k, None)
            bpy.context.collection.objects.link(root)
            for ob in new:
                if ob.parent is None:
                    ob.parent = root
            bpy.context.view_layer.update()
            pts3 = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
            sx0 = max(v.x for v in pts3) - min(v.x for v in pts3)
            sy0 = max(v.y for v in pts3) - min(v.y for v in pts3)
            sz0 = max(v.z for v in pts3) - min(v.z for v in pts3)
            if min(sx0, sy0, sz0) <= 0:
                continue
            fx, fy = VW / sx0, VD / sy0
            fz = min(fx, fy)
            root.scale = (fx, fy, fz)
            bpy.context.view_layer.update()
            pts3 = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
            mnx, mxx = min(v.x for v in pts3), max(v.x for v in pts3)
            mny, mxy = min(v.y for v in pts3), max(v.y for v in pts3)
            mnz, mxz = min(v.z for v in pts3), max(v.z for v in pts3)
            h = mxz - mnz
            tx = cx + vx                       # vx : écart au centre du plan (m)
            ty = D - (vz + 0.75)               # vz : coordonnée monde, le mur est à -0.75
            tz = z0 + ep - (h - 0.10)          # à poser : la vasque dépasse du plan de 10 cm (même règle que le configurateur)
            if encastree:
                tz = z0 + ep - h + 0.01        # encastrée : le bord de la vasque affleure le plan, qui est découpé en dessous
                if o:
                    cut = add_box("decoupe_%d" % k, tx - VW / 2, tx + VW / 2, ty - VD / 2, ty + VD / 2, z0 - 0.01, z0 + ep + 0.01, pm, "h", rnd)
                    if cut:
                        md = o.modifiers.new("trou", "BOOLEAN"); md.operation = "DIFFERENCE"; md.object = cut; md.solver = "EXACT"
                        cut.hide_render = True; cut.hide_viewport = True
                        if cut in objs: objs.remove(cut)
            root.location = (tx - (mnx + mxx) / 2, ty - (mny + mxy) / 2, tz - mnz)
            for ob in meshes:
                ob.data.materials.clear()
                ob.data.materials.append(pm)
                objs.append(ob)
    except Exception as e:  # noqa
        print("plan/vasque non dessinés :", e)



def build_furniture(cfg, opt, open_state=False):
    mm = 0.001
    spec0 = cfg["_spec"]
    ep = spec0.get("panel_thickness_mm", 18)
    D = spec0["overall_mm"]["depth"]
    plinth = opt["plinthe"]
    z_off = plinth * mm
    name = decor_name(cfg, opt)
    key = name.strip().lower()
    tex = DECORS.get(key)
    if tex:
        wood = mat_wood("decor", os.path.join(REPO, tex))
    elif key in FLAT_COLORS:
        wood = mat_wood("decor", None, FLAT_COLORS[key], 0.6)
    else:
        wood = mat_wood("decor", os.path.join(REPO, "img/BOISCHENE.jpg"))
    inside = mat_plain("interieur", (0.55, 0.53, 0.50), 0.85)
    metal = mat_plain("metal", (0.60, 0.60, 0.62), 0.25)
    rnd = random.Random(7)
    objs = []

    def box(nm, ox, xl, xr, yb, yt, d0, d1, grain, mt=None):
        o = add_box(nm, (ox + xl) * mm, (ox + xr) * mm, d0 * mm, d1 * mm, yb * mm + z_off, yt * mm + z_off, mt or wood, grain, rnd)
        if o: objs.append(o)
        return o

    for ox, spec in cfg["_caissons"]:
        W = spec["overall_mm"]["width"]; H = spec["overall_mm"]["height"]
        B = lambda nm, xl, xr, yb, yt, d0, d1, grain, mt=None: box(nm, ox, xl, xr, yb, yt, d0, d1, grain, mt)
        for p in spec.get("structural_panels", []):
            t = p["type"]
            if t == "fond":
                B("fond", p["x_left_mm"], p["x_right_mm"], p["y_bottom_mm"], p["y_top_mm"], D - 8, D, "v", inside)
            elif t.startswith("joue"):
                B(t, p["x_left_mm"], p["x_right_mm"], p["y_bottom_mm"], p["y_top_mm"], 0, D, "v")
            else:
                B(t, p["x_left_mm"], p["x_right_mm"], p["y_bottom_mm"], p["y_top_mm"], 0, D, "h")
        for s_ in spec.get("separators", []):
            B("sep", s_["x_left_mm"], s_["x_right_mm"], s_["y_bottom_mm"], s_["y_top_mm"], 0, D - 8, "v")
        for s_ in spec.get("shelves", []):
            B("shelf", s_["x_left_mm"], s_["x_right_mm"], s_["y_bottom_mm"], s_["y_top_mm"], 12, min(D - 8, 12 + s_.get("depth_mm", D - ep)), "h")
        for b_ in spec.get("bars", []):
            o = add_cyl("tringle", (ox + b_["x_left_mm"]) * mm, (ox + b_["x_right_mm"]) * mm, 0.5 * D * mm, b_["y_center_mm"] * mm + z_off, b_.get("diameter_mm", 28) * mm / 2, metal)
            objs.append(o)
        # façades encastrées, affleurant la face avant du caisson (jeu de 2 mm entre éléments)
        sides = hinge_sides(spec, ep) if open_state else []
        dlist = spec.get("doors", [])

        def pivot_x(d, side):
            return d["x_left_mm"] if side == "L" else d["x_right_mm"]

        def angle_for(di):
            """Ouverture réduite (80°) quand une autre porte, de l'autre côté du même panneau, pivote sur la même ligne :
            ouvertes en grand, elles se traverseraient."""
            d, sd = dlist[di], sides[di]
            for oi, o in enumerate(dlist):
                if oi == di or sides[oi] == sd: continue
                if abs(pivot_x(o, sides[oi]) - pivot_x(d, sd)) > 16: continue
                ov = min(o["y_bottom_mm"] + o["height_mm"], d["y_bottom_mm"] + d["height_mm"]) - max(o["y_bottom_mm"], d["y_bottom_mm"])
                if ov > 10: return 80
            return 98

        for di, d in enumerate(spec.get("doors", [])):
            th = d.get("door_thickness_mm", ep)
            xl, xr = d["x_left_mm"] + 1, d["x_right_mm"] - 1
            yb, yt = d["y_bottom_mm"] + 1, d["y_bottom_mm"] + d["height_mm"] - 1
            if not open_state:
                B("porte", xl, xr, yb, yt, 0, th, "v")
            else:  # charnières sur une joue ou un intercalaire (jamais dans le vide)
                left = sides[di] == "L"
                px = (ox + (xl if left else xr)) * mm
                o = add_box("porte", (ox + xl) * mm, (ox + xr) * mm, 0, th * mm, yb * mm + z_off, yt * mm + z_off, wood, "v", rnd,
                            pivot=(px, 0), rot_z=math.radians(-angle_for(di) if left else angle_for(di)))
                if o: objs.append(o)
        for d in spec.get("drawers", []):
            th = d.get("drawer_face_thickness_mm", ep)
            xl, xr = d["x_left_mm"] + 1, d["x_right_mm"] - 1
            yb, yt = d["y_bottom_mm"] + 1, d["y_bottom_mm"] + d["height_mm"] - 1
            sortie = -min(200, D * 0.35) if open_state else 0     # tiroir sorti de 20 cm (assez pour le voir sans cacher les portes voisines)
            B("tiroir", xl, xr, yb, yt, sortie, th + sortie, "h")
            # caisse du tiroir : fond + côtés + dos (ouverte sur le dessus)
            prof = min(D - 30, th + 450) - th
            c0, c1 = xl + 20, xr - 20
            y0, y1 = th + sortie, th + sortie + prof
            hb = d["y_bottom_mm"] + 20
            ht_ = max(60, d["height_mm"] - 70)
            B("tiroir_fond", c0, c1, hb, hb + 12, y0, y1, "h", inside)
            B("tiroir_cote_g", c0, c0 + 12, hb, hb + ht_, y0, y1, "h", inside)
            B("tiroir_cote_d", c1 - 12, c1, hb, hb + ht_, y0, y1, "h", inside)
            B("tiroir_dos", c0, c1, hb, hb + ht_, y1 - 12, y1, "h", inside)
    Wtot = max(ox + sp["overall_mm"]["width"] for ox, sp in cfg["_caissons"])
    Htot = max(sp["overall_mm"]["height"] for _, sp in cfg["_caissons"])
    # plinthe continue : panneau de façade en retrait (≈ 30 mm), sans retour latéral, sur pieds
    if plinth > 0:
        objs.append(add_box("plinthe", ep * mm, (Wtot - ep) * mm, 30 * mm, (30 + ep) * mm, 0, plinth * mm, wood, "h", rnd))
    top_h = (Htot + plinth) * mm   # le plan et la vasque ne sont pas dessinés avec le meuble : ils ont leurs propres images (render_parts)
    return objs, dict(W=Wtot * mm, H=top_h, D=D * mm, plinth=plinth, caissons=cfg["_caissons"])


# ───────────────────────────── pièce, lumière, caméra ─────────────────────────────
def add_plane(name, p0, p1, p2, p3, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([p0, p1, p2, p3], [], [(0, 1, 2, 3)])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def setup_world(scene, color, strength):
    w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1); bg.inputs["Strength"].default_value = strength


def add_area_light(loc, target, size, energy, color=(1, 0.97, 0.92)):
    ld = bpy.data.lights.new("sun", "AREA"); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new("sun", ld); bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def make_camera(scene, loc, target, lens=40, shift=(0, 0)):
    cd = bpy.data.cameras.new("cam"); cd.lens = lens; cd.sensor_fit = "VERTICAL"; cd.sensor_height = 24
    cd.shift_x, cd.shift_y = shift
    ob = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = ob
    return ob


def fit_camera(scene, cam, objs, center, fill, direction, fill_w=0.8):
    """Éloigne/rapproche la caméra le long de `direction` jusqu'à ce que le meuble occupe `fill` de la hauteur du cadre."""
    bbox = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo, hi = 0.3, 40.0
    for _ in range(40):
        mid = (lo + hi) / 2
        cam.location = Vector(center) + Vector(direction).normalized() * mid
        cam.rotation_euler = (Vector(center) - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(scene, cam, p) for p in bbox]
        h = max(p.y for p in pts) - min(p.y for p in pts)
        w = max(p.x for p in pts) - min(p.x for p in pts)
        if max(h / fill, w / fill_w) > 1: lo = mid
        else: hi = mid
    return bbox


def set_specular(node, v):
    """Blender 3.x : « Specular » ; Blender 4.x : « Specular IOR Level » (même rôle, valeur 0.5 = ancien 0.5 par défaut)."""
    for name in ("Specular", "Specular IOR Level"):
        if name in node.inputs:
            node.inputs[name].default_value = v
            return


def configure_render(scene, w, h, samples, scale):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    try:  # GPU Apple (Metal) : 5 à 10 fois plus rapide que le processeur
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == "METAL"]
        for d in prefs.devices: d.use = d.type == "METAL"
        if gpus: cy.device = "GPU"
    except Exception as e:
        print("GPU indisponible, rendu CPU :", e)
    print("PÉRIPHÉRIQUE DE RENDU :", cy.device)
    cy.samples = samples; cy.use_denoising = True; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02
    try: cy.denoiser = "OPENIMAGEDENOISE"
    except Exception: pass
    cy.max_bounces = 6
    scene.render.resolution_x = int(w * scale); scene.render.resolution_y = int(h * scale)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def clear_scene_except(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


# ───────────────────────────── rendus ─────────────────────────────
def render_demande(opt, cfg, out):
    scene = reset_scene()
    objs, info = build_furniture(cfg, opt)
    W, H, D = info["W"], info["H"], info["D"]
    wall = mat_plain("mur", (0.66, 0.60, 0.59), 0.95)
    floor = mat_plain("sol", (0.74, 0.72, 0.69), 0.85)
    add_plane("mur", (-30, D, -1), (30, D, -1), (30, D, 12), (-30, D, 12), wall)
    add_plane("sol", (-30, -40, 0), (30, -40, 0), (30, D, 0), (-30, D, 0), floor)
    setup_world(scene, (0.92, 0.88, 0.88), 0.30)
    add_area_light((W + 3.2, -3.6, H * 0.9 + 1.0), (W / 2, D, H * 0.4), 6.0, 520)
    cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=45)
    c = (W / 2, D / 2, H / 2)
    configure_render(scene, 1200, 1735, opt["samples"], opt["scale"])
    fit_camera(scene, cam, objs, c, 0.56, (0.22, -1.0, 0.0), fill_w=0.78)
    cam.location.z = min(1.35, H * 0.55)
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.shift_y = -0.04
    scene.render.filepath = os.path.join(out, "img_demande.png")
    bpy.ops.render.render(write_still=True)


def render_ambiance(opt, cfg, out):
    scene = reset_scene()
    objs, info = build_furniture(cfg, opt)
    W, H, D = info["W"], info["H"], info["D"]
    white = mat_plain("mur_blanc", (0.92, 0.92, 0.91), 0.95)
    lilas = mat_plain("mur_gris", (0.42, 0.42, 0.52), 0.95)
    ceil_z = max(2.75, H + 0.45)
    add_plane("mur_fond", (-4, D, -0.01), (W + 12, D, -0.01), (W + 12, D, ceil_z), (-4, D, ceil_z), white)
    add_plane("mur_gauche", (0, -14, -0.01), (0, D, -0.01), (0, D, ceil_z), (0, -14, ceil_z), lilas)
    add_plane("sol", (-4, -14, 0), (W + 12, -14, 0), (W + 12, D, 0), (-4, D, 0), mat_parquet("parquet"))
    add_plane("plafond", (-4, -14, ceil_z), (W + 12, -14, ceil_z), (W + 12, D, ceil_z), (-4, D, ceil_z), white)
    setup_world(scene, (0.9, 0.92, 0.95), 0.30)
    add_area_light((W + 3.0, -2.8, 2.3), (W / 2, D, H * 0.4), 5.0, 300)
    cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=38)
    c = (W / 2, D / 2, H / 2)
    configure_render(scene, 1600, 867, opt["samples"], opt["scale"])
    fit_camera(scene, cam, objs, c, 0.74, (0.95, -1.0, 0.10), fill_w=0.72)
    cam.location.z = 1.4
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.shift_x = -0.12
    scene.render.filepath = os.path.join(out, "img_ambiance.png")
    bpy.ops.render.render(write_still=True)



def verifier(cfg, objs, out):
    """Compare ce qui a été dessiné à ce que dit le JSON (comptage indépendant) et écrit verification.json."""
    import collections
    bpy.context.view_layer.update()
    built = collections.Counter()
    xs = []
    for o in objs:
        base = o.name.split(".")[0]
        built[base] += 1
        if base.startswith("joue"):
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            xs += [p.x for p in pts]
    got = {"porte": built["porte"], "tiroir": built["tiroir"], "etagere": built["shelf"], "intercalaire": built["sep"], "tringle": built["tringle"],
           "caissons": built["joue_gauche"] or built["joue_g"], "largeur_mm": round((max(xs) - min(xs)) * 1000) if xs else 0}
    want = count_raw(cfg)
    lignes, ok = [], True
    labels = {"porte": "portes", "tiroir": "tiroirs", "etagere": "étagères", "intercalaire": "intercalaires", "tringle": "tringles", "caissons": "caissons", "largeur_mm": "largeur totale (mm)"}
    for k in ("caissons", "largeur_mm", "porte", "tiroir", "etagere", "intercalaire", "tringle"):
        w, g = want[k], got[k]
        tol = 2 if k == "largeur_mm" else 0
        bon = abs(w - g) <= tol
        ok = ok and bon
        lignes.append({"element": labels[k], "json": w, "dessine": g, "ok": bon})
    json.dump({"ok": ok, "lignes": lignes, "non_dessine": non_dessines(cfg)}, open(os.path.join(out, "verification.json"), "w"), ensure_ascii=False)

def mat_stone(name, tex_path, rough=0.25, color=(0.78, 0.76, 0.72), scale=2.5):
    """Matière pierre/minéral : texture projetée en boîte (pas besoin d'UV), pour la vasque importée."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    set_specular(bsdf, 0.4)
    if tex_path and os.path.exists(tex_path):
        tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(tex_path); t.projection = "BOX"; t.projection_blend = 0.2
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    return m


def _studio(scene, size):
    """Fond neutre + lumière douce pour photographier une pièce seule."""
    floor = mat_plain("studio_sol", (0.80, 0.79, 0.77), 0.9)
    add_plane("studio_sol", (-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0), floor)
    setup_world(scene, (0.93, 0.93, 0.94), 0.55)
    k = (size / 1.6) ** 2   # l'éclairement baisse avec le carré de la distance : on adapte la puissance à la taille de la pièce
    add_area_light((size * 1.2, -size * 2.5, size * 1.2), (0, 0, 0), 3.0, 260 * k)
    add_area_light((-size * 2.5, -size * 1.5, size * 1.6), (0, 0, 0), 4.0, 160 * k)


def render_parts(opt, cfg, out):
    """Photo du plan de travail seul et de la vasque seule, chacune avec sa texture (salle de bain)."""
    plan = cfg.get("plan") or {}
    vas = cfg.get("vasques") or {}
    rnd = random.Random(7)
    if plan.get("L") and plan.get("P"):
        scene = reset_scene()
        L, P = plan["L"] / 100.0, plan["P"] / 100.0
        ep = (plan.get("Ep_cm") or (plan.get("Ep") if (plan.get("Ep") or 0) >= 1 else 0) or 4) / 100.0
        tex = PLAN_TEX.get(str(plan.get("matLabel") or "").strip().lower())
        pm = mat_wood("plan", os.path.join(REPO, "textures", tex) if tex else None, (0.78, 0.76, 0.72), 0.25)
        o = add_box("plan", -L / 2, L / 2, -P / 2, P / 2, 0.0, ep, pm, "h", rnd)
        _studio(scene, max(L, P))
        cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=45)
        configure_render(scene, 1200, 800, min(opt["samples"], 14), opt["scale"])
        fit_camera(scene, cam, [o], (0, 0, ep / 2), 0.62, (0.55, -1.0, 0.75), fill_w=0.70)
        scene.render.filepath = os.path.join(out, "rendu-plan.png")
        bpy.ops.render.render(write_still=True)
    nb = vas.get("nb"); nb = 1 if nb is None else int(nb)
    if nb > 0 and plan.get("L"):
        vid = vas.get("id") or "v1"
        glb = os.path.join(REPO, "models", "vasque-%s.glb" % vid)
        if os.path.exists(glb):
            scene = reset_scene()
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=glb)
            new = [ob for ob in bpy.data.objects if ob not in before]
            meshes = [ob for ob in new if ob.type == "MESH"]
            root = bpy.data.objects.new("vasque_root", None); bpy.context.collection.objects.link(root)
            for ob in new:
                if ob.parent is None: ob.parent = root
            bpy.context.view_layer.update()
            pts = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
            sx0 = max(v.x for v in pts) - min(v.x for v in pts); sy0 = max(v.y for v in pts) - min(v.y for v in pts)
            VW, VD = (vas.get("W") or 50) / 100.0, (vas.get("D") or 35) / 100.0
            fx, fy = VW / sx0, VD / sy0
            root.scale = (fx, fy, min(fx, fy)); bpy.context.view_layer.update()
            pts = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
            cxv = (max(v.x for v in pts) + min(v.x for v in pts)) / 2; cyv = (max(v.y for v in pts) + min(v.y for v in pts)) / 2; mnz = min(v.z for v in pts)
            root.location = (-cxv, -cyv, -mnz)
            label = str(vas.get("finition") or plan.get("matLabel") or "").strip().lower()
            tex = PLAN_TEX.get(label)
            vm = mat_stone("vasque", os.path.join(REPO, "textures", tex) if tex else None, rough=0.5)
            chrome = mat_plain("robinet", (0.62, 0.62, 0.64), 0.2)
            for ob in meshes:
                ob.data.materials.clear()
                ob.data.materials.append(chrome if re.search(r"cygne|robinet|mitigeur|tap|bec", ob.name + (ob.parent.name if ob.parent else ""), re.I) else vm)
            bpy.context.view_layer.update()
            hz = max(v.z for v in [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]) / 2
            _studio(scene, max(VW, VD))
            cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=45)
            configure_render(scene, 1200, 800, min(opt["samples"], 14), opt["scale"])
            fit_camera(scene, cam, meshes, (0, 0, hz), 0.62, (0.5, -1.0, 0.85), fill_w=0.70)
            scene.render.filepath = os.path.join(out, "rendu-vasque.png")
            bpy.ops.render.render(write_still=True)


def render_pair(opt, cfg, out):
    """Deux images rapides pour le devis : meuble fermé, puis portes et tiroirs ouverts (même caméra)."""
    scene = reset_scene()
    objs, info = build_furniture(cfg, opt, open_state=False)
    W, H, D = info["W"], info["H"], info["D"]
    verifier(cfg, objs, out)
    wall = mat_plain("mur", (0.66, 0.60, 0.59), 0.95)
    floor = mat_plain("sol", (0.74, 0.72, 0.69), 0.85)
    add_plane("mur", (-30, D, -1), (30, D, -1), (30, D, 12), (-30, D, 12), wall)
    add_plane("sol", (-30, -40, 0), (30, -40, 0), (30, D, 0), (-30, D, 0), floor)
    setup_world(scene, (0.92, 0.88, 0.88), 0.35)
    add_area_light((W + 3.2, -3.8, H * 0.9 + 1.0), (W / 2, D, H * 0.4), 6.0, 560)
    add_area_light((-W * 0.4 - 1.5, -3.0, H * 0.8 + 0.6), (W / 2, 0, H * 0.4), 5.0, 220)   # contre-jour doux : éclaire l'intérieur
    cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=42)
    c = (W / 2, D / 2, H / 2)
    configure_render(scene, 1500, 1100, opt["samples"], opt["scale"])
    plan_clair = str((cfg.get("plan") or {}).get("matLabel") or "").strip().lower() in ("miami white", "blanc elysée", "blanc elysee", "linen cream", "white arabesque", "blanc gris", "blanc multicolore")
    if plan_clair and decor_name(cfg, opt).strip().lower() not in LIGHT_DECORS:
        scene.view_settings.exposure = -0.7
    if decor_name(cfg, opt).strip().lower() in LIGHT_DECORS:
        scene.view_settings.exposure = -1.3
        wall.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.50, 0.46, 0.45, 1)
    fit_camera(scene, cam, objs, c, 0.60, (0.18, -1.0, 0.0), fill_w=0.58)
    cam.location.z = min(1.45, H * 0.55)
    if cfg.get("furniture_type") == "sdb" and (cfg.get("plan") or {}).get("L"):
        pass
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.shift_y = -0.03
    scene.render.filepath = os.path.join(out, "rendu-ferme.png")
    bpy.ops.render.render(write_still=True)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    build_furniture(cfg, opt, open_state=True)
    scene.render.filepath = os.path.join(out, "rendu-ouvert.png")
    bpy.ops.render.render(write_still=True)


def render_cotes(opt, cfg, out):
    scene = reset_scene()
    objs, info = build_furniture(cfg, opt)
    W, H, D, pl = info["W"], info["H"], info["D"], info["plinth"] * 0.001
    cais = info["caissons"]
    floor = mat_plain("sol", (1, 1, 1), 1.0)
    fl = add_plane("sol", (-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0), floor)
    fl.is_shadow_catcher = True
    scene.render.film_transparent = True
    setup_world(scene, (1, 1, 1), 0.75)
    add_area_light((-W - 1.5, -2.5, H + 1.5), (W / 2, D / 2, H / 3), 4.0, 260)
    cam = make_camera(scene, (0, 0, 0), (0, 0, 0), lens=45)
    c = (W / 2, D / 2, H / 2)
    configure_render(scene, 1050, 2284, opt["samples"], opt["scale"])
    # meuble vu un peu depuis la gauche, comme dans le dossier : fill réduit pour laisser la place aux cotes
    fit_camera(scene, cam, objs, c, 0.66, (-0.30, -1.0, 0.0), fill_w=0.70)
    cam.location.z = min(1.4, H * 0.5)
    cam.rotation_euler = (Vector(c) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, "_cotes_base.png")
    bpy.ops.render.render(write_still=True)

    # --- cotes : projection 3D -> écran ; le tracé 2D est fait par annotate_cotes.py (Python système, Pillow) ---
    res = (scene.render.resolution_x, scene.render.resolution_y)
    def P(x, y, z):
        v = world_to_camera_view(scene, cam, Vector((x, y, z)))
        return [v.x * res[0], (1 - v.y) * res[1]]
    dims = []
    def dim(p0, p1, off, txt):
        a = (p0[0] + off[0], p0[1] + off[1], p0[2] + off[2]); b = (p1[0] + off[0], p1[1] + off[1], p1[2] + off[2])
        dims.append({"p0": P(*p0), "p1": P(*p1), "a": P(*a), "b": P(*b), "label": txt})
    m = min(0.25, 0.12 + 0.03 * max(0.0, W - 1.2))  # écart des lignes de cote
    dim((0, 0, H), (W, 0, H), (0, 0, m * (2.0 if len(cais) > 1 else 1.0)), "%d mm" % round(W * 1000))   # largeur totale
    if len(cais) > 1:                                                                                  # largeur de chaque caisson
        for ox, sp in cais:
            w = sp["overall_mm"]["width"]
            dim((ox * 0.001, 0, H), ((ox + w) * 0.001, 0, H), (0, 0, m * 0.8), "%d mm" % w)
    dim((0, 0, 0), (0, 0, H), (-m, 0, 0), "%d mm" % round(H * 1000))             # hauteur totale (plinthe comprise)
    dim((0, 0, 0), (0, D, 0), (-m * 0.35, 0, -0.05), "%d mm" % round(D * 1000))   # profondeur (en bas à gauche)
    ox_r, sp_r = max(cais, key=lambda c: c[0] + c[1]["overall_mm"]["width"])
    doors = list(sp_r.get("doors", [])) + list(sp_r.get("drawers", []))
    if doors:                                                                    # façades du caisson le plus à droite
        xr = max(d["x_right_mm"] for d in doors)
        for d in sorted([d for d in doors if d["x_right_mm"] == xr], key=lambda d: d["y_bottom_mm"]):
            z0 = d["y_bottom_mm"] * 0.001 + pl
            dim((W, 0, z0), (W, 0, z0 + d["height_mm"] * 0.001), (m, 0, 0), "%d mm" % d["height_mm"])
    if pl > 0:
        dim((W, 0, 0), (W, 0, pl), (m, 0, 0), "%d mm" % round(pl * 1000))
    json.dump({"dims": dims}, open(os.path.join(out, "_cotes_dims.json"), "w"))


def main():
    opt = parse_args()
    os.makedirs(opt["out"], exist_ok=True)
    cfg = load_spec(opt["json"])
    for v in opt["only"].split(","):
        v = v.strip()
        {"demande": render_demande, "ambiance": render_ambiance, "cotes": render_cotes, "pair": render_pair, "parts": render_parts}[v](opt, cfg, opt["out"])
    print("Rendus terminés :", opt["out"])


main()
