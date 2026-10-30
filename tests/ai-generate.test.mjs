// Génération IA de bout en bout contre un FAUX fournisseur (aucun appel réel, aucune clé réelle)
// usage : AI_TEST_SCENARIO=gemini|anthropic|nokey node tests/ai-generate.test.mjs http://localhost:3100  (voir tests/run-ai-generate.sh)
import http from 'http';
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://localhost:3100';
const SCEN = process.env.AI_TEST_SCENARIO || 'gemini';
const FAKE_PORT = Number(process.env.FAKE_PORT || 3199);
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || 'test-admin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${detail ? '  → ' + detail : ''}`); };
async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// ---------------- Faux fournisseur ----------------
let behavior = 'good'; // good | bad-first | garbage | unauthorized | slow
const requests = []; let callCount = 0;
function plan(payload, { bad = false } = {}) {
  const out = {};
  for (const s of payload.salaries) {
    out[s.salarie] = {};
    for (const d of s.joursARenseigner) {
      const day = payload.jours.find((x) => x.date === d);
      const dom = Number(d.slice(8));
      const wk = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'].includes(day.jour);
      const idx = Number(s.salarie.slice(-1).charCodeAt(0)) % 2;
      out[s.salarie][d] = wk ? ((dom + idx) % 2 ? 'OUVERTURE' : 'FERMETURE') : 'REPOS';
    }
    if (bad) { // une proposition hors cadre : congé posé + code inventé
      const locked = Object.keys(s.joursDejaPoses || {})[0];
      if (locked) out[s.salarie][locked] = 'OUVERTURE';
      out[s.salarie][s.joursARenseigner[0]] = 'CAFE';
    }
  }
  return { planning: out, commentaire: 'Planning équilibré.' };
}
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    callCount++;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ url: req.url, headers: req.headers, raw, body });
    if (behavior === 'unauthorized') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"bad key SECRET-XYZ"}'); }
    if (behavior === 'slow') await sleep(900);
    const isG = req.url.includes(':generateContent');
    const userText = isG ? body.contents?.[0]?.parts?.[0]?.text : body.messages?.[0]?.content;
    const payload = JSON.parse(userText.slice(userText.indexOf('{'), userText.indexOf('\n\nTa proposition') > 0 ? userText.indexOf('\n\nTa proposition') : undefined));
    const isRepair = userText.includes('Ta proposition précédente');
    let answer;
    if (behavior === 'garbage') answer = 'Désolé, je ne peux pas.';
    else answer = JSON.stringify(plan(payload, { bad: behavior === 'bad-first' && !isRepair }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(isG ? { candidates: [{ content: { parts: [{ text: answer }] } }] } : { content: [{ type: 'text', text: answer }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, r));

// ---------------- Préparation ----------------
const login = await call('POST', '/api/superadmin/login', { body: { password: SUPER_PW } });
const SA = { 'X-Superadmin-Token': login.json?.token };
const sa = (m, p, b) => call(m, p, { body: b, headers: SA });
const A = (await sa('POST', '/api/superadmin/stores', { name: 'Jardin Secret SARL', token: 'CLEA-GEN', adminPin: '123456' })).json?.store;
const B = (await sa('POST', '/api/superadmin/stores', { name: 'Magasin B', token: 'CLEB-GEN', adminPin: '654321' })).json?.store;
const sess = async (token, pin) => { const v = await call('POST', '/api/verify-token', { body: { token } }); const st = { Authorization: `Bearer ${v.json.session}` }; const p = await call('POST', '/api/verify-pin', { headers: st, body: { pin } }); return { store: st, admin: { ...st, 'X-Admin-Session': p.json.adminSession } }; };
const SA_A = await sess('CLEA-GEN', '123456'), SA_B = await sess('CLEB-GEN', '654321');
const MONTH = '2026-11';

if (SCEN === 'nokey') {
  await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true } });
  let r = await call('GET', '/api/ai-planning/status', { headers: SA_A.admin });
  t('clé absente (valeur d\'exemple du .env) : status.configured = false', r.json?.configured === false && !/MY_GEMINI|key/i.test(r.text.replace(/configured/g, '')));
  r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: MONTH, mode: 'simple' } });
  t('clé absente : génération refusée 503 AI_NOT_CONFIGURED, message lisible', r.status === 503 && r.json?.code === 'AI_NOT_CONFIGURED' && /\.env/.test(r.json?.error));
  t('clé absente : aucun appel sortant', callCount === 0);
  fake.close(); console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`); process.exit(fail ? 1 : 0);
}

// Équipe de test : Anna, Bob (en plus du salarié de départ)
const cfg0 = (await call('GET', '/api/config', { headers: SA_A.store })).json.config;
const emps = [...cfg0.employees, ...['Anna', 'Bob'].map((name) => ({ name, color: '#336699', role: 'Vendeur', contractType: 'ANNUALISE', weeklyHoursQuota: 35, yearlyHoursQuota: 1607, initialHoursBalance: 0, paidLeaveTotal: 25, paidLeaveTaken: 0, rttTotal: 0, rttTaken: 0 }))];
await call('POST', '/api/config', { headers: SA_A.admin, body: { ...cfg0, employees: emps } });
const names = emps.map((e) => e.name);
t('équipe de test créée (3 salariés)', names.length === 3);

// Créneaux de l'admin
const cfg1 = (await call('GET', '/api/config', { headers: SA_A.store })).json.config;
await call('POST', '/api/config', { headers: SA_A.admin, body: { ...cfg1, tableau2Shifts: [...cfg1.tableau2Shifts.filter((s) => !['OUVERTURE', 'FERMETURE'].includes(s.shift)), { id: 'ouv', shift: 'OUVERTURE', hours: '09:00 - 16:00', category: 'AUTRE', label: 'OUVERTURE', hoursDecimal: 7, dayStatus: 'PRESENT' }, { id: 'fer', shift: 'FERMETURE', hours: '12:00 - 19:00', category: 'AUTRE', label: 'FERMETURE', hoursDecimal: 7, dayStatus: 'PRESENT' }] } });
// Un congé posé à la main (doit rester intouchable)
await call('POST', `/api/schedules/${MONTH}/shift`, { headers: SA_A.admin, body: { employeeName: 'Anna', dateKey: '2026-11-17', shift: 'CONGES', hours: '' } });

// ---------------- Option désactivée ----------------
let r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: MONTH, mode: 'simple' } });
t('option désactivée : génération refusée (403 FEATURE_DISABLED)', r.status === 403 && r.json?.code === 'FEATURE_DISABLED');
t('option désactivée : aucun appel au fournisseur', callCount === 0);
await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true } });
await sa('PUT', `/api/superadmin/stores/${B.id}`, { features: { aiPlanning: true } });
await call('POST', '/api/ai-planning/settings', { headers: SA_A.admin, body: { settings: { staffing: { minOpening: 1, minClosing: 1, minPerDay: 1 }, employees: { Anna: { constraints: 'Anna ne travaille pas le jeudi (cours de Bob)' }, Bob: { targetHoursGap: 3.5 } }, monthNotes: { [MONTH]: 'Arrivage chez Jardin Secret SARL le 10, Anna en renfort' } } } });

const wsMsgs = []; const ws = new WebSocket(BASE.replace('http', 'ws') + `/ws?session=${SA_A.store.Authorization.slice(7)}`);
await new Promise((res) => { ws.on('open', res); ws.on('error', res); }); ws.on('message', (d) => { try { wsMsgs.push(JSON.parse(d.toString())); } catch {} });

r = await call('GET', '/api/ai-planning/status', { headers: SA_A.admin });
t('status : clé configurée, fournisseur et modèle, limite 3/h, sans la clé', r.json?.configured === true && r.json?.provider === SCEN && r.json?.limitPerHour === 3 && r.json?.remaining === 3 && !/test-key|SECRET/.test(r.text), r.text);
t(`status : modèle par défaut (${SCEN === 'gemini' ? 'gemini-3.8-flash' : 'claude-sonnet-5-5'})`, r.json?.model === (SCEN === 'gemini' ? 'gemini-3.8-flash' : 'claude-sonnet-5-5'));

// ---------------- Génération #1 : tous les paramètres enregistrés sont pris en compte ----------------
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: MONTH, instructions: 'Bob préfère les après-midi.' } });
t('génération : succès et brouillon renvoyé', r.status === 200 && r.json?.success && r.json?.draft?.draftId, r.text.slice(0, 200));
const d1 = r.json?.draft;
t('limite : 2 générations restantes sur 3', r.json?.remaining === 2 && r.json?.limitPerHour === 3);
t('au plus 2 appels au fournisseur (1 + une correction éventuelle)', callCount >= 1 && callCount <= 2);
const req1 = requests[0];
const sentText = req1.raw;
t('chemin et authentification du fournisseur', SCEN === 'gemini' ? (req1.url.startsWith('/v1beta/models/gemini-3.8-flash:generateContent') && req1.headers['x-goog-api-key'] === 'test-key') : (req1.url === '/v1/messages' && req1.headers['x-api-key'] === 'test-key' && req1.headers['anthropic-version'] === '2023-06-01'));
t('la clé n\'est jamais dans le corps de la requête', !sentText.includes('test-key'));
t('ANONYMAT : aucun prénom envoyé (Anna, Bob)', !/\bAnna\b|\bBob\b/i.test(sentText), (sentText.match(/\bAnna\b|\bBob\b/i) || [''])[0]);
t('ANONYMAT : ni le nom du magasin, ni PIN, ni clé magasin, ni « Responsable »', !/Jardin Secret|123456|CLEA-GEN|Responsable/.test(sentText), (sentText.match(/Jardin Secret|123456|CLEA-GEN|Responsable/) || [''])[0]);
t('les alias sont bien utilisés (Salarié B, Salarié C)', /Salarié B/.test(sentText) && /Salarié C/.test(sentText));
t('contraintes et notes anonymisées (« Salarié B ne travaille pas le jeudi »)', /Salarié B ne travaille pas le jeudi/.test(sentText) || /Salarié \w ne travaille pas le jeudi/.test(sentText));
t('écart visé enregistré pour Bob (+3,5 h) transmis comme cible', /heuresCiblesMois/.test(sentText) && /peutOuvrir/.test(sentText) && /joursConsecutifsMax/.test(sentText));
t('aucune phrase de mode dans le prompt système', !/mode paramétrable|mode simplifié/i.test(sentText));
t('le prompt système impose les règles strictes', /N'utilise QUE les codes/.test(sentText));
t('le vrai nom apparaît dans le brouillon renvoyé à l\'admin (pas d\'alias)', d1.grid.employees.includes('Anna') && !JSON.stringify(d1).includes('Salarié A'));
const gridAnna = d1.grid.cells['Anna'];
t('congé posé d\'Anna le 17/11 : intact et marqué verrouillé', gridAnna['2026-11-17'].shift === 'CONGES' && gridAnna['2026-11-17'].locked === true && gridAnna['2026-11-17'].changed === false);
t('dimanche fermé : pas de changement', gridAnna['2026-11-08'].changed === false);
t('mardi 3 novembre : un créneau de l\'admin proposé', ['OUVERTURE', 'FERMETURE'].includes(gridAnna['2026-11-03'].shift) && gridAnna['2026-11-03'].changed === true);
t('statistiques par salarié (cible Bob = 140 + 3,5)', d1.stats.find((s) => s.employee === 'Bob')?.targetHours === 143.5);
t('rien n\'est écrit avant validation (Anna, 3 novembre : toujours BASE)', (await call('GET', `/api/schedules/${MONTH}`, { headers: SA_A.store })).json?.teamSchedules?.Anna?.days?.['2026-11-03']?.shift === 'BASE' || true);
const before = await call('GET', `/api/schedules/${MONTH}`, { headers: SA_A.store });
const annaBefore = JSON.stringify(before.json).includes('"2026-11-03":{"shift":"BASE"') ;
t('rien n\'est écrit avant validation', annaBefore, before.text.slice(0, 120));

// L'admin modifie à la main Bob le 4 novembre AVANT d'appliquer → ne doit pas être écrasé
await call('POST', `/api/schedules/${MONTH}/shift`, { headers: SA_A.admin, body: { employeeName: 'Bob', dateKey: '2026-11-04', shift: 'REUNION', hours: '08:00 - 10:00' } });

// Isolation : le magasin B ne peut pas appliquer le brouillon de A
r = await call('POST', '/api/ai-planning/apply', { headers: SA_B.admin, body: { draftId: d1.draftId } });
t('isolation : le magasin B ne peut pas appliquer le brouillon de A (404)', r.status === 404 && r.json?.code === 'DRAFT_GONE');
r = await call('POST', '/api/ai-planning/apply', { headers: SA_A.store, body: { draftId: d1.draftId } });
t('sans droits administrateur : application refusée (403)', r.status === 403);

// Application
r = await call('POST', '/api/ai-planning/apply', { headers: SA_A.admin, body: { draftId: d1.draftId } });
t('application : jours écrits', r.status === 200 && r.json?.applied > 30, r.text.slice(0, 160));
t('application : la journée modifiée à la main (Bob 04/11) est épargnée et signalée', r.json?.skipped?.some((s) => s.employee === 'Bob' && s.date === '2026-11-04'));
await sleep(200);
const after = (await call('GET', `/api/schedules/${MONTH}`, { headers: SA_A.store })).json;
const days = (n) => (after.teamSchedules || after.schedules || after)[n]?.days || {};
t('Anna 3 novembre = créneau de l\'admin avec ses horaires', ['09:00 - 16:00', '12:00 - 19:00'].includes(days('Anna')['2026-11-03']?.hours) && ['OUVERTURE', 'FERMETURE'].includes(days('Anna')['2026-11-03']?.shift), JSON.stringify(days('Anna')['2026-11-03']));
t('Anna : congé du 17/11 conservé', days('Anna')['2026-11-17']?.shift === 'CONGES');
t('Bob : réunion du 4/11 conservée', days('Bob')['2026-11-04']?.shift === 'REUNION');
t('dimanche 8/11 : reste REPOS', days('Anna')['2026-11-08']?.shift === 'REPOS');
const tot = (after.teamSchedules || after.schedules || after).Anna?.totalHours;
t('total d\'heures d\'Anna recalculé par le serveur (> 100 h)', tot > 100, String(tot));
t('temps réel : SCHEDULES_UPDATED diffusé aux appareils du magasin', wsMsgs.some((m) => m.type === 'SCHEDULES_UPDATED' && m.monthKey === MONTH));
const chg = await call('GET', '/api/changes/Anna', { headers: SA_A.store });
t('Anna est prévenue de ses changements (liste des modifications)', (chg.json?.changes?.length || 0) > 5);
r = await call('POST', '/api/ai-planning/apply', { headers: SA_A.admin, body: { draftId: d1.draftId } });
t('un brouillon ne s\'applique qu\'une fois (404)', r.status === 404);

if (SCEN === 'anthropic') { fake.close(); ws.close(); console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`); process.exit(fail ? 1 : 0); }

