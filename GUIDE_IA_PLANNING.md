# Module IA de planning — guide

## Activer (gestionnaire)
1. Espace Gestionnaire > ✏️ Modifier le magasin > case **Module IA de planning**, puis coche le ou les **modèles proposés** (Gemini, Claude) > Enregistrer.
2. L'onglet **IA planning** apparaît côté administrateur du magasin (rien n'apparaît sur les autres magasins). L'administrateur choisit son modèle parmi ceux autorisés (carte « Modèle d'IA »).

## Configurer le serveur (une seule fois, fichier `.env` sur la VM)
- `AI_PROVIDER` : modèle utilisé par défaut (`gemini` ou `anthropic`) pour un magasin dont le gestionnaire n'a rien choisi.
- `GEMINI_API_KEY` et/ou `ANTHROPIC_API_KEY` : une clé par modèle proposé. **Ne jamais les mettre dans l'app ni dans git.**
- `GEMINI_MODEL` / `ANTHROPIC_MODEL` : nom du modèle (à vérifier dans Google AI Studio si Gemini).
- `AI_MAX_GENERATIONS_PER_HOUR` : limite par magasin et par heure (défaut 10).
- `AI_TIMEOUT_SECONDS` : attente maximale (défaut 120).
- Après modification du `.env` : `docker compose up -d` (le conteneur est recréé avec les nouvelles valeurs). Aucun autre fichier à modifier.

## Utiliser (administrateur du magasin)
1. **Réglages** (toujours tous pris en compte, enregistrés avec le magasin et donc inclus dans sa sauvegarde) : modèle d'IA, horaires d'ouverture (par jour, par mois, par date), effectifs, règles d'équipe, réglages par salarié (dont l'écart d'heures visé), précisions du mois. Enregistrer.
2. **Générer** : choisir le mois, ajouter une précision pour cette génération si besoin, « Générer un brouillon ».
3. Contrôler le brouillon (écarts d'heures, points à vérifier, grille), puis **Appliquer au planning** ou Annuler.

## Garanties
- Le brouillon n'est jamais écrit sans validation. Les journées posées à la main (congés, CFA, RTT, créneaux) ne sont jamais écrasées.
- Seuls les créneaux de l'onglet « Créneaux » sont utilisés, dans les horaires d'ouverture ; tout le reste est écarté par le serveur.
- Les prénoms sont remplacés par « Salarié A, B… » et le nom du magasin par « le magasin » avant l'envoi.
- Offre gratuite de Gemini : Google peut utiliser les échanges pour améliorer ses produits.
