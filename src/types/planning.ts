export type ContractType = 'HEBDO_35H' | 'ANNUALISE' | 'FORFAIT_JOUR';

export interface Employee {
  name: string;
  color: string;
  pin?: string;
  role?: string;
  isAdmin?: boolean;
  contractType?: ContractType; // 'HEBDO_35H' | 'ANNUALISE' | 'FORFAIT_JOUR'
  weeklyHoursQuota?: number; // Quota hebdomadaire pour les 35h (défaut: 35)
  yearlyHoursQuota?: number; // Quota annuel pour les annualisés (défaut: 1607)
  forfaitDaysQuota?: number; // Quota annuel de jours pour forfait jour (défaut: 218)
  exerciseInitials?: Record<string, { hoursBalance?: number; leaveTaken?: number; rttTaken?: number }>; // Soldes initiaux PAR exercice (clé = année de début, ex. "2027")
  initialsExerciseYear?: number; // Exercice auquel s'appliquent les valeurs historiques ci-dessous
  initialHoursBalance?: number; // Report d'heures N-1 au 1er juin (ex: +4h ou -2h, défaut: 0)
  paidLeaveTotal?: number; // Total de congés payés acquis sur l'exercice (défaut: 25)
  paidLeaveTaken?: number; // Congés payés déjà pris initialement au 1er juin (défaut: 0)
  rttTotal?: number; // Total RTT acquis (défaut: 0 ou 10)
  rttTaken?: number; // RTT déjà pris initialement (défaut: 0)
}

export interface ShiftCategoryItem {
  id: string;
  name: string;
  color?: string; // e.g. 'sky', 'amber', 'emerald', 'slate', 'orange', 'teal', 'purple', 'rose', 'indigo'
  icon?: string; // e.g. 'sun', 'sunset', 'briefcase', 'home', 'palmtree', 'sparkles', 'graduation-cap', 'clock', 'coffee', 'shield', 'zap', 'tag'
  badgeBg?: string;
  badgeText?: string;
  badgeBorder?: string;
  locked?: boolean; // Catégorie de base : non modifiable, non supprimable
}

export type ShiftCategory =
  | 'BASE'
  | 'CFA'
  | 'MATIN'
  | 'SOIR'
  | 'JOURNEE'
  | 'HORAIRE'
  | 'REPOS'
  | 'CONGES'
  | 'RTT'
  | 'FORMATION'
  | 'FERIE'
  | 'AT'
  | 'AUTRE'
  | (string & {});

export interface DayShift {
  shift: string;
  hours?: string;
  info?: string;
}

export type DayNotesMap = Record<string, string>;

export interface EmployeeMonthSchedule {
  employee: string;
  month: string; // "YYYY-MM"
  days: Record<string, DayShift>; // key is "YYYY-MM-DD"
  totalHours?: number;
  visibleMonths?: string[];
  employees?: Employee[];
  lastUpdate?: string;
  generated?: string;
  dayNotes?: Record<string, string>;
}

export interface MonthItem {
  key: string; // "2026-09"
  tab: string; // "SEPTEMBRE 26"
  label: string; // "Septembre 2026"
  customWorkingDays?: number; // Surcharge manuelle du nombre de jours ouvrés (par défaut calcul auto sur lun-ven hors fériés)
  customBaseHours?: number; // Surcharge manuelle des heures de base du mois
}

export interface ConfigData {
  storeName?: string;
  apiToken?: string;
  adminPin?: string;
  employees: Employee[];
  visibleMonths: string[];
  allMonths: MonthItem[];
  lastModified?: string;
}

export interface ChangeEntry {
  id?: string;
  date: string;
  previousShift?: string;
  newShift?: string;
  previousHours?: string;
  newHours?: string;
  timestamp?: string;
  comment?: string;
}

export interface HistoryEntry {
  id?: string;
  date: string;
  employee: string;
  change: string;
  timestamp: string;
}

export interface Tableau2ShiftOption {
  id: string;
  shift: string;
  hours: string;
  category: string;
  color?: string; // color ID e.g. 'emerald', 'sky', 'black', 'dark-gray', etc.
  label: string;
  description?: string;
  hoursDecimal?: number;
  dayStatus?: 'PRESENT' | 'REPOS' | 'ABSENT'; // Status in Team Day view: Présent, Repos, Absent
  locked?: boolean; // Créneau de base : non modifiable, non supprimable
}