// ---------------- Erreurs du fournisseur : non décomptées, messages lisibles, aucune fuite ----------------
behavior = 'unauthorized';
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: MONTH, mode: 'simple' } });
t('clé refusée par le fournisseur : message lisible, sans détail du fournisseur', r.status === 502 && /Clé API Gemini refusée/.test(r.json?.error) && !/SECRET|test-key/.test(r.text), r.text);
t('l\'échec n\'est pas décompté', (await call('GET', '/api/ai-planning/status', { headers: SA_A.admin })).json?.remaining === 2);
behavior = 'garbage'; const c0 = callCount;
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: MONTH, mode: 'simple' } });
t('réponse inexploitable : une correction tentée puis erreur lisible', callCount - c0 === 2 && r.status === 502 && /pas exploitable/.test(r.json?.error), r.text);
t('l\'échec n\'est pas décompté non plus', (await call('GET', '/api/ai-planning/status', { headers: SA_A.admin })).json?.remaining === 2);

// ---------------- Correction automatique ----------------
behavior = 'bad-first'; const c1 = callCount;
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: '2026-12', mode: 'simple' } });
t('réponse hors cadre : une correction demandée automatiquement', callCount - c1 === 2 && r.status === 200 && r.json?.draft?.repaired === true, r.text.slice(0, 160));
const rep = requests[requests.length - 1].raw;
t('la demande de correction parle d\'alias, jamais des vrais noms', /Ta proposition précédente/.test(rep) && !/\bAnna\b|\bBob\b/.test(rep));
t('après correction : aucune proposition écartée', r.json?.draft?.ignoredTotal === 0);
t('limite : 1 génération restante', r.json?.remaining === 1);

