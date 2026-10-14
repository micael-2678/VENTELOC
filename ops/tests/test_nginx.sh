#!/usr/bin/env bash
# Tests de non-régression de frontend/nginx.conf avec un vrai nginx (sans Docker) :
# adresse IP du client (X-Forwarded-For non falsifiable), absence de redirection héritée (/vendre est une page),
# module /embed/ affichable en iframe (frame-ancestors EMBED_ALLOWED_ORIGINS, sans X-Frame-Options), cache des
# fichiers versionnés, CSP sans 'unsafe-inline' pour les scripts. Usage : ops/tests/test_nginx.sh (nginx et python3 requis).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
chmod 755 "$WORK"  # lisible par les workers nginx (utilisateur nobody quand nginx est lancé en root)
NGINX_PORT="${NGINX_TEST_PORT:-18089}"
# Valeur de EMBED_ALLOWED_ORIGINS simulée (substituée au démarrage du conteneur, voir frontend/Dockerfile)
EMBED_ORIGIN="https://wp.exemple.fr"
BACKEND_PORT="${BACKEND_TEST_PORT:-18098}"
failures=0
cleanup() {
  [ -f "$WORK/nginx.pid" ] && kill "$(cat "$WORK/nginx.pid")" 2>/dev/null
  [ -n "${echo_pid:-}" ] && kill "$echo_pid" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v nginx >/dev/null || { echo "nginx absent : test ignoré"; exit 0; }

check() { # check <description> <commande…>
  local desc="$1"; shift
  if "$@"; then echo "ok   - $desc"; else echo "ÉCHEC - $desc"; failures=$((failures + 1)); fi
}

# Faux backend : renvoie l'en-tête X-Forwarded-For reçu
cat > "$WORK/echo.py" <<'EOF'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = (self.headers.get("X-Forwarded-For") or "").encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
EOF
python3 "$WORK/echo.py" "$BACKEND_PORT" & echo_pid=$!

# Racine factice du build
mkdir -p "$WORK/html/static/media" "$WORK/html/static/js" "$WORK/tmp"
echo "<html>accueil</html>" > "$WORK/html/index.html"
echo "<html>app</html>" > "$WORK/html/app-shell.html"
echo "font" > "$WORK/html/static/media/inter-latin-400-normal.eca1e215.woff2"
echo "js" > "$WORK/html/static/js/main.a0610a0a.js"
echo "ico" > "$WORK/html/favicon.ico"

start_nginx() { # start_nginx <trust_loopback:0|1>
  [ -f "$WORK/nginx.pid" ] && kill "$(cat "$WORK/nginx.pid")" 2>/dev/null && sleep 0.3
  local site="$WORK/site.conf"
  sed -e "s/listen 80;/listen 127.0.0.1:$NGINX_PORT;/" \
      -e "s#root /usr/share/nginx/html;#root $WORK/html;#" \
      -e "s#resolver 127.0.0.11 valid=30s ipv6=off;#resolver 127.0.0.1;#" \
      -e "s#http://venteloc-api:8001#http://127.0.0.1:$BACKEND_PORT#" \
      -e "s#\${EMBED_ALLOWED_ORIGINS}#$EMBED_ORIGIN#" \
      "$ROOT/frontend/nginx.conf" > "$site"
  # Sans confiance dans 127.0.0.1, le client de test se comporte comme un visiteur public qui atteint nginx directement
  [ "$1" = "1" ] || sed -i '/set_real_ip_from 127.0.0.1;/d' "$site"
  cat > "$WORK/nginx.conf" <<EOF
pid $WORK/nginx.pid;
error_log $WORK/error.log;
events {}
http {
  types { text/html html; application/javascript js; font/woff2 woff2; image/x-icon ico; }
  access_log off;
  client_body_temp_path $WORK/tmp; proxy_temp_path $WORK/tmp; fastcgi_temp_path $WORK/tmp;
  uwsgi_temp_path $WORK/tmp; scgi_temp_path $WORK/tmp;
  include $site;
}
EOF
  nginx -e "$WORK/error.log" -c "$WORK/nginx.conf" -p "$WORK" || { echo "nginx ne démarre pas"; cat "$WORK/error.log"; exit 1; }
  sleep 0.3
}

url="http://127.0.0.1:$NGINX_PORT"

# 1. Visiteur public direct : son X-Forwarded-For est ignoré, deux valeurs différentes donnent la même adresse
start_nginx 0
a="$(curl -s -H 'X-Forwarded-For: 1.1.1.1' "$url/api/x")"
b="$(curl -s -H 'X-Forwarded-For: 2.2.2.2, 3.3.3.3' "$url/api/x")"
check "X-Forwarded-For falsifié par un client direct ignoré (« $a »)" test "$a" = "127.0.0.1"
check "deux X-Forwarded-For différents → même adresse (même compteur de limitation)" test "$a" = "$b"

# 2. Derrière Traefik (proxy de confiance) : l'adresse réelle est la plus à droite non fiable, valeur unique
start_nginx 1
c="$(curl -s -H 'X-Forwarded-For: 9.9.9.9, 203.0.113.7' "$url/api/x")"
check "derrière un proxy de confiance → adresse réelle seule (« $c »)" test "$c" = "203.0.113.7"

# 3. Pages de l'application servies telles quelles (aucune redirection héritée de CessionRGE)
status_of() { curl -s -o /dev/null -w '%{http_code}' "$url$1"; }
for p in /vendre /estimer /annonce/abc /search /entreprises-a-vendre; do
  check "$p → 200 (application monopage, pas de 301)" test "$(status_of "$p")" = "200"
done

# 3 ter. Module intégrable : affichable en iframe depuis EMBED_ALLOWED_ORIGINS seulement ; ailleurs DENY
e="$(curl -sI "$url/embed/annonces?limit=6" | tr -d '\r')"
check "/embed/annonces → 200 (gabarit SPA)" bash -c "grep -q '^HTTP/1.1 200' <<<\"\$1\"" _ "$e"
check "/embed/ : pas de X-Frame-Options" bash -c "! grep -qi '^x-frame-options:' <<<\"\$1\"" _ "$e"
check "/embed/ : frame-ancestors 'self' $EMBED_ORIGIN" bash -c "grep -q \"frame-ancestors 'self' $EMBED_ORIGIN;\" <<<\"\$1\"" _ "$e"
check "/embed/ : en-têtes de sécurité conservés, noindex" bash -c "grep -qi '^x-content-type-options: nosniff' <<<\"\$1\" && grep -qi '^x-robots-tag: noindex' <<<\"\$1\"" _ "$e"
a="$(curl -sI "$url/" | tr -d '\r')"
check "/ : X-Frame-Options DENY et frame-ancestors 'none'" bash -c "grep -qi '^x-frame-options: DENY' <<<\"\$1\" && grep -q \"frame-ancestors 'none'\" <<<\"\$1\"" _ "$a"

# 3 bis. www → domaine principal
loc="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Host: www.exemple.fr' "$url/annonce/x?y=1")"
check "www.<domaine> → 301 https://<domaine> (« $loc »)" test "$loc" = "301 https://exemple.fr/annonce/x?y=1"

# 4. Cache : polices versionnées d'un an, fichiers non versionnés d'une semaine
cc="$(curl -sI "$url/static/media/inter-latin-400-normal.eca1e215.woff2" | tr -d '\r' | grep -i '^cache-control:')"
check "police versionnée /static/media/*.woff2 → max-age d'un an (« $cc »)" bash -c "grep -q 'max-age=31536000' <<<'$cc'"
cc="$(curl -sI "$url/favicon.ico" | tr -d '\r' | grep -i '^cache-control:')"
check "favicon → max-age d'une semaine" bash -c "grep -q 'max-age=604800' <<<'$cc'"

# 5. En-têtes de sécurité présents partout, CSP sans 'unsafe-inline' pour les scripts
h="$(curl -sI "$url/static/js/main.a0610a0a.js" | tr -d '\r')"
check "en-têtes de sécurité sur /static/" bash -c "grep -qi '^content-security-policy:' <<<\"\$1\" && grep -qi '^x-frame-options: DENY' <<<\"\$1\"" _ "$h"
csp="$(grep -i '^content-security-policy:' <<<"$h")"
check "CSP : script-src 'self' sans 'unsafe-inline'" bash -c "grep -q \"script-src 'self';\" <<<\"\$1\"" _ "$csp"

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) en échec"
  exit 1
fi
echo "tous les tests nginx passent"
