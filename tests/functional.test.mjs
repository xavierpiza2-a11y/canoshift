// Tests fonctionnels CanoShift (serveur corrigé) — usage : node functional.test.mjs [url]
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://localhost:3100';
const WSURL = BASE.replace('http', 'ws') + '/ws';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || 'test-admin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function t(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${detail ? '  → ' + detail : ''}`);
}

async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

function openWs(query) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WSURL}?${query}`);
    const msgs = [];
    const state = { ws, msgs, opened: false, closeCode: null, rejected: false };
    ws.on('open', () => { state.opened = true; resolve(state); });
    ws.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
    ws.on('close', (code) => { state.closeCode = code; });
    ws.on('unexpected-response', () => { state.rejected = true; resolve(state); });
    ws.on('error', () => { state.rejected = true; resolve(state); });
  });
}

// ---- Préparation : gestionnaire + 2 magasins
const login = await call('POST', '/api/superadmin/login', { body: { password: SUPER_PW } });
t('Connexion gestionnaire (bon mot de passe)', login.status === 200 && login.json?.token?.length === 64);
const SA = { 'X-Superadmin-Token': login.json?.token };

const sa = async (method, path, body) => call(method, path, { body, headers: SA });
const A = (await sa('POST', '/api/superadmin/stores', { name: 'Magasin A', token: 'CLEA-FONC', adminPin: '123456' })).json?.store;
const B = (await sa('POST', '/api/superadmin/stores', { name: 'Magasin B', token: 'CLEB-FONC', adminPin: '654321' })).json?.store;
if (!A || !B) { console.log('Préparation impossible'); process.exit(2); }

// ---- 1. Connexion par clé magasin
const bad = await call('POST', '/api/verify-token', { body: { token: 'MAUVAISE' } });
t('Mauvaise clé refusée (valid=false, pas de session)', bad.json?.valid === false && !bad.json?.session);
const va = await call('POST', '/api/verify-token', { body: { token: 'cle a-fonc'.replace(' ', '') } });
const vA = await call('POST', '/api/verify-token', { body: { token: 'clea-fonc' } }); // insensible à la casse
const vB = await call('POST', '/api/verify-token', { body: { token: 'CLEB-FONC' } });
t('Bonne clé acceptée, insensible à la casse, session émise', vA.json?.valid === true && vA.json?.session?.length === 64 && vA.json?.store?.id === A.id);
const SA_A = { Authorization: `Bearer ${vA.json.session}`, 'X-Store-Id': A.id };
const SA_B = { Authorization: `Bearer ${vB.json.session}`, 'X-Store-Id': B.id };

// ---- 2. Lecture (niveau employé) et absence de secrets
const cfg = await call('GET', '/api/config', { headers: SA_A });
t('GET /api/config avec session : 200 et données du bon magasin', cfg.status === 200 && cfg.json?.storeId === A.id && cfg.json?.config?.storeName === 'Magasin A');
t('La config ne contient ni PIN ni clé magasin', !/adminPin|apiToken|123456|CLEA-FONC/.test(cfg.text));
for (const path of ['/api/schedules', '/api/schedules/2026-11', '/api/notes/2026-11', '/api/history', '/api/changes/Test']) {
  const r = await call('GET', path, { headers: SA_A });
  t(`Lecture ${path} (employé)`, r.status === 200 && r.json?.success === true, `HTTP ${r.status}`);
}
const clr = await call('POST', '/api/changes/Test/clear', { headers: SA_A });
t('Employé : marquer ses changements comme lus', clr.status === 200);

// ---- 3. Écritures : refusées sans session admin
const writes = [
  ['POST', '/api/config', { storeName: 'X' }],
  ['POST', '/api/schedules/2026-11', { teamSchedules: {} }],
  ['POST', '/api/schedules/2026-11/shift', { employeeName: 'Test', dateKey: '2026-11-03', shift: 'M', hours: 7 }],
  ['POST', '/api/notes/2026-11', { notes: { '2026-11-03': 'x' } }],
  ['DELETE', '/api/months/2026-11'],
  ['DELETE', '/api/history'],
  ['POST', '/api/reset'],
  ['GET', '/api/backup'],
];
for (const [m, p, b] of writes) {
  const r = await call(m, p, { headers: SA_A, body: b });
  t(`Sans PIN admin : ${m} ${p} refusé`, r.status === 403 && r.json?.code === 'ADMIN_REQUIRED', `HTTP ${r.status}`);
}

// ---- 4. PIN admin
const badPin = await call('POST', '/api/verify-pin', { headers: SA_A, body: { pin: '000001' } });
t('Mauvais PIN refusé', badPin.json?.valid === false && !badPin.json?.adminSession);
const okPin = await call('POST', '/api/verify-pin', { headers: SA_A, body: { pin: '123456' } });
t('Bon PIN accepté, session admin émise', okPin.json?.valid === true && okPin.json?.adminSession?.length === 64);
const ADM_A = { ...SA_A, 'X-Admin-Session': okPin.json.adminSession };

// ---- 5. Écritures admin et relecture
const ws1 = await openWs(`session=${vA.json.session}`);
const ws2 = await openWs(`session=${vB.json.session}`);
t('WebSocket accepté avec une session valide', ws1.opened && ws2.opened);

let r = await call('POST', '/api/schedules/2026-11/shift', { headers: ADM_A, body: { employeeName: 'Test', dateKey: '2026-11-03', shift: 'M', hours: '09:00-16:30', info: 'ok' } });
t('Admin : modification d\'un horaire', r.status === 200 && r.json?.success !== false, `HTTP ${r.status}`);
r = await call('POST', '/api/notes/2026-11', { headers: ADM_A, body: { notes: { '2026-11-03': 'Inventaire' } } });
t('Admin : enregistrement d\'une note de jour', r.status === 200);
const notes = await call('GET', '/api/notes/2026-11', { headers: SA_A });
t('Relecture de la note', notes.json?.notes?.['2026-11-03'] === 'Inventaire');
const sched = await call('GET', '/api/schedules/2026-11', { headers: SA_A });
t('Relecture de l\'horaire modifié (valeurs conservées à l\'identique)', JSON.stringify(sched.json).includes('09:00-16:30'));
r = await call('POST', '/api/config', { headers: ADM_A, body: { storeName: 'Magasin A bis' } });
t('Admin : changement du nom du magasin', r.status === 200 && r.json?.config?.storeName === 'Magasin A bis' && !/adminPin|apiToken/.test(r.text));
await sleep(400);
t('Temps réel : le même magasin reçoit les mises à jour', ws1.msgs.some((m) => m.type === 'NOTES_UPDATED') && ws1.msgs.some((m) => m.type === 'SHIFT_UPDATED'));
t('Temps réel : l\'AUTRE magasin ne reçoit rien', ws2.msgs.filter((m) => m.type !== 'INIT_CONNECTED').length === 0, `${ws2.msgs.length} message(s)`);
t('Diffusions sans PIN ni clé', !ws1.msgs.some((m) => /adminPin|apiToken|123456|CLEA-FONC/.test(JSON.stringify(m))));

// Sauvegarde / restauration par l'admin
const bk = await call('GET', '/api/backup', { headers: ADM_A });
t('Admin : export de sauvegarde', bk.status === 200 && bk.json);
r = await call('POST', '/api/backup', { headers: ADM_A, body: bk.json });
t('Admin : restauration de la sauvegarde', r.status === 200 && !/adminPin|apiToken/.test(r.text));
const stillPin = await call('POST', '/api/verify-pin', { headers: SA_A, body: { pin: '123456' } });
t('Le PIN n\'a pas été modifié par la restauration', stillPin.json?.valid === true);

// ---- 6. Isolation entre magasins
r = await call('GET', '/api/config', { headers: { Authorization: SA_A.Authorization, 'X-Store-Id': B.id } });
t('Session A avec en-tête magasin B : refusé', r.status === 403, `HTTP ${r.status}`);
r = await call('POST', '/api/notes/2026-11', { headers: { ...SA_B, 'X-Admin-Session': okPin.json.adminSession }, body: { notes: {} } });
t('Session admin de A inutilisable sur le magasin B', r.status === 403, `HTTP ${r.status}`);
const cfgB = await call('GET', '/api/config', { headers: SA_B });
t('Magasin B : ses propres données', cfgB.json?.config?.storeName === 'Magasin B');

// ---- 7. WebSocket : refus sans / avec mauvaise session
const wsNo = await openWs('');
const wsBad = await openWs('session=' + 'a'.repeat(64));
t('WebSocket sans session refusé', !wsNo.opened);
t('WebSocket avec fausse session refusé', !wsBad.opened);

// ---- 8. Santé
const h1 = await call('GET', '/api/health');
const h2 = await call('GET', '/api/health', { headers: SA_A });
t('/api/health public : pas d\'infos internes', h1.json?.status === 'ok' && !h1.text.includes('storageLocation') && h1.json?.connectedClients === undefined);
t('/api/health avec session : nombre d\'appareils du magasin', h2.json?.connectedClients === 1, `connectedClients=${h2.json?.connectedClients}`);

// ---- 9. Gros corps sans authentification : rejeté sans être traité
const big = 'x'.repeat(5 * 1024 * 1024);
r = await call('POST', '/api/config', { body: { storeName: big } });
t('Gros envoi non authentifié rejeté', r.status === 401, `HTTP ${r.status}`);
r = await call('POST', '/api/verify-token', { body: { token: big } });
t('Gros envoi sur route publique rejeté (413)', r.status === 413, `HTTP ${r.status}`);

// ---- 10. Super-admin
r = await call('GET', '/api/superadmin/stores', { headers: SA_A });
t('Session magasin inutilisable sur les routes gestionnaire', r.status === 401, `HTTP ${r.status}`);
r = await sa('GET', '/api/superadmin/stores');
t('Gestionnaire : liste des magasins', r.status === 200 && r.json?.stores?.length >= 2);
r = await sa('GET', '/api/superadmin/backup-all');
t('Gestionnaire : sauvegarde globale', r.status === 200);
// Modification SANS changement de clé/PIN : personne n'est déconnecté
const n1 = ws2.msgs.length;
await sa('PUT', `/api/superadmin/stores/${B.id}`, { name: 'Magasin B renommé', token: 'CLEB-FONC', adminPin: '654321' });
await sleep(900);
const stillB = await call('GET', '/api/config', { headers: SA_B });
t('Renommer un magasin (clé/PIN inchangés) ne déconnecte personne', stillB.status === 200 && ws2.closeCode === null && ws2.msgs.length === n1);

// ---- 11. Changement de PIN par l'admin
r = await call('POST', '/api/config', { headers: ADM_A, body: { adminPin: '777777' } });
t('Admin : changement du PIN', r.status === 200 && !/777777/.test(r.text));
await sleep(500);
const pinMsg = ws1.msgs.find((m) => m.type === 'PIN_CHANGED');
t('PIN_CHANGED diffusé sans le nouveau PIN', pinMsg && !JSON.stringify(pinMsg).includes('777777'));
r = await call('POST', '/api/notes/2026-11', { headers: ADM_A, body: { notes: {} } });
t('Ancienne session admin révoquée après changement de PIN', r.status === 403);
r = await call('POST', '/api/verify-pin', { headers: SA_A, body: { pin: '123456' } });
t('Ancien PIN refusé', r.json?.valid === false);
r = await call('POST', '/api/verify-pin', { headers: SA_A, body: { pin: '777777' } });
t('Nouveau PIN accepté', r.json?.valid === true);

// ---- 12. Changement de clé magasin
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { token: 'NOUVELLE-CLE' });
await sleep(1200);
t('TOKEN_CHANGED diffusé sans la nouvelle clé', ws1.msgs.some((m) => m.type === 'TOKEN_CHANGED') && !ws1.msgs.some((m) => JSON.stringify(m).includes('NOUVELLE-CLE')));
t('Sockets de l\'ancienne clé fermés (code 4401)', ws1.closeCode === 4401, `code=${ws1.closeCode}`);
r = await call('GET', '/api/config', { headers: SA_A });
t('Ancienne session magasin révoquée (401)', r.status === 401);
r = await call('POST', '/api/verify-token', { body: { token: 'CLEA-FONC' } });
t('Ancienne clé refusée', r.json?.valid === false);
r = await call('POST', '/api/verify-token', { body: { token: 'NOUVELLE-CLE' } });
t('Nouvelle clé acceptée', r.json?.valid === true && r.json?.session);
const stillOk = await call('GET', '/api/config', { headers: SA_B });
t('Les autres magasins ne sont pas affectés', stillOk.status === 200);

// ---- 13. Limitation sur le gestionnaire
let blocked = false;
for (let i = 0; i < 8; i++) {
  const x = await call('POST', '/api/superadmin/login', { body: { password: 'mauvais' + i } });
  if (x.status === 429) { blocked = true; break; }
}
t('Mots de passe gestionnaire erronés : blocage 429', blocked);

// ---- Nettoyage
for (const s of [A, B]) await sa('DELETE', `/api/superadmin/stores/${s.id}`);
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
