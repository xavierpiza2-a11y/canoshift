# Guide de Déploiement Docker : Planning Pro (Mode 100% Autonome)

Ce guide détaille comment déployer votre application **Planning Pro** avec **Docker** sur une **VM Ubuntu hébergée sur votre Freebox (Delta ou Ultra)** ou sur tout autre serveur Linux / VPS.

---

## 🌟 Avantages du Mode Autonome Docker

- **Zéro dépendance externe** : Aucun serveur MySQL à installer, aucun compte ni quota Firebase.
- **Déploiement en 1 commande** : `docker compose up -d`.
- **Persistance garantie** : Toutes vos données sont stockées dans le dossier `./data` (monté en volume).
- **Sauvegarde ultra-simple** : Une copie du dossier `./data` ou un clic sur « Télécharger la sauvegarde (.json) » dans l'interface Admin suffit pour sauvegarder tout votre planning.
- **Temps réel natif** : Le serveur WebSocket intégré synchronise immédiatement tous les smartphones et ordinateurs connectés.

---

## Étape 1 : Créer la VM Ubuntu sur Freebox OS

1. Rendez-vous sur votre interface Freebox : [http://mafreebox.freebox.fr/](http://mafreebox.freebox.fr/).
2. Ouvrez l'application **« Gestion des VMs »**.
3. Cliquez sur **« Ajouter une VM »**.
4. Choisissez le système préinstallé **Ubuntu**.
5. Allouez 1 ou 2 cœurs CPU et au moins 1 Go ou 2 Go de RAM.
6. Définissez votre nom d'utilisateur et mot de passe, puis démarrez la VM.
7. Notez l'adresse IP locale de votre VM (ex: `192.168.1.50`).

---

## Étape 2 : Se connecter en SSH à la VM

Depuis votre terminal (ou PuTTY / PowerShell sur Windows) :
```bash
ssh votre_nom_utilisateur@192.168.1.50
```

---

## Étape 3 : Récupérer les fichiers de l'application

Copiez le dossier de l'application sur la VM (via Git, SCP ou archive zip) :
```bash
git clone <votre_depot> planning-app
cd planning-app
```

---

## Étape 4 : Lancement en 1 seule commande

### Option A : Avec le script d'installation automatique
```bash
sudo bash install-freebox.sh
```
Ce script installe Docker automatiquement (s'il n'est pas déjà présent), construit l'image et démarre le conteneur.

### Option B : Directement avec Docker Compose
Si Docker est déjà installé sur votre machine :
```bash
docker compose up -d --build
```

---

## Étape 5 : Accéder à l'application

L'application est immédiatement accessible dans votre navigateur :
- En local sur votre réseau Wi-Fi : `http://192.168.1.50:3000`

---

## Étape 6 : Accès depuis l'extérieur (Smartphones des salariés en 4G/5G)

### Méthode Recommandée : Cloudflare Tunnel (100% Gratuit, Sécurisé, Sans ouvrir de ports)
1. Créez un compte gratuit sur [cloudflare.com](https://cloudflare.com).
2. Installez `cloudflared` sur votre VM :
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
   sudo dpkg -i cloudflared.deb
   ```
3. Connectez votre tunnel vers le port local `3000`.
4. Vous obtenez une URL HTTPS sécurisée (ex: `https://planning.mon-domaine.fr`) avec certificat SSL automatique !

### Méthode Classique : Redirection de port Freebox OS
1. Sur [mafreebox.freebox.fr](http://mafreebox.freebox.fr/) > **Paramètres de la Freebox** > **Gestion des ports**.
2. Ajoutez une redirection :
   - IP de destination : `192.168.1.50` (IP de la VM)
   - Port externe : `3000`
   - Port interne : `3000`
   - Protocole : TCP
3. Vos salariés peuvent accéder à `http://votre-ip-freebox:3000`.

> 💡 **Pourquoi le bouton d'installation PWA automatique nécessite HTTPS :**
> Les navigateurs modernes (Chrome, Safari, Edge) bloquent l'affichage automatique du bouton « Installer l'application » sur les connexions en `http://` non sécurisées (comme une adresse IP directe `http://82.66.184.173:3000`).
>
> Deux solutions simples :
> 1. **Sans rien changer (en 5 secondes)** : Sur votre téléphone dans Chrome, cliquez sur les **3 points verticaux (⋮)** en haut à droite > **« Ajouter à l'écran d'accueil »** (sur iPhone : bouton **Partager** > **« Sur l'écran d'accueil »**). L'icône sera installée sur votre smartphone !
> 2. **Pour activer le bouton automatique et le HTTPS gratuit** : Lancez un Cloudflare Tunnel gratuit (ex: `cloudflared tunnel --url http://localhost:3000`). Vous obtenez une adresse sécurisée en `https://...` qui débloque instantanément le bouton « Installer l'application » et les notifications push.

---

## 🛠️ Commandes utiles pour la gestion quotidienne

```bash
# Voir les logs en direct (connexions, modifications)
docker compose logs -f

# Redémarrer l'application
docker compose restart

# Arrêter l'application
docker compose down

# Mettre à jour l'application après modification du code
git pull
docker compose up -d --build
```
