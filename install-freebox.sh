#!/bin/bash
# ==============================================================================
# Script de déploiement automatique Docker pour CanoShift WebApp by NEVO
# Compatible : VM, Ubuntu, Debian, VPS
# ==============================================================================

set -e

echo "=========================================================="
echo "🚀 Déploiement de CanoShift by NEVO (Mode 100% Autonome Docker)"
echo "=========================================================="

# 1. Vérification des droits root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Veuillez exécuter ce script avec les droits administrateur (sudo) :"
  echo "   sudo bash install-freebox.sh"
  exit 1
fi

APP_DIR=$(pwd)
echo "📁 Dossier de l'application : $APP_DIR"

# 2. Installation de Docker et Docker Compose si absents
if ! command -v docker &> /dev/null; then
  echo "📦 Installation de Docker..."
  apt update -y
  apt install -y curl ca-certificates gnupg lsb-release
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "✅ Docker installé avec succès !"
else
  echo "✅ Docker est déjà installé : $(docker --version)"
fi

# 3. Création du dossier de données persistantes
mkdir -p "$APP_DIR/data/stores"
chmod -R 777 "$APP_DIR/data"

# 4. Configuration du fichier d'environnement (.env)
if [ ! -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/.env.example" ]; then
  echo "⚙️ Initialisation du fichier .env à partir de .env.example..."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "⚠️ Important : Pensez à éditer le fichier .env pour définir votre mot de passe Super-Admin personnalisé :"
  echo "   nano .env"
fi

# 5. Configuration optionnelle du pare-feu
if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
  echo "🛡️ Ouverture du port 3000 dans le pare-feu..."
  ufw allow 3000/tcp || true
fi

# 5. Démarrage du conteneur via Docker Compose
echo "🐳 Construction et lancement du conteneur Docker..."
docker compose down || true
docker compose up -d --build

IP_LOCALE=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================================="
echo "🎉 Déploiement terminé avec succès !"
echo "=========================================================="
echo ""
echo "📱 Accès à l'application depuis votre réseau :"
echo "   http://${IP_LOCALE}:3000"
echo ""
echo "💾 Volume de persistance : $APP_DIR/data"
echo "   Toutes vos données (plannings, notes, salariés) y sont enregistrées automatiquement."
echo ""
echo "📋 Commandes utiles :"
echo "   - Voir les logs en direct : docker compose logs -f"
echo "   - Arrêter l'application  : docker compose down"
echo "   - Redémarrer              : docker compose restart"
echo ""
