#!/usr/bin/env bash
# Point 4/4 — Librairie xlsx : passage de la 0.18.5 (failles connues) à la 0.20.3 corrigée
# Usage : ./04-xlsx.sh [chemin-de-l-app]     (défaut : ~/canoshift/planning-app)
#
# Les versions corrigées de SheetJS ne sont plus publiées sur npm mais sur le site de l'éditeur (cdn.sheetjs.com).
# La librairie sert uniquement à l'import/export Excel dans le navigateur de l'administrateur.
# À faire APRÈS les points 1 à 3, puis tester un import et un export Excel.

set -u
APP_DIR="${1:-$HOME/canoshift/planning-app}"
URL="https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
BACKUP_DIR="$HOME/backup-canoshift-xlsx-$(date +%Y%m%d-%H%M%S)"
say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "Dossier introuvable : $APP_DIR"
cd "$APP_DIR" || exit 1
[ -f package.json ] || die "package.json introuvable."
if docker ps >/dev/null 2>&1; then D="docker"; else D="sudo docker"; fi
health() { curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health; }

say "0/4  Vérifications préalables"
[ "$(health)" = "200" ] || die "L'app ne répond pas. Répare-la d'abord."
grep -q '"xlsx": "\^0.18' package.json || die "package.json ne contient pas xlsx ^0.18.x (déjà fait ?). Rien à faire."
CODE=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -I "$URL")
[ "$CODE" = "200" ] || die "Le site de SheetJS n'est pas joignable depuis la VM (HTTP $CODE). Réessaie plus tard."
echo "OK : application en ligne, version corrigée téléchargeable."

say "1/4  Sauvegarde dans $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -p package.json "$BACKUP_DIR/"; cp -p bun.lock "$BACKUP_DIR/" 2>/dev/null
sudo tar czf "$BACKUP_DIR/data.tgz" data 2>/dev/null || warn "sauvegarde de data/ incomplète"
sudo chown -R "$(id -u):$(id -g)" "$BACKUP_DIR"

say "2/4  Modification de package.json"
sed -i "s#\"xlsx\": \"^0.18.5\"#\"xlsx\": \"$URL\"#" package.json
grep -n '"xlsx"' package.json

say "3/4  Reconstruction (1 à 3 minutes)"
if ! $D compose up -d --build; then
  warn "Échec du rebuild. Retour arrière :"
  echo "  cp $BACKUP_DIR/package.json . && cp $BACKUP_DIR/bun.lock . 2>/dev/null; $D compose up -d --build"; exit 1
fi

say "4/4  Vérifications"
for i in $(seq 1 40); do [ "$(health)" = "200" ] && break; sleep 2; done
[ "$(health)" = "200" ] && echo "  OK    l'application répond" || warn "l'application ne répond pas : $D logs --tail 40 CanoShift"
cat <<EOF

À TESTER dans l'app (mode admin) :
  1. Exporter le planning en Excel -> le fichier s'ouvre et les horaires sont corrects.
  2. Importer un fichier Excel de test -> les journées s'affichent.
Si l'un des deux échoue, retour arrière :
  cd $APP_DIR
  cp $BACKUP_DIR/package.json .
  cp $BACKUP_DIR/bun.lock . 2>/dev/null
  $D compose up -d --build
EOF
