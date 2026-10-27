#!/usr/bin/env bash
# Point 3/4 — Conteneur sans droits root + fin du chmod 777 sur data/
# Usage : ./03-conteneur-non-root.sh [chemin-de-l-app]     (défaut : ~/canoshift/planning-app)
#
# Ce que fait ce script :
#   - Dockerfile : le serveur tourne avec l'utilisateur « bun » (uid 1000) au lieu de root ;
#   - docker-compose.yml : no-new-privileges + suppression de toutes les capacités Linux inutiles ;
#   - data/ : propriétaire = uid 1000 (ton utilisateur « freebox »), droits 750 au lieu de 777 ;
#   - update-freebox.sh / install-freebox.sh : remplace « chmod -R 777 data » par un chown propre.
# Les originaux sont copiés dans le dossier de sauvegarde (retour arrière sans toucher à git).

set -u
APP_DIR="${1:-$HOME/canoshift/planning-app}"

# ---- modifications de fichiers (idempotentes) ----------------------------------------------------
appliquer_modifs() {
  local d="$1"
  # Dockerfile
  if ! grep -q '^USER bun' "$d/Dockerfile"; then
    sed -i 's|^RUN mkdir -p /app/data$|RUN mkdir -p /app/data \&\& chown -R bun:bun /app/data\n\n# Le serveur tourne sans droits root\nUSER bun|' "$d/Dockerfile"
  fi
  # docker-compose.yml
  if ! grep -q 'no-new-privileges' "$d/docker-compose.yml"; then
    sed -i 's#^\(\s*\)restart: unless-stopped$#\1restart: unless-stopped\n\1security_opt:\n\1  - no-new-privileges:true\n\1cap_drop:\n\1  - ALL#' "$d/docker-compose.yml"
  fi
  # scripts : plus de chmod 777
  for f in update-freebox.sh install-freebox.sh; do
    [ -f "$d/$f" ] || continue
    sed -i 's#^\(\s*\)chmod -R 777 "\$APP_DIR/data".*$#\1chown -R 1000:1000 "$APP_DIR/data" 2>/dev/null || sudo chown -R 1000:1000 "$APP_DIR/data" 2>/dev/null || true\n\1chmod -R u=rwX,g=rX,o= "$APP_DIR/data" 2>/dev/null || sudo chmod -R u=rwX,g=rX,o= "$APP_DIR/data" 2>/dev/null || true#' "$d/$f"
  done
}
if [ "${CANOSHIFT_TEST_EDITS_ONLY:-}" = "1" ]; then appliquer_modifs "$APP_DIR"; exit 0; fi

# ---- exécution -----------------------------------------------------------------------------------
BACKUP_DIR="$HOME/backup-canoshift-nonroot-$(date +%Y%m%d-%H%M%S)"
say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "Dossier introuvable : $APP_DIR"
cd "$APP_DIR" || exit 1
[ -f Dockerfile ] && [ -f docker-compose.yml ] || die "Ce dossier ne ressemble pas à l'app CanoShift."
if docker ps >/dev/null 2>&1; then D="docker"; else D="sudo docker"; fi
health() { curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health; }

say "0/5  L'application répond-elle avant ?"
[ "$(health)" = "200" ] || die "L'app ne répond pas. Répare-la d'abord."
[ "$(id -u)" = "1000" ] || warn "Ton utilisateur n'a pas l'uid 1000 (uid $(id -u)) : les fichiers de data/ appartiendront à l'uid 1000, pas à toi (sans conséquence pour l'app)."

say "1/5  Sauvegarde dans $BACKUP_DIR"
mkdir -p "$BACKUP_DIR/originaux"
sudo tar czf "$BACKUP_DIR/data.tgz" data || die "sauvegarde de data/ impossible"
cp -p Dockerfile docker-compose.yml update-freebox.sh install-freebox.sh "$BACKUP_DIR/originaux/" 2>/dev/null
(cd data && sudo find . -type f -name '*.json' -exec sha256sum {} + | sort -k2) > "$BACKUP_DIR/empreintes-avant.txt"
sudo chown -R "$(id -u):$(id -g)" "$BACKUP_DIR"
echo "$(wc -l < "$BACKUP_DIR/empreintes-avant.txt") fichier(s) de données enregistrés avec leur empreinte."

say "2/5  Modifications des fichiers"
appliquer_modifs "$APP_DIR"
git diff --stat -- Dockerfile docker-compose.yml update-freebox.sh install-freebox.sh 2>/dev/null | tail -6

say "3/5  Droits de data/ (propriétaire uid 1000, plus de 777)"
sudo chown -R 1000:1000 data
sudo chmod -R u=rwX,g=rX,o= data
ls -ld data data/* | head -8

say "4/5  Reconstruction (1 à 3 minutes)"
if ! $D compose up -d --build; then
  warn "Échec du rebuild. Retour arrière :"
  echo "  cp $BACKUP_DIR/originaux/* ."; echo "  $D compose up -d --build"; exit 1
fi

say "5/5  Vérifications"
for i in $(seq 1 40); do [ "$(health)" = "200" ] && break; sleep 2; done
OK=0; BAD=0
chk() { if [ "$2" = "$3" ]; then echo "  OK    $1"; OK=$((OK+1)); else echo "  ECHEC $1 (attendu « $2 », obtenu « $3 »)"; BAD=$((BAD+1)); fi; }
chk "l'application répond"                       200  "$(health)"
chk "le serveur tourne avec l'uid"               1000 "$($D exec CanoShift id -u 2>/dev/null)"
chk "écriture dans data/ possible"               OK   "$($D exec CanoShift sh -c 'touch /app/data/.test_ecriture && rm /app/data/.test_ecriture && echo OK' 2>/dev/null)"
chk "config sans connexion refusée"              401  "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/config)"
(cd data && sudo find . -type f -name '*.json' -exec sha256sum {} + | sort -k2) > "$BACKUP_DIR/empreintes-apres.txt"
if diff -q "$BACKUP_DIR/empreintes-avant.txt" "$BACKUP_DIR/empreintes-apres.txt" >/dev/null; then echo "  OK    données identiques (empreintes inchangées)"; OK=$((OK+1)); else echo "  INFO  des données ont changé (normal si quelqu'un a utilisé l'app pendant l'opération)"; fi
say "Résultat : $OK OK, $BAD échec(s)"
cat <<EOF

Test à faire sur l'app : modifier puis annuler un horaire en mode admin (vérifie que l'enregistrement fonctionne).

RETOUR ARRIÈRE si besoin :
  cd $APP_DIR
  cp $BACKUP_DIR/originaux/* .
  $D compose up -d --build
EOF
[ "$BAD" -eq 0 ]
