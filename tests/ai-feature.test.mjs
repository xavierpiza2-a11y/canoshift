// Option « IA de planning » par magasin + réglages — test d'intégration contre un serveur neuf
// usage : node tests/ai-feature.test.mjs [url]   (SUPER_ADMIN_PASSWORD identique à celui du serveur)
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://localhost:3100';
const WSURL = BASE.replace('http', 'ws') + '/ws';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || 'test-admin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name}${detail ? '  → ' + detail : ''}`); };
async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const login = await call('POST', '/api/superadmin/login', { body: { password: SUPER_PW } });
const SA = { 'X-Superadmin-Token': login.json?.token };
const sa = (m, p, b) => call(m, p, { body: b, headers: SA });
const A = (await sa('POST', '/api/superadmin/stores', { name: 'Magasin A', token: 'CLEA-IA', adminPin: '123456' })).json?.store;
const B = (await sa('POST', '/api/superadmin/stores', { name: 'Magasin B', token: 'CLEB-IA', adminPin: '654321' })).json?.store;
if (!A || !B) { console.log('Préparation impossible'); process.exit(2); }
const session = async (token, pin) => {
  const v = await call('POST', '/api/verify-token', { body: { token } });
  const st = { Authorization: `Bearer ${v.json.session}` };
  const p = await call('POST', '/api/verify-pin', { headers: st, body: { pin } });
  return { store: st, admin: { ...st, 'X-Admin-Session': p.json.adminSession } };
};
const SESS_A = await session('CLEA-IA', '123456');
const SESS_B = await session('CLEB-IA', '654321');

// ---- 1. Option désactivée par défaut
t('nouveau magasin : option IA désactivée par défaut', (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === false);
let r = await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin });
t('option désactivée : lecture des réglages refusée (403 FEATURE_DISABLED)', r.status === 403 && r.json?.code === 'FEATURE_DISABLED');
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: {} } });
t('option désactivée : écriture des réglages refusée (403)', r.status === 403 && r.json?.code === 'FEATURE_DISABLED');
r = await call('GET', '/api/ai-planning/settings', { headers: SESS_A.store });
t('sans session admin : 403 (ADMIN_REQUIRED)', r.status === 403 && r.json?.code === 'ADMIN_REQUIRED');
r = await call('GET', '/api/ai-planning/settings');
t('sans aucune session : 401', r.status === 401);

