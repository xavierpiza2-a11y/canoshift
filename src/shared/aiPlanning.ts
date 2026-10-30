// Réglages de la génération de planning par IA — partagés client / serveur (code pur, sans dépendance).
// Étape A : modèle, validation, et règle d'ouverture d'un jour donné. La génération elle-même vient à l'étape B.
// ⚠ Importé par le serveur : ce dossier (src/shared) est déjà copié dans l'image Docker.

import { isPublicHoliday } from './planning.ts';

export const AI_SETTINGS_VERSION = 1;

/** Jours de la semaine au format ISO : 1 = lundi … 7 = dimanche. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ISO_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche',
};

export interface TimeRange { start: string; end: string } // « HH:MM »
export interface DayRule { open: boolean; ranges: TimeRange[] } // 0 à 2 plages (ex. 9h-12h / 14h-19h)

export interface MonthOverride {
  weekly?: Partial<Record<IsoWeekday, DayRule>>; // exceptions par jour de semaine pour ce mois (ex. dimanches de décembre)
  holidays?: DayRule; // règle des jours fériés pour ce mois
}

export interface Staffing {
  minOpening: number; // personnes minimum à l'ouverture
  minClosing: number; // personnes minimum à la fermeture
  minPerDay: number; // personnes minimum présentes dans la journée
  busyDays: Partial<Record<IsoWeekday, number>>; // minimum renforcé certains jours (ex. samedi)
}

export interface TeamRules {
  maxConsecutiveDays: number; // jours travaillés consécutifs au maximum
  weekendRotation: boolean; // alterner les week-ends travaillés
}

export interface EmployeeAiRules {
  canOpen: boolean;
  canClose: boolean;
  fixedRestWeekdays: IsoWeekday[]; // jours de repos fixes
  targetHoursGap: number; // écart d'heures visé sur le mois (+ = en plus, − = en moins), 0 par défaut
  constraints: string; // contraintes libres (visibles de l'IA)
}

/** Modèles d'IA possibles : Gemini (gratuit possible) ou Claude. Le gestionnaire autorise, l'administrateur du magasin choisit. */
export type AiProvider = 'gemini' | 'anthropic';
export const AI_PROVIDERS: AiProvider[] = ['gemini', 'anthropic'];
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { gemini: 'Gemini (gratuit possible)', anthropic: 'Claude' };
export const isAiProvider = (v: unknown): v is AiProvider => v === 'gemini' || v === 'anthropic';

export interface AiPlanningSettings {
  version: number;
  model?: AiProvider; // modèle choisi par l'administrateur (parmi ceux autorisés par le gestionnaire)
  weekly: Record<IsoWeekday, DayRule>;
  holidays: DayRule; // jours fériés : fermé par défaut
  monthOverrides: Record<string, MonthOverride>; // clé « AAAA-MM »
  dateOverrides: Record<string, DayRule>; // clé « AAAA-MM-JJ » : exception d'une date précise
  staffing: Staffing;
  teamRules: TeamRules;
  employees: Record<string, EmployeeAiRules>; // clé = nom du salarié
  monthNotes: Record<string, string>; // précisions libres du mois (arrivages, promos, inventaire…)
}

const DEFAULT_RANGE: TimeRange = { start: '09:00', end: '19:00' };
const closedRule = (): DayRule => ({ open: false, ranges: [] });
const openRule = (): DayRule => ({ open: true, ranges: [{ ...DEFAULT_RANGE }] });

export function defaultEmployeeRules(): EmployeeAiRules {
  return { canOpen: true, canClose: true, fixedRestWeekdays: [], targetHoursGap: 0, constraints: '' };
}

export function defaultAiSettings(): AiPlanningSettings {
  return {
    version: AI_SETTINGS_VERSION,
    // Lundi à samedi ouverts par défaut (le samedi est donc ouvert tant que l'admin ne le désactive pas), dimanche fermé.
    weekly: { 1: openRule(), 2: openRule(), 3: openRule(), 4: openRule(), 5: openRule(), 6: openRule(), 7: closedRule() },
    holidays: closedRule(),
    monthOverrides: {},
    dateOverrides: {},
    staffing: { minOpening: 1, minClosing: 1, minPerDay: 2, busyDays: {} },
    teamRules: { maxConsecutiveDays: 6, weekendRotation: true },
    employees: {},
    monthNotes: {},
  };
}

// ---------------------------------------------------------------------------------------------
// Validation / normalisation : accepte n'importe quelle entrée, renvoie des réglages sûrs.
// `strict: true` lève une erreur lisible (réponse 400) ; sinon corrige silencieusement.
// ---------------------------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_TEXT = 2000;
const MAX_EMPLOYEES = 100;
const MAX_KEYS = 400;

