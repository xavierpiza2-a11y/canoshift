// Projection de fin d'exercice des annualisés — usage : BASE_URL=/ bun run tests/projection.test.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k), clear: () => mem.clear() };
globalThis.window = Object.assign(new EventTarget(), { localStorage });

const P = await import('../src/shared/planning.ts');
const H = await import('../src/services/hoursService.ts');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${ok ? '' : `  → attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`}`);
};

const months = P.getExerciseMonthKeys(2026);

// Charge un planning généré (BASE / REPOS / FERIE) pour 12 mois ; `edits` = { 'AAAA-MM-JJ': 'CONGES' }
function load(name, edits = {}) {
  mem.clear();
  for (const m of months) {
    const days = {};
    for (const d of P.getMonthDateKeys(m)) {
      const g = P.generateDefaultDay(d);
      days[d] = { shift: edits[d] ?? g.shift, hours: '', info: '' };
    }
    localStorage.setItem(`planning_sched_${name}_${m}`, JSON.stringify({ days, totalHours: 0 }));
  }
}
const weekdays = months.flatMap((m) => P.getMonthDateKeys(m)).filter((d) => P.isOpenWeekday(d));
const emp = (extra = {}) => ({ name: 'Test', contractType: 'ANNUALISE', yearlyHoursQuota: 1607, weeklyHoursQuota: 35, paidLeaveTotal: 25, ...extra });
const proj = (e, m) => H.calculateEmployeeBalances({ employee: e, selectedMonth: m });

// 1. Aucun CP posé : 1778 h planifiées − 25 j × 7 h = 1603 h → −4 h, quel que soit le mois affiché
load('Test');
eq('sans CP posé : fin d\'exercice identique sur 12 mois (heures)', [...new Set(months.map((m) => proj(emp(), m).projectedExerciseEndHours))], [1603]);
eq('sans CP posé : fin d\'exercice identique sur 12 mois (écart)', [...new Set(months.map((m) => proj(emp(), m).projectedExerciseEndBalance))], [-4]);
eq('sans CP posé : écart à date = 0 chaque mois', [...new Set(months.map((m) => proj(emp(), m).exerciseBalance))], [0]);

// 2. 5 CP posés dans le futur, puis 25 posés, puis 27 posés
for (const n of [5, 12, 25]) {
  const edits = Object.fromEntries(weekdays.slice(40, 40 + n).map((d) => [d, 'CONGES']));
  load('Test', edits);
  eq(`${n} CP posés : même résultat tous les mois`, [...new Set(months.map((m) => proj(emp(), m).projectedExerciseEndHours))], [1603]);
}
{
  const edits = Object.fromEntries(weekdays.slice(40, 67).map((d) => [d, 'CONGES']));
  load('Test', edits);
  eq('27 CP posés (reste 0, pas de déduction) : 1778 − 189 = 1589 h tous les mois', [...new Set(months.map((m) => proj(emp(), m).projectedExerciseEndHours))], [1589]);
}

// 3. CP déjà pris dans le passé (soldes initiaux), CP restants = 25 − 10
load('Test');
eq('10 CP déjà pris avant (soldes initiaux) : déduction de 15 j seulement, stable',
  [...new Set(months.map((m) => proj(emp({ paidLeaveTaken: 10, initialHoursBalance: 0 }), m).projectedExerciseEndHours))].length, 1);

// 4. Solde d'ouverture de l'exercice (+10 h) reporté dans le total
load('Test');
eq('solde d\'ouverture +10 h : 1613 h en juin comme en mai', [proj(emp({ initialHoursBalance: 10 }), months[0]).projectedExerciseEndHours, proj(emp({ initialHoursBalance: 10 }), months[11]).projectedExerciseEndHours], [1613, 1613]);

// 5. Autres contrats : inchangés (pas de projection)
for (const c of ['HEBDO_35H', 'FORFAIT_JOUR']) {
  load('Test');
  const r = proj(emp({ contractType: c }), months[11]);
  eq(`${c} : pas de projection annualisée`, [r.projectedExerciseEndHours, r.projectedExerciseEndBalance], [0, 0]);
}

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
