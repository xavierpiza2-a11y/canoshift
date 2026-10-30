// Réglages de la génération IA — logique pure (défauts, validation, règle d'ouverture d'une date)
// usage : BASE_URL=/ bun run tests/ai-settings.test.mjs
const A = await import('../src/shared/aiPlanning.ts');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${ok ? '' : `  → attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`}`);
};
const throws = (name, fn, re) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof A.AiSettingsError ? e.message : 'AUTRE ' + e; }
  const ok = msg !== null && re.test(msg);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${ok ? '' : `  → message : ${msg}`}`);
};
const open = (...ranges) => ({ open: true, ranges: ranges.map(([start, end]) => ({ start, end })) });

// ---- 1. Valeurs par défaut
const d = A.defaultAiSettings();
eq('défaut : lundi à samedi ouverts, dimanche fermé', A.ISO_WEEKDAYS.map((k) => d.weekly[k].open), [true, true, true, true, true, true, false]);
eq('défaut : le samedi est ouvert', d.weekly[6].open, true);
eq('défaut : jours fériés fermés', d.holidays.open, false);
eq('défaut : plage 09:00-19:00', d.weekly[1].ranges, [{ start: '09:00', end: '19:00' }]);
eq('défaut : écart visé 0 h, effectifs 1/1/2, 6 jours consécutifs', [d.staffing.minOpening, d.staffing.minClosing, d.staffing.minPerDay, d.teamRules.maxConsecutiveDays], [1, 1, 2, 6]);
eq('défaut : aucun modèle choisi (le premier autorisé s\'applique)', d.model, undefined);
eq('plus de notion de mode (simplifié / paramétrable)', ['defaultMode' in d, 'defaultMode' in A.normalizeAiSettings({ defaultMode: 'advanced' })], [false, false]);
eq('modèle gemini accepté', A.normalizeAiSettings({ model: 'gemini' }).model, 'gemini');
eq('modèle anthropic accepté', A.normalizeAiSettings({ model: 'anthropic' }).model, 'anthropic');
eq('modèle inconnu ignoré', A.normalizeAiSettings({ model: 'gpt-9' }).model, undefined);
eq('libellés des modèles', [A.AI_PROVIDER_LABELS.gemini, A.AI_PROVIDER_LABELS.anthropic], ['Gemini (gratuit possible)', 'Claude']);
eq('une entrée vide donne les défauts', A.normalizeAiSettings(undefined), d);
eq('normaliser est idempotent', A.normalizeAiSettings(A.normalizeAiSettings(d)), d);

// ---- 2. Règle d'ouverture d'une date
const R = (s, date) => A.resolveDayRule(s, date);
eq('lundi 2 novembre 2026 : ouvert (règle du jour)', [R(d, '2026-11-02').rule.open, R(d, '2026-11-02').source], [true, 'weekday']);
eq('samedi 7 novembre 2026 : ouvert par défaut', R(d, '2026-11-07').rule.open, true);
eq('dimanche 8 novembre 2026 : fermé', R(d, '2026-11-08').rule.open, false);
eq('1er novembre 2026 (dimanche ET férié) : fermé', [R(d, '2026-11-01').holiday, R(d, '2026-11-01').rule.open], [true, false]);
eq('11 novembre 2026 (mercredi férié) : fermé car férié', [R(d, '2026-11-11').holiday, R(d, '2026-11-11').rule.open, R(d, '2026-11-11').source], [true, false, 'holiday']);

let s = A.normalizeAiSettings({ weekly: { 6: { open: false } } });
eq('l\'admin peut désactiver le samedi', R(s, '2026-11-07').rule.open, false);

s = A.normalizeAiSettings({ monthOverrides: { '2026-12': { weekly: { 7: open(['10:00', '18:00']) } } } });
eq('décembre : dimanche ouvert 10-18', [R(s, '2026-12-06').rule.open, R(s, '2026-12-06').rule.ranges, R(s, '2026-12-06').source], [true, [{ start: '10:00', end: '18:00' }], 'weekday-month']);
eq('novembre : dimanche toujours fermé', R(s, '2026-11-08').rule.open, false);
eq('décembre : le lundi garde la règle générale', R(s, '2026-12-07').source, 'weekday');

s = A.normalizeAiSettings({ holidays: open(['09:00', '13:00']) });
eq('fériés ouverts globalement : le 11 novembre est ouvert 9-13', [R(s, '2026-11-11').rule.open, R(s, '2026-11-11').rule.ranges], [true, [{ start: '09:00', end: '13:00' }]]);
s = A.normalizeAiSettings({ monthOverrides: { '2027-05': { holidays: open(['09:00', '12:30']) } } });
eq('fériés de mai ouverts uniquement en mai (1er mai 2027)', [R(s, '2027-05-01').rule.open, R(s, '2027-05-01').source], [true, 'holiday-month']);
eq('fériés d\'un autre mois restent fermés (25/12/2026)', R(s, '2026-12-25').rule.open, false);

