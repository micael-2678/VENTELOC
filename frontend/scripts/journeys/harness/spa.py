"""Serveur statique minimal d'une application monopage (repli sur index.html) : python spa.py <dossier build> [port]"""
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "build")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 3000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        path = self.translate_path(self.path.split("?", 1)[0])
        if not os.path.exists(path) or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html"))):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
