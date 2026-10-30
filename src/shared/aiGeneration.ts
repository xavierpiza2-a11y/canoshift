// Génération de planning par IA — logique PURE (sans réseau), partagée client/serveur et testable.
//  - anonymisation des salariés (« Salarié A », « Salarié B »…) avant tout envoi ;
//  - construction du contexte (horaires d'ouverture, créneaux autorisés, journées déjà posées, objectifs d'heures) ;
//  - validation STRICTE de la réponse de l'IA : tout ce qui sort du cadre est écarté, jamais écrit.
// ⚠ Importé par le serveur : src/shared est déjà copié dans l'image Docker.

import { generateDefaultDay, isOpenWeekday, coreShiftHours, BASE_DAILY_HOURS } from './planning.ts';
import {
  WEEKDAY_LABELS,
  resolveDayRule,
  minStaffForDay,
  type AiPlanningSettings,
  type DayRule,
} from './aiPlanning.ts';

export interface ShiftOption {
  shift: string;
  hours: string;
  category: string;
  label?: string;
  description?: string;
  hoursDecimal?: number;
  dayStatus?: string;
}
export interface DayCell { shift: string; hours: string; info?: string }
export interface Cell { employee: string; date: string; shift: string; hours: string }
export interface GenEmployee { name: string; contractType?: string; weeklyHoursQuota?: number }

export interface GenInput {
  monthKey: string;
  dateKeys: string[]; // toutes les dates du mois
  settings: AiPlanningSettings;
  employees: GenEmployee[];
  existing: Record<string, Record<string, DayCell>>; // salarié -> date -> journée actuelle
  dayNotes: Record<string, string>;
  shifts: ShiftOption[]; // créneaux configurés par l'admin
  instructions: string;
  storeName?: string; // nom du magasin : jamais envoyé tel quel (remplacé par « le magasin » dans les textes libres)
}

// ---------------------------------------------------------------------------------------------
// Horaires : « 09:00 - 12:30 , 14:00 - 18:00 » ou « 9h-12h30 14h-19h » -> plages en minutes
// ---------------------------------------------------------------------------------------------
export interface MinRange { start: number; end: number }

