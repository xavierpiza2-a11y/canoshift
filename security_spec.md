# Security Specification & Threat Model (Planning Pro)

## 1. Data Invariants
- Configuration (`/config/{configId}`): Document unique "current" partagé. Seul le storeName et les configurations d'équipe valides peuvent être modifiés.
- Schedules (`/schedules/{scheduleId}`): L'identifiant `{scheduleId}` correspond au format `{monthKey}_{employeeName}`. Chaque document doit contenir un nom d'employé et un mois valide.
- Notes (`/dayNotes/{monthKey}`): Notes journalières indexées par mois.
- Changes (`/changes/{changeId}`): Alertes de notification de changement.
- History (`/history/{historyId}`): Journal immuable d'audit.

## 2. Security Rules Intent
- L'application est un outil d'équipe accessible aux membres autorisés.
- Validation stricte des types de données et longueurs maximales sur chaque écriture.
- Blocage des injections de données malveillantes.
- Pas de suppression non autorisée.
