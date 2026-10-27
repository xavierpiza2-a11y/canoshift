// Tests de l'export Excel — usage : BASE_URL=/ bun run tests/excel.test.mjs <store.json>
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
globalThis.window = Object.assign(new EventTarget(), { localStorage });

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { generatePlanningTemplateXLSX } = await import('../src/services/excelService.ts');
const { ensureResponsableAdmin } = await import('../src/services/api.ts');
const ExcelJS = (await import('exceljs')).default;

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${detail ? '  → ' + detail : ''}`); };

const employees = ensureResponsableAdmin(d.config.employees);
const options = d.config.tableau2Shifts;
const months = Object.keys(d.schedules).sort();

const JSZip = (await import('jszip')).default;
// Valeurs mises en cache de la ligne de total, lues dans le XML brut (ce que voient les lecteurs qui ne recalculent pas)
async function cachedTotals(buf, row, n) {
  const z = await JSZip.loadAsync(buf);
  const xml = await z.file('xl/worksheets/sheet1.xml').async('string');
  const r = xml.match(new RegExp(`<row r="${row}"[\\s\\S]*?</row>`))[0];
  return Array.from({ length: n }, (_, i) => {
    const col = String.fromCharCode(67 + i);
    const m = r.match(new RegExp(`<c r="${col}${row}"[^>]*><f>[^<]*</f><v>([^<]*)</v>`));
    return m ? parseFloat(m[1]) : null;
  });
}
async function load(buf) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }
const totalRowOf = (ws) => ws.getRow(ws.rowCount);
const cellValue = (c) => (c && typeof c.value === 'object' && c.value !== null && 'formula' in c.value ? c.value : null);

// ---- 1. Modèle : la ligne de total existe, avec une formule pour CHAQUE salarié ---------------------------
{
  const tplBuf = await generatePlanningTemplateXLSX('2026-11', employees, options, undefined, {}, 'Test');
  const wb = await load(tplBuf);
  const ws = wb.getWorksheet('Planning');
  const row = totalRowOf(ws);
  t('modèle : ligne TOTAL HEURES présente', String(row.getCell(1).value) === 'TOTAL HEURES');
  const all = employees.every((_, i) => cellValue(row.getCell(3 + i))?.formula?.includes('SUMPRODUCT'));
  t(`modèle : formule de total pour les ${employees.length} salariés (responsable compris)`, all);
  const tplCache = await cachedTotals(tplBuf, ws.rowCount, employees.length);
  t('modèle : valeur 0 h enregistrée dans le fichier (jamais de case vide, même sans recalcul)', tplCache.every((v) => v === 0), JSON.stringify(tplCache));
  t('modèle : liste déroulante conservée', !!ws.getRow(3).getCell(3).dataValidation?.formulae?.[0]?.includes('Créneaux'));
}

// ---- 2. Planning complet : tous les mois, tous les salariés, totaux cohérents ---------------------------------
let allCols = true, allTotals = true, allFormulas = true, filledOk = true;
for (const m of months) {
  const sc = d.schedules[m];
  const fullBuf = await generatePlanningTemplateXLSX(m, employees, options, sc, d.dayNotes?.[m] || {}, 'Test');
  const wb = await load(fullBuf);
  const ws = wb.getWorksheet('Planning');
  const row = totalRowOf(ws);
  const header = ws.getRow(2);
  const cache = await cachedTotals(fullBuf, ws.rowCount, employees.length);
  employees.forEach((e, i) => {
    if (!String(header.getCell(3 + i).value).startsWith(e.name)) allCols = false;
    const f = cellValue(row.getCell(3 + i));
    if (!f?.formula) allFormulas = false;
    const stored = sc[e.name]?.totalHours ?? 0;
    if (cache[i] === null || Math.abs(cache[i] - stored) > 0.06) { allTotals = false; console.log(`   écart ${m} ${e.name}: valeur du fichier=${cache[i]} enregistré=${stored}`); }
    const days = Object.values(sc[e.name]?.days || {}).filter((x) => x.shift || x.hours).length;
    let filled = 0;
    for (let r = 3; r < ws.rowCount; r++) if (ws.getRow(r).getCell(3 + i).value) filled++;
    if (filled !== days) { filledOk = false; console.log(`   cases ${m} ${e.name}: ${filled} remplies pour ${days} journées`); }
  });
}
t(`planning complet (${months.length} mois) : une colonne par salarié, responsable compris`, allCols);
t('planning complet : formule de total pour chaque salarié et chaque mois', allFormulas);
t('planning complet : total affiché = total enregistré (tous mois, tous salariés)', allTotals);
t('planning complet : toutes les journées saisies sont présentes (aucune case perdue)', filledOk);

// ---- 3. Mois ≠ mois chargé : l'export doit utiliser le planning DU MOIS demandé --------------------------------
{
  const wb = await load(await generatePlanningTemplateXLSX('2026-12', employees, options, d.schedules['2026-12'], {}, 'Test'));
  const ws = wb.getWorksheet('Planning');
  const resp = employees.findIndex((e) => /responsable/i.test(e.role || '') || e.isAdmin) ;
  const idx = resp >= 0 ? resp : 0;
  let filled = 0; for (let r = 3; r < ws.rowCount; r++) if (ws.getRow(r).getCell(3 + idx).value) filled++;
  t(`décembre 2026 : colonne du responsable remplie (${employees[idx].name})`, filled > 0, `${filled} cases`);
}

// ---- 4. Recalcul réel des formules par LibreOffice ------------------------------------------------------------------
const hasLO = (() => { try { execSync('which soffice', { stdio: 'ignore' }); return true; } catch { return false; } })();
if (hasLO) {
  mkdirSync('/tmp/xl', { recursive: true });
  const m = '2026-11';
  const sc = d.schedules[m];
  async function recalc(name, mutate) {
    const wb = await load(await generatePlanningTemplateXLSX(m, employees, options, sc, {}, 'Test'));
    const ws = wb.getWorksheet('Planning');
    if (mutate) mutate(ws);
    // on retire les valeurs mises en cache : LibreOffice DOIT recalculer les formules
    const row = totalRowOf(ws);
    employees.forEach((_, i) => { const f = cellValue(row.getCell(3 + i)); if (f) row.getCell(3 + i).value = { formula: f.formula }; });
    const file = `/tmp/xl/${name}.xlsx`;
    await wb.xlsx.writeFile(file);
    execSync(`cd /tmp/xl && timeout 120 soffice --headless --convert-to csv --outdir /tmp/xl ${file} >/dev/null 2>&1`);
    const lines = readFileSync(`/tmp/xl/${name}.csv`, 'utf8').trim().split('\n');
    const last = lines[lines.length - 1].split(',').map((x) => x.replace(/"/g, ''));
    return employees.map((_, i) => parseFloat((last[2 + i] || '').replace('h', '').replace(',', '.')));
  }
  const base = await recalc('recalc_base');
  const expected = employees.map((e) => sc[e.name]?.totalHours ?? 0);
  t('LibreOffice recalcule les formules : totaux = totaux enregistrés', JSON.stringify(base) === JSON.stringify(expected), `calculé=${base} attendu=${expected}`);
  // Modifier une case dans Excel => le total change tout seul
  const i0 = 0;
  const mutated = await recalc('recalc_modif', (ws) => {
    for (let r = 3; r < ws.rowCount; r++) { const c = ws.getRow(r).getCell(3 + i0); if (/\(\d+h/.test(String(c.value)) || c.value === 'BASE') { c.value = 'CONGES'; break; } }
  });
  t('changer une case en CONGES dans Excel diminue le total automatiquement', mutated[i0] < base[i0], `${base[i0]} → ${mutated[i0]}`);
  const emptyMod = await recalc('recalc_vide', (ws) => { for (let r = 3; r < ws.rowCount; r++) ws.getRow(r).getCell(3 + i0).value = null; });
  t('colonne vidée : total = 0', emptyMod[i0] === 0, `${emptyMod[i0]}`);
} else {
  console.log('INFO  LibreOffice absent : recalcul des formules non vérifié');
}

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
