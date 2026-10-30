// Rendu de EmployeeView : une seule vue (liste), plus de grille ni d'export agenda
import React from 'react';
import { renderToString } from 'react-dom/server';
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() };
(globalThis as any).window = Object.assign(new EventTarget(), { localStorage: (globalThis as any).localStorage });
const { EmployeeView } = await import('../src/components/EmployeeView');
const P = await import('../src/shared/planning');

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}`); };
const strip = (h: string) => h.replace(/<!-- -->/g, '');

const month = '2026-11';
const days: Record<string, any> = {};
for (const d of P.getMonthDateKeys(month)) days[d] = { ...P.generateDefaultDay(d), hours: '', info: '' };
const emp: any = { name: 'Test', color: 'emerald', contractType: 'HEBDO_35H' };
const items = P.getExerciseMonthItems(2026);
const html = strip(renderToString(
  <EmployeeView currentEmployee={emp} schedule={{ employee: 'Test', month, days, totalHours: 140 } as any} isLoading={false}
    selectedMonth={month} allMonths={items} visibleMonths={items.map((m) => m.key)} onSelectMonth={() => {}} onRefresh={() => {}} onOpenHistory={() => {}} />
));
t('le rendu de la vue liste ne plante pas', html.length > 500);
t('plus de bouton « Grille »', !html.includes('Grille'));
t('plus de bouton « Liste » (vue unique)', !html.includes('>Liste<'));
t('plus d\'export vers l\'agenda', !html.includes('Exporter vers mon agenda'));
t('bouton Historique conservé', html.includes('Historique des modifications'));
t('les 30 jours de novembre 2026 sont listés (20 BASE, 8 REPOS, 2 FERIE)', (html.match(/BASE/g) || []).length === 20 && (html.match(/REPOS/g) || []).length === 8 && html.includes('01</span>') && html.includes('30</span>'));
t('plus de grille en 7 colonnes', !html.includes('grid-cols-7'));
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
