// Tests d'intégration serveur — usage : node tests/generation.test.mjs [url] [store.json]
import { readFileSync, existsSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:3100';
const DATA = process.argv[3];
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || 'test-admin';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${detail ? '  → ' + detail : ''}`); };
async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// ---- calendrier de référence INDÉPENDANT du code testé -----------------------------------------
const easter = (y) => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const holidays = (y) => { const e = easter(y).getTime(), p = (n) => iso(new Date(e + n * 864e5)); return new Set([`${y}-01-01`, p(1), `${y}-05-01`, `${y}-05-08`, p(39), p(50), `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`]); };
const expectedCode = (dk) => { if (holidays(+dk.slice(0, 4)).has(dk)) return 'FERIE'; const w = new Date(dk + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6 ? 'REPOS' : 'BASE'; };
const datesOf = (m) => { const [y, mo] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
const nowKey = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
const monthConforms = (days, m) => datesOf(m).every((d) => days?.[d]?.shift === expectedCode(d));

// ---- préparation : magasin neuf -------------------------------------------------------------------
const login = await call('POST', '/api/superadmin/login', { body: { password: SUPER_PW } });
const SA = { 'X-Superadmin-Token': login.json?.token };
const created = await call('POST', '/api/superadmin/stores', { body: { name: 'Magasin Génération', token: 'GEN-TEST', adminPin: '112233' }, headers: SA });
const store = created.json?.store;
const v = await call('POST', '/api/verify-token', { body: { token: 'GEN-TEST' } });
const SH = { Authorization: `Bearer ${v.json.session}`, 'X-Store-Id': store.id };
const pin = await call('POST', '/api/verify-pin', { headers: SH, body: { pin: '112233' } });
const AH = { ...SH, 'X-Admin-Session': pin.json.adminSession };
const schedules = async () => (await call('GET', '/api/schedules', { headers: SH })).json.schedules;
const config = async () => (await call('GET', '/api/config', { headers: SH })).json.config;

// ---- 1. Création d'un magasin -------------------------------------------------------------------
let cfg = await config();
const firstEmployee = cfg.employees[0];
t('catégories par défaut = les 6 catégories de base', JSON.stringify(cfg.categories.map((c) => c.name)) === JSON.stringify(['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES']));
t('les 12 mois de l\'exercice sont visibles', cfg.visibleMonths.length === 12 && cfg.allMonths.length === 12);
let sc = await schedules();
const months0 = cfg.allMonths.map((m) => m.key);
t('planning du responsable généré et enregistré pour les 12 mois', months0.every((m) => sc[m]?.[firstEmployee.name]));
t('chaque journée = FERIE / REPOS / BASE selon le calendrier', months0.every((m) => monthConforms(sc[m][firstEmployee.name].days, m)));
const janKey = months0.find((m) => m.endsWith('-01'));
const wantJan = datesOf(janKey).filter((d) => expectedCode(d) === 'BASE').length * 7;
t(`total du mois enregistré correct (${janKey} : ${wantJan} h)`, sc[janKey][firstEmployee.name].totalHours === wantJan, `obtenu ${sc[janKey][firstEmployee.name].totalHours}`);
const febKey = months0.find((m) => m.endsWith('-02'));
t('février : nombre de jours exact', Object.keys(sc[febKey][firstEmployee.name].days).length === datesOf(febKey).length, `${Object.keys(sc[febKey][firstEmployee.name].days).length} jours`);

// ---- 2. Ajout d'un salarié : exercice COMPLET ----------------------------------------------------------
const before = JSON.stringify(sc);
const newEmp = { ...firstEmployee, name: 'Nouveau', role: 'Test', isAdmin: false };
let r = await call('POST', '/api/config', { headers: AH, body: { employees: [...cfg.employees, newEmp] } });
t('ajout du salarié accepté', r.status === 200);
sc = await schedules();
const fromNow = months0.filter((m) => m >= nowKey());
t(`planning généré sur les ${months0.length} mois de l'exercice (passés et futurs)`, months0.every((m) => monthConforms(sc[m]?.['Nouveau']?.days, m)));
t('les autres salariés ne sont pas modifiés', JSON.stringify(Object.fromEntries(months0.map((m) => [m, sc[m][firstEmployee.name]]))) === JSON.stringify(Object.fromEntries(months0.map((m) => [m, JSON.parse(before)[m][firstEmployee.name]]))));
const cfgAfter = await config();
t('totaux enregistrés cohérents sur les mois passés', months0.every((m) => sc[m]['Nouveau'].totalHours === datesOf(m).filter((d) => expectedCode(d) === 'BASE').length * 7));

// ---- 3. Idempotence + reprise ------------------------------------------------------------------
const g1 = await call('POST', '/api/planning/generate', { headers: AH, body: {} });
t('relancer la génération : 0 journée créée', g1.json?.createdDays === 0, `créées=${g1.json?.createdDays}`);
await call('POST', `/api/schedules/${months0[0]}/shift`, { headers: AH, body: { employeeName: 'Nouveau', dateKey: datesOf(months0[0]).find((d) => expectedCode(d) === 'BASE'), shift: 'EMPTY', hours: '' } });
const g2 = await call('POST', '/api/planning/generate', { headers: AH, body: {} });
t('génération par défaut = exercice complet (reprend une journée supprimée dans un mois passé)', g2.json?.createdDays === 1 && g2.json?.months?.[0] === months0[0], `créées=${g2.json?.createdDays}`);
const g3 = await call('POST', '/api/planning/generate', { headers: AH, body: {} });
t('…et une seconde fois : 0 journée', g3.json?.createdDays === 0);
r = await call('POST', '/api/planning/generate', { headers: SH, body: {} });
t('génération sans droits administrateur refusée', r.status === 403);

// ---- 4. Protection des saisies ---------------------------------------------------------------------
const m4 = fromNow[0] || months0[months0.length - 1];
const monday = datesOf(m4).find((d) => expectedCode(d) === 'BASE');
const mondayHours = (await schedules())[m4]['Nouveau'].totalHours;
await call('POST', `/api/schedules/${m4}/shift`, { headers: AH, body: { employeeName: 'Nouveau', dateKey: monday, shift: 'CONGES', hours: '', info: 'saisie manuelle' } });
await call('POST', '/api/planning/generate', { headers: AH, body: { monthKeys: [m4] } });
sc = await schedules();
t('saisie manuelle jamais écrasée par une génération', sc[m4]['Nouveau'].days[monday].shift === 'CONGES' && sc[m4]['Nouveau'].days[monday].info === 'saisie manuelle');
t('total recalculé après la saisie (-7 h)', sc[m4]['Nouveau'].totalHours === mondayHours - 7, `${mondayHours} -> ${sc[m4]['Nouveau'].totalHours}`);
await call('POST', `/api/schedules/${m4}/shift`, { headers: AH, body: { employeeName: 'Nouveau', dateKey: monday, shift: 'EMPTY', hours: '' } });
await call('POST', '/api/planning/generate', { headers: AH, body: { monthKeys: [m4] } });
sc = await schedules();
t('journée supprimée (absente) : recréée par la reprise', sc[m4]['Nouveau'].days[monday]?.shift === 'BASE');

// ---- 5. Un mois isolé n'existe pas : ajouter un mois crée l'exercice COMPLET --------------------------------
cfg = await config();
const other = JSON.stringify((await schedules())[months0[0]]);
const feb28 = { key: '2028-02', tab: 'FEVRIER 28', label: 'Février 2028' };
r = await call('POST', '/api/config', { headers: AH, body: { allMonths: [...cfg.allMonths, feb28], visibleMonths: [...cfg.visibleMonths, '2028-02'] } });
sc = await schedules();
cfg = await config();
const ex27 = ['2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12', '2028-01', '2028-02', '2028-03', '2028-04', '2028-05'];
const emps = cfg.employees.map((e) => e.name);
t('un mois ajouté complète tout son exercice (12 mois)', ex27.every((k) => cfg.allMonths.some((m) => m.key === k)) && cfg.allMonths.length === 24);
t('mois triés chronologiquement', JSON.stringify(cfg.allMonths.map((m) => m.key)) === JSON.stringify(cfg.allMonths.map((m) => m.key).sort()));
t('seul le mois demandé est visible, les autres sont à publier', cfg.visibleMonths.includes('2028-02') && !cfg.visibleMonths.includes('2027-08'));
t('journées générées pour TOUS les salariés sur les 12 mois (février 2028 = 29 jours)', ex27.every((m) => emps.every((n) => monthConforms(sc[m]?.[n]?.days, m))) && Object.keys(sc['2028-02'][emps[0]].days).length === 29);
t('les mois existants ne sont pas modifiés', JSON.stringify(sc[months0[0]]) === other);

// ---- 6. Retirer un seul mois : refusé (l'exercice est réparé) ; retirer un exercice entier : accepté ------------
cfg = await config();
r = await call('POST', '/api/config', { headers: AH, body: { allMonths: cfg.allMonths.filter((m) => m.key !== '2027-08') } });
cfg = await config();
t('suppression d\'un mois isolé impossible (exercice complété)', cfg.allMonths.some((m) => m.key === '2027-08'));
r = await call('POST', '/api/config', { headers: AH, body: { visibleMonths: [...cfg.visibleMonths, '1999-01'] } });
cfg = await config();
t('mois visibles inexistants ignorés', !cfg.visibleMonths.includes('1999-01'));
const beforeMonths = JSON.stringify(Object.fromEntries(months0.map((m) => [m, sc[m]])));
r = await call('POST', '/api/config', { headers: AH, body: { allMonths: cfg.allMonths.filter((m) => !ex27.includes(m.key)), visibleMonths: cfg.visibleMonths.filter((k) => !ex27.includes(k)) } });
cfg = await config();
t('exercice entier retirable : 12 mois restants, exercice précédent intact', cfg.allMonths.length === 12 && JSON.stringify(Object.fromEntries(months0.map((m) => [m, sc[m]]))) === beforeMonths);

// ---- 7. Concurrence / doubles clics -----------------------------------------------------------------------------
const m7 = { key: '2030-03', tab: 'MARS 30', label: 'Mars 2030' };
const cfgBody = { allMonths: [...cfg.allMonths, m7], visibleMonths: [...cfg.visibleMonths, '2030-03'] };
const results = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/api/config', { headers: AH, body: cfgBody })));
await Promise.all([1, 2, 3].map(() => call('POST', '/api/planning/generate', { headers: AH, body: { monthKeys: ['2030-03'] } })));
sc = await schedules();
t('5 envois simultanés : tous acceptés', results.every((x) => x.status === 200));
t('…journées uniques et complètes (31 jours, aucun doublon)', emps.every((n) => Object.keys(sc['2030-03'][n].days).length === 31 && monthConforms(sc['2030-03'][n].days, '2030-03')));
cfg = await config();
t('…exercice 2029-2030 créé une seule fois (12 mois)', cfg.allMonths.filter((m) => m.key === '2030-03').length === 1 && cfg.allMonths.length === 24);

// ---- 8. Totaux jamais périmés + aucun salarié perdu --------------------------------------------------
const mTot = months0[months0.length - 2];
sc = await schedules();
const stale = JSON.parse(JSON.stringify(sc[mTot]));
const someDay = datesOf(mTot).find((d) => expectedCode(d) === 'BASE');
stale[firstEmployee.name].days[someDay] = { shift: 'RTT', hours: '', info: '' };
stale[firstEmployee.name].totalHours = 999; // total périmé envoyé par un vieux client
delete stale['Nouveau']; // client pas encore synchronisé
await call('POST', `/api/schedules/${mTot}`, { headers: AH, body: { teamSchedules: stale } });
sc = await schedules();
const exp = datesOf(mTot).reduce((n, d) => n + (d === someDay ? 0 : expectedCode(d) === 'BASE' ? 7 : 0), 0);
t('total périmé corrigé par le serveur', sc[mTot][firstEmployee.name].totalHours === exp, `obtenu ${sc[mTot][firstEmployee.name].totalHours}, attendu ${exp}`);
t('salarié absent de l\'envoi conservé', !!sc[mTot]['Nouveau']);

// ---- 9. Catégories verrouillées côté serveur ----------------------------------------------------------
r = await call('POST', '/api/config', { headers: AH, body: { categories: [{ id: 'x', name: 'REPOS', color: 'rose' }, { id: 'c1', name: 'INVENTAIRE', color: 'sky' }], tableau2Shifts: [{ id: 'inv', shift: 'INVENTAIRE', hours: '', category: 'INVENTAIRE', label: 'INVENTAIRE', hoursDecimal: 4 }] } });
cfg = await config();
t('catégories de base impossibles à supprimer ou modifier', ['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES'].every((n) => cfg.categories.find((c) => c.name === n)?.locked) && cfg.categories.find((c) => c.name === 'REPOS').color === 'slate', cfg.categories.map((c) => c.name).join(','));
t('catégorie personnalisée créée et conservée', cfg.categories.some((c) => c.name === 'INVENTAIRE') && cfg.tableau2Shifts.some((o) => o.shift === 'INVENTAIRE'));
r = await call('POST', '/api/config', { headers: AH, body: { categories: cfg.categories.filter((c) => c.name !== 'INVENTAIRE'), tableau2Shifts: cfg.tableau2Shifts.filter((o) => o.shift !== 'INVENTAIRE') } });
cfg = await config();
t('catégorie personnalisée supprimable', !cfg.categories.some((c) => c.name === 'INVENTAIRE') && cfg.categories.length === 6);
// Ordre des créneaux (y compris verrouillés) modifiable et conservé par le serveur
const reorder = [cfg.tableau2Shifts[4], cfg.tableau2Shifts[0], ...cfg.tableau2Shifts.filter((_, i) => i !== 0 && i !== 4)];
await call('POST', '/api/config', { headers: AH, body: { tableau2Shifts: reorder } });
const cfgOrd = await config();
t('ordre des créneaux verrouillés modifiable et conservé par le serveur', JSON.stringify(cfgOrd.tableau2Shifts.map((o) => o.shift)) === JSON.stringify(reorder.map((o) => o.shift)), cfgOrd.tableau2Shifts.map((o) => o.shift).join(','));
t('…créneaux toujours verrouillés', cfgOrd.tableau2Shifts.every((o) => o.locked));

// ---- 10. Données réelles : option A (aucune réinitialisation) ----------------------------------------------
if (DATA && existsSync(DATA)) {
  const real = JSON.parse(readFileSync(DATA, 'utf8'));
  r = await call('POST', `/api/superadmin/stores/${store.id}/restore`, { headers: SA, body: real });
  t('restauration des vraies données (copie isolée)', r.status === 200);
  const after = await schedules();
  const identical = JSON.stringify(Object.keys(real.schedules).sort()) === JSON.stringify(Object.keys(after).sort()) &&
    Object.keys(real.schedules).every((m) => JSON.stringify(real.schedules[m]) === JSON.stringify(after[m]));
  t('plannings réels strictement identiques après migration (aucune journée ajoutée/modifiée/supprimée)', identical);
  const c2 = await config();
  const legacy = real.config.categories.map((c) => c.name).filter((n) => !['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES'].includes(n));
  const realNames = real.config.categories.map((c) => c.name);
t('catégories réelles : ordre existant conservé, 6 catégories de base présentes et verrouillées, anciennes conservées', JSON.stringify(c2.categories.map((c) => c.name)) === JSON.stringify(['BASE', 'FERIE', 'CFA', ...realNames]) && ['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES'].every((n) => c2.categories.find((c) => c.name === n)?.locked), c2.categories.map((c) => c.name).join(','));
  t('créneaux réels (OUVERTURE, FERMETURE…) conservés', ['OUVERTURE', 'FERMETURE', 'JOURNEE'].every((s) => c2.tableau2Shifts.some((o) => o.shift === s)));
  t('12 mois visibles conservés', c2.visibleMonths.length === 12);
  const dry = await call('POST', '/api/planning/generate', { headers: AH, body: {} });
  console.log(`INFO  une génération manuelle (exercice complet) créerait ${dry.json.createdDays} journée(s) manquante(s) sur vos données réelles — jamais lancée automatiquement`);
}

// ---- nettoyage -----------------------------------------------------------------------------------------------
await call('DELETE', `/api/superadmin/stores/${store.id}`, { headers: SA });
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