s = A.normalizeAiSettings({ dateOverrides: { '2026-11-02': { open: false }, '2026-11-08': open(['09:00', '12:00']) } });
eq('exception de date : lundi 2 novembre fermé (inventaire)', [R(s, '2026-11-02').rule.open, R(s, '2026-11-02').source], [false, 'date']);
eq('exception de date : dimanche 8 novembre ouvert 9-12', R(s, '2026-11-08').rule.ranges, [{ start: '09:00', end: '12:00' }]);
s = A.normalizeAiSettings({ holidays: { open: false }, dateOverrides: { '2026-11-11': open(['09:00', '12:00']) } });
eq('l\'exception de date l\'emporte sur le jour férié', R(s, '2026-11-11').rule.open, true);

eq('deux plages (pause déjeuner) conservées et triées', A.normalizeAiSettings({ weekly: { 1: open(['14:00', '19:00'], ['09:00', '12:00']) } }).weekly[1].ranges, [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '19:00' }]);
eq('effectif renforcé le samedi', [A.minStaffForDay(A.normalizeAiSettings({ staffing: { minPerDay: 2, busyDays: { 6: 4 } } }), '2026-11-07'), A.minStaffForDay(d, '2026-11-07')], [4, 2]);
eq('resolveMonth : 30 jours pour novembre', A.resolveMonth(d, '2026-11', Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)).length, 30);

// ---- 3. Validation stricte (erreurs lisibles)
throws('heure invalide refusée', () => A.normalizeAiSettings({ weekly: { 1: { open: true, ranges: [{ start: '25:00', end: '19:00' }] } } }, undefined, true), /horaires invalides/);
throws('fermeture avant ouverture refusée', () => A.normalizeAiSettings({ weekly: { 1: open(['19:00', '09:00']) } }, undefined, true), /après l'heure d'ouverture/);
throws('plages qui se chevauchent refusées', () => A.normalizeAiSettings({ weekly: { 1: open(['09:00', '13:00'], ['12:00', '19:00']) } }, undefined, true), /chevauchent/);
throws('ouvert sans plage refusé', () => A.normalizeAiSettings({ weekly: { 1: { open: true, ranges: [] } } }, undefined, true), /au moins une plage/);
throws('mois invalide refusé', () => A.normalizeAiSettings({ monthNotes: { '2026-13': 'x' } }, undefined, true), /Mois invalide/);
throws('date invalide refusée', () => A.normalizeAiSettings({ dateOverrides: { '2026-02-31x': open(['09:00', '12:00']) } }, undefined, true), /Date invalide/);
throws('effectif hors bornes refusé', () => A.normalizeAiSettings({ staffing: { minPerDay: 99 } }, undefined, true), /entre 0 et 50/);
throws('écart d\'heures hors bornes refusé', () => A.normalizeAiSettings({ employees: { Anna: { targetHoursGap: 500 } } }, ['Anna'], true), /entre -100 h et \+100 h/);
// Mode non strict : on corrige sans planter
eq('non strict : heures invalides corrigées par la plage par défaut', A.normalizeAiSettings({ weekly: { 1: { open: true, ranges: [{ start: 'abc', end: 'def' }] } } }).weekly[1].ranges, [{ start: '09:00', end: '19:00' }]);
eq('non strict : effectif borné à 50', A.normalizeAiSettings({ staffing: { minPerDay: 99 } }).staffing.minPerDay, 50);

// ---- 4. Salariés, notes, assainissement
const emp = A.normalizeAiSettings({ employees: { Anna: { canOpen: false, fixedRestWeekdays: [3, 3, '2', 9, 'x'], targetHoursGap: '2,5', constraints: '  pas le jeudi matin  ' }, Fantome: { canOpen: false } } }, ['Anna', 'Bob']);
eq('salarié supprimé de l\'équipe : réglages ignorés', Object.keys(emp.employees), ['Anna']);
eq('repos fixes : dédoublonnés, triés, bornés 1-7', emp.employees.Anna.fixedRestWeekdays, [2, 3]);
eq('écart visé accepte la virgule (2,5)', emp.employees.Anna.targetHoursGap, 2.5);
eq('contraintes nettoyées', emp.employees.Anna.constraints, 'pas le jeudi matin');
eq('canOpen=false conservé, canClose=true par défaut', [emp.employees.Anna.canOpen, emp.employees.Anna.canClose], [false, true]);
eq('notes du mois : texte long tronqué à 2000 caractères', A.normalizeAiSettings({ monthNotes: { '2026-12': 'x'.repeat(5000) } }).monthNotes['2026-12'].length, 2000);
eq('notes vides supprimées', A.normalizeAiSettings({ monthNotes: { '2026-12': '   ' } }).monthNotes, {});
eq('entrée non-objet : défauts', A.normalizeAiSettings('n\'importe quoi'), d);
eq('clés dangereuses ignorées (__proto__)', ({}).polluted, undefined);
A.normalizeAiSettings(JSON.parse('{"__proto__":{"polluted":1},"weekly":{"__proto__":{"polluted":1}},"employees":{"__proto__":{"polluted":1}}}'), ['__proto__']);
eq('pas de pollution de prototype', ({}).polluted, undefined);
eq('nom de salarié « __proto__ » ignoré', Object.keys(A.normalizeAiSettings({ employees: JSON.parse('{"__proto__":{"canOpen":false}}') }, ['__proto__']).employees), []);

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
