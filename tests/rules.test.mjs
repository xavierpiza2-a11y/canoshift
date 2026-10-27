// Tests des règles métier — usage : BASE_URL=/ bun run tests/rules.test.mjs [store.json]
import { readFileSync, existsSync } from 'fs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k), clear: () => mem.clear() };
globalThis.window = Object.assign(new EventTarget(), { localStorage });

const P = await import('../src/shared/planning.ts');
const H = await import('../src/services/hoursService.ts');
const C = await import('../src/config/constants.ts');
const { calculateShiftDurationHours } = await import('../src/server/db.ts');
const { ensureCoreConfig } = await import('../src/shared/coreConfig.ts');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${ok ? '' : `  → attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`}`);
};

// ---- 1. Heures des catégories de base (client ET serveur) -----------------------------------
const opts = C.DEFAULT_TABLEAU2_SHIFTS;
for (const [code, h] of [['BASE', 7], ['REPOS', 0], ['RTT', 0], ['CFA', 0], ['CONGES', 0], ['FERIE', 0]]) {
  eq(`${code} = ${h} h (client)`, H.parseWorkedHours(code, ''), h);
  eq(`${code} = ${h} h (serveur)`, calculateShiftDurationHours(code, '', opts), h);
}
for (const c of ['HEBDO_35H', 'ANNUALISE', 'FORFAIT_JOUR'])
  eq(`BASE = 7 h pour le contrat ${c}`, H.parseWorkedHours('BASE', '', c), 7);
eq('BASE ignore un horaire saisi (7 h quand même)', H.parseWorkedHours('BASE', '09:00-12:00', 'HEBDO_35H'), 7);
eq('CFA distinct de RTT (catégorie)', [C.categorizeShift('CFA'), C.categorizeShift('RTT')], ['CFA', 'RTT']);
eq('BASE est une catégorie à part', C.categorizeShift('BASE'), 'BASE');

// ---- 2. Jours fériés : dates calculées indépendamment (calendriers officiels) ----------------
const known = {
  2024: ['2024-04-01', '2024-05-09', '2024-05-20'],
  2025: ['2025-04-21', '2025-05-29', '2025-06-09'],
  2026: ['2026-04-06', '2026-05-14', '2026-05-25'],
  2027: ['2027-03-29', '2027-05-06', '2027-05-17'],
  2028: ['2028-04-17', '2028-05-25', '2028-06-05'],
};
for (const [y, [paques, ascension, pentecote]] of Object.entries(known)) {
  const h = P.getFrenchPublicHolidays(Number(y));
  eq(`${y} : lundi de Pâques, Ascension, lundi de Pentecôte`, [!!h[paques], !!h[ascension], !!h[pentecote]], [true, true, true]);
  eq(`${y} : 11 jours fériés`, Object.keys(h).length, 11);
}

// ---- 3. Calendrier : longueur des mois ---------------------------------------------------------
eq('février 2027 = 28 jours', P.getMonthDateKeys('2027-02').length, 28);
eq('février 2028 (bissextile) = 29 jours', P.getMonthDateKeys('2028-02').length, 29);
eq('novembre 2026 = 30 jours', P.getMonthDateKeys('2026-11').length, 30);
eq('décembre 2026 = 31 jours', P.getMonthDateKeys('2026-12').length, 31);
eq('mois invalide = aucune date', P.getMonthDateKeys('2026-13').length, 0);

// ---- 4. Génération d'une journée --------------------------------------------------------------
const code = (d) => P.generateDefaultDay(d).shift;
eq('lundi ordinaire (2026-11-09) -> BASE', code('2026-11-09'), 'BASE');
eq('samedi ordinaire (2026-11-07) -> REPOS', code('2026-11-07'), 'REPOS');
eq('dimanche ordinaire (2026-11-08) -> REPOS', code('2026-11-08'), 'REPOS');
eq('férié en semaine (2026-11-11, mercredi) -> FERIE', code('2026-11-11'), 'FERIE');
eq('férié un dimanche (2026-11-01 Toussaint) -> FERIE prioritaire', code('2026-11-01'), 'FERIE');
eq('férié un samedi (2027-05-08) -> FERIE prioritaire', code('2027-05-08'), 'FERIE');
eq('lundi de Pâques 2027-03-29 -> FERIE', code('2027-03-29'), 'FERIE');
eq('Ascension 2027-05-06 -> FERIE', code('2027-05-06'), 'FERIE');
eq('lundi de Pentecôte 2027-05-17 -> FERIE', code('2027-05-17'), 'FERIE');
eq('29 février 2028 (mardi) -> BASE', code('2028-02-29'), 'BASE');
eq('31 mai -> 1er juin : exercice change', [P.getExerciseStartYear('2027-05'), P.getExerciseStartYear('2027-06')], [2026, 2027]);
eq('exercice 2026 = 12 mois juin→mai', [P.getExerciseMonthKeys(2026)[0], P.getExerciseMonthKeys(2026)[11], P.getExerciseMonthKeys(2026).length], ['2026-06', '2027-05', 12]);
eq('exercice 2027 : même règle sans toucher au code', P.getExerciseMonthKeys(2027)[0], '2027-06');
eq('libellés/onglets du mois', P.buildMonthItem('2027-02'), { key: '2027-02', tab: 'FEVRIER 27', label: 'Février 2027' });
eq('12 mois visibles par défaut', C.DEFAULT_VISIBLE_MONTHS.length, 12);

// ---- 5. Catégories de base verrouillées ---------------------------------------------------------
eq('6 catégories de base par défaut', C.DEFAULT_CATEGORIES.map((c) => c.name), ['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES']);
eq('toutes verrouillées', C.DEFAULT_CATEGORIES.every((c) => c.locked) && C.DEFAULT_TABLEAU2_SHIFTS.every((o) => o.locked), true);
const migrated = ensureCoreConfig({
  categories: [{ id: 'x', name: 'REPOS', color: 'rose' }, { id: 'cat_matin', name: 'MATIN', color: 'sky' }],
  tableau2Shifts: [{ id: 'o1', shift: 'OUVERTURE', hours: '09:00-12:00', category: 'JOURNEE', label: 'OUVERTURE' }, { id: 'repos', shift: 'REPOS', hours: '', category: 'REPOS', label: 'REPOS modifié' }],
});
eq('migration : catégories de base manquantes ajoutées en tête, entrées existantes à leur place', migrated.categories.map((c) => c.name), ['BASE', 'RTT', 'FERIE', 'CFA', 'CONGES', 'REPOS', 'MATIN']);
eq('migration : créneau personnalisé conservé, base rétablie', [migrated.tableau2Shifts.some((o) => o.shift === 'OUVERTURE'), migrated.tableau2Shifts.find((o) => o.shift === 'REPOS').label], [true, 'REPOS']);
eq('migration idempotente', ensureCoreConfig(migrated).changed, false);
// L'ordre choisi par l'administrateur est respecté (y compris pour les catégories de base)
const byName = (n) => migrated.tableau2Shifts.find((o) => o.shift === n);
const rest = migrated.tableau2Shifts.filter((o) => !['RTT', 'BASE', 'OUVERTURE'].includes(o.shift));
const reordered = { categories: migrated.categories.slice(), tableau2Shifts: [byName('RTT'), byName('BASE'), byName('OUVERTURE'), ...rest] };
const kept = ensureCoreConfig(reordered);
eq('ordre personnalisé des créneaux de base conservé', kept.tableau2Shifts.slice(0, 3).map((o) => o.shift), ['RTT', 'BASE', 'OUVERTURE']);
eq('…sans modification (ordre déjà valide)', kept.changed, false);
const lost = ensureCoreConfig({ categories: [], tableau2Shifts: reordered.tableau2Shifts.filter((o) => o.shift !== 'CFA') });
eq('catégorie de base manquante rétablie en tête, ordre des autres conservé', [lost.tableau2Shifts[0].shift, lost.tableau2Shifts[1].shift, lost.tableau2Shifts[2].shift], ['CFA', 'RTT', 'BASE']);
const dup = ensureCoreConfig({ categories: [], tableau2Shifts: [...reordered.tableau2Shifts, { id: 'dup', shift: 'BASE', hours: '', category: 'BASE', label: 'BASE' }] });
eq('doublon d\'une catégorie de base supprimé', dup.tableau2Shifts.filter((o) => o.shift === 'BASE').length, 1);

// ---- 6. CFA : 0 h travaillée, -7 h sur l'objectif mensuel -------------------------------------
const emp = { name: 'Test', role: 'x', contractType: 'HEBDO_35H', weeklyHoursQuota: 35 };
const mk = (days) => ({ employee: 'Test', month: '2027-01', days, totalHours: 0 });
const all = P.getMonthDateKeys('2027-01');
const baseDays = Object.fromEntries(all.map((d) => [d, P.generateDefaultDay(d)]));
const calc = (days) => H.calculateEmployeeBalances({ employee: emp, selectedMonth: '2027-01', currentSchedule: mk(days), teamSchedules: { Test: mk(days) } });
const b0 = calc(baseDays);
eq('janvier 2027 généré : 140 h travaillées, objectif 140 h, solde 0', [b0.monthHours, b0.expectedMonthHours, b0.monthBalance], [140, 140, 0]);
const withCfa = { ...baseDays, '2027-01-12': { shift: 'CFA', hours: '', info: '' }, '2027-01-13': { shift: 'CFA', hours: '', info: '' } };
const b1 = calc(withCfa);
eq('2 jours CFA : 126 h travaillées, objectif 126 h (-14 h), solde 0', [b1.monthHours, b1.expectedMonthHours, b1.monthBalance, b1.monthCfaDays], [126, 126, 0, 2]);
const cfaWeekend = { ...baseDays, '2027-01-09': { shift: 'CFA', hours: '', info: '' }, '2027-01-01': { shift: 'CFA', hours: '', info: '' } };
const b2 = calc(cfaWeekend);
eq('CFA un samedi ou un jour férié : pas de double déduction', [b2.expectedMonthHours, b2.monthCfaDays], [140, 0]);
const withRtt = { ...baseDays, '2027-01-12': { shift: 'RTT', hours: '', info: '' } };
const b3 = calc(withRtt);
eq('RTT : comportement actuel conservé (0 h, objectif inchangé)', [b3.monthHours, b3.expectedMonthHours, b3.rttTaken], [133, 140, 1]);
eq('CFA ne compte pas dans les RTT pris', b1.rttTaken, 0);
const withCp = { ...baseDays, '2027-01-12': { shift: 'CONGES', hours: '', info: '' } };
eq('CONGES : comportement actuel conservé (objectif -7 h)', calc(withCp).expectedMonthHours, 133);

// ---- 7. Soldes initiaux : propres à chaque exercice ------------------------------------------
const empInit = { ...emp, contractType: 'ANNUALISE', initialHoursBalance: 3.5 };
const bal = (m) => H.calculateEmployeeBalances({ employee: empInit, selectedMonth: m, currentSchedule: null, teamSchedules: {} });
eq('solde initial appliqué à l\'exercice 2026-27', bal('2026-10').initialHoursBalance, 3.5);
eq('solde initial NON reporté sur l\'exercice 2027-28', bal('2027-09').initialHoursBalance, 0);

// ---- 8. Cohérence client / serveur sur les vraies données ------------------------------------
const dataPath = process.argv[2];
if (dataPath && existsSync(dataPath)) {
  const d = JSON.parse(readFileSync(dataPath, 'utf8'));
  const pairs = new Set();
  for (const m of Object.values(d.schedules)) for (const s of Object.values(m)) for (const day of Object.values(s.days || {})) pairs.add(`${day.shift}||${day.hours}`);
  let mismatch = [];
  for (const k of pairs) {
    const [shift, hours] = k.split('||');
    const a = H.parseWorkedHours(shift, hours, undefined);
    const b = Math.round(calculateShiftDurationHours(shift, hours, d.config.tableau2Shifts) * 100) / 100;
    if (Math.abs(a - b) > 0.06) mismatch.push(`${shift} [${hours}] client=${a} serveur=${b}`);
  }
  eq(`client = serveur sur ${pairs.size} combinaisons réelles`, mismatch, []);
  // Les 6 catégories de base : jamais d'écart sur toutes les données
  let stale = 0;
  for (const [m, sc] of Object.entries(d.schedules)) for (const [n, s] of Object.entries(sc)) {
    let t = 0; for (const day of Object.values(s.days || {})) t += H.parseWorkedHours(day.shift, day.hours, undefined);
    if (Math.abs(Math.round(t * 100) / 100 - (s.totalHours ?? 0)) > 0.06) stale++;
  }
  eq('totaux enregistrés = recalcul (72 plannings réels)', stale, 0);
}

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
