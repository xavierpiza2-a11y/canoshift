#!/usr/bin/env bash
# Point 2/4 — Pare-feu ufw : n'autorise que SSH, HTTP et HTTPS
# Usage : ./02-pare-feu.sh
#
# SÉCURITÉ ANTI-VERROUILLAGE : une minuterie désactive automatiquement le pare-feu après 5 minutes.
# Tu dois donc tester dans un NOUVEAU terminal, puis ANNULER la minuterie si tout va bien.
# (Le port 3000 de l'application n'a pas besoin d'être ouvert : il n'écoute que sur 127.0.0.1.)

set -u
say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

command -v ufw >/dev/null || { echo "Installation de ufw…"; sudo apt-get install -y ufw >/dev/null || die "impossible d'installer ufw"; }

say "1/4  Ports actuellement ouverts sur la VM"
sudo ss -tlnpH 2>/dev/null | awk '{print "  " $4 "  " $6}'

SSH_PORT=$(sudo ss -tlnpH 2>/dev/null | awk '/sshd/ {n=split($4,a,":"); print a[n]; exit}')
SSH_PORT="${SSH_PORT:-22}"
echo; echo "Port SSH détecté : $SSH_PORT"
echo "Règles prévues : SSH ($SSH_PORT/tcp), HTTP (80/tcp), HTTPS (443/tcp et 443/udp), tout le reste entrant refusé."
echo "Ta session SSH actuelle ne sera PAS coupée."
read -r -p "Activer le pare-feu avec ces règles ? (oui/non) " rep
[ "$rep" = "oui" ] || { echo "Annulé, rien n'a été modifié."; exit 0; }

say "2/4  Règles"
sudo ufw --force reset >/dev/null
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow "$SSH_PORT"/tcp comment 'SSH' >/dev/null
sudo ufw allow 80/tcp comment 'HTTP Caddy' >/dev/null
sudo ufw allow 443/tcp comment 'HTTPS Caddy' >/dev/null
sudo ufw allow 443/udp comment 'HTTP/3 Caddy' >/dev/null

say "3/4  Filet de sécurité + activation"
sudo systemctl stop ufw-filet-securite.timer 2>/dev/null
sudo systemd-run --quiet --unit=ufw-filet-securite --on-active=300 /usr/sbin/ufw --force disable \
  && echo "Minuterie posée : le pare-feu se désactivera tout seul dans 5 minutes." \
  || die "impossible de poser le filet de sécurité : pare-feu NON activé."
sudo ufw --force enable
sudo ufw status verbose

say "4/4  À FAIRE MAINTENANT (dans les 5 minutes)"
cat <<EOF
  1. Ouvre un NOUVEAU terminal et reconnecte-toi en SSH à la VM.
  2. Ouvre le site de CanoShift sur ton téléphone (en 4G/5G pour tester l'accès extérieur) et sur le PC.
  3. Si tout fonctionne, ANNULE la minuterie pour garder le pare-feu :
         sudo systemctl stop ufw-filet-securite.timer
     Vérifie ensuite :  sudo ufw status | head -3     (doit afficher « Status: active »)
  4. Si quelque chose ne marche pas : ne fais rien, le pare-feu se coupe seul dans 5 minutes
     (ou tout de suite :  sudo ufw disable ), puis envoie-moi le message d'erreur.

Retour arrière à tout moment :  sudo ufw disable
EOF
