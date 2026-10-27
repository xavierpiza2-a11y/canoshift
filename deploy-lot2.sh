#!/usr/bin/env bash
# Déploiement du lot 2 CanoShift : génération sur l'exercice complet, formules de total dans l'export Excel,
# export du mois choisi (responsable compris), onglet admin « Modifier shift » supprimé, ordre des créneaux verrouillés.
# Aucune donnée n'est réinitialisée ; Dockerfile, docker-compose.yml et package.json ne sont pas touchés.
# Usage (depuis le dossier qui contient canoshift-lot2.patch) :
#   ./deploy-securite.sh [chemin-de-l-app]      (défaut : ~/canoshift/planning-app)
#
# Étapes : vérifications -> sauvegarde -> application du patch -> rebuild Docker
#          -> tests rapides -> consignes de retour arrière.
# En cas de problème avant le rebuild, RIEN n'est modifié.

set -u
APP_DIR="${1:-$HOME/canoshift/planning-app}"
PATCH="$(cd "$(dirname "$0")" && pwd)/canoshift-lot2.patch"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/backup-canoshift-lot2-$STAMP"

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$PATCH" ]   || die "Fichier introuvable : $PATCH (mets-le dans le même dossier que ce script)"
[ -d "$APP_DIR" ] || die "Dossier introuvable : $APP_DIR"
cd "$APP_DIR" || exit 1
[ -f server.ts ] && [ -f docker-compose.yml ] || die "Ce dossier ne ressemble pas à l'app CanoShift."
grep -q "requireStore" server.ts || die "Le correctif de sécurité n'est pas appliqué."
[ -f src/shared/coreConfig.ts ] || die "L'évolution précédente (catégories, génération) n'est pas appliquée : applique-la d'abord."
grep -q "mergeKeepingOrder" src/shared/coreConfig.ts && die "Le lot 2 semble déjà appliqué."

if docker ps >/dev/null 2>&1; then D="docker"; else D="sudo docker"; fi
say "Docker : $D"

# --- 1. Sauvegardes ---------------------------------------------------------
say "1/5  Sauvegarde dans $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
git status --short > "$BACKUP_DIR/git-status.txt" 2>&1
git diff > "$BACKUP_DIR/modifs-locales-avant.patch" 2>&1
git rev-parse HEAD > "$BACKUP_DIR/commit-avant.txt" 2>&1
sudo tar czf "$BACKUP_DIR/data.tgz" data 2>"$BACKUP_DIR/tar-erreurs.txt" || warn "sauvegarde de data/ incomplète (voir tar-erreurs.txt)"
[ -f .env ] && sudo cp -p .env "$BACKUP_DIR/env.sauvegarde" 2>/dev/null
sudo chown -R "$(id -u):$(id -g)" "$BACKUP_DIR" 2>/dev/null
ls -lh "$BACKUP_DIR"

# --- 2. Vérification du patch (sans rien modifier) ---------------------------
say "2/5  Vérification du patch"
if ! git apply --check "$PATCH" 2>"$BACKUP_DIR/apply-check.txt"; then
  cat "$BACKUP_DIR/apply-check.txt"
  die "Le patch ne s'applique pas proprement. RIEN n'a été modifié. Envoie-moi les fichiers $BACKUP_DIR/git-status.txt et modifs-locales-avant.patch."
fi
echo "Le patch s'applique proprement."

# --- 3. Application ---------------------------------------------------------
say "3/5  Application du patch"
git apply "$PATCH" || die "Échec de l'application (état inchangé grâce à --check ; vérifie git status)."
git status --short

# SUPER_ADMIN_PASSWORD obligatoire pour l'espace gestionnaire
if ! sudo grep -q '^SUPER_ADMIN_PASSWORD=.\+' .env 2>/dev/null; then
  warn "SUPER_ADMIN_PASSWORD absent de .env : l'espace gestionnaire sera inutilisable. Ajoute-le puis relance : $D compose up -d"
fi

# --- 4. Rebuild -------------------------------------------------------------
say "4/5  Reconstruction et redémarrage (1 à 3 minutes)"
if ! $D compose up -d --build; then
  warn "Le rebuild a échoué. Retour arrière :  git apply -R $PATCH && $D compose up -d --build"
  exit 1
fi

# --- 5. Vérifications rapides ----------------------------------------------
say "5/5  Vérifications"
OK=0; BAD=0
check() { # nom, attendu, obtenu
  if [ "$2" = "$3" ]; then echo "  OK    $1"; OK=$((OK+1)); else echo "  ECHEC $1 (attendu $2, obtenu $3)"; BAD=$((BAD+1)); fi
}
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3000/api/health && break; sleep 1; done
check "génération sans connexion refusée"       401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/planning/generate)"
check "serveur démarré"                         200 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)"
check "config sans connexion refusée"           401 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/config)"
check "liste des magasins sans connexion"       401 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/superadmin/stores)"
check "sauvegarde globale sans connexion"       401 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/superadmin/backup-all)"
check "suppression de magasin sans connexion"   401 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:3000/api/superadmin/stores/magasin_test_inexistant)"
check "page de l'app servie"                    200 "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/)"
$D compose ps 2>/dev/null | head -5

say "Résultat : $OK OK, $BAD échec(s)"
cat <<EOF

Étapes suivantes (à faire sur l'app) :
  1. Admin > Créneaux : les 6 créneaux « 🔒 Verrouillé » ont maintenant des flèches pour changer leur ordre
     (modifier / supprimer restent interdits). Déplace-en un et recharge la page : l'ordre est conservé.
  2. Admin : l'onglet « Modifier shift » a disparu (la modification se fait depuis la vue planning).
  3. Admin > Excel : choisis un AUTRE mois que celui affiché, télécharge « Exporter le planning du mois » :
     toutes les colonnes sont remplies, responsable compris. La ligne TOTAL HEURES est une formule :
     change une case dans Excel, le total se met à jour. Le modèle vide contient aussi la ligne de total (0h).
  4. Admin > Excel : le bouton « Imprimer le planning du mois (PDF) » remplace l'ancien bouton de l'onglet supprimé.
  5. Ajout d'un salarié : son planning est généré sur les 12 mois de l'exercice (tu peux le tester puis le supprimer).
  6. Si l'écran reste figé sur l'ancienne version : ferme complètement l'app (PWA) et rouvre-la 2 fois.

RETOUR ARRIÈRE (si besoin) :
  cd $APP_DIR
  git apply -R $PATCH
  $D compose up -d --build
  # données (recommandé : la migration a ajouté les 6 catégories de base à la configuration) :
  sudo tar xzf $BACKUP_DIR/data.tgz -C .

Pense ensuite à enregistrer cet état en local : git add server.ts src tests && git commit -m "Évolution : catégories, génération, exercices"
EOF
[ "$BAD" -eq 0 ]
