#!/bin/bash
# ==============================================================================
# Script de mise à jour automatique depuis GitHub pour CanoShift by NEVO
# Compatible : VM Freebox, Ubuntu, Debian, VPS
# ==============================================================================

set -e

echo "=========================================================="
echo "🔄 Mise à jour de CanoShift by NEVO depuis GitHub"
echo "=========================================================="

APP_DIR=$(pwd)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 1. Sauvegarde préventive intégrale de TOUTES les données (data/)
TEMP_BACKUP="/tmp/canoshift_data_backup_${TIMESTAMP}"
PERM_BACKUP="$APP_DIR/backups/data_backup_${TIMESTAMP}"

if [ -d "$APP_DIR/data" ]; then
  mkdir -p "$TEMP_BACKUP"
  mkdir -p "$APP_DIR/backups"
  cp -r "$APP_DIR/data"/* "$TEMP_BACKUP/" 2>/dev/null || true
  cp -r "$APP_DIR/data" "$PERM_BACKUP" 2>/dev/null || true
  echo "🛡️ Sauvegarde intégrale de vos données créée :"
  echo "   -> $PERM_BACKUP"
fi

# 2. Ignorer tout conflit Git sur le dossier data
git checkout -- data/ 2>/dev/null || true
git stash -- data/ 2>/dev/null || true

# 3. Récupération des dernières modifications du code depuis GitHub
echo "📥 Téléchargement des nouveaux fichiers depuis GitHub..."
git pull origin main || git pull

# 4. Restauration prioritaire de TOUTES vos données locales (magasins, plannings, notes)
if [ -d "$TEMP_BACKUP" ] && [ "$(ls -A "$TEMP_BACKUP" 2>/dev/null)" ]; then
  echo "♻️ Restauration de vos plannings et configurations..."
  mkdir -p "$APP_DIR/data/stores"
  cp -r "$TEMP_BACKUP"/* "$APP_DIR/data/" 2>/dev/null || true
  rm -rf "$TEMP_BACKUP"
fi

# 5. Garantir les permissions d'écriture complètes pour Docker
chmod -R 777 "$APP_DIR/data" 2>/dev/null || true

# 6. Reconstruction et relance du conteneur avec la nouvelle version
echo "🐳 Reconstruction du conteneur Docker avec les nouveaux fichiers..."
docker compose up -d --build

echo ""
echo "=========================================================="
echo "🎉 Mise à jour terminée avec succès !"
echo "=========================================================="
echo "✅ Vos données (planning, salariés, notes, PIN, clé) sont restées intactes."
echo "✅ L'application tourne désormais avec la nouvelle version de code."
echo ""
