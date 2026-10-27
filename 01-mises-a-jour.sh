#!/usr/bin/env bash
# Point 1/4 — Mises à jour système (docker-ce, containerd, apparmor, glib…)
# Usage : ./01-mises-a-jour.sh [chemin-de-l-app]     (défaut : ~/canoshift/planning-app)
# Fait un "apt upgrade" classique (PAS de changement de version d'Ubuntu), après sauvegarde et confirmation.
# La mise à jour de docker-ce / containerd redémarre le conteneur quelques secondes.

set -u
APP_DIR="${1:-$HOME/canoshift/planning-app}"
BACKUP_DIR="$HOME/backup-canoshift-maj-$(date +%Y%m%d-%H%M%S)"
say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || die "Dossier introuvable : $APP_DIR"
cd "$APP_DIR" || exit 1
health() { curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health; }

say "0/4  L'application répond-elle avant la mise à jour ?"
[ "$(health)" = "200" ] || die "L'app ne répond pas (HTTP $(health)). Répare-la d'abord, ne fais pas de mise à jour maintenant."
echo "OK, l'application répond."

say "1/4  Sauvegarde dans $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
sudo tar czf "$BACKUP_DIR/data.tgz" data 2>/dev/null || warn "sauvegarde de data/ incomplète"
cp -p docker-compose.yml Dockerfile "$BACKUP_DIR/" 2>/dev/null
sudo chown -R "$(id -u):$(id -g)" "$BACKUP_DIR" 2>/dev/null
dpkg -l | awk '/^ii/ {print $2" "$3}' > "$BACKUP_DIR/paquets-avant.txt"
ls -lh "$BACKUP_DIR"

say "2/4  Mises à jour disponibles"
sudo apt-get update -qq
apt list --upgradable 2>/dev/null | tail -n +2 | tee "$BACKUP_DIR/a-mettre-a-jour.txt"
N=$(wc -l < "$BACKUP_DIR/a-mettre-a-jour.txt")
[ "$N" -gt 0 ] || { echo "Rien à mettre à jour."; exit 0; }
echo; echo "$N paquet(s). Le conteneur CanoShift redémarrera si docker-ce/containerd en font partie."
read -r -p "Lancer la mise à jour maintenant ? (oui/non) " rep
[ "$rep" = "oui" ] || { echo "Annulé, rien n'a été modifié."; exit 0; }

say "3/4  Mise à jour (peut prendre quelques minutes)"
sudo NEEDRESTART_MODE=a DEBIAN_FRONTEND=noninteractive apt-get -y upgrade || die "apt a échoué : voir le message ci-dessus."

say "4/4  Vérifications"
for i in $(seq 1 40); do [ "$(health)" = "200" ] && break; sleep 2; done
[ "$(health)" = "200" ] && echo "  OK    l'application répond" || warn "l'application ne répond pas : sudo docker compose up -d  puis  sudo docker logs --tail 40 CanoShift"
sudo docker ps --format '  conteneur {{.Names}} : {{.Status}}'
for svc in docker caddy; do
  systemctl is-enabled "$svc" >/dev/null 2>&1 && echo "  OK    $svc démarre au boot" || warn "$svc n'est pas activé au démarrage (systemctl enable $svc)"
done
if [ -f /var/run/reboot-required ]; then
  warn "Un redémarrage de la VM est recommandé (noyau ou bibliothèques mises à jour)."
  echo "  Quand tu veux (créneau calme) :  sudo reboot"
  echo "  Après ~1 minute, reconnecte-toi et vérifie :  curl -s http://127.0.0.1:3000/api/health"
else
  echo "  Aucun redémarrage nécessaire."
fi
echo; echo "Liste des paquets avant mise à jour : $BACKUP_DIR/paquets-avant.txt"