// ---- 2. L'admin du magasin ne peut pas s'activer l'option lui-même
r = await call('POST', '/api/config', { headers: SESS_A.admin, body: { features: { aiPlanning: true }, aiPlanning: { model: 'anthropic' } } });
t('config générale : l\'admin ne peut ni activer l\'option ni écrire les réglages IA', r.status === 200 && (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === false);
r = await call('PUT', `/api/superadmin/stores/${A.id}`, { headers: SESS_A.admin, body: { features: { aiPlanning: true } } });
t('un admin de magasin ne peut pas utiliser la route gestionnaire', r.status === 401 || r.status === 403);
t('toujours désactivée après ces tentatives', (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === false);

// ---- 3. Activation par le gestionnaire (magasin A uniquement) + diffusion temps réel
const wsMsgs = []; const ws = new WebSocket(`${WSURL}?session=${SESS_A.store.Authorization.slice(7)}`);
await new Promise((res) => { ws.on('open', res); ws.on('error', res); });
ws.on('message', (d) => { try { wsMsgs.push(JSON.parse(d.toString())); } catch {} });
const wsB = []; const ws2 = new WebSocket(`${WSURL}?session=${SESS_B.store.Authorization.slice(7)}`);
await new Promise((res) => { ws2.on('open', res); ws2.on('error', res); });
ws2.on('message', (d) => { try { wsB.push(JSON.parse(d.toString())); } catch {} });
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true } });
t('gestionnaire : activation de l\'option pour le magasin A', r.json?.success === true && r.json?.store?.features?.aiPlanning === true);
await sleep(300);
t('A reçoit FEATURES_UPDATED en temps réel', wsMsgs.some((m) => m.type === 'FEATURES_UPDATED' && m.features?.aiPlanning === true));
t('B (autre magasin) ne reçoit rien', !wsB.some((m) => m.type === 'FEATURES_UPDATED'));
t('A : features = aiPlanning true', (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === true);
t('B : toujours désactivé (isolation entre magasins)', (await call('GET', '/api/features', { headers: SESS_B.store })).json?.features?.aiPlanning === false);
r = await call('GET', '/api/ai-planning/settings', { headers: SESS_B.admin });
t('B : réglages refusés', r.status === 403 && r.json?.code === 'FEATURE_DISABLED');
const list = await sa('GET', '/api/superadmin/stores');
t('liste gestionnaire : features visibles par magasin', list.json?.stores?.find((s) => s.id === A.id)?.features?.aiPlanning === true && !list.json?.stores?.find((s) => s.id === B.id)?.features?.aiPlanning);
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { name: 'Magasin A renommé' });
t('renommer le magasin ne change pas l\'option', (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === true);

// ---- 4. Lecture / écriture des réglages (A, option active)
r = await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin });
t('A : réglages par défaut renvoyés (samedi ouvert, dimanche fermé)', r.status === 200 && r.json?.settings?.weekly?.[6]?.open === true && r.json?.settings?.weekly?.[7]?.open === false);
const emps = (await call('GET', '/api/config', { headers: SESS_A.store })).json?.config?.employees?.map((e) => e.name) || [];
t('A : au moins un salarié de départ', emps.length >= 1, emps.join(','));
const mine = {
  model: 'gemini',
  weekly: { 6: { open: false } },
  monthOverrides: { '2026-12': { weekly: { 7: { open: true, ranges: [{ start: '10:00', end: '18:00' }] } } } },
  dateOverrides: { '2026-11-02': { open: false } },
  staffing: { minOpening: 2, minClosing: 1, minPerDay: 3, busyDays: { 6: 4 } },
  teamRules: { maxConsecutiveDays: 5, weekendRotation: false },
  employees: { [emps[0]]: { canOpen: false, fixedRestWeekdays: [3], targetHoursGap: -2, constraints: 'pas le jeudi matin' }, Inconnu: { canOpen: false } },
  monthNotes: { '2026-11': 'Arrivage de plantes le 10 novembre' },
};
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: mine } });
t('A : enregistrement accepté', r.status === 200 && r.json?.success === true, r.text.slice(0, 120));
r = await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin });
const s = r.json?.settings;
t('réglages relus à l\'identique (samedi désactivé, décembre dimanche 10-18, date fermée)', s?.weekly?.[6]?.open === false && s?.monthOverrides?.['2026-12']?.weekly?.[7]?.ranges?.[0]?.start === '10:00' && s?.dateOverrides?.['2026-11-02']?.open === false);
t('effectifs, règles d\'équipe, modèle et note du mois conservés', s?.staffing?.minPerDay === 3 && s?.staffing?.busyDays?.[6] === 4 && s?.teamRules?.maxConsecutiveDays === 5 && s?.model === 'gemini' && /Arrivage/.test(s?.monthNotes?.['2026-11'] || ''));
t('réglages par salarié conservés ; salarié inconnu écarté', s?.employees?.[emps[0]]?.targetHoursGap === -2 && s?.employees?.[emps[0]]?.canOpen === false && !('Inconnu' in (s?.employees || {})));
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: { weekly: { 1: { open: true, ranges: [{ start: '19:00', end: '09:00' }] } } } } });
t('réglages invalides : 400 avec message lisible', r.status === 400 && /après l'heure d'ouverture/.test(r.json?.error || ''));
t('après le refus, les réglages précédents sont intacts', (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).json?.settings?.weekly?.[6]?.open === false);

// ---- 5. Confidentialité et robustesse
const pub = await call('GET', '/api/config', { headers: SESS_A.store });
t('la config lue par un employé ne contient pas les réglages IA', !/aiPlanning|Arrivage|pas le jeudi/.test(pub.text));
await call('POST', '/api/config', { headers: SESS_A.admin, body: { ...pub.json.config, storeName: 'Magasin A renommé' } });
t('une sauvegarde de config complète (client) n\'efface pas les réglages IA', (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).json?.settings?.staffing?.minPerDay === 3);
t('ni ne contient les réglages dans sa réponse', !/aiPlanning|Arrivage/.test((await call('POST', '/api/config', { headers: SESS_A.admin, body: pub.json.config })).text));
await sleep(200);
t('les diffusions CONFIG_UPDATED ne contiennent pas les réglages IA', !wsMsgs.some((m) => JSON.stringify(m).includes('Arrivage') || JSON.stringify(m).includes('aiPlanning":{')));
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: { employees: { __proto__: { canOpen: false } }, monthNotes: { '2026-11': 'x'.repeat(10000) } } } });
t('entrée hostile : pas de plantage, texte tronqué', r.status === 200 && ({}).canOpen === undefined);
t('corps non JSON-objet : pas de plantage (réglages remis aux défauts)', [200, 400].includes((await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: 'abc' } })).status));

