// Génération IA — logique pure : anonymisation, contexte, validation stricte de la réponse du modèle
// usage : BASE_URL=/ bun run tests/ai-generation.test.mjs
const G = await import('../src/shared/aiGeneration.ts');
const S = await import('../src/shared/aiPlanning.ts');
const P = await import('../src/shared/planning.ts');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${n}${d ? '  → ' + d : ''}`); };
const eq = (n, got, want) => t(n, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? '' : `attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);

const SHIFTS = [
  { shift: 'BASE', hours: '', category: 'BASE', hoursDecimal: 7, dayStatus: 'PRESENT' },
  { shift: 'REPOS', hours: '', category: 'REPOS', hoursDecimal: 0, dayStatus: 'REPOS' },
  { shift: 'RTT', hours: '', category: 'RTT', hoursDecimal: 0, dayStatus: 'ABSENT' },
  { shift: 'FERIE', hours: '', category: 'FERIE', hoursDecimal: 0, dayStatus: 'REPOS' },
  { shift: 'CFA', hours: '', category: 'CFA', hoursDecimal: 0, dayStatus: 'ABSENT' },
  { shift: 'CONGES', hours: '', category: 'CONGES', hoursDecimal: 0, dayStatus: 'ABSENT' },
  { shift: 'OUVERTURE', hours: '09:00 - 16:00', category: 'AUTRE', hoursDecimal: 7, dayStatus: 'PRESENT' },
  { shift: 'FERMETURE', hours: '12:00 - 19:00', category: 'AUTRE', hoursDecimal: 7, dayStatus: 'PRESENT' },
  { shift: 'REUNION', hours: '08:00 - 10:00', category: 'AUTRE', hoursDecimal: 2, dayStatus: 'PRESENT' },
];
const MONTH = '2026-11';
const dates = P.getMonthDateKeys(MONTH);
const EMPS = [{ name: 'Anna', contractType: 'HEBDO_35H' }, { name: 'Bob', contractType: 'ANNUALISE' }, { name: 'Chloé', contractType: 'FORFAIT_JOUR' }];

function existing(extra = {}) {
  const ex = {};
  for (const e of EMPS) { ex[e.name] = {}; for (const d of dates) ex[e.name][d] = { ...P.generateDefaultDay(d) }; }
  for (const [k, v] of Object.entries(extra)) { const [n, d] = k.split('|'); ex[n][d] = v; }
  return ex;
}
const base = (over = {}) => ({
  monthKey: MONTH, dateKeys: dates, settings: S.defaultAiSettings(), employees: EMPS,
  existing: existing({ 'Anna|2026-11-16': { shift: 'CONGES', hours: '' }, 'Anna|2026-11-17': { shift: 'CONGES', hours: '' }, 'Anna|2026-11-18': { shift: 'CONGES', hours: '' }, 'Bob|2026-11-05': { shift: 'REUNION', hours: '08:00 - 10:00' } }),
  dayNotes: { '2026-11-10': 'Arrivage de plantes, Anna et chloé en renfort' }, shifts: SHIFTS, instructions: 'Bob préfère les après-midi. Annabelle est cliente.', ...over,
});

// ---- 1. Horaires
eq('horaires 09:00 - 12:30 , 14:00 - 18:00', G.parseTimeRanges('09:00 - 12:30 , 14:00 - 18:00'), [{ start: 540, end: 750 }, { start: 840, end: 1080 }]);
eq('horaires 9h-12h30 14h-19h', G.parseTimeRanges('9h-12h30 14h-19h'), [{ start: 540, end: 750 }, { start: 840, end: 1140 }]);
eq('valeur seule « 7 » : pas des horaires', G.parseTimeRanges('7'), []);
eq('plage inversée : refusée', G.parseTimeRanges('19:00 - 09:00'), []);
eq('vide : aucune plage', G.parseTimeRanges(''), []);

