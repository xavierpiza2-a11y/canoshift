import type { Employee, MonthItem, ShiftCategory, Tableau2ShiftOption, ShiftCategoryItem } from '../types/planning.ts';

export const DEFAULT_API_TOKEN = 'CANOSHIFT';

export const DEFAULT_ADMIN_PIN = '000000';

/**
 * Default categories for shifts
 */
export const DEFAULT_CATEGORIES: ShiftCategoryItem[] = [
  { id: 'cat_matin', name: 'MATIN', color: 'sky', icon: 'sun' },
  { id: 'cat_soir', name: 'SOIR', color: 'amber', icon: 'sunset' },
  { id: 'cat_journee', name: 'JOURNEE', color: 'emerald', icon: 'briefcase' },
  { id: 'cat_repos', name: 'REPOS', color: 'slate', icon: 'home' },
  { id: 'cat_conges', name: 'CONGES', color: 'orange', icon: 'palmtree' },
  { id: 'cat_rtt', name: 'RTT', color: 'teal', icon: 'sparkles' },
  { id: 'cat_ferie', name: 'FERIE', color: 'purple', icon: 'calendar' },
  { id: 'cat_at', name: 'AT', color: 'rose', icon: 'heart' },
  { id: 'cat_formation', name: 'FORMATION', color: 'purple', icon: 'graduation-cap' },
  { id: 'cat_horaire', name: 'HORAIRE', color: 'indigo', icon: 'clock' },
  { id: 'cat_autre', name: 'AUTRE', color: 'zinc', icon: 'tag' },
];

/**
 * Standard choices corresponding to Créneaux (Horaires possibles)
 */
