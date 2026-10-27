import { getExerciseMonthItems, getCurrentExerciseStartYear } from '../shared/planning';
import type { Employee, MonthItem, ShiftCategory, Tableau2ShiftOption, ShiftCategoryItem } from '../types/planning.ts';

export const DEFAULT_API_TOKEN = 'CANOSHIFT';

export const DEFAULT_ADMIN_PIN = '000000';

/**
 * Default categories for shifts
 */
// Les 6 catégories de base : verrouillées (non modifiables / non supprimables).
// Des catégories personnalisées peuvent être créées en plus par l'administrateur.
export const DEFAULT_CATEGORIES: ShiftCategoryItem[] = [
  { id: 'cat_base', name: 'BASE', color: 'emerald', icon: 'briefcase', locked: true },
  { id: 'cat_repos', name: 'REPOS', color: 'slate', icon: 'home', locked: true },
  { id: 'cat_rtt', name: 'RTT', color: 'teal', icon: 'sparkles', locked: true },
  { id: 'cat_ferie', name: 'FERIE', color: 'purple', icon: 'calendar', locked: true },
  { id: 'cat_cfa', name: 'CFA', color: 'indigo', icon: 'graduation-cap', locked: true },
  { id: 'cat_conges', name: 'CONGES', color: 'orange', icon: 'palmtree', locked: true },
];

export const DEFAULT_TABLEAU2_SHIFTS: Tableau2ShiftOption[] = [
  { id: 'base', shift: 'BASE', hours: '', category: 'BASE', color: 'emerald', label: 'BASE', description: 'Journée de base (7 h)', hoursDecimal: 7, dayStatus: 'PRESENT', locked: true },
  { id: 'repos', shift: 'REPOS', hours: '', category: 'REPOS', color: 'slate', label: 'REPOS', description: 'Jour de repos', hoursDecimal: 0, dayStatus: 'REPOS', locked: true },
  { id: 'rtt', shift: 'RTT', hours: '', category: 'RTT', color: 'teal', label: 'RTT', description: 'Réduction du temps de travail', hoursDecimal: 0, dayStatus: 'ABSENT', locked: true },
  { id: 'ferie', shift: 'FERIE', hours: '', category: 'FERIE', color: 'purple', label: 'FERIE', description: 'Jour férié', hoursDecimal: 0, dayStatus: 'REPOS', locked: true },
  { id: 'cfa', shift: 'CFA', hours: '', category: 'CFA', color: 'indigo', label: 'CFA', description: 'Journée au CFA', hoursDecimal: 0, dayStatus: 'ABSENT', locked: true },
  { id: 'conges', shift: 'CONGES', hours: '', category: 'CONGES', color: 'orange', label: 'CONGES', description: 'Congés payés', hoursDecimal: 0, dayStatus: 'ABSENT', locked: true },
];

export const DEFAULT_STORE_NAME = 'CanoShift';

export const DEFAULT_EMPLOYEES: Employee[] = [
  {
    name: 'Responsable',
    color: '#1a6b2a',
    role: 'Responsable',
    isAdmin: true,
    contractType: 'HEBDO_35H',
    weeklyHoursQuota: 35,
    yearlyHoursQuota: 1607,
    initialHoursBalance: 0,
    paidLeaveTotal: 25,
    paidLeaveTaken: 0,
    rttTotal: 0,
    rttTaken: 0,
  },
];

// Exercice courant (1er juin -> 31 mai), calculé à partir de la date : aucun changement de code d'une année à l'autre.
export const DEFAULT_ALL_MONTHS: MonthItem[] = getExerciseMonthItems(getCurrentExerciseStartYear());

// Les 12 mois de l'exercice sont visibles par défaut.
export const DEFAULT_VISIBLE_MONTHS: string[] = DEFAULT_ALL_MONTHS.map((m) => m.key);

/**
 * Categorize a shift code & hours into styling & semantic group
 */
export function categorizeShift(shiftText: string, hoursText?: string): ShiftCategory {
  const s = (shiftText || '').trim().toUpperCase();
  const h = (hoursText || '').toLowerCase();

  if (s === 'FERIE' || s === 'FÉRIÉ' || s === 'FERIE_CHOME') {
    return 'FERIE';
  }

  if (
    s === 'AT' ||
    /\bAT\b/i.test(s) ||
    s.includes('MALADIE') ||
    s.includes('ACCIDENT') ||
    s.includes('ARRÊT') ||
    s.includes('ARRET')
  ) {
    return 'AT';
  }

  if (s === 'BASE') {
    return 'BASE';
  }

  // CFA est une catégorie distincte de RTT (0 h travaillée, mais -7 h sur l'objectif mensuel)
  if (s === 'CFA') {
    return 'CFA';
  }

  if (s === 'REPOS') {
    return 'REPOS';
  }

  if (
    s === 'CONGES' ||
    s === 'CONGESMAT' ||
    s === 'CONGESPAT' ||
    s === 'CP' ||
    s === 'ABSENCE'
  ) {
    return 'CONGES';
  }

  if (s === 'RTT' || s === 'RECUP' || s === 'REL') {
    return 'RTT';
  }

  if (s === 'FORMATION' || s === 'REUNION') {
    return 'FORMATION';
  }

  if (s === 'MATIN') {
    return 'MATIN';
  }

  if (s === 'SOIR') {
    return 'SOIR';
  }

  if (s === 'JOURNEE' || s === 'JOURNÉE') {
    return 'JOURNEE';
  }

  // If shift is HORAIRE or contains hours in s or h:
  if (h) {
    // Check if ending time is late (soir) or early (matin) or double vacation (journée)
    // E.g. 9h/12h30--14h/19h is double vacation / journée or specific lin
    if (h.includes('--') || h.includes(' - ') || (h.includes('14h') && h.includes('19h'))) {
      if (h.includes('10h/12h30') || h.includes('10h-12h30')) {
        return 'HORAIRE'; // Plage type 10h/12h30 - 14h30/19h teinte lin très clair
      }
      return 'JOURNEE';
    }
    if (h.includes('18h') || h.includes('19h') || h.includes('19h30') || h.includes('20h')) {
      return 'SOIR';
    }
    if (h.includes('12h30') || h.includes('13h') || h.includes('14h30') || h.includes('15h30')) {
      return 'MATIN';
    }
  }

  return 'HORAIRE';
}

/**
 * Format raw hours string without altering characters
 */
export function formatHoursReadable(hours?: string): string {
  if (!hours) return '';
  return hours.trim();
}