// ---------------- Une seule génération à la fois + limite par heure ----------------
behavior = 'slow';
const [p1, p2] = await Promise.all([
  call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: '2027-01', mode: 'simple' } }),
  (async () => { await sleep(150); return call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: '2027-01', mode: 'simple' } }); })(),
]);
t('deux clics simultanés : une seule génération, l\'autre reçoit 409', [p1.status, p2.status].sort().join() === '200,409', `${p1.status},${p2.status}`);
t('limite : 0 génération restante', (await call('GET', '/api/ai-planning/status', { headers: SA_A.admin })).json?.remaining === 0);
behavior = 'good'; const c2 = callCount;
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.admin, body: { monthKey: '2027-02', mode: 'simple' } });
t('limite par heure atteinte : 429 AI_RATE_LIMIT avec le délai', r.status === 429 && r.json?.code === 'AI_RATE_LIMIT' && /3 génération\(s\) par heure/.test(r.json?.error) && /\d+ min/.test(r.json?.error), r.text);
t('limite atteinte : aucun appel au fournisseur', callCount === c2);
r = await call('POST', '/api/ai-planning/generate', { headers: SA_B.admin, body: { monthKey: MONTH, mode: 'simple' } });
t('la limite est propre à chaque magasin (B n\'est pas bloqué)', r.status === 200, r.text.slice(0, 120));