export const DEFAULT_TABLEAU2_SHIFTS: Tableau2ShiftOption[] = [
  {
    id: 'repos',
    shift: 'REPOS',
    hours: '',
    category: 'REPOS',
    color: 'slate',
    label: 'REPOS',
    description: 'Jour de repos',
    hoursDecimal: 0,
    dayStatus: 'REPOS',
  },
  {
    id: 'conges',
    shift: 'CONGES',
    hours: '',
    category: 'CONGES',
    color: 'amber',
    label: 'CONGES',
    description: 'Congés payés',
    hoursDecimal: 0,
    dayStatus: 'ABSENT',
  },
  {
    id: 'rtt',
    shift: 'RTT',
    hours: '',
    category: 'RTT',
    color: 'teal',
    label: 'RTT',
    description: 'Réduction du temps de travail',
    hoursDecimal: 0,
    dayStatus: 'ABSENT',
  },
  {
    id: 'matin_830_1230',
    shift: 'MATIN',
    hours: '08:30-12:30',
    category: 'MATIN',
    color: 'sky',
    label: 'MATIN · 08:30-12:30 (4h)',
    description: 'Vacation matin standard (4h)',
    hoursDecimal: 4,
    dayStatus: 'PRESENT',
  },
  {
    id: 'matin_830_1330',
    shift: 'MATIN',
    hours: '08:30-13:30',
    category: 'MATIN',
    color: 'sky',
    label: 'MATIN · 08:30-13:30 (5h)',
    description: 'Vacation matin longue (5h)',
    hoursDecimal: 5,
    dayStatus: 'PRESENT',
  },
  {
    id: 'matin_900_1300',
    shift: 'MATIN',
    hours: '09:00-13:00',
    category: 'MATIN',
    color: 'sky',
    label: 'MATIN · 09:00-13:00 (4h)',
    description: 'Vacation matin décalée (4h)',
    hoursDecimal: 4,
    dayStatus: 'PRESENT',
  },
  {
    id: 'soir_1400_1900',
    shift: 'SOIR',
    hours: '14:00-19:00',
    category: 'SOIR',
    color: 'orange',
    label: 'SOIR · 14:00-19:00 (5h)',
    description: 'Fermeture magasin standard (5h)',
    hoursDecimal: 5,
    dayStatus: 'PRESENT',
  },
  {
    id: 'soir_1430_1900',
    shift: 'SOIR',
    hours: '14:30-19:00',
    category: 'SOIR',
    color: 'orange',
    label: 'SOIR · 14:30-19:00 (4h30)',
    description: 'Fermeture magasin courte (4h30)',
    hoursDecimal: 4.5,
    dayStatus: 'PRESENT',
  },
  {
    id: 'soir_1400_1930',
    shift: 'SOIR',
    hours: '14:00-19:30',
    category: 'SOIR',
    color: 'orange',
    label: 'SOIR · 14:00-19:30 (5h30)',
    description: 'Fermeture magasin tardive (5h30)',
    hoursDecimal: 5.5,
    dayStatus: 'PRESENT',
  },
  {
    id: 'journee_830_1800',
    shift: 'JOURNEE',
    hours: '08:30-12:30 , 14:00-18:00',
    category: 'JOURNEE',
    color: 'emerald',
    label: 'JOURNÉE · 08:30-12:30 , 14:00-18:00 (8h)',
    description: 'Journée complète 8h',
    hoursDecimal: 8,
    dayStatus: 'PRESENT',
  },
  {
    id: 'journee_900_1900',
    shift: 'JOURNEE',
    hours: '09:00-12:30 , 14:00-19:00',
    category: 'JOURNEE',
    color: 'emerald',
    label: 'JOURNÉE · 09:00-12:30 , 14:00-19:00 (7h30)',
    description: 'Journée complète avec fermeture 7h30',
    hoursDecimal: 7.5,
    dayStatus: 'PRESENT',
  },
  {
    id: 'journee_900_1430_1900',
    shift: 'JOURNEE',
    hours: '09:00-12:30 , 14:30-19:00',
    category: 'JOURNEE',
    color: 'emerald',
    label: 'JOURNÉE · 09:00-12:30 , 14:30-19:00 (7h)',
    description: 'Journée complète standard 7h',
    hoursDecimal: 7,
    dayStatus: 'PRESENT',
  },
  {
    id: 'journee_1000_1430_1900',
    shift: 'JOURNEE',
    hours: '10:00-12:30 , 14:30-19:00',
    category: 'JOURNEE',
    color: 'emerald',
    label: 'JOURNÉE · 10:00-12:30 , 14:30-19:00 (7h)',
    description: 'Journée décalée 7h',
    hoursDecimal: 7,
    dayStatus: 'PRESENT',
  },
  {
    id: 'formation',
    shift: 'FORMATION',
    hours: '09:00-12:30 , 13:30-17:00',
    category: 'FORMATION',
    color: 'purple',
    label: 'FORMATION · 09:00-12:30 , 13:30-17:00 (7h)',
    description: 'Journée de formation / réunion (7h)',
    hoursDecimal: 7,
    dayStatus: 'PRESENT',
  },
  {
    id: 'ferie',
    shift: 'FERIE',
    hours: '',
    category: 'FERIE',
    color: 'purple',
    label: 'FÉRIÉ',
    description: 'Jour férié chômé (-7h à faire sur le mois / -1j forfait)',
    hoursDecimal: 0,
    dayStatus: 'REPOS',
  },
  {
    id: 'maladie',
    shift: 'AT',
    hours: '',
    category: 'AT',
    color: 'rose',
    label: 'ARRÊT MALADIE / AT',
    description: 'Arrêt de travail (comptabilisé 7h en annualisé ou 1j en forfait jour)',
    hoursDecimal: 7,
    dayStatus: 'ABSENT',
  },
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

export const DEFAULT_ALL_MONTHS: MonthItem[] = [
  { key: '2026-06', tab: 'JUIN 26', label: 'Juin 2026' },
  { key: '2026-07', tab: 'JUILLET 26', label: 'Juillet 2026' },
  { key: '2026-08', tab: 'AOUT 26', label: 'Août 2026' },
  { key: '2026-09', tab: 'SEPTEMBRE 26', label: 'Septembre 2026' },
  { key: '2026-10', tab: 'OCTOBRE 26', label: 'Octobre 2026' },
  { key: '2026-11', tab: 'NOVEMBRE 26', label: 'Novembre 2026' },
  { key: '2026-12', tab: 'DECEMBRE 26', label: 'Décembre 2026' },
  { key: '2027-01', tab: 'JANVIER 27', label: 'Janvier 2027' },
  { key: '2027-02', tab: 'FEVRIER 27', label: 'Février 2027' },
  { key: '2027-03', tab: 'MARS 27', label: 'Mars 2027' },
  { key: '2027-04', tab: 'AVRIL 27', label: 'Avril 2027' },
  { key: '2027-05', tab: 'MAI 27', label: 'Mai 2027' },
];

export const DEFAULT_VISIBLE_MONTHS = ['2026-09', '2026-10'];

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

  if (s === 'RTT' || s === 'RECUP' || s === 'REL' || s === 'CFA') {
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