// ---- 6. Désactivation : les réglages sont conservés mais inaccessibles
await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: mine } });
await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: false } });
await sleep(200);
t('désactivation : routes refusées de nouveau', (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).status === 403);
t('désactivation : FEATURES_UPDATED false diffusé', wsMsgs.some((m) => m.type === 'FEATURES_UPDATED' && m.features?.aiPlanning === false));
await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true } });
t('réactivation : les réglages sont retrouvés', (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).json?.settings?.staffing?.minPerDay === 3);

// ---- 7. Sauvegarde / restauration du magasin conservent les réglages
const bk = await sa('GET', `/api/superadmin/stores/${A.id}/backup`);
t('la sauvegarde du magasin contient les réglages IA', /minPerDay/.test(bk.text) && /Arrivage/.test(bk.text));
await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: { ...mine, staffing: { minOpening: 1, minClosing: 1, minPerDay: 9 } } } });
t('réglages modifiés après la sauvegarde (minPerDay = 9)', (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).json?.settings?.staffing?.minPerDay === 9);
r = await sa('POST', `/api/superadmin/stores/${A.id}/restore`, bk.json);
t('restauration acceptée', r.status === 200 && r.json?.success !== false, r.text.slice(0, 100));
const rs = (await call('GET', '/api/ai-planning/settings', { headers: SESS_A.admin })).json?.settings;
t('restauration : tous les réglages IA sont retrouvés (effectifs, écart visé, notes, exceptions, modèle)', rs?.staffing?.minPerDay === 3 && rs?.employees?.[emps[0]]?.targetHoursGap === -2 && /Arrivage/.test(rs?.monthNotes?.['2026-11'] || '') && rs?.dateOverrides?.['2026-11-02']?.open === false && rs?.model === 'gemini');
t('restauration : l\'option IA reste activée (registre du gestionnaire)', (await call('GET', '/api/features', { headers: SESS_A.store })).json?.features?.aiPlanning === true);

// ---- 8. Choix des modèles : autorisation par le gestionnaire, choix par l'administrateur
let lst = await sa('GET', '/api/superadmin/stores');
t('liste gestionnaire : modèles effectifs affichés (par défaut Gemini)', JSON.stringify(lst.json?.stores?.find((x) => x.id === A.id)?.features?.aiModels) === '["gemini"]');
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true, aiModels: [] } });
t('activation sans aucun modèle : refusée (400)', r.status === 400 && /au moins un modèle/.test(r.json?.error || ''));
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true, aiModels: ['gpt-9'] } });
t('modèle inconnu seul : refusé (400)', r.status === 400);
wsMsgs.length = 0;
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true, aiModels: ['gemini', 'anthropic', 'gemini'] } });
await sleep(250);
t('autorisation des deux modèles (doublons ignorés)', r.json?.success === true && JSON.stringify(r.json?.store?.features?.aiModels) === '["gemini","anthropic"]', JSON.stringify(r.json?.store?.features));
t('FEATURES_UPDATED diffusé avec les modèles autorisés', wsMsgs.some((m) => m.type === 'FEATURES_UPDATED' && m.features?.aiModels?.length === 2));
let st = await call('GET', '/api/ai-planning/status', { headers: SESS_A.admin });
t('status : deux modèles proposés, aucun secret', st.json?.allowed?.length === 2 && st.json?.allowed?.every((m) => m.label && m.model && typeof m.configured === 'boolean') && !/api[_-]?key/i.test(st.text.replace(/configured/g, '')));
t('status : modèle choisi par l\'admin = Gemini (réglage enregistré)', st.json?.provider === 'gemini');
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: { ...mine, model: 'anthropic' } } });
t('l\'admin choisit Claude : enregistré', r.status === 200 && r.json?.settings?.model === 'anthropic');
st = await call('GET', '/api/ai-planning/status', { headers: SESS_A.admin });
t('status : le modèle utilisé devient Claude', st.json?.provider === 'anthropic' && /claude/i.test(st.json?.model || ''));
r = await sa('PUT', `/api/superadmin/stores/${A.id}`, { features: { aiPlanning: true, aiModels: ['gemini'] } });
st = await call('GET', '/api/ai-planning/status', { headers: SESS_A.admin });
t('le gestionnaire retire Claude : repli automatique sur Gemini', st.json?.provider === 'gemini' && st.json?.allowed?.length === 1);
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_A.admin, body: { settings: { ...mine, model: 'anthropic' } } });
t('l\'admin ne peut pas choisir un modèle non autorisé (400)', r.status === 400 && /pas autorisé/.test(r.json?.error || ''));
r = await call('POST', '/api/ai-planning/settings', { headers: SESS_B.admin, body: { settings: { model: 'anthropic' } } });
t('magasin sans l\'option : choix du modèle refusé (403)', r.status === 403);

ws.close(); ws2.close();
console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
