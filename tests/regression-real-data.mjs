// Compare l'ANCIEN et le NOUVEAU code de calcul sur les vraies données (copie sans secrets).
// Usage : BASE_URL=/ bun run tests/regression-real-data.mjs <store.json> <dossier-ancien-code>
import { readFileSync } from 'fs';
const [dataPath, oldDir] = [process.argv[2], process.argv[3]];
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k), clear: () => mem.clear() };
globalThis.window = Object.assign(new EventTarget(), { localStorage });

const d = JSON.parse(readFileSync(dataPath, 'utf8'));
for (const [m, sc] of Object.entries(d.schedules)) mem.set(`planning_team_${m}`, JSON.stringify(sc));

const oldMod = await import(`${oldDir}/src/services/hoursService.ts`);
const newMod = await import('../src/services/hoursService.ts');
const { isOpenWeekday } = await import('../src/shared/planning.ts');

const FIELDS = ['monthHours', 'expectedMonthHours', 'monthBalance', 'monthWorkedDays', 'exerciseHours', 'expectedExerciseHoursAtDate', 'exerciseBalance', 'projectedExerciseEndHours', 'exerciseWorkedDays', 'forfaitDaysRemaining', 'paidLeaveTaken', 'paidLeaveRemaining', 'rttTaken', 'rttRemaining', 'initialHoursBalance'];
const months = d.config.allMonths;
let pairs = 0, diffPairs = 0, unexplained = 0;
const byField = {};
const lines = [];
for (const emp of d.config.employees) for (const mi of months) {
  const sched = d.schedules[mi.key]?.[emp.name];
  const params = { employee: emp, selectedMonth: mi.key, currentSchedule: sched || null, teamSchedules: d.schedules[mi.key] || {}, allMonths: months };
  const a = oldMod.calculateEmployeeBalances(params), b = newMod.calculateEmployeeBalances(params);
  pairs++;
  const diffs = FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
  if (!diffs.length) continue;
  diffPairs++;
  diffs.forEach((f) => (byField[f] = (byField[f] || 0) + 1));
  // Explication attendue : jours CFA dans le mois (objectif) ou dans l'exercice (compteur RTT)
  const cfaMonth = sched ? Object.entries(sched.days || {}).filter(([k, v]) => (v.shift || '').toUpperCase() === 'CFA' && isOpenWeekday(k)).length : 0;
  const cfaAny = Object.values(d.schedules).some((m) => Object.values(m[emp.name]?.days || {}).some((v) => (v.shift || '').toUpperCase() === 'CFA'));
  if (!cfaAny) unexplained++;
  if (lines.length < 12) lines.push(`${emp.name} ${mi.key}: ` + diffs.map((f) => `${f} ${a[f]}→${b[f]}`).join(', ') + ` (jours CFA ouvrés du mois: ${cfaMonth})`);
}
console.log(`Couples salarié×mois comparés : ${pairs}`);
console.log(`Avec au moins une différence    : ${diffPairs}`);
console.log(`Différences sans aucun jour CFA  : ${unexplained}  (doit être 0)`);
console.log('Champs concernés :', JSON.stringify(byField));
console.log(lines.join('\n'));
process.exit(unexplained ? 1 : 0);