export function parseTimeRanges(text: string | undefined): MinRange[] {
  const t = (text || '').trim();
  if (!t) return [];
  const toks = [...t.matchAll(/(\d{1,2})\s*[:hH]\s*(\d{2})?/g)].map((m) => Number(m[1]) * 60 + Number(m[2] || 0));
  if (toks.length < 2 || toks.length % 2 !== 0) return [];
  const out: MinRange[] = [];
  for (let i = 0; i < toks.length; i += 2) {
    if (toks[i] >= toks[i + 1] || toks[i + 1] > 24 * 60) return [];
    out.push({ start: toks[i], end: toks[i + 1] });
  }
  return out;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface SlotInfo { code: string; option: ShiftOption; timed: boolean; start: number; end: number; hours: number; working: boolean; resting: boolean }

export function slotInfo(opt: ShiftOption): SlotInfo {
  const ranges = parseTimeRanges(opt.hours);
  const timed = ranges.length > 0;
  const core = coreShiftHours(opt.shift);
  const rangeHours = ranges.reduce((s, r) => s + (r.end - r.start), 0) / 60;
  const hours = opt.hoursDecimal != null && opt.hoursDecimal >= 0 ? opt.hoursDecimal : core ?? rangeHours;
  const code = opt.shift.trim().toUpperCase();
  const resting = code === 'REPOS' || opt.dayStatus === 'REPOS' || opt.category === 'REPOS';
  const working = !resting && opt.dayStatus !== 'ABSENT' && (hours > 0 || code === 'BASE');
  return { code, option: opt, timed, start: timed ? ranges[0].start : 0, end: timed ? ranges[ranges.length - 1].end : 0, hours, working, resting };
}

/** Créneaux que l'IA a le droit de proposer : présence (avec ou sans horaires) et repos. Jamais d'absence (congés, RTT, CFA, férié…). */
export function allowedSlots(shifts: ShiftOption[]): SlotInfo[] {
  const seen = new Set<string>();
  const out: SlotInfo[] = [];
  for (const s of shifts) {
    const code = (s.shift || '').trim().toUpperCase();
    if (!code || seen.has(code) && !(s.hours || '').trim()) continue;
    if (['CONGES', 'RTT', 'CFA', 'FERIE', 'EMPTY'].includes(code) || s.dayStatus === 'ABSENT' || s.category === 'FERIE') continue;
    const info = slotInfo(s);
    if (!info.working && !info.resting) continue;
    const key = `${code}|${(s.hours || '').replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key); seen.add(code);
    out.push(info);
  }
  return out;
}

function hullOf(rule: DayRule): MinRange | null {
  if (!rule.open || !rule.ranges.length) return null;
  return { start: toMin(rule.ranges[0].start), end: toMin(rule.ranges[rule.ranges.length - 1].end) };
}

// ---------------------------------------------------------------------------------------------
// Anonymisation
// ---------------------------------------------------------------------------------------------
export function aliasFor(index: number): string {
  let n = index, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return `Salarié ${s}`;
}

export function buildAliasMap(names: string[]): { nameToAlias: Record<string, string>; aliasToName: Record<string, string> } {
  const nameToAlias: Record<string, string> = {}, aliasToName: Record<string, string> = {};
  names.forEach((n, i) => { const a = aliasFor(i); nameToAlias[n] = a; aliasToName[a] = n; });
  return { nameToAlias, aliasToName };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remplace tout prénom/nom connu dans un texte libre (insensible à la casse et aux mots collés à des lettres). */
export function anonymizeText(text: string, nameToAlias: Record<string, string>): string {
  let out = text || '';
  const names = Object.keys(nameToAlias).filter((n) => n.trim().length >= 2).sort((a, b) => b.length - a.length);
  for (const name of names) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name.trim())}(?![\\p{L}\\p{N}])`, 'giu'), nameToAlias[name]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Contexte
// ---------------------------------------------------------------------------------------------
export interface EmpCtx {
  name: string; alias: string; contractType: string;
  objectiveHours: number; targetHours: number; lockedHours: number; hoursToPlan: number;
  editable: Set<string>; // dates que l'IA peut renseigner (jour ouvert, journée non posée à la main)
  locked: Record<string, string>; // dates posées à la main -> code
  canOpen: boolean; canClose: boolean; fixedRest: number[]; constraints: string;
}
export interface DayCtx { date: string; weekday: number; open: boolean; ranges: string[]; holiday: boolean; minPeople: number; note: string; hull: MinRange | null }

export interface GenContext {
  input: GenInput;
  employees: EmpCtx[];
  days: DayCtx[];
  slots: SlotInfo[];
  nameToAlias: Record<string, string>;
  aliasToName: Record<string, string>;
  autoRest: Cell[]; // jours fermés encore en « BASE » générée : remis en REPOS d'office
  staffing: { minOpening: number; minClosing: number; maxConsecutiveDays: number; weekendRotation: boolean };
  payload: any; // ce qui est envoyé au modèle (anonymisé)
}

const isDefaultCell = (date: string, c: DayCell | undefined) => {
  if (!c || !c.shift) return true; // case vide
  const def = generateDefaultDay(date).shift;
  return c.shift.trim().toUpperCase() === def && !(c.hours || '').trim() && !(c.info || '').trim();
};

function cellHours(c: DayCell, slots: ShiftOption[]): number {
  const code = (c.shift || '').trim().toUpperCase();
  const core = coreShiftHours(code);
  if (core !== null) return core;
  const opt = slots.find((s) => s.shift.trim().toUpperCase() === code && (s.hours || '').replace(/\s+/g, '') === (c.hours || '').replace(/\s+/g, ''))
    || slots.find((s) => s.shift.trim().toUpperCase() === code);
  if (opt) return slotInfo(opt).hours;
  const r = parseTimeRanges(c.hours);
  return r.reduce((s, x) => s + (x.end - x.start), 0) / 60;
}

export function buildContext(input: GenInput): GenContext {
  const { settings } = input;
  const names = input.employees.map((e) => e.name);
  const { nameToAlias, aliasToName } = buildAliasMap(names);
  const slots = allowedSlots(input.shifts);
  const textMap: Record<string, string> = { ...nameToAlias, ...(input.storeName && input.storeName.trim().length >= 2 ? { [input.storeName.trim()]: 'le magasin' } : {}) };
  const anon = (t: string) => anonymizeText(t, textMap);

  const days: DayCtx[] = input.dateKeys.map((date) => {
    const r = resolveDayRule(settings, date);
    return {
      date, weekday: r.weekday, open: r.rule.open && r.rule.ranges.length > 0, holiday: r.holiday,
      ranges: r.rule.open ? r.rule.ranges.map((x) => `${x.start}-${x.end}`) : [],
      minPeople: r.rule.open ? minStaffForDay(settings, date) : 0,
      note: anon(input.dayNotes[date] || ''), hull: hullOf(r.rule),
    };
  });
  const autoRest: Cell[] = [];
  const employees: EmpCtx[] = input.employees.map((e) => {
    const rules = settings.employees[e.name];
    const cells = input.existing[e.name] || {};
    const editable = new Set<string>(), locked: Record<string, string> = {};
    let lockedHours = 0, absentWeekdays = 0;
    for (const d of days) {
      const c = cells[d.date];
      if (isDefaultCell(d.date, c)) {
        if (d.open) editable.add(d.date);
        else if (c && c.shift.trim().toUpperCase() === 'BASE') autoRest.push({ employee: e.name, date: d.date, shift: 'REPOS', hours: '' });
        else if (!c) autoRest.push({ employee: e.name, date: d.date, shift: d.holiday ? 'FERIE' : 'REPOS', hours: '' });
      } else {
        locked[d.date] = c!.shift.trim().toUpperCase();
        lockedHours += cellHours(c!, input.shifts);
        if (['CONGES', 'CFA'].includes(locked[d.date]) && isOpenWeekday(d.date)) absentWeekdays++;
      }
    }
    const openWeekdays = days.filter((d) => isOpenWeekday(d.date)).length;
    const objectiveHours = Math.max(0, openWeekdays - absentWeekdays) * BASE_DAILY_HOURS;
    const gap = rules?.targetHoursGap ?? 0;
    const targetHours = round1(objectiveHours + gap);
    return {
      name: e.name, alias: nameToAlias[e.name], contractType: e.contractType || 'HEBDO_35H',
      objectiveHours: round1(objectiveHours), targetHours, lockedHours: round1(lockedHours),
      hoursToPlan: round1(Math.max(0, targetHours - lockedHours)),
      editable, locked,
      canOpen: rules?.canOpen !== false, canClose: rules?.canClose !== false,
      fixedRest: rules?.fixedRestWeekdays ?? [],
      constraints: anon(rules?.constraints || ''),
    };
  });

  const staffing = {
    minOpening: settings.staffing.minOpening, minClosing: settings.staffing.minClosing,
    maxConsecutiveDays: settings.teamRules.maxConsecutiveDays, weekendRotation: settings.teamRules.weekendRotation,
  };
  const notes = [settings.monthNotes[input.monthKey] || '', input.instructions || ''].map(anon).filter(Boolean);

  const payload = {
    mois: input.monthKey,
    jours: days.map((d) => ({
      date: d.date, jour: WEEKDAY_LABELS[d.weekday as 1].toLowerCase(), ouvert: d.open,
      ...(d.open ? { horaires: d.ranges, ferie: d.holiday || undefined, minimumPersonnes: d.minPeople } : { ferie: d.holiday || undefined }),
      ...(d.note ? { note: d.note } : {}),
    })),
    creneauxAutorises: slots.map((s) => ({
      code: s.code, horaires: s.timed ? `${hhmm(s.start)}-${hhmm(s.end)}` : 'sans horaire précis', dureeHeures: round1(s.hours),
      type: s.resting ? 'repos' : 'présence',
    })),
    effectifs: { ouvertureMin: staffing.minOpening, fermetureMin: staffing.minClosing, joursConsecutifsMax: staffing.maxConsecutiveDays, rotationWeekends: staffing.weekendRotation },
    salaries: employees.map((e) => ({
      salarie: e.alias, contrat: e.contractType, heuresObjectifMois: e.objectiveHours, heuresCiblesMois: e.targetHours,
      heuresDejaPosees: e.lockedHours, heuresAPlanifier: e.hoursToPlan,
      joursARenseigner: [...e.editable].sort(), joursDejaPoses: e.locked,
      peutOuvrir: e.canOpen, peutFermer: e.canClose,
      reposFixes: e.fixedRest.map((d) => WEEKDAY_LABELS[d as 1].toLowerCase()), contraintes: e.constraints || undefined,
    })),
    precisions: notes,
  };
  return { input, employees, days, slots, nameToAlias, aliasToName, autoRest, staffing, payload };
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------
export const SYSTEM_PROMPT = `Tu es un assistant de planification des horaires pour un magasin (jardinerie). Tu proposes le planning d'UN mois pour une équipe.
Règles ABSOLUES :
1. N'utilise QUE les codes de "creneauxAutorises". Jamais d'autre code.
2. Ne renseigne QUE les jours listés dans "joursARenseigner" de chaque salarié. Les "joursDejaPoses" (congés, CFA, RTT, créneaux saisis à la main…) sont intouchables : tiens-en compte, ne les répète pas.
3. Respect STRICT des horaires d'ouverture : un jour "ouvert": false n'a aucun créneau de présence ; un créneau avec horaires doit tenir dans les horaires d'ouverture du jour.
4. Respecte les effectifs : "minimumPersonnes" par jour, "ouvertureMin" personnes à l'ouverture (créneau qui commence à l'heure d'ouverture), "fermetureMin" à la fermeture (créneau qui finit à l'heure de fermeture). Compte aussi les salariés dont le jour est déjà posé.
5. Vise les "heuresCiblesMois" de chaque salarié (total des heures du mois, jours déjà posés inclus) : utilise des repos en semaine pour compenser les samedis/dimanches travaillés. Ordre de grandeur toléré : ± 3,5 h.
6. Respecte aussi "peutOuvrir"/"peutFermer", "reposFixes", "contraintes", "joursConsecutifsMax" et alterne les week-ends si "rotationWeekends" est vrai. Tiens compte des "precisions" et des "note" de jour (arrivages, promotions, inventaire…).
7. Répartis équitablement les jours difficiles (samedis, ouvertures, fermetures) entre les salariés.
Réponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :
{"planning": {"Salarié A": {"2026-11-02": "CODE", "2026-11-03": "REPOS"}, "Salarié B": {...}}, "commentaire": "2 phrases maximum"}
Chaque salarié doit avoir une entrée pour CHACUN de ses "joursARenseigner".`;

export function buildUserPrompt(ctx: GenContext, feedback?: string[]): string {
  let p = `Voici les données du mois (JSON). Propose le planning.\n${JSON.stringify(ctx.payload)}`;
  if (feedback?.length) {
    p += `\n\nTa proposition précédente comporte des problèmes à corriger. Renvoie le planning COMPLET corrigé :\n- ${feedback.slice(0, 30).join('\n- ')}`;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Lecture et validation de la réponse
// ---------------------------------------------------------------------------------------------
export function extractJson(text: string): any {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('La réponse de l\'IA n\'est pas exploitable (pas de JSON).');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('La réponse de l\'IA n\'est pas exploitable (JSON invalide).'); }
}

export interface Ignored { employee: string; date: string; reason: string }
export interface EmpStat { employee: string; targetHours: number; plannedHours: number; delta: number; workingDays: number; changes: number }
export interface Evaluation {
  accepted: Cell[]; // propositions valides (hors jours fermés remis en repos)
  ignored: Ignored[]; // propositions écartées (hors cadre)
  warnings: string[]; // règles non respectées (effectifs, repos fixes, heures…)
  stats: EmpStat[];
  missing: number; // jours à renseigner que l'IA n'a pas traités (restent inchangés)
  comment: string;
  hardCount: number; // ignorés + avertissements de règles (hors écart d'heures léger) : sert à décider d'une correction
}

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function evaluateProposal(ctx: GenContext, raw: any): Evaluation {
  const planning = raw && typeof raw.planning === 'object' && raw.planning ? raw.planning : null;
  if (!planning) throw new Error('La réponse de l\'IA ne contient pas de planning.');
  const slotByCode = new Map<string, SlotInfo>();
  for (const s of ctx.slots) if (!slotByCode.has(s.code)) slotByCode.set(s.code, s);
  const dayOf = new Map(ctx.days.map((d) => [d.date, d]));
  const empByAlias = new Map(ctx.employees.map((e) => [e.alias.toLowerCase(), e]));
  const accepted: Cell[] = [], ignored: Ignored[] = [];
  const got = new Map<string, Set<string>>();

  for (const [aliasRaw, cells] of Object.entries(planning)) {
    const emp = empByAlias.get(aliasRaw.trim().toLowerCase());
    if (!emp || !cells || typeof cells !== 'object') { ignored.push({ employee: aliasRaw, date: '*', reason: 'salarié inconnu' }); continue; }
    for (const [date, codeRaw] of Object.entries(cells as Record<string, unknown>)) {
      const code = String(codeRaw ?? '').trim().toUpperCase();
      const day = dayOf.get(date);
      if (!day) { ignored.push({ employee: emp.name, date, reason: 'date hors du mois' }); continue; }
      if (!emp.editable.has(date)) { ignored.push({ employee: emp.name, date, reason: emp.locked[date] ? `journée déjà posée (${emp.locked[date]})` : 'jour non modifiable' }); continue; }
      const slot = slotByCode.get(code);
      if (!slot) { ignored.push({ employee: emp.name, date, reason: `créneau inconnu (${String(codeRaw).slice(0, 20)})` }); continue; }
      if (slot.working && !day.open) { ignored.push({ employee: emp.name, date, reason: 'magasin fermé ce jour-là' }); continue; }
      if (slot.working && slot.timed && day.hull && (slot.start < day.hull.start || slot.end > day.hull.end)) {
        ignored.push({ employee: emp.name, date, reason: `hors horaires d'ouverture (${slot.code} ${hhmm(slot.start)}-${hhmm(slot.end)})` }); continue;
      }
      if (!got.has(emp.name)) got.set(emp.name, new Set());
      got.get(emp.name)!.add(date);
      accepted.push({ employee: emp.name, date, shift: slot.option.shift, hours: slot.option.hours || '' });
    }
  }
  let missing = 0;
  for (const e of ctx.employees) for (const d of e.editable) if (!got.get(e.name)?.has(d)) missing++;

  // État final du mois (jours posés + propositions + jours inchangés) pour contrôler les règles
  const proposed = new Map(accepted.map((c) => [`${c.employee}|${c.date}`, c]));
  const stateOf = (e: EmpCtx, date: string): { code: string; slot: SlotInfo | null } => {
    const p = proposed.get(`${e.name}|${date}`);
    if (p) { const s = slotByCode.get(p.shift.trim().toUpperCase()) ?? null; return { code: p.shift.toUpperCase(), slot: s }; }
    const cur = ctx.input.existing[e.name]?.[date];
    const code = (cur?.shift || generateDefaultDay(date).shift).trim().toUpperCase();
    const opt = ctx.input.shifts.find((s) => s.shift.trim().toUpperCase() === code && (s.hours || '').replace(/\s+/g, '') === (cur?.hours || '').replace(/\s+/g, ''))
      || ctx.input.shifts.find((s) => s.shift.trim().toUpperCase() === code);
    return { code, slot: opt ? slotInfo(opt) : null };
  };
  const isWorking = (st: { code: string; slot: SlotInfo | null }) => st.slot ? st.slot.working : coreShiftHours(st.code) === 7 || (st.code !== 'REPOS' && !['CONGES', 'RTT', 'CFA', 'FERIE'].includes(st.code));

  const warnings: string[] = [];
  const anyTimed = ctx.slots.some((s) => s.working && s.timed);
  for (const d of ctx.days) {
    if (!d.open) continue;
    let present = 0, openers = 0, closers = 0;
    for (const e of ctx.employees) {
      const st = stateOf(e, d.date);
      if (!isWorking(st)) continue;
      present++;
      if (st.slot?.timed && d.hull) {
        if (st.slot.start - d.hull.start <= 30) openers++;
        if (d.hull.end - st.slot.end <= 30) closers++;
      }
    }
    const lab = `${WEEKDAY_LABELS[d.weekday as 1]} ${fmtDate(d.date)}`;
    if (present < d.minPeople) warnings.push(`${lab} : ${present} personne(s) présente(s), minimum ${d.minPeople}.`);
    if (anyTimed && openers < ctx.staffing.minOpening) warnings.push(`${lab} : ${openers} personne(s) à l'ouverture, minimum ${ctx.staffing.minOpening}.`);
    if (anyTimed && closers < ctx.staffing.minClosing) warnings.push(`${lab} : ${closers} personne(s) à la fermeture, minimum ${ctx.staffing.minClosing}.`);
  }

  const stats: EmpStat[] = [];
  for (const e of ctx.employees) {
    let hours = 0, runLen = 0, runMax = 0, workDays = 0, changes = 0;
    for (const d of ctx.days) {
      const st = stateOf(e, d.date);
      const cur = ctx.input.existing[e.name]?.[d.date];
      const p = proposed.get(`${e.name}|${d.date}`);
      if (p) {
        hours += st.slot ? st.slot.hours : 0;
        if (!cur || cur.shift.trim().toUpperCase() !== p.shift.trim().toUpperCase() || (cur.hours || '') !== p.hours) changes++;
      } else if (cur) {
        hours += cellHours(cur, ctx.input.shifts);
      } else {
        hours += coreShiftHours(generateDefaultDay(d.date).shift) ?? 0;
      }
      const working = isWorking(st);
      if (working) { workDays++; runLen++; runMax = Math.max(runMax, runLen); } else runLen = 0;
      if (working && e.fixedRest.includes(d.weekday) && proposed.has(`${e.name}|${d.date}`)) warnings.push(`${e.name} : travaille ${WEEKDAY_LABELS[d.weekday as 1].toLowerCase()} ${fmtDate(d.date)} malgré son repos fixe.`);
      if (st.slot?.timed && d.hull && proposed.has(`${e.name}|${d.date}`)) {
        if (!e.canOpen && st.slot.start - d.hull.start <= 30) warnings.push(`${e.name} : ouvre le ${fmtDate(d.date)} alors qu'il/elle ne peut pas ouvrir.`);
        if (!e.canClose && d.hull.end - st.slot.end <= 30) warnings.push(`${e.name} : ferme le ${fmtDate(d.date)} alors qu'il/elle ne peut pas fermer.`);
      }
    }
    if (runMax > ctx.staffing.maxConsecutiveDays) warnings.push(`${e.name} : ${runMax} jours travaillés consécutifs (maximum ${ctx.staffing.maxConsecutiveDays}).`);
    const planned = round1(hours);
    stats.push({ employee: e.name, targetHours: e.targetHours, plannedHours: planned, delta: round1(planned - e.targetHours), workingDays: workDays, changes });
  }
  // Les écarts d'heures passent en premier : c'est l'information la plus utile (affichage et retours de correction)
  const hourIssues = stats.filter((s) => Math.abs(s.delta) > 3.5);
  warnings.unshift(...hourIssues.map((s) => `${s.employee} : ${s.plannedHours} h planifiées pour une cible de ${s.targetHours} h (écart ${s.delta > 0 ? '+' : ''}${s.delta} h).`));

  return {
    accepted, ignored, warnings, stats, missing,
    comment: typeof raw.commentaire === 'string' ? raw.commentaire.slice(0, 400) : '',
    hardCount: ignored.length + warnings.length + (missing > 0 ? 1 : 0),
  };
}

/** Retours précis envoyés au modèle pour une correction (avec les alias, jamais les vrais noms). */
export function feedbackFor(ctx: GenContext, ev: Evaluation): string[] {
  const alias = (t: string) => anonymizeText(t, ctx.nameToAlias);
  const out: string[] = [];
  for (const i of ev.ignored.slice(0, 15)) out.push(alias(`${i.employee} ${i.date} : proposition refusée (${i.reason}).`));
  if (ev.missing > 0) out.push(`${ev.missing} jour(s) à renseigner n'ont pas été traités : renseigne chaque jour de "joursARenseigner".`);
  for (const w of ev.warnings.slice(0, 20)) out.push(alias(w));
  return out;
}

/** Lecture rapide pour l'interface : réglages en français d'un jour. */
export function describeDay(d: DayCtx): string {
  return d.open ? d.ranges.join(' / ') : 'fermé';
}
