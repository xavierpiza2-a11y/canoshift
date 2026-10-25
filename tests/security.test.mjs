// Tests de sécurité CanoShift — usage : node security.mjs [http://localhost:3100]
// Mode "avant" : les tests marqués FAILLE doivent réussir à exploiter.
// Mode "après" : tout doit afficher OK (exploit bloqué).
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://localhost:3100';
const WS = BASE.replace('http', 'ws') + '/ws';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || 'test-admin';

let exploited = 0, blocked = 0;
const report = [];
function check(name, wasExploited, detail = '') {
  if (wasExploited) exploited++; else blocked++;
  report.push(`${wasExploited ? 'FAILLE' : 'OK    '}  ${name}${detail ? '  → ' + detail : ''}`);
}

async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// Préparation : on se connecte en super-admin légitimement pour créer 2 magasins de test
const login = await call('POST', '/api/superadmin/login', { body: { password: SUPER_PW } });
const saToken = login.json?.token;
const saHeaders = saToken ? { Authorization: `Bearer ${saToken}`, 'X-Superadmin-Token': saToken } : {};

async function createStore(name, token, pin) {
  const r = await call('POST', '/api/superadmin/stores', { body: { name, token, adminPin: pin }, headers: saHeaders });
  return r.json?.store;
}
const A = await createStore('TestA', 'TOKEN-A-TEST', '123456');
const B = await createStore('TestB', 'TOKEN-B-TEST', '654321');
if (!A || !B) { console.log('Préparation impossible (création des magasins de test) :', A, B); process.exit(2); }

// 1. PIN lisible sans authentification
{
  const r = await call('GET', '/api/config', { headers: { 'X-Store-Id': A.id } });
  const leaked = JSON.stringify(r.json || {}).includes('123456');
  check('Lecture du PIN admin via GET /api/config sans identification', r.status === 200 && leaked, `HTTP ${r.status}`);
}
// 2. Sans en-tête : données du premier magasin
{
  const r = await call('GET', '/api/schedules');
  check('Accès aux plannings sans token ni en-tête magasin', r.status === 200, `HTTP ${r.status}`);
}
// 3. Routes super-admin sans jeton
{
  const r = await call('GET', '/api/superadmin/stores');
  check('Liste des magasins (avec token/PIN) sans authentification', r.status === 200, `HTTP ${r.status}`);
  const r2 = await call('GET', '/api/superadmin/backup-all');
  check('Sauvegarde de TOUS les magasins sans authentification', r2.status === 200, `HTTP ${r2.status}`);
}
// 4. Accès croisé : un client sans droit modifie la config du magasin A
{
  const r = await call('POST', '/api/config', { headers: { 'X-Store-Id': A.id }, body: { storeName: 'PIRATE' } });
  check('Modification de la config d\'un magasin sans authentification', r.status === 200, `HTTP ${r.status}`);
}
// 5. Suppression d'un magasin sans authentification
{
  const tmp = await createStore('Jetable', 'TOKEN-TMP-TEST', '111111');
  const r = await call('DELETE', `/api/superadmin/stores/${tmp.id}`);
  check('Suppression d\'un magasin sans authentification', r.status === 200, `HTTP ${r.status}`);
  if (r.status !== 200) await call('DELETE', `/api/superadmin/stores/${tmp.id}`, { headers: saHeaders });
}
// 6. WebSocket : un espion non authentifié reçoit-il le PIN d'un autre magasin ?
{
  const received = [];
  await new Promise((resolve) => {
    const ws = new WebSocket(WS);
    let opened = false;
    ws.on('open', () => { opened = true; });
    ws.on('message', (d) => received.push(d.toString()));
    ws.on('close', () => resolve());
    ws.on('error', () => resolve());
    setTimeout(async () => {
      // un admin légitime de A change son PIN
      await call('POST', '/api/config', { headers: { 'X-Store-Id': A.id, ...saHeaders }, body: { adminPin: '999999' } });
    }, 400);
    setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 1500);
  });
  const leaked = received.some((m) => m.includes('999999'));
  check('Espion WebSocket sans identification reçoit le nouveau PIN d\'un magasin', leaked, `${received.length} messages reçus`);
}
// 7. Force brute du PIN par un employé (qui connaît la clé du magasin)
{
  const v = await call('POST', '/api/verify-token', { body: { token: 'TOKEN-B-TEST' } });
  const session = v.json?.session;
  const h = session ? { Authorization: `Bearer ${session}` } : {};
  let limited = false, validSeen = false, tries = 0;
  for (let i = 0; i < 40; i++) {
    tries++;
    const r = await call('POST', '/api/verify-pin', { headers: h, body: { pin: String(100000 + i) } });
    if (r.json?.valid) validSeen = true;
    if (r.status === 429) { limited = true; break; }
  }
  check('Force brute du PIN par un employé (blocage attendu après quelques essais)', !limited, `bloqué après ${tries} essais`);
}
// 8. Force brute du token magasin
{
  let limited = false;
  for (let i = 0; i < 40; i++) {
    const r = await call('POST', '/api/verify-token', { body: { token: 'ESSAI' + i } });
    if (r.status === 429) { limited = true; break; }
  }
  check('Force brute du token magasin (40 essais rapides sans blocage)', !limited);
}

// Nettoyage (avec jeton si disponible)
for (const s of [A, B]) await call('DELETE', `/api/superadmin/stores/${s.id}`, { headers: saHeaders });

console.log(report.join('\n'));
console.log(`\nRésultat : ${exploited} faille(s) exploitable(s), ${blocked} bloquée(s)`);
process.exit(exploited ? 1 : 0);
