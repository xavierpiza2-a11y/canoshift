# Guide Complet d'Installation, Déploiement et Utilisation (de A à Z)
## Planning Pro · Équipe (Mode 100% Autonome Docker)

Ce document contient l'ensemble des procédures détaillées pas à pas pour :
1. **Le déploiement de l'application sur VM Freebox OS (Delta / Ultra) ou tout serveur Linux avec Docker**
2. **Le fonctionnement du moteur de stockage autonome et des sauvegardes JSON**
3. **L'accès distant sécurisé depuis les smartphones des salariés (4G/5G)**
4. **Le mode d'emploi exhaustif de l'application de A à Z**

---

# Sommaire
- [1. Déploiement sur Machine Virtuelle Freebox OS avec Docker](#1-déploiement-sur-machine-virtuelle-freebox-os-avec-docker)
  - [1.1 Prérequis Freebox OS](#11-prérequis-freebox-os)
  - [1.2 Création de la VM dans Freebox OS](#12-création-de-la-vm-dans-freebox-os)
  - [1.3 Connexion SSH à la VM](#13-connexion-ssh-à-la-vm)
  - [1.4 Lancement en 1 seule commande](#14-lancement-en-1-seule-commande)
  - [1.5 Accès distant depuis l'extérieur (Cloudflare Tunnel & Redirection de port)](#15-accès-distant-depuis-lextérieur-cloudflare-tunnel--redirection-de-port)
- [2. Moteur de Stockage Autonome & Sauvegardes](#2-moteur-de-stockage-autonome--sauvegardes)
  - [2.1 Stockage persistant sans base de données externe](#21-stockage-persistant-sans-base-de-données-externe)
  - [2.2 Synchronisation WebSocket en direct](#22-synchronisation-websocket-en-direct)
  - [2.3 Sauvegardes & Restauration JSON en 1 clic](#23-sauvegardes--restauration-json-en-1-clic)
- [3. Mode d'emploi complet de l'application de A à Z](#3-mode-demploi-complet-de-lapplication-de-a-à-z)
  - [3.1 Premier accès & Jeton de sécurité](#31-premier-accès--jeton-de-sécurité)
  - [3.2 Sélection du profil salarié](#32-sélection-du-profil-salarié)
  - [3.3 Vue Salarié (« Mon Planning »)](#33-vue-salarié-«-mon-planning-»)
  - [3.4 Vue Équipe (« Planning Équipe »)](#34-vue-équipe-«-planning-équipe-»)
  - [3.5 Vue Statistiques & Heures](#35-vue-statistiques--heures)
  - [3.6 Espace Administrateur & Responsable](#36-espace-administrateur--responsable)
  - [3.7 Gestion autonome des fichiers Excel (.xlsx)](#37-gestion-autonome-des-fichiers-excel-xlsx)
  - [3.8 Gestion des créneaux & horaires (Tableau 2)](#38-gestion-des-créneaux--horaires-tableau-2)
  - [3.9 Exports officiels (PDF imprimable, Calendrier ICS)](#39-exports-officiels-pdf-imprimable-calendrier-ics)
  - [3.10 Installation PWA sur Smartphone / PC](#310-installation-pwa-sur-smartphone--pc)
  - [3.11 Synchronisation manuelle instantanée](#311-synchronisation-manuelle-instantanée)

---

# 1. Déploiement sur Machine Virtuelle Freebox OS avec Docker

L'application est **100% autonome**. Elle ne nécessite aucun service tiers (aucun compte Firebase, aucun serveur MySQL). Un unique conteneur Docker gère le serveur web, l'API REST, les WebSockets temps réel et le stockage persistant.

### 1.1 Prérequis Freebox OS
- Une Freebox compatible avec les Machines Virtuelles : **Freebox Delta** ou **Freebox Ultra**.
- Un disque dur ou SSD connecté à la Freebox.

### 1.2 Création de la VM dans Freebox OS
1. Rendez-vous sur votre interface locale : [http://mafreebox.freebox.fr/](http://mafreebox.freebox.fr/).
2. Ouvrez l'application **« Gestion des VMs »**.
3. Cliquez sur **« Ajouter une VM »**.
4. Choisissez le système préinstallé **Ubuntu** (Ubuntu 22.04 ou 24.04).
5. Allouez 1 ou 2 cœurs CPU et au moins 1 Go ou 2 Go de RAM.
6. Choisissez votre nom d'utilisateur et mot de passe, puis démarrez la VM.
7. Notez l'adresse IP locale attribuée par la Freebox (ex: `192.168.1.50`).

### 1.3 Connexion SSH à la VM
Ouvrez votre terminal (ou PuTTY / PowerShell sur Windows) :
```bash
ssh votre_nom_utilisateur@192.168.1.50
```

### 1.4 Lancement en 1 seule commande
Copiez le code du projet sur la machine :
```bash
git clone <votre_depot> planning-app
cd planning-app
```

Exécutez le script d'installation automatique :
```bash
sudo bash install-freebox.sh
```
Ce script installe Docker automatiquement si nécessaire, crée le volume de données `./data` et démarre le conteneur via Docker Compose.

L'application est immédiatement accessible sur votre réseau local :
```
http://192.168.1.50:3000
```

### 1.5 Accès distant depuis l'extérieur (Cloudflare Tunnel & Redirection de port)

#### Méthode 1 (Recommandée : Cloudflare Tunnel - Gratuit, HTTPS automatique & Sans ouvrir de ports)
1. Créez un compte gratuit sur [cloudflare.com](https://cloudflare.com).
2. Installez le connecteur `cloudflared` sur la VM Ubuntu :
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
   sudo dpkg -i cloudflared.deb
   ```
3. Associez votre nom de domaine ou sous-domaine gratuit vers `http://localhost:3000`.
4. Vos salariés bénéficient d'une adresse HTTPS sécurisée (ex: `https://planning.mon-magasin.fr`) accessible partout en 4G/5G.

#### Méthode 2 (Redirection de ports Freebox OS classique)
1. Rendez-vous sur [mafreebox.freebox.fr](http://mafreebox.freebox.fr/) > **Paramètres de la Freebox** > **Gestion des ports**.
2. Créez une redirection :
   - IP de destination : `192.168.1.50`
   - Port externe : `3000`
   - Port interne : `3000`
   - Protocole : TCP
3. L'application est joignable via l'adresse IP publique de votre Freebox : `http://VOTRE_IP_PUBLIQUE:3000`.

---

# 2. Moteur de Stockage Autonome & Sauvegardes

### 2.1 Stockage persistant sans base de données externe
- Toutes les données (configurations du magasin, salariés, créneaux du Tableau 2, plannings mensuels, notes du jour, journal des modifications) sont stockées dans le fichier :
  ```
  ./data/planning_db.json
  ```
- **Écriture atomique sécurisée** : Les écritures passent d'abord par un fichier temporaire avant d'être permutées instantanément, ce qui élimine tout risque de corruption de données en cas de coupure de courant ou de redémarrage inattendu.
- **Volume Docker** : Le dossier `./data` est monté en volume externe. Une mise à jour ou reconstruction du conteneur Docker préserve 100% de vos plannings.

### 2.2 Synchronisation WebSocket en direct
- Dès qu'un responsable modifie un horaire, ajoute une note ou publie un planning, le serveur envoie immédiatement l'événement à tous les téléphones et navigateurs connectés via WebSockets (`/ws`).
- Aucune action de rechargement de page n'est nécessaire pour voir les changements.

### 2.3 Sauvegardes & Restauration JSON en 1 clic
Dans l'onglet **Administration** > **Serveur & Sauvegardes** :
- **Télécharger une sauvegarde (.json)** : Génère et télécharge en un clic un fichier JSON horodaté contenant l'intégralité de vos plannings et configurations.
- **Restaurer une sauvegarde (.json)** : Déposez simplement votre fichier de sauvegarde pour restaurer l'intégralité du système à l'état sauvegardé.

---

# 3. Mode d'emploi complet de l'application de A à Z

### 3.1 Premier accès & Jeton de sécurité
- Dès l'ouverture de l'application, un écran de contrôle d'accès sécurise le planning.
- **Jeton d'accès par défaut** : tapez simplement `PLANNING` (en majuscules ou minuscules) et validez.
- Vous pouvez à tout moment modifier ce jeton dans **Administration** > **Magasin & Sécurité** > champ « Jeton d'accès API requis ».

### 3.2 Sélection du profil salarié
- Cliquez sur votre nom dans la liste des profils.
- Le profil « **Responsable** » possède par défaut les droits de gestion et d'administration.
- Vous pouvez changer d'employé à tout moment en cliquant sur la pastille de profil en haut à droite.

### 3.3 Vue Salarié (« Mon Planning »)
- Affiche le planning individuel du mois sélectionné.
- **Cartes quotidiennes** : Date, jour de la semaine, badge de créneau (ex: MATIN, SOIR, REPOS, CONGÉ), horaires détaillés (ex: `09:00 - 16:30`) et consignes du jour.
- **Compteur d'heures mensuel** : Calcul automatique et précis du total des heures travaillées.
- **Export Calendrier (.ics)** : Permet à chaque collaborateur d'ajouter ses horaires dans Google Calendar, Apple Calendar ou Outlook.

### 3.4 Vue Équipe (« Planning Équipe »)
- Vue tabulaire horizontale globale affichant tous les salariés pour chaque jour du mois.
- **Indicateurs de présence** : Visualisation instantanée de qui est présent, qui est en repos ou en congé.
- **Note journalière** : Cliquez sur l'icône de note pour lire ou modifier les consignes spécifiques du jour.
- **Bouton PDF** : Génère un document PDF haute résolution, prêt pour impression A4 ou affichage légal au tableau de l'entreprise.

### 3.5 Vue Statistiques & Heures
- Graphiques analytiques mensuels.
- Répartition des heures travaillées par employé.
- Décompte des samedis travaillés, des ouvertures, des fermetures et des congés payés.

### 3.6 Espace Administrateur & Responsable
- Cliquez sur l'onglet **Admin** dans la barre de navigation inférieure.
- **Code PIN par défaut** : `987654` (personnalisable).
- L'administration est organisée en 5 onglets :
  1. **Magasin & Sécurité** : Nom de l'établissement, jeton d'accès et code PIN.
  2. **Équipe & Salariés** : Ajout, modification, couleurs et droits des salariés.
  3. **Gestion Excel (.xlsx)** : Importation et exportation de fichiers Excel.
  4. **Créneaux (Tableau 2)** : Personnalisation de tous les codes horaires et équivalences décimales.
  5. **Serveur & Sauvegardes** : Statut en ligne, nombre d'appareils connectés en direct, téléchargement et restauration de sauvegardes JSON.

### 3.7 Gestion autonome des fichiers Excel (.xlsx)
L'application est 100% compatible avec Microsoft Excel et LibreOffice :
1. Rendez-vous dans **Admin** > **Excel (.xlsx)**.
2. Déposez votre fichier `.xlsx`. L'algorithme intelligent analyse la structure, détecte automatiquement les salariés, les dates et les horaires, et calcule le bilan d'heures.
3. Cliquez sur **Appliquer et enregistrer dans le planning**.
4. Vous pouvez également cliquer sur **Télécharger la matrice Excel vierge** pour obtenir un modèle pré-formaté.

### 3.8 Gestion des créneaux & horaires (Tableau 2)
- Configurez chaque code horaire (ex : `7H`, `8H30`, `MAT`, `SOIR`, `RH`, `CP`).
- Chaque créneau possède :
  - Un code court.
  - Une plage horaire explicite (ex : `09:00 - 12:30 / 14:00 - 18:30`).
  - Un volume d'heures décimales pour les totaux (ex : `7.5`).
  - Une catégorie de couleur (Matin, Soir, Journée, Repos, Congés).

### 3.9 Exports officiels (PDF imprimable, Calendrier ICS)
- **PDF officiel** : Cliquez sur le bouton « Exporter PDF » en haut de l'écran pour obtenir un PDF propre conforme aux exigences d'affichage en entreprise.
- **Calendrier (.ics)** : Permet d'exporter les heures sur smartphone.

### 3.10 Installation PWA sur Smartphone / PC
L'application est une **Progressive Web App (PWA)** :
- **Sur iPhone (Safari)** : Bouton de partage > **« Sur l'écran d'accueil »**.
- **Sur Android (Chrome)** : Menu trois points > **« Installer l'application »** (ou bannière en bas d'écran).
- **Fonctionnement hors-ligne** : L'application s'ouvre même sans réseau et conserve en mémoire locale tous les plannings déjà consultés.

### 3.11 Synchronisation manuelle instantanée
- Le bouton avec l'icône de rafraîchissement situé en haut à gauche de l'en-tête permet de forcer une synchronisation immédiate et affiche l'heure exacte de la dernière mise à jour.
