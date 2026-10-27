/**
 * Règles métier de planning communes au navigateur ET au serveur.
 * Aucune dépendance au DOM ni à Node : ce fichier est importé des deux côtés,
 * ce qui garantit des résultats identiques.
 */

// ---------------------------------------------------------------------------
// CATÉGORIES DE BASE (verrouillées)
// ---------------------------------------------------------------------------
export const CORE_SHIFT_CODES = ['BASE', 'REPOS', 'RTT', 'FERIE', 'CFA', 'CONGES'] as const;
export type CoreShiftCode = (typeof CORE_SHIFT_CODES)[number];

/** Heures travaillées comptées pour une journée BASE (tous contrats confondus). */
export const BASE_DAILY_HOURS = 7;

/**
 * Heures travaillées d'un code de base, ou null si le code n'est pas une catégorie de base
 * (créneaux personnalisés ou historiques : leur calcul existant est conservé tel quel).
 *  - BASE = 7 h ; REPOS, RTT, FERIE, CFA, CONGES = 0 h travaillée.
 */
export function coreShiftHours(shiftText: string | undefined | null): number | null {
  const s = (shiftText || '').trim().toUpperCase();
  switch (s) {
    case 'BASE':
      return BASE_DAILY_HOURS;
    case 'REPOS':
    case 'RTT':
    case 'FERIE':
    case 'FÉRIÉ':
    case 'CFA':
    case 'CONGES':
    case 'CONGÉS':
      return 0;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CALENDRIER
// ---------------------------------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKeyOf = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * Jours fériés nationaux français d'une année (fixes + Pâques, Ascension, Pentecôte).
 * Clé : "AAAA-MM-JJ".
 */
export function getFrenchPublicHolidays(year: number): Record<string, string> {
  // Algorithme de Meeus/Jones/Butcher pour la date de Pâques (calendrier grégorien)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  const easter = new Date(Date.UTC(year, month - 1, day));
  const plus = (n: number) => {
    const t = new Date(easter.getTime() + n * 86400000);
    return dateKeyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  };

  return {
    [dateKeyOf(year, 1, 1)]: "Jour de l'An",
    [plus(1)]: 'Lundi de Pâques',
    [dateKeyOf(year, 5, 1)]: 'Fête du Travail',
    [dateKeyOf(year, 5, 8)]: 'Victoire 1945',
    [plus(39)]: 'Ascension',
    [plus(50)]: 'Lundi de Pentecôte',
    [dateKeyOf(year, 7, 14)]: 'Fête Nationale',
    [dateKeyOf(year, 8, 15)]: 'Assomption',
    [dateKeyOf(year, 11, 1)]: 'Toussaint',
    [dateKeyOf(year, 11, 11)]: 'Armistice 1918',
    [dateKeyOf(year, 12, 25)]: 'Noël',
  };
}

/** Toutes les dates "AAAA-MM-JJ" d'un mois "AAAA-MM" (gère 28/29/30/31 jours). */
export function getMonthDateKeys(monthKey: string): string[] {
  const [yStr, mStr] = monthKey.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!y || !m || m < 1 || m > 12) return [];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const keys: string[] = [];
  for (let d = 1; d <= days; d++) keys.push(dateKeyOf(y, m, d));
  return keys;
}

/** 0 = dimanche … 6 = samedi, calculé en UTC (indépendant du fuseau). */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(dateKey: string): boolean {
  const w = weekdayOf(dateKey);
  return w === 0 || w === 6;
}

export function isPublicHoliday(dateKey: string): boolean {
  const year = parseInt(dateKey.slice(0, 4), 10);
  return Boolean(getFrenchPublicHolidays(year)[dateKey]);
}

/** Jour ouvré = lundi-vendredi qui n'est pas un jour férié. */
export function isOpenWeekday(dateKey: string): boolean {
  return !isWeekend(dateKey) && !isPublicHoliday(dateKey);
}

// ---------------------------------------------------------------------------
// GÉNÉRATION D'UNE JOURNÉE PAR DÉFAUT
//   1. jour férié  -> FERIE (prioritaire, même un week-end)
//   2. samedi/dimanche -> REPOS
//   3. sinon -> BASE
// ---------------------------------------------------------------------------
export function getDefaultShiftCodeForDate(dateKey: string): CoreShiftCode {
  if (isPublicHoliday(dateKey)) return 'FERIE';
  if (isWeekend(dateKey)) return 'REPOS';
  return 'BASE';
}

export interface GeneratedDay {
  shift: string;
  hours: string;
  info: string;
}

export function generateDefaultDay(dateKey: string): GeneratedDay {
  return { shift: getDefaultShiftCodeForDate(dateKey), hours: '', info: '' };
}

// ---------------------------------------------------------------------------
// EXERCICES (1er juin -> 31 mai)
// ---------------------------------------------------------------------------
/** Année de début de l'exercice qui contient le mois "AAAA-MM". */
export function getExerciseStartYear(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  return m >= 6 ? y : y - 1;
}

/** Les 12 clés de mois de l'exercice commençant le 1er juin de `startYear`. */
export function getExerciseMonthKeys(startYear: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((5 + i) % 12) + 1; // 6,7,...,12,1,...,5
    const year = month >= 6 ? startYear : startYear + 1;
    keys.push(`${year}-${pad2(month)}`);
  }
  return keys;
}

