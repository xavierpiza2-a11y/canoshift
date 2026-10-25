// Test d'intégration du VRAI code client (src/services/api.ts) contre le serveur, avec simulation du navigateur
const BASE = 'http://localhost:3100';
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
const target = new EventTarget();
globalThis.window = Object.assign(target, { location: { protocol: 'http:', host: 'localhost:3100' }, localStorage: globalThis.localStorage });
const realFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => realFetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init));

const events = [];
target.addEventListener('canoshift:auth-lost', () => events.push('auth-lost'));
target.addEventListener('canoshift:admin-expired', () => events.push('admin-expired'));

const api = await import('../src/services/api.ts');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${n}${d ? '  → ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (r) => r.json();

// Préparation (gestionnaire)
const login = await J(await realFetch(BASE + '/api/superadmin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin' }) }));
const SA = { 'Content-Type': 'application/json', 'X-Superadmin-Token': login.token };
const created = await J(await realFetch(BASE + '/api/superadmin/stores', { method: 'POST', headers: SA, body: JSON.stringify({ name: 'Magasin C', token: 'CLEC-TEST', adminPin: '246810' }) }));
const C = created.store;

// 1) Appareil déjà « connecté » (clé mémorisée) : la session s'obtient toute seule au premier appel
store.set('planning_api_token', 'CLEC-TEST');
store.set('planning_token_validated', 'true');
store.set('planning_active_store_id', C.id);
const cfg = await api.fetchConfig();
t('fetchConfig : session obtenue automatiquement depuis la clé mémorisée', cfg.storeName === 'Magasin C', `storeName=${cfg.storeName}`);
t('La clé de l\'appareil n\'est pas écrasée par une valeur par défaut', cfg.apiToken === 'CLEC-TEST', cfg.apiToken);
t('Aucun PIN n\'est mémorisé sur l\'appareil', !JSON.stringify([...store.entries()]).includes('246810'));

// 2) Mode admin
t('PIN incorrect refusé', (await api.verifyAdminPin('000000')) === false);
t('PIN correct accepté', (await api.verifyAdminPin('246810')) === true);
await api.saveStoreName('Magasin C2');
t('Écriture admin (nom du magasin) réussie', (await api.fetchConfig()).storeName === 'Magasin C2');
await api.saveStoredDayNotes('2026-11', { '2026-11-05': 'Livraison' });
const notesRes = await (await api.authFetch('/api/notes/2026-11')).json();
t('Note de jour enregistrée puis relue', notesRes.notes?.['2026-11-05'] === 'Livraison');

// 3) Perte de la session admin => aucune écriture, événement émis pour verrouiller l'interface
api.clearAdminSession();
await api.saveStoreName('Pirate');
await sleep(100);
t('Sans session admin : écriture refusée + événement « admin-expired »', events.includes('admin-expired') && (await api.fetchConfig()).storeName === 'Magasin C2');

// 4) Changement de PIN par l'admin : l'ancienne session admin est révoquée
await api.verifyAdminPin('246810');
t('Changement de PIN accepté', (await api.saveAdminPin('135790')) === true);
t('Le nouveau PIN n\'est pas mémorisé localement', !JSON.stringify([...store.entries()]).includes('135790'));
events.length = 0;
await api.saveStoreName('Pirate2');
await sleep(100);
t('Après changement de PIN : ancienne session admin refusée', events.includes('admin-expired'));
t('Ancien PIN refusé / nouveau PIN accepté', (await api.verifyAdminPin('246810')) === false && (await api.verifyAdminPin('135790')) === true);

// 5) Session magasin expirée / révoquée mais clé toujours valide => renouvellement silencieux
await realFetch(BASE + `/api/superadmin/stores/${C.id}`, { method: 'PUT', headers: SA, body: JSON.stringify({ token: 'CLEC-TEST', adminPin: '135790' }) });
const cfg2 = await api.fetchConfig();
t('Renommage sans changement de clé : l\'appareil continue sans interruption', cfg2.storeName === 'Magasin C2' && !events.includes('auth-lost'));

// 6) Clé changée par le gestionnaire => sessions révoquées, l'appareil doit ressaisir la clé
events.length = 0;
await realFetch(BASE + `/api/superadmin/stores/${C.id}`, { method: 'PUT', headers: SA, body: JSON.stringify({ token: 'CLEC-NEUVE' }) });
await api.fetchConfig();
await sleep(150);
t('Clé changée : événement « auth-lost » émis (retour à l\'écran de saisie de la clé)', events.filter((e) => e === 'auth-lost').length === 1);
await api.fetchConfig(); await api.fetchConfig();
t('Pas de rafale de tentatives : un seul événement', events.filter((e) => e === 'auth-lost').length === 1);

// 7) Saisie de la nouvelle clé via l'écran de saisie
const v = await api.verifyApiTokenWithStore('CLEC-NEUVE');
t('Nouvelle clé acceptée par verifyApiTokenWithStore', v.valid === true);
store.set('planning_api_token', 'CLEC-NEUVE');
t('Après ressaisie : accès rétabli', (await api.fetchConfig()).storeName === 'Magasin C2');

// 8) Temps réel avec la session
const { realtimeClient } = await import('../src/services/realtimeClient.ts');
let connected = false;
realtimeClient.onStatusChange((s) => { if (s === 'connected') connected = true; });
realtimeClient.connect();
await sleep(1200);
t('WebSocket client : connexion avec session', connected);

await realFetch(BASE + `/api/superadmin/stores/${C.id}`, { method: 'DELETE', headers: SA });
console.log(`\nRésultat client : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
