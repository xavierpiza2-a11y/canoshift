# Plan d'implémentation Exécuté : CanoShift (Thème Sombre/Clair, Contrastes des Saisies, TokenGate & Export PDF)

Toutes les demandes ont été rigoureusement intégrées et vérifiées :

1. **TokenGate — Titre « CanoShift » en deux tons de vert** :
   - Typographie bicolore fidèle à `logo-full-light.svg` : « Cano » en vert sapin profond (`#14532d` / `#22c55e`), et « Shift » en vert émeraude vif (`#16a34a` / `#4ade80`).
   - Sous-titre officiel conservé : `Gestion des Planning et Temps. By NEVO`.

2. **Lisibilité maximale de tous les champs modifiables (Inputs, Selects, Textareas)** :
   - **`SuperAdminModal.tsx`** : Textes foncés et nets (`text-slate-900 font-bold bg-white dark:bg-slate-950 dark:text-white border-slate-300 dark:border-slate-700`) dans la création de magasin (nom, clé, PIN), la modification de magasin, et les boîtes de confirmation.
   - **`AdminView.tsx` — Mois & Calendrier** : Champs de création (`newMonthPickerVal`, `newMonthLabel`, `newMonthTab`) et de modification (`editMonthKey`, `editMonthLabel`, `editMonthTab`, `editMonthCustomWorkingDays`, `editMonthCustomBaseHours`) à contraste élevé.
   - **`AdminView.tsx` — Salariés & Fiches Collaborateurs** : Ajout et édition de salarié (nom, rôle, couleur, droits admin, type de contrat, quotas annuel/hebdo/forfait, report d'heures, CP acquis/pris, RTT acquis/pris).
   - **`AdminView.tsx` — Sécurité & Remise à zéro** : Champs de changement de code PIN administrateur et de réinitialisation de magasin.
   - **`AdminShiftEditModal.tsx` & `AdminTableau2Section.tsx` — Horaires & Créneaux** : Sélecteur de salarié, sélecteur de date, note du jour, libellé manuel de créneau, code shift, heures début/fin AM et PM, durée calculée et description.

3. **Pied de page PDF du planning (`pdfExport.ts`)** :
   - Intégration en bas à gauche du logo officiel vectoriel **`logo-full-light.svg`** immédiatement suivi du texte **`By NEVO`** en typographie bold verte.
   - Mention d'exportation avec date et heure conservée en bas à droite, maintien strict du gabarit **1 seule page paysage A4**.

4. **Sélecteur dynamique Mode Sombre / Mode Clair (Dark / Light)** :
   - Bouton Soleil / Lune interactif dans le **Header** et sur l'écran d'accueil **TokenGate**.
   - Détection automatique par défaut selon les préférences de l'appareil (**OS preference**).
   - Persistance dans `localStorage` sous `canoshift_theme`.
   - Adaptation dynamique des arrière-plans (`bg-slate-950` / `bg-slate-50`), de l'en-tête, de la barre de navigation basse et des logos (`AppLogo`).