export function getCurrentExerciseStartYear(now: Date = new Date()): number {
  return getExerciseStartYear(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
}

const MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTH_TABS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

export interface MonthItemLite {
  key: string;
  tab: string;
  label: string;
}

export function buildMonthItem(monthKey: string): MonthItemLite {
  const [yStr, mStr] = monthKey.split('-');
  const m = parseInt(mStr, 10);
  return {
    key: monthKey,
    tab: `${MONTH_TABS[m - 1]} ${yStr.slice(2)}`,
    label: `${MONTH_LABELS[m - 1]} ${yStr}`,
  };
}

export function getExerciseMonthItems(startYear: number): MonthItemLite[] {
  return getExerciseMonthKeys(startYear).map(buildMonthItem);
}

// ---------------------------------------------------------------------------
// SOLDES INITIAUX PAR EXERCICE
// Les valeurs historiques (initialHoursBalance, paidLeaveTaken, rttTaken) décrivent
// l'exercice en cours à la mise en place de la règle ; elles ne doivent pas se
// reporter automatiquement sur les exercices suivants.
// ---------------------------------------------------------------------------
export const LEGACY_INITIALS_EXERCISE_YEAR = 2026;

export interface ExerciseInitials {
  hoursBalance: number;
  leaveTaken: number;
  rttTaken: number;
}

export function getExerciseInitials(
  employee: {
    initialHoursBalance?: number;
    paidLeaveTaken?: number;
    rttTaken?: number;
    exerciseInitials?: Record<string, { hoursBalance?: number; leaveTaken?: number; rttTaken?: number }>;
    initialsExerciseYear?: number;
  },
  exerciseStartYear: number
): ExerciseInitials {
  const byYear = employee.exerciseInitials?.[String(exerciseStartYear)];
  if (byYear) {
    return {
      hoursBalance: byYear.hoursBalance ?? 0,
      leaveTaken: byYear.leaveTaken ?? 0,
      rttTaken: byYear.rttTaken ?? 0,
    };
  }
  const legacyYear = employee.initialsExerciseYear ?? LEGACY_INITIALS_EXERCISE_YEAR;
  if (exerciseStartYear === legacyYear) {
    return {
      hoursBalance: employee.initialHoursBalance ?? 0,
      leaveTaken: employee.paidLeaveTaken ?? 0,
      rttTaken: employee.rttTaken ?? 0,
    };
  }
  return { hoursBalance: 0, leaveTaken: 0, rttTaken: 0 };
}