// ---- 2. Créneaux autorisés
const allowed = G.allowedSlots(SHIFTS).map((s) => s.code);
eq('créneaux autorisés : présence + repos, jamais congés/RTT/CFA/férié', allowed, ['BASE', 'REPOS', 'OUVERTURE', 'FERMETURE', 'REUNION']);

// ---- 3. Anonymisation
const ctx = G.buildContext(base());
const payloadText = JSON.stringify(ctx.payload);
t('aucun vrai prénom dans ce qui part chez l\'IA', !/Anna\b|Bob\b|Chlo/.test(payloadText.replace(/Annabelle/g, '')), payloadText.match(/Anna\b|Bob\b|Chlo./)?.[0]);
t('alias présents : Salarié A / B / C', ['Salarié A', 'Salarié B', 'Salarié C'].every((a) => payloadText.includes(a)));
t('note de jour anonymisée (« Anna et chloé » → alias, casse ignorée)', ctx.payload.jours.find((d) => d.date === '2026-11-10').note === 'Arrivage de plantes, Salarié A et Salarié C en renfort');
t('« Annabelle » (autre mot) n\'est pas modifié', ctx.payload.precisions.join(' ').includes('Annabelle est cliente') && ctx.payload.precisions.join(' ').includes('Salarié B préfère'));
eq('anonymizeText : mots collés à des lettres épargnés', G.anonymizeText('Bobby, Bob. (bob)', { Bob: 'Salarié B' }), 'Bobby, Salarié B. (Salarié B)');
eq('alias au-delà de 26 salariés', [G.aliasFor(25), G.aliasFor(26), G.aliasFor(27)], ['Salarié Z', 'Salarié AA', 'Salarié AB']);

const ctxStore = G.buildContext(base({ storeName: 'Jardin Secret SARL', instructions: 'Inventaire chez Jardin Secret SARL le 28' }));
t('nom du magasin remplacé par « le magasin » dans les textes libres', ctxStore.payload.precisions.join(' ').includes('Inventaire chez le magasin le 28') && !JSON.stringify(ctxStore.payload).includes('Jardin Secret'));

// ---- 4. Contexte : jours, journées posées, objectifs
const day = (d) => ctx.days.find((x) => x.date === d);
eq('lundi 2 novembre : ouvert 09:00-19:00', [day('2026-11-02').open, day('2026-11-02').ranges], [true, ['09:00-19:00']]);
eq('samedi 7 : ouvert (par défaut)', day('2026-11-07').open, true);
eq('dimanche 8 : fermé', day('2026-11-08').open, false);
eq('mercredi 11 (férié) : fermé', [day('2026-11-11').open, day('2026-11-11').holiday], [false, true]);
const A = ctx.employees[0], B = ctx.employees[1];
t('Anna : jours de congés posés = intouchables', A.locked['2026-11-16'] === 'CONGES' && !A.editable.has('2026-11-16'));
t('Bob : réunion posée à la main = intouchable', B.locked['2026-11-05'] === 'REUNION' && !B.editable.has('2026-11-05'));
t('jours fermés : non modifiables', !A.editable.has('2026-11-08') && !A.editable.has('2026-11-11'));
t('samedi (REPOS généré) : modifiable', A.editable.has('2026-11-07'));
eq('objectif Anna : (20 jours ouvrés − 3 congés) × 7 = 119 h', A.objectiveHours, 119);
eq('objectif Bob : 20 × 7 = 140 h', B.objectiveHours, 140);
eq('heures déjà posées de Bob : réunion 2 h', B.lockedHours, 2);
eq('heures à planifier de Bob : 140 − 2 = 138 h', B.hoursToPlan, 138);