export class AiSettingsError extends Error {}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

function normText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT) : '';
}

function normInt(v: unknown, min: number, max: number, fallback: number, label: string, strict: boolean): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) {
    if (strict) throw new AiSettingsError(`${label} : valeur entre ${min} et ${max} attendue.`);
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  return Math.round(n);
}

function normGap(v: unknown, label: string, strict: boolean): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) return 0;
  if (n < -100 || n > 100) {
    if (strict) throw new AiSettingsError(`${label} : écart entre -100 h et +100 h attendu.`);
    return Math.min(100, Math.max(-100, n));
  }
  return Math.round(n * 10) / 10;
}

export function normalizeDayRule(raw: unknown, fallback: DayRule, label: string, strict = false): DayRule {
  if (!isObj(raw)) return { open: fallback.open, ranges: fallback.ranges.map((r) => ({ ...r })) };
  const open = raw.open === true;
  if (!open) return { open: false, ranges: [] };
  const rawRanges = Array.isArray(raw.ranges) ? raw.ranges : [];
  const ranges: TimeRange[] = [];
  for (const r of rawRanges.slice(0, 2)) {
    const start = isObj(r) ? String(r.start ?? '') : '';
    const end = isObj(r) ? String(r.end ?? '') : '';
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      if (strict) throw new AiSettingsError(`${label} : horaires invalides (format HH:MM attendu).`);
      continue;
    }
    if (toMinutes(start) >= toMinutes(end)) {
      if (strict) throw new AiSettingsError(`${label} : l'heure de fermeture doit être après l'heure d'ouverture.`);
      continue;
    }
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  if (ranges.length === 2 && toMinutes(ranges[0].end) > toMinutes(ranges[1].start)) {
    if (strict) throw new AiSettingsError(`${label} : les deux plages horaires se chevauchent.`);
    ranges.pop();
  }
  if (ranges.length === 0) {
    if (strict) throw new AiSettingsError(`${label} : au moins une plage horaire est requise quand le magasin est ouvert.`);
    return { open: true, ranges: [{ ...DEFAULT_RANGE }] };
  }
  return { open: true, ranges };
}

const wd = (k: string): IsoWeekday | null => (/^[1-7]$/.test(k) ? (Number(k) as IsoWeekday) : null);

