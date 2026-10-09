#!/usr/bin/env python3
"""Assistant local de rendus pour l'admin Kōbō (à laisser tourner sur le Mac).

L'admin (kobo-design.fr/admin) envoie le JSON d'un meuble à http://127.0.0.1:8765/rendre ;
Blender fabrique les 2 images (meuble fermé / portes et tiroirs ouverts) et les renvoie en ≈ 30-40 s.
Rien n'est accessible depuis l'extérieur : le serveur n'écoute que sur 127.0.0.1 et n'accepte que les requêtes
venant de kobo-design.fr (ou d'un serveur local de test).
"""
import base64, io, json, os, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
PORT = 8765
ORIGINS = {"https://www.kobo-design.fr", "https://kobo-design.fr", "http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:8000"}
LOCK = threading.Lock()
CACHE = {}  # empreinte du JSON -> images déjà rendues


def rendre(cfg_text):
    import hashlib
    from PIL import Image
    # l'empreinte inclut la date du script de rendu : un script modifié n'est jamais servi avec d'anciennes images
    key = hashlib.sha1((cfg_text + str(os.path.getmtime(HERE / 'render' / 'render_meuble.py'))).encode()).hexdigest()
    if key in CACHE:
        return CACHE[key]
    with tempfile.TemporaryDirectory() as tmp:
        js = Path(tmp) / "meuble.json"
        js.write_text(cfg_text, encoding="utf-8")
        has_plan = bool((json.loads(cfg_text).get("plan") or {}).get("L"))
        r = subprocess.run([BLENDER, "-b", "-P", str(HERE / "render" / "render_meuble.py"), "--", str(js), tmp, "--only", "pair,parts" if has_plan else "pair", "--samples", "16"],
                           capture_output=True, text=True, timeout=300)
        out = {}
        for k, f in (("ferme", "rendu-ferme.png"), ("ouvert", "rendu-ouvert.png")):
            p = Path(tmp) / f
            if not p.exists():
                raise RuntimeError("Blender n'a pas produit %s : %s" % (f, (r.stdout + r.stderr)[-400:]))
            buf = io.BytesIO()
            Image.open(p).convert("RGB").save(buf, "JPEG", quality=90)
            out[k] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        for k, f in (("plan", "rendu-plan.png"), ("vasque", "rendu-vasque.png")):   # salle de bain : photos séparées du plan et de la vasque
            p = Path(tmp) / f
            if p.exists():
                buf = io.BytesIO()
                Image.open(p).convert("RGB").save(buf, "JPEG", quality=90)
                out[k] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        vf = Path(tmp) / "verification.json"
        if vf.exists():
            out["verification"] = json.loads(vf.read_text(encoding="utf-8"))
    CACHE[key] = out
    return out


class H(BaseHTTPRequestHandler):
    def _cors(self):
        o = self.headers.get("Origin", "")
        if o in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path.startswith("/ping") and self.headers.get("Origin", "") in ORIGINS | {""}:
            return self._json(200, {"ok": True})
        self._json(404, {"error": "inconnu"})

    def do_POST(self):
        if self.headers.get("Origin", "") not in ORIGINS:
            return self._json(403, {"error": "origine refusée"})
        if self.path != "/rendre":
            return self._json(404, {"error": "inconnu"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 3_000_000:
                return self._json(400, {"error": "corps invalide"})
            txt = ""
            txt = self.rfile.read(n).decode("utf-8")
            json.loads(txt)
            try: Path("/tmp/kobo-dernier.json").write_text(txt, encoding="utf-8")
            except Exception: pass
            with LOCK:
                self._json(200, rendre(txt))
        except Exception as e:  # noqa
            sys.stderr.write("[rendus] ERREUR : %s\n" % e)
            try: Path("/tmp/kobo-dernier-echec.json").write_text(txt, encoding="utf-8")
            except Exception: pass
            self._json(500, {"error": str(e)})

    def log_message(self, fmt, *a):
        sys.stderr.write("[rendus] " + fmt % a + "\n")


if __name__ == "__main__":
    print("Assistant de rendus Kōbō prêt sur http://127.0.0.1:%d — laisse cette fenêtre ouverte." % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