// ---- 5. Tous les paramètres sont toujours pris en compte (plus de mode simplifié)
const sGap = S.normalizeAiSettings({ employees: { Anna: { targetHoursGap: 3.5, fixedRestWeekdays: [3], canOpen: false, constraints: 'Bob remplace le jeudi' } } }, ['Anna', 'Bob', 'Chloé']);
const adv = G.buildContext(base({ settings: sGap }));
eq('cible Anna = 119 + 3,5 = 122,5 h (écart visé enregistré)', adv.employees[0].targetHours, 122.5);
t('contraintes anonymisées (« Salarié B remplace le jeudi »)', JSON.stringify(adv.payload.salaries[0]).includes('Salarié B remplace le jeudi'));
t('règles par salarié toujours envoyées (peutOuvrir, reposFixes)', JSON.stringify(adv.payload.salaries[0]).includes('peutOuvrir') && JSON.stringify(adv.payload.salaries[0]).includes('reposFixes'));
t('effectifs : jours consécutifs et rotation toujours envoyés', adv.payload.effectifs.joursConsecutifsMax === 6 && adv.payload.effectifs.rotationWeekends === true);
t('le payload ne contient plus de champ « mode »', !('mode' in adv.payload));

// ---- 6. Jour fermé encore en BASE -> repos d'office
const sClosed = S.normalizeAiSettings({ dateOverrides: { '2026-11-02': { open: false } } });
const cc = G.buildContext(base({ settings: sClosed }));
eq('lundi 2 fermé (inventaire) : BASE remis en REPOS pour les 3 salariés', cc.autoRest.filter((c) => c.date === '2026-11-02').map((c) => c.shift), ['REPOS', 'REPOS', 'REPOS']);
t('lundi 2 fermé : plus modifiable', !cc.employees[0].editable.has('2026-11-02'));
const sDec = S.normalizeAiSettings({ monthOverrides: { '2026-11': { weekly: { 7: { open: true, ranges: [{ start: '10:00', end: '18:00' }] } } } } });
const dd = G.buildContext(base({ settings: sDec }));
t('exception du mois : dimanche 8 ouvert 10-18 et modifiable', dd.days.find((x) => x.date === '2026-11-08').ranges[0] === '10:00-18:00' && dd.employees[0].editable.has('2026-11-08'));
const sHol = S.normalizeAiSettings({ holidays: { open: true, ranges: [{ start: '09:00', end: '13:00' }] } });
const hh = G.buildContext(base({ settings: sHol }));
t('jours fériés ouverts : le 11 est modifiable (FERIE généré)', hh.employees[0].editable.has('2026-11-11'));

// ---- 7. Lecture de la réponse du modèle
eq('JSON entouré de ```json', G.extractJson('```json\n{"planning":{}}\n```'), { planning: {} });
eq('JSON précédé de texte', G.extractJson('Voici : {"planning":{"a":1}} fin'), { planning: { a: 1 } });
let msg = ''; try { G.extractJson('désolé, impossible'); } catch (e) { msg = e.message; }
t('texte sans JSON : erreur lisible', /pas de JSON/.test(msg));
msg = ''; try { G.extractJson('{ "planning": '); } catch (e) { msg = e.message; }
t('JSON cassé : erreur lisible', /JSON invalide|pas de JSON/.test(msg));

// ---- 8. Validation stricte
function plan(fn) {
  const out = {};
  for (const e of ctx.employees) { out[e.alias] = {}; for (const d of [...e.editable].sort()) out[e.alias][d] = fn(e, d); }
  return out;
}
// Planning raisonnable : en semaine OUVERTURE/FERMETURE en alternance, samedi REPOS
const good = plan((e, d) => (P.isOpenWeekday(d) ? (((Number(d.slice(8)) + e.alias.charCodeAt(8)) % 2) ? 'OUVERTURE' : 'FERMETURE') : 'REPOS'));
let ev = G.evaluateProposal(ctx, { planning: good, commentaire: 'ok' });
eq('planning valide : rien d\'écarté, rien d\'oublié', [ev.ignored.length, ev.missing], [0, 0]);
eq('commentaire conservé', ev.comment, 'ok');
t('propositions converties en vrais créneaux (code + horaires de l\'admin)', ev.accepted.some((c) => c.shift === 'OUVERTURE' && c.hours === '09:00 - 16:00') && ev.accepted.some((c) => c.shift === 'FERMETURE' && c.hours === '12:00 - 19:00'));
t('les vrais noms sont rétablis dans les cellules', new Set(ev.accepted.map((c) => c.employee)).size === 3 && ev.accepted.every((c) => EMPS.some((e) => e.name === c.employee)));