export function normalizeAiSettings(raw: unknown, knownEmployees?: string[], strict = false): AiPlanningSettings {
  const d = defaultAiSettings();
  const r = isObj(raw) ? raw : {};
  const out = defaultAiSettings();

  if (isAiProvider(r.model)) out.model = r.model;

  const weekly = isObj(r.weekly) ? r.weekly : {};
  for (const day of ISO_WEEKDAYS) {
    out.weekly[day] = normalizeDayRule(weekly[day], d.weekly[day], `${WEEKDAY_LABELS[day]}`, strict);
  }
  out.holidays = normalizeDayRule(r.holidays, d.holidays, 'Jours fériés', strict);

  if (isObj(r.monthOverrides)) {
    for (const [mk, v] of Object.entries(r.monthOverrides).slice(0, MAX_KEYS)) {
      if (!MONTH_RE.test(mk)) { if (strict) throw new AiSettingsError(`Mois invalide : ${mk}`); continue; }
      if (!isObj(v)) continue;
      const ov: MonthOverride = {};
      if (isObj(v.weekly)) {
        const w: Partial<Record<IsoWeekday, DayRule>> = {};
        for (const [k, rule] of Object.entries(v.weekly)) {
          const day = wd(k);
          if (day && isObj(rule)) w[day] = normalizeDayRule(rule, d.weekly[day], `${mk} – ${WEEKDAY_LABELS[day]}`, strict);
        }
        if (Object.keys(w).length) ov.weekly = w;
      }
      if (isObj(v.holidays)) ov.holidays = normalizeDayRule(v.holidays, d.holidays, `${mk} – jours fériés`, strict);
      if (ov.weekly || ov.holidays) out.monthOverrides[mk] = ov;
    }
  }

  if (isObj(r.dateOverrides)) {
    for (const [dk, v] of Object.entries(r.dateOverrides).slice(0, MAX_KEYS)) {
      if (!DATE_RE.test(dk)) { if (strict) throw new AiSettingsError(`Date invalide : ${dk}`); continue; }
      if (isObj(v)) out.dateOverrides[dk] = normalizeDayRule(v, openRule(), dk, strict);
    }
  }

  const s = isObj(r.staffing) ? r.staffing : {};
  out.staffing.minOpening = normInt(s.minOpening, 0, 50, d.staffing.minOpening, 'Minimum à l\'ouverture', strict);
  out.staffing.minClosing = normInt(s.minClosing, 0, 50, d.staffing.minClosing, 'Minimum à la fermeture', strict);
  out.staffing.minPerDay = normInt(s.minPerDay, 0, 50, d.staffing.minPerDay, 'Minimum par jour', strict);
  if (isObj(s.busyDays)) {
    for (const [k, v] of Object.entries(s.busyDays)) {
      const day = wd(k);
      if (day) out.staffing.busyDays[day] = normInt(v, 0, 50, out.staffing.minPerDay, `Effectif du ${WEEKDAY_LABELS[day]}`, strict);
    }
  }

  const t = isObj(r.teamRules) ? r.teamRules : {};
  out.teamRules.maxConsecutiveDays = normInt(t.maxConsecutiveDays, 1, 14, d.teamRules.maxConsecutiveDays, 'Jours consécutifs maximum', strict);
  out.teamRules.weekendRotation = t.weekendRotation === undefined ? d.teamRules.weekendRotation : t.weekendRotation === true;

  if (isObj(r.employees)) {
    const entries = Object.entries(r.employees);
    if (strict && entries.length > MAX_EMPLOYEES) throw new AiSettingsError('Trop de salariés.');
    for (const [name, v] of entries.slice(0, MAX_EMPLOYEES)) {
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') continue;
      if (knownEmployees && !knownEmployees.includes(name)) continue; // salarié supprimé : on ne garde rien
      const e = isObj(v) ? v : {};
      const rest = Array.isArray(e.fixedRestWeekdays)
        ? [...new Set(e.fixedRestWeekdays.map((x: unknown) => Number(x)).filter((x: number) => x >= 1 && x <= 7))].sort() as IsoWeekday[]
        : [];
      out.employees[name] = {
        canOpen: e.canOpen !== false,
        canClose: e.canClose !== false,
        fixedRestWeekdays: rest,
        targetHoursGap: normGap(e.targetHoursGap, `Écart visé (${name})`, strict),
        constraints: normText(e.constraints),
      };
    }
  }

  if (isObj(r.monthNotes)) {
    for (const [mk, v] of Object.entries(r.monthNotes).slice(0, MAX_KEYS)) {
      if (!MONTH_RE.test(mk)) { if (strict) throw new AiSettingsError(`Mois invalide : ${mk}`); continue; }
      const text = normText(v);
      if (text) out.monthNotes[mk] = text;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Règle d'ouverture d'une date.
// Priorité : exception de date > jour férié (règle du mois, sinon règle générale) > jour de semaine (règle du mois, sinon générale).
// ---------------------------------------------------------------------------------------------

export function isoWeekdayOf(dateKey: string): IsoWeekday {
  const [y, m, d] = dateKey.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return (js === 0 ? 7 : js) as IsoWeekday;
}

export type DayRuleSource = 'date' | 'holiday-month' | 'holiday' | 'weekday-month' | 'weekday';
export interface ResolvedDay { dateKey: string; weekday: IsoWeekday; holiday: boolean; rule: DayRule; source: DayRuleSource }

export function resolveDayRule(settings: AiPlanningSettings, dateKey: string): ResolvedDay {
  const weekday = isoWeekdayOf(dateKey);
  const holiday = isPublicHoliday(dateKey);
  const monthKey = dateKey.slice(0, 7);
  const ov = settings.monthOverrides[monthKey];

  const exact = settings.dateOverrides[dateKey];
  if (exact) return { dateKey, weekday, holiday, rule: exact, source: 'date' };
  if (holiday) {
    if (ov?.holidays) return { dateKey, weekday, holiday, rule: ov.holidays, source: 'holiday-month' };
    return { dateKey, weekday, holiday, rule: settings.holidays, source: 'holiday' };
  }
  const monthRule = ov?.weekly?.[weekday];
  if (monthRule) return { dateKey, weekday, holiday, rule: monthRule, source: 'weekday-month' };
  return { dateKey, weekday, holiday, rule: settings.weekly[weekday], source: 'weekday' };
}

/** Effectif minimum de la journée (renforcé certains jours). */
export function minStaffForDay(settings: AiPlanningSettings, dateKey: string): number {
  return settings.staffing.busyDays[isoWeekdayOf(dateKey)] ?? settings.staffing.minPerDay;
}

/** Toutes les journées d'un mois avec leur règle d'ouverture (entrée de l'étape B). */
export function resolveMonth(settings: AiPlanningSettings, monthKey: string, dateKeys: string[]): ResolvedDay[] {
  return dateKeys.filter((d) => d.startsWith(monthKey)).map((d) => resolveDayRule(settings, d));
}