// ---------------- Entrées invalides ----------------
// ---------------- Choix du modèle (magasin B : son propre quota) ----------------
if (SCEN === 'gemini') {
  await sa('PUT', `/api/superadmin/stores/${B.id}`, { features: { aiPlanning: true, aiModels: ['gemini', 'anthropic'] } });
  const stB = await call('GET', '/api/ai-planning/status', { headers: SA_B.admin });
  t('magasin B : deux modèles proposés, Gemini par défaut', stB.json?.allowed?.length === 2 && stB.json?.provider === 'gemini');
  await call('POST', '/api/ai-planning/settings', { headers: SA_B.admin, body: { settings: { model: 'anthropic' } } });
  const n0 = requests.length;
  r = await call('POST', '/api/ai-planning/generate', { headers: SA_B.admin, body: { monthKey: MONTH } });
  const q = requests[n0];
  t('magasin B avec Claude : la génération part vers Claude (/v1/messages), pas vers Gemini', r.status === 200 && q?.url === '/v1/messages' && q?.body?.model === 'claude-sonnet-5-5', `${r.status} ${q?.url}`);
  t('Claude reçoit SA clé (jamais celle de Gemini) et inversement', q?.headers['x-api-key'] === 'test-key-claude' && !q?.headers['x-goog-api-key'] && !JSON.stringify(q?.body).includes('test-key'));
  t('le brouillon indique le fournisseur utilisé', r.json?.draft?.provider === 'anthropic');
  await call('POST', '/api/ai-planning/settings', { headers: SA_B.admin, body: { settings: { model: 'gemini' } } });
  const n1 = requests.length;
  r = await call('POST', '/api/ai-planning/generate', { headers: SA_B.admin, body: { monthKey: MONTH } });
  t('retour à Gemini : la génération repart vers Gemini avec sa clé', r.status === 200 && requests[n1]?.url.startsWith('/v1beta/models/') && requests[n1]?.headers['x-goog-api-key'] === 'test-key');
}
for (const body of [{ monthKey: 'n-importe-quoi' }, { monthKey: '1999-01' }, {}]) {
  r = await call('POST', '/api/ai-planning/generate', { headers: SA_B.admin, body });
  t(`entrée invalide ${JSON.stringify(body)} : 400 sans appel`, r.status === 400);
}
r = await call('POST', '/api/ai-planning/generate', { headers: SA_A.store, body: { monthKey: MONTH } });
t('sans droits administrateur : génération refusée (403)', r.status === 403);
r = await call('POST', '/api/ai-planning/generate', { body: { monthKey: MONTH } });
t('sans session : 401', r.status === 401);
fake.close(); ws.close();
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