const bad = plan(() => 'REPOS');
bad['Salarié A']['2026-11-16'] = 'OUVERTURE';          // congé posé
bad['Salarié B']['2026-11-05'] = 'FERMETURE';          // réunion posée à la main
bad['Salarié A']['2026-11-08'] = 'OUVERTURE';          // dimanche fermé
bad['Salarié A']['2026-11-03'] = 'CAFE';               // code inconnu
bad['Salarié A']['2026-11-04'] = 'CONGES';             // absence interdite pour l'IA
bad['Salarié C']['2026-11-06'] = 'REUNION';            // 08:00 : avant l'ouverture de 09:00
bad['Salarié Z'] = { '2026-11-02': 'BASE' };           // salarié inventé
bad['Salarié C']['2026-12-01'] = 'BASE';               // hors du mois
ev = G.evaluateProposal(ctx, { planning: bad });
const reasons = ev.ignored.map((i) => `${i.employee}|${i.date}|${i.reason.split(' (')[0]}`);
t('congé posé : proposition écartée', reasons.includes('Anna|2026-11-16|journée déjà posée'));
t('réunion posée à la main : écartée', reasons.includes('Bob|2026-11-05|journée déjà posée'));
t('dimanche fermé : écarté', reasons.includes('Anna|2026-11-08|jour non modifiable'));
t('code inconnu : écarté', reasons.includes('Anna|2026-11-03|créneau inconnu'));
t('CONGES interdit à l\'IA : écarté', reasons.includes('Anna|2026-11-04|créneau inconnu'));
t('créneau hors horaires d\'ouverture : écarté', reasons.includes('Chloé|2026-11-06|hors horaires d\'ouverture'));
t('salarié inventé : écarté', reasons.includes('Salarié Z|*|salarié inconnu'));
t('date hors du mois : écartée', reasons.includes('Chloé|2026-12-01|date hors du mois'));
t('aucune des 8 propositions hors cadre n\'est acceptée', !ev.accepted.some((c) => (c.employee === 'Anna' && ['2026-11-16', '2026-11-08', '2026-11-03', '2026-11-04'].includes(c.date)) || (c.employee === 'Bob' && c.date === '2026-11-05') || (c.employee === 'Chloé' && c.date === '2026-11-06')));

// Magasin fermé le samedi par l'admin : travail le samedi refusé
const sSat = S.normalizeAiSettings({ weekly: { 6: { open: false } } });
const cs = G.buildContext(base({ settings: sSat }));
ev = G.evaluateProposal(cs, { planning: { 'Salarié A': { '2026-11-07': 'OUVERTURE' } } });
t('samedi désactivé : plus modifiable', !cs.employees[0].editable.has('2026-11-07') && ev.ignored.length === 1);

