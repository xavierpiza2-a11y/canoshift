// Rendu des composants de gestion par exercice (détecte les erreurs d'exécution sans navigateur)
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AdminExercisesSection } from '../src/components/AdminExercisesSection';
import { MonthSelector } from '../src/components/MonthSelector';
import { getExerciseMonthItems } from '../src/shared/planning';

const all = [...getExerciseMonthItems(2026), ...getExerciseMonthItems(2027)];
const visible = getExerciseMonthItems(2026).map((m) => m.key);
let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}`); };

const strip = (h: string) => h.replace(/<!-- -->/g, '');
const html = strip(renderToString(<AdminExercisesSection allMonths={all} visibleMonths={visible} onApply={async () => {}} showToast={() => {}} />));
t('une carte par exercice (2026-2027 et 2027-2028)', html.includes('Exercice 2026-2027') && html.includes('Exercice 2027-2028'));
t('exercice suivant proposé : 2028-2029', html.includes('Exercice suivant : 2028-2029'));
t('plus de formulaire de création d\'un mois isolé', !html.includes('Créer le mois') && !html.includes('Nouveau mois'));
t('12 mois par exercice, libellés calculés', html.includes('Juin 2026') && html.includes('Mai 2028'));
t('suppression proposée (plusieurs exercices)', html.includes('Supprimer l&#x27;exercice'));
const one = strip(renderToString(<AdminExercisesSection allMonths={getExerciseMonthItems(2026)} visibleMonths={visible} onApply={async () => {}} showToast={() => {}} />));
t('l\'unique exercice ne peut pas être supprimé', !one.includes('Supprimer l&#x27;exercice'));
const sel = strip(renderToString(<MonthSelector allMonths={all} visibleMonths={all.map((m) => m.key)} selectedMonth="2026-10" onSelectMonth={() => {}} />));
t('sélecteur de mois groupé par exercice', sel.includes('Exercice 2026-2027') && sel.includes('Exercice 2027-2028'));
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