// ---- 9. Règles de l'équipe -> avertissements
const everyone = plan((e, d) => (P.isOpenWeekday(d) ? 'OUVERTURE' : 'REPOS')); // tous ouvrent : personne ne ferme
ev = G.evaluateProposal(ctx, { planning: everyone });
t('personne à la fermeture : avertissement', ev.warnings.some((w) => /à la fermeture, minimum 1/.test(w)));
const alone = plan(() => 'REPOS'); alone['Salarié A']['2026-11-02'] = 'OUVERTURE';
ev = G.evaluateProposal(ctx, { planning: alone });
t('1 seule personne présente (minimum 2) : avertissement', ev.warnings.some((w) => /Lundi 02\/11 : 1 personne\(s\) présente\(s\), minimum 2/.test(w)));
const rest = plan(() => 'REPOS'); rest['Salarié A']['2026-11-04'] = 'FERMETURE'; rest['Salarié A']['2026-11-02'] = 'OUVERTURE';
ev = G.evaluateProposal(adv, { planning: rest });
t('repos fixe (mercredi) non respecté : avertissement', ev.warnings.some((w) => /Anna : travaille mercredi 04\/11 malgré son repos fixe/.test(w)));
t('Anna ne peut pas ouvrir : avertissement', ev.warnings.some((w) => /Anna : ouvre le 02\/11/.test(w)));
const run = plan((e, d) => 'OUVERTURE');
ev = G.evaluateProposal(ctx, { planning: run });
t('lundi-samedi travaillés = 6 jours : dans la limite de 6, pas d\'avertissement', !ev.warnings.some((w) => /consécutifs/.test(w)));
const s3 = S.normalizeAiSettings({ teamRules: { maxConsecutiveDays: 3 } });
const ctx3 = G.buildContext(base({ settings: s3 }));
const run3 = {}; for (const e of ctx3.employees) { run3[e.alias] = {}; for (const d of [...e.editable].sort()) run3[e.alias][d] = P.isOpenWeekday(d) ? 'OUVERTURE' : 'REPOS'; }
ev = G.evaluateProposal(ctx3, { planning: run3 });
t('maximum 3 jours consécutifs dépassé : avertissement', ev.warnings.some((w) => /5 jours travaillés consécutifs \(maximum 3\)/.test(w)));
t('les règles par salarié sont toujours contrôlées', ev && G.evaluateProposal(adv, { planning: rest }).warnings.some((w) => /repos fixe|ne peut pas/.test(w)));

// ---- 10. Heures : planifié vs cible
const hrs = plan((e, d) => 'REPOS');
for (const d of [...ctx.employees[1].editable].sort().slice(0, 4)) hrs['Salarié B'][d] = 'OUVERTURE'; // 4 × 7 h
delete hrs['Salarié C']; // un salarié oublié par l'IA : ses jours restent inchangés
ev = G.evaluateProposal(ctx, { planning: hrs });
const sb = ev.stats.find((s) => s.employee === 'Bob');
eq('Bob : 2 h posées + 4 × 7 h = 30 h, cible 140 h', [sb.plannedHours, sb.targetHours, sb.delta], [30, 140, -110]);
t('écart important signalé', ev.warnings.some((w) => /Bob : 30 h planifiées pour une cible de 140 h/.test(w)));
t('jours non traités comptés (missing)', ev.missing > 0);
eq('retours de correction : alias et jamais les vrais noms', G.feedbackFor(ctx, ev).some((l) => /\bBob\b|\bAnna\b/.test(l)), false);
t('retours de correction : parlent de « Salarié B »', G.feedbackFor(ctx, ev).some((l) => /Salarié B/.test(l)));
t('prompt de correction contient les problèmes', G.buildUserPrompt(ctx, ['Lundi 02/11 : 1 personne']).includes('Lundi 02/11 : 1 personne'));
t('invariant : le prompt système interdit les codes hors liste et fixe le JSON', /N'utilise QUE les codes/.test(G.SYSTEM_PROMPT) && /UNIQUEMENT par un objet JSON/.test(G.SYSTEM_PROMPT));

// ---- 11. Entrées hostiles
let m2 = ''; try { G.evaluateProposal(ctx, { rien: 1 }); } catch (e) { m2 = e.message; }
t('réponse sans planning : erreur lisible', /ne contient pas de planning/.test(m2));
ev = G.evaluateProposal(ctx, { planning: { 'Salarié A': { '2026-11-02': { x: 1 }, '__proto__': 'x' }, constructor: 5 } });
t('valeurs bizarres : aucun plantage, rien d\'accepté', ev.accepted.length === 0);

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
