import {
  coreShiftHours,
  getFrenchPublicHolidays as sharedGetFrenchPublicHolidays,
  getExerciseInitials,
  getExerciseStartYear,
  isOpenWeekday,
} from '../shared/planning';
import { Employee, EmployeeMonthSchedule, Tableau2ShiftOption, ContractType, MonthItem } from '../types/planning';
import { categorizeShift } from '../config/constants';

export interface AnnualExerciseInfo {
  yearStart: number;
  yearEnd: number;
  label: string;
  key: string;
  months: string[]; // 12 month keys from "YYYY-06" to "YYYY+1-05"
  selectedMonthIndex: number; // 0 to 11
  elapsedMonths: number; // 1 to 12
}

/**
 * Jours fériés nationaux français (fixes + Pâques, Ascension, Pentecôte).
 * Implémentation partagée avec le serveur : src/shared/planning.ts
 */
export const getFrenchPublicHolidays = sharedGetFrenchPublicHolidays;

/**
 * Returns annual exercise info based on the 1er Juin (N) ➔ 31 Mai (N+1) cycle.
 */
export function getAnnualExercise(targetDateOrMonth?: string | Date): AnnualExerciseInfo {
  let year: number;
  let month: number; // 1 to 12

  if (!targetDateOrMonth) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  } else if (typeof targetDateOrMonth === 'string') {
    const parts = targetDateOrMonth.split('-');
    year = parseInt(parts[0], 10) || 2026;
    month = parseInt(parts[1], 10) || 6;
  } else {
    year = targetDateOrMonth.getFullYear();
    month = targetDateOrMonth.getMonth() + 1;
  }

  // If month is June..December (6..12), exercise started June of this year
  // If month is January..May (1..5), exercise started June of previous year
  const yearStart = month >= 6 ? year : year - 1;
  const yearEnd = yearStart + 1;

  const months: string[] = [];
  // June to December of yearStart
  for (let m = 6; m <= 12; m++) {
    months.push(`${yearStart}-${String(m).padStart(2, '0')}`);
  }
  // January to May of yearEnd
  for (let m = 1; m <= 5; m++) {
    months.push(`${yearEnd}-${String(m).padStart(2, '0')}`);
  }

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
  const selectedMonthIndex = months.indexOf(currentMonthKey);
  const elapsedMonths = selectedMonthIndex >= 0 ? selectedMonthIndex + 1 : 1;

  return {
    yearStart,
    yearEnd,
    label: `1er Juin ${yearStart} – 31 Mai ${yearEnd}`,
    key: `${yearStart}-${yearEnd}`,
    months,
    selectedMonthIndex: selectedMonthIndex >= 0 ? selectedMonthIndex : 0,
    elapsedMonths,
  };
}

/**
 * Analyzes the working calendar for a given month (Monday to Friday, automatic weekend rest).
 * Correctly accounts for French public holidays on weekdays and any custom "FERIE" shifts.
 * Supports manual customization/override from month settings (customWorkingDays, customBaseHours).
 * Example: January 2027 has 21 weekdays (Mon-Fri) minus 1 holiday (Jan 1) = 20 net working days = 140h.
 */
export function getMonthWorkingCalendar(
  monthKey: string,
  employeeDays?: Record<string, { shift: string; hours?: string }>,
  customMonthItem?: MonthItem | null
): {
  weekdaysCount: number;
  ferieCount: number;
  netWorkingDays: number;
  standardBaseHours: number;
  holidaysList: Array<{ dateKey: string; name: string }>;
  isCustomized: boolean;
} {
  const [yStr, mStr] = monthKey.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const publicHolidays = getFrenchPublicHolidays(year);

  let weekdaysCount = 0;
  let ferieCount = 0;
  const holidaysList: Array<{ dateKey: string; name: string }> = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isWeekday) {
      weekdaysCount++;
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // Check if official public holiday
      const holidayName = publicHolidays[dateKey];

      // Check if user has explicitly assigned a "FERIE" shift
      const dayData = employeeDays ? employeeDays[dateKey] : undefined;
      const isShiftFerie =
        dayData &&
        (categorizeShift(dayData.shift, dayData.hours) === 'FERIE' ||
          /^(ferie|férié)/i.test((dayData.shift || '').trim()));

      if (holidayName || isShiftFerie) {
        ferieCount++;
        holidaysList.push({
          dateKey,
          name: holidayName || 'Jour Férié',
        });
      }
    }
  }

  // Automatic calculation based on open working days (Mon-Fri minus holidays)
  let netWorkingDays = Math.max(0, weekdaysCount - ferieCount);
  let standardBaseHours = netWorkingDays * 7;
  let isCustomized = false;

  // If month settings override working days or base hours
  if (customMonthItem) {
    if (typeof customMonthItem.customWorkingDays === 'number' && customMonthItem.customWorkingDays >= 0) {
      netWorkingDays = customMonthItem.customWorkingDays;
      standardBaseHours = netWorkingDays * 7;
      isCustomized = true;
    }
    if (typeof customMonthItem.customBaseHours === 'number' && customMonthItem.customBaseHours >= 0) {
      standardBaseHours = customMonthItem.customBaseHours;
      isCustomized = true;
    }
  }

  return {
    weekdaysCount,
    ferieCount,
    netWorkingDays,
    standardBaseHours,
    holidaysList,
    isCustomized,
  };
}

/**
 * Parses worked hours from shift text and hours string.
 * - Repos, Congés/CP, RTT, Férié = 0h ("ne doivent pas être valorisé", férié est chômé et ajuste la base)
 * - AT (Arrêt de travail) = 7h pour les régimes horaires (annualisé et 35h)
 */
export function parseWorkedHours(
  shiftText: string,
  hoursText?: string,
  _contractType?: ContractType
): number {
  if (!shiftText && !hoursText) return 0;
  // Catégories de base : BASE = 7 h, REPOS/RTT/FERIE/CFA/CONGES = 0 h (règle commune client/serveur)
  const coreHours = coreShiftHours(shiftText);
  if (coreHours !== null) return coreHours;
  const cat = categorizeShift(shiftText, hoursText);
  const sUpper = (shiftText || '').trim().toUpperCase();

  // 1. Non-worked non-valorised shifts
  if (
    cat === 'REPOS' ||
    cat === 'CONGES' ||
    cat === 'RTT' ||
    cat === 'FERIE' ||
    sUpper === 'REPOS' ||
    sUpper === 'CONGES' ||
    sUpper === 'CP' ||
    sUpper === 'RTT' ||
    sUpper === 'FERIE' ||
    sUpper === 'FÉRIÉ'
  ) {
    return 0;
  }

  // 2. AT / Arrêt de travail : 7h sur l'annualisation et régimes horaires
  if (
    cat === 'AT' ||
    sUpper === 'AT' ||
    /\bAT\b/i.test(sUpper) ||
    sUpper.includes('MALADIE') ||
    sUpper.includes('ACCIDENT')
  ) {
    return 7;
  }

  const hStr = (hoursText || '').trim();

  // 3. Direct single numeric value like "7", "7h", "7.5", "7,5", "8h"
  const singleNumMatch = hStr.match(/^(\d+(?:[.,]\d+)?)\s*h?$/i);
  if (singleNumMatch) {
    const val = parseFloat(singleNumMatch[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val <= 16) return val;
  }

  // 4. Direct format like "7h30" or "8h15"
  const singleHoursMinsMatch = hStr.match(/^(\d{1,2})\s*h\s*(\d{2})$/i);
  if (singleHoursMinsMatch) {
    const h = parseInt(singleHoursMinsMatch[1], 10);
    const m = parseInt(singleHoursMinsMatch[2], 10);
    return Math.round((h + m / 60) * 100) / 100;
  }

  // 5. Time ranges like "9h-12h30 14h-19h" or "8h30/12h30 - 14h/18h"
  const rangeRegex = /(\d{1,2})(?:[h:](\d{2}))?\s*(?:[-/–—]|à)\s*(\d{1,2})(?:[h:](\d{2}))?/gi;
  let totalRangeHours = 0;
  let matchesFound = 0;
  let match: RegExpExecArray | null;

  while ((match = rangeRegex.exec(hStr)) !== null) {
    matchesFound++;
    const startH = parseInt(match[1], 10);
    const startM = match[2] ? parseInt(match[2], 10) : 0;
    const endH = parseInt(match[3], 10);
    const endM = match[4] ? parseInt(match[4], 10) : 0;

    const startDec = startH + startM / 60;
    let endDec = endH + endM / 60;
    if (endDec < startDec) endDec += 24;
    const diff = endDec - startDec;
    if (diff > 0 && diff <= 16) {
      totalRangeHours += diff;
    }
  }

  if (matchesFound > 0 && totalRangeHours > 0) {
    return Math.round(totalRangeHours * 100) / 100;
  }

  // Fallback based on category
  switch (cat) {
    case 'AT':
      return 7;
    case 'MATIN':
      return 7;
    case 'SOIR':
      return 7;
    case 'JOURNEE':
      return 7.5;
    case 'FORMATION':
      return 7;
    default:
      return 0;
  }
}

/**
 * Returns ISO week number for a given date string or Date object.
 */
export function getISOWeekNumber(dateInput: string | Date): number {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : new Date(dateInput.getTime());
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Returns all 7 dates (Monday to Sunday) of the week containing dateStr.
 */
export function getWeekDates(dateStr: string): {
  weekNumber: number;
  monday: string;
  sunday: string;
  dateKeys: string[];
  label: string;
} {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const date = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10));

  const dayOfWeek = date.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const mondayDate = new Date(date);
  mondayDate.setDate(date.getDate() + diffToMonday);

  const dateKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mondayDate);
    cur.setDate(mondayDate.getDate() + i);
    const curKey = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    dateKeys.push(curKey);
  }

  const weekNumber = getISOWeekNumber(date);
  const monday = dateKeys[0];
  const sunday = dateKeys[6];

  return {
    weekNumber,
    monday,
    sunday,
    dateKeys,
    label: `Semaine ${weekNumber} (${monday.slice(8)}/${monday.slice(5, 7)} - ${sunday.slice(8)}/${sunday.slice(5, 7)})`,
  };
}

/**
 * Comprehensive balances & gap data for an employee
 */
export interface EmployeeBalances {
  employeeName: string;
  contractType: 'HEBDO_35H' | 'ANNUALISE' | 'FORFAIT_JOUR';
  contractLabel: string;
  weeklyQuota: number;
  yearlyQuota: number;
  forfaitDaysQuota: number;
  initialHoursBalance: number;

  // Selected Month
  selectedMonth: string;
  monthHours: number;
  monthWorkingDays: number;
  monthFerieDays: number;
  monthCpDays: number;
  monthCfaDays: number; // Jours CFA ouvrés du mois (déduits de l'objectif)
  expectedMonthHours: number; // For Annualisé: (weekdays - feries - cp) * 7h; for 35h: (weeklyQuota * 52 / 12) - (ferie * 7)
  monthBalance: number; // >0: credit (due by employer), <0: debit (due by employee), 0 for forfait jour
  monthWorkedDays: number; // For forfait jour

  // Target Week (if date provided)
  targetDate?: string;
  weekNumber?: number;
  weekLabel?: string;
  weekHours?: number;
  weekQuota?: number;
  weekBalance?: number;

  // Annual Exercise (1er Juin - 31 Mai)
  exercise: AnnualExerciseInfo;
  exerciseHours: number; // Realized hours so far in exercise + initialHoursBalance
  expectedExerciseHoursAtDate: number; // Theoretical trajectory at this month
  exerciseBalance: number; // Realized - Expected at date (>0: credit, <0: debit)
  projectedExerciseEndHours: number; // Projected total at May 31
  projectedExerciseEndBalance: number; // Projected end balance (>0: credit, <0: debit)
  exerciseCompletionPercent: number;

  // Forfait Jour specific metrics
  exerciseWorkedDays: number; // Realized days so far in exercise (presence + AT)
  forfaitDaysRemaining: number; // forfaitDaysQuota - exerciseWorkedDays

  // Leave & RTT Counters (Exercise 1er Juin - 31 Mai)
  paidLeaveTotal: number;
  paidLeaveTaken: number;
  paidLeaveRemaining: number;
  rttTotal: number;
  rttTaken: number;
  rttRemaining: number;

  // Helper status flags
  isCreditMonth: boolean;
  isDebitMonth: boolean;
  isCreditExercise: boolean;
  isDebitExercise: boolean;
  debtSummaryText: string;
  hasAnnualHoursCounter: boolean;
}

/**
 * Retrieves a schedule for an employee from memory, localStorage cache or fallback.
 */
function getScheduleFromCache(employeeName: string, monthKey: string): EmployeeMonthSchedule | null {
  if (typeof window === 'undefined') return null;
  const lower = employeeName.toLowerCase();

  // Try direct individual cache - check all key variants
  const possibleIndivKeys = [
    `planning_sched_${employeeName}_${monthKey}`,
    `planning_cached_sched_${employeeName}_${monthKey}`,
    `planning_sched_${lower}_${monthKey}`,
    `planning_cached_sched_${lower}_${monthKey}`,
  ];
  for (const k of possibleIndivKeys) {
    try {
      const rawIndiv = localStorage.getItem(k);
      if (rawIndiv) return JSON.parse(rawIndiv);
    } catch {
      // ignore
    }
  }

  // Try team cache - check all key variants
  const possibleTeamKeys = [
    `planning_team_${monthKey}`,
    `planning_cached_team_${monthKey}`,
  ];
  for (const tk of possibleTeamKeys) {
    try {
      const rawTeam = localStorage.getItem(tk);
      if (rawTeam) {
        const parsedTeam = JSON.parse(rawTeam);
        if (parsedTeam[employeeName]) return parsedTeam[employeeName];
        const found = Object.entries(parsedTeam).find(([k]) => k.toLowerCase() === lower);
        if (found) return found[1] as EmployeeMonthSchedule;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Calculates all live balances and indicators for a given employee.
 */
export function calculateEmployeeBalances(params: {
  employee: Employee;
  selectedMonth: string;
  targetDate?: string;
  currentSchedule?: EmployeeMonthSchedule | null;
  teamSchedules?: Record<string, EmployeeMonthSchedule>;
  allMonths?: MonthItem[];
}): EmployeeBalances {
  const { employee, selectedMonth, targetDate, currentSchedule, teamSchedules, allMonths } = params;
  const contractType = employee.contractType || 'HEBDO_35H';
  const weeklyQuota = employee.weeklyHoursQuota ?? 35;
  const yearlyQuota = employee.yearlyHoursQuota ?? 1607;
  const forfaitDaysQuota = employee.forfaitDaysQuota ?? 218;
  const exerciseInitials = getExerciseInitials(employee, getExerciseStartYear(selectedMonth));
  const initialHoursBalance = exerciseInitials.hoursBalance;

  // Resolve custom month configuration if present
  let resolvedAllMonths = allMonths;
  if (!resolvedAllMonths && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('planning_cached_config');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.allMonths) resolvedAllMonths = parsed.allMonths;
      }
    } catch {
      // ignore
    }
  }

  const currentMonthItem = resolvedAllMonths?.find((m) => m.key === selectedMonth) || null;

  const exercise = getAnnualExercise(selectedMonth);

  // 1. Resolve selected month schedule
  let effectiveMonthSched: EmployeeMonthSchedule | null = currentSchedule || null;
  if (!effectiveMonthSched && teamSchedules) {
    effectiveMonthSched =
      teamSchedules[employee.name] ||
      teamSchedules[employee.name.toLowerCase()] ||
      null;
  }
  if (!effectiveMonthSched) {
    effectiveMonthSched = getScheduleFromCache(employee.name, selectedMonth);
  }

  // Calendar info for the selected month (based on working days Mon-Fri minus holidays or custom override)
  const calInfo = getMonthWorkingCalendar(selectedMonth, effectiveMonthSched?.days, currentMonthItem);

  // Count month hours, CP taken in month, and worked days in month
  let monthHours = 0;
  let monthCpDays = 0;
  let monthCfaDays = 0;
  let monthWorkedDays = 0;

  if (effectiveMonthSched?.days) {
    Object.entries(effectiveMonthSched.days).forEach(([dKey, d]) => {
      const cat = categorizeShift(d.shift, d.hours);
      const sUp = (d.shift || '').trim().toUpperCase();

      // Check if CP
      if (cat === 'CONGES' || /^(conge|cp|ca)/i.test(sUp)) {
        monthCpDays++;
      }

      // CFA : 0 h travaillée mais déduit 7 h (1 jour) de l'objectif mensuel (jours ouvrés uniquement)
      if (cat === 'CFA' && isOpenWeekday(dKey)) {
        monthCfaDays++;
      }

      // Check if worked day for Forfait Jour (presence vacation or AT)
      if (
        cat === 'AT' ||
        sUp === 'AT' ||
        cat === 'MATIN' ||
        cat === 'SOIR' ||
        cat === 'JOURNEE' ||
        cat === 'HORAIRE' ||
        cat === 'BASE' ||
        cat === 'FORMATION'
      ) {
        monthWorkedDays++;
      }

      monthHours += parseWorkedHours(d.shift, d.hours, contractType);
    });
  } else if (effectiveMonthSched?.totalHours && effectiveMonthSched.totalHours > 0) {
    monthHours = effectiveMonthSched.totalHours;
  }
  monthHours = Math.round(monthHours * 10) / 10;

  // Expected month hours calculation
  // Monthly hour base is strictly based on open working days (Mon-Fri, Saturday/Sunday resting)
  // Minus public holidays and minus taken CP days.
  // 1 working day = (weeklyQuota / 5) hours (e.g. 35h / 5 = 7h/day)
  const dailyQuota = weeklyQuota > 0 ? weeklyQuota / 5 : 7;
  let expectedMonthHours = 0;

  if (contractType === 'ANNUALISE') {
    // Annualized employee:
    // Base is constructed on working days (Mon-Fri) minus Fériés minus CP taken.
    // E.g. Jan 2027: 21 weekdays - 1 férié = 20 days x 7h = 140h!
    const effectiveWorkingDays = Math.max(0, calInfo.netWorkingDays - monthCpDays - monthCfaDays);
    expectedMonthHours = Math.round(effectiveWorkingDays * dailyQuota * 10) / 10;
  } else if (contractType === 'HEBDO_35H') {
    // 35h / week standard:
    // Base is also calculated on open working days of the month (excluding Sat/Sun and Fériés)
    // minus any CP taken during the month.
    const effectiveWorkingDays = Math.max(0, calInfo.netWorkingDays - monthCpDays - monthCfaDays);
    expectedMonthHours = Math.round(effectiveWorkingDays * dailyQuota * 10) / 10;
  } else {
    // Forfait Jour
    expectedMonthHours = 0;
  }

  const monthBalance =
    contractType === 'FORFAIT_JOUR'
      ? 0
      : Math.round((monthHours - expectedMonthHours) * 10) / 10;

  // 2. Week calculation (if targetDate provided)
  let weekNumber: number | undefined;
  let weekLabel: string | undefined;
  let weekHours: number | undefined;
  let weekQuota: number | undefined;
  let weekBalance: number | undefined;

  if (targetDate) {
    const weekInfo = getWeekDates(targetDate);
    weekNumber = weekInfo.weekNumber;
    weekLabel = weekInfo.label;
    weekQuota = weeklyQuota;

    let wHours = 0;
    weekInfo.dateKeys.forEach((dKey) => {
      const dMonth = dKey.slice(0, 7);
      let schedForDay = dMonth === selectedMonth ? effectiveMonthSched : getScheduleFromCache(employee.name, dMonth);
      const dayData = schedForDay?.days ? schedForDay.days[dKey] : undefined;
      if (dayData) {
        wHours += parseWorkedHours(dayData.shift, dayData.hours, contractType);
      }
    });
    weekHours = Math.round(wHours * 10) / 10;
    weekBalance = contractType === 'FORFAIT_JOUR' ? 0 : Math.round((weekHours - weeklyQuota) * 10) / 10;
  }

  // 3. Annual Exercise calculation (1er Juin ➔ 31 Mai)
  let totalExerciseHours = initialHoursBalance;
  let leaveShiftsCount = 0;
  let rttShiftsCount = 0;
  let totalExerciseWorkedDays = 0;
  let expectedExerciseHoursToDate = 0;
  let futureProjectedHours = 0;

  exercise.months.forEach((mKey, idx) => {
    const isElapsedOrCurrent = idx <= exercise.selectedMonthIndex;
    const sched = mKey === selectedMonth ? effectiveMonthSched : getScheduleFromCache(employee.name, mKey);
    const mItem = resolvedAllMonths?.find((m) => m.key === mKey) || null;
    const mCal = getMonthWorkingCalendar(mKey, sched?.days, mItem);

    let mCP = 0;
    let mCFA = 0;
    let mHours = 0;

    if (sched?.days) {
      Object.entries(sched.days).forEach(([dKey, day]) => {
        const cat = categorizeShift(day.shift, day.hours);
        const sUp = (day.shift || '').trim().toUpperCase();

        if (cat === 'CONGES' || /^(conge|cp|ca)/i.test(sUp)) {
          leaveShiftsCount++;
          mCP++;
        } else if (cat === 'RTT' || /^rtt/i.test(sUp)) {
          rttShiftsCount++;
        }

        if (cat === 'CFA' && isOpenWeekday(dKey)) {
          mCFA++;
        }

        // Count worked days for Forfait Jour (presence vacation or AT)
        if (
          cat === 'AT' ||
          sUp === 'AT' ||
          cat === 'MATIN' ||
          cat === 'SOIR' ||
          cat === 'JOURNEE' ||
          cat === 'HORAIRE' ||
          cat === 'BASE' ||
          cat === 'FORMATION'
        ) {
          totalExerciseWorkedDays++;
        }

        mHours += parseWorkedHours(day.shift, day.hours, contractType);
      });
    } else if (sched?.totalHours && sched.totalHours > 0) {
      mHours = sched.totalHours;
    }

    if (isElapsedOrCurrent && contractType === 'ANNUALISE') {
      totalExerciseHours += mHours;
      // Expected theoretical hours for elapsed month based on working days minus CP
      const effDays = Math.max(0, mCal.netWorkingDays - mCP - mCFA);
      expectedExerciseHoursToDate += effDays * dailyQuota;
    } else if (contractType === 'ANNUALISE') {
      // Future months in exercise: if already entered in schedule, use mHours, otherwise use standard theoretical base
      if (mHours > 0) {
        futureProjectedHours += mHours;
      } else {
        futureProjectedHours += mCal.standardBaseHours;
      }
    }
  });

  const isAnnualised = contractType === 'ANNUALISE';
  const is35h = contractType === 'HEBDO_35H';

  const exerciseHours = isAnnualised ? Math.round(totalExerciseHours * 10) / 10 : 0;
  expectedExerciseHoursToDate = isAnnualised ? Math.round(expectedExerciseHoursToDate * 10) / 10 : 0;

  // Realized gap at date (only relevant for Annualisé)
  const exerciseBalance = isAnnualised
    ? Math.round((exerciseHours - expectedExerciseHoursToDate) * 10) / 10
    : 0;

  // Projected end of exercise (May 31):
  // Realized hours + future projected hours - remaining un-taken leave adjustment
  const paidLeaveTotal = employee.paidLeaveTotal ?? 25;
  const initialLeaveTaken = exerciseInitials.leaveTaken;
  const paidLeaveTaken = initialLeaveTaken + leaveShiftsCount;
  const paidLeaveRemaining = Math.max(0, paidLeaveTotal - paidLeaveTaken);

  // Future base adjustment: deduct remaining leave that will be taken before May 31
  const futureLeaveDeductionHours = paidLeaveRemaining * 7;
  const projectedExerciseEndHours = isAnnualised
    ? Math.round(
        Math.max(0, totalExerciseHours + Math.max(0, futureProjectedHours - futureLeaveDeductionHours)) * 10
      ) / 10
    : 0;

  const projectedExerciseEndBalance = isAnnualised
    ? Math.round((projectedExerciseEndHours - yearlyQuota) * 10) / 10
    : 0;

  const exerciseCompletionPercent =
    isAnnualised && yearlyQuota > 0 ? Math.min(100, Math.round((exerciseHours / yearlyQuota) * 100)) : 0;

  // Forfait Jour specific metrics
  const exerciseWorkedDays = totalExerciseWorkedDays;
  const forfaitDaysRemaining = Math.max(0, forfaitDaysQuota - exerciseWorkedDays);

  // Leave & RTT Counters
  const rttTotal =
    employee.rttTotal ?? (contractType === 'FORFAIT_JOUR' ? 10 : 0);
  const initialRttTaken = exerciseInitials.rttTaken;
  const rttTaken = initialRttTaken + rttShiftsCount;
  const rttRemaining = Math.max(0, rttTotal - rttTaken);

  // Contract label
  let contractLabel = '35h / semaine';
  if (contractType === 'ANNUALISE') contractLabel = `Annualisé (${yearlyQuota}h)`;
  else if (contractType === 'FORFAIT_JOUR') contractLabel = `Forfait Jour (${forfaitDaysQuota}j)`;

  // Summary debt text
  let debtSummaryText = 'À l’équilibre';
  if (isAnnualised) {
    if (exerciseBalance > 0) {
      debtSummaryText = `Vous lui devez ${Math.abs(exerciseBalance)}h (exercice)`;
    } else if (exerciseBalance < 0) {
      debtSummaryText = `Il vous doit ${Math.abs(exerciseBalance)}h (exercice)`;
    }
  } else if (is35h) {
    if (monthBalance > 0) {
      debtSummaryText = `+${monthBalance}h ce mois`;
    } else if (monthBalance < 0) {
      debtSummaryText = `${monthBalance}h ce mois`;
    } else {
      debtSummaryText = 'Mois équilibré';
    }
  } else {
    debtSummaryText = `${forfaitDaysRemaining}j à faire`;
  }

  return {
    employeeName: employee.name,
    contractType,
    contractLabel,
    weeklyQuota,
    yearlyQuota,
    forfaitDaysQuota,
    initialHoursBalance,

    selectedMonth,
    monthHours,
    monthWorkingDays: calInfo.netWorkingDays,
    monthFerieDays: calInfo.ferieCount,
    monthCpDays,
    monthCfaDays,
    expectedMonthHours,
    monthBalance,
    monthWorkedDays,

    targetDate,
    weekNumber,
    weekLabel,
    weekHours,
    weekQuota,
    weekBalance,

    exercise,
    exerciseHours,
    expectedExerciseHoursAtDate: expectedExerciseHoursToDate,
    exerciseBalance,
    projectedExerciseEndHours,
    projectedExerciseEndBalance,
    exerciseCompletionPercent,

    exerciseWorkedDays,
    forfaitDaysRemaining,

    paidLeaveTotal,
    paidLeaveTaken,
    paidLeaveRemaining,
    rttTotal,
    rttTaken,
    rttRemaining,

    isCreditMonth: monthBalance > 0,
    isDebitMonth: monthBalance < 0,
    isCreditExercise: exerciseBalance > 0,
    isDebitExercise: exerciseBalance < 0,
    debtSummaryText,
    hasAnnualHoursCounter: isAnnualised,
  };
}

/**
 * Simulates the live impact of changing a single shift on a given date.
 */
export function simulateShiftImpact(params: {
  currentBalances: EmployeeBalances;
  targetDate: string;
  currentShift: string;
  currentHours?: string;
  newOption: Tableau2ShiftOption;
}): {
  deltaHours: number;
  newMonthHours: number;
  newMonthBalance: number;
  newWeekBalance?: number;
  newExerciseHours: number;
  newExerciseBalance: number;
  newPaidLeaveRemaining: number;
  newRttRemaining: number;
  newForfaitDaysRemaining: number;
  summaryText: string;
  statusType: 'credit' | 'debit' | 'neutral';
} {
  const { currentBalances, currentShift, currentHours, newOption } = params;
  const isForfait = currentBalances.contractType === 'FORFAIT_JOUR';
  const isAnnualised = currentBalances.contractType === 'ANNUALISE';

  const oldHours = parseWorkedHours(currentShift, currentHours, currentBalances.contractType);
  const isAtOption =
    newOption.shift === 'AT' ||
    newOption.category === 'AT' ||
    /\bAT\b/i.test(newOption.shift) ||
    newOption.shift.toUpperCase().includes('MALADIE');

  const newHours = isAtOption
    ? (newOption.hoursDecimal && newOption.hoursDecimal > 0 ? newOption.hoursDecimal : 7)
    : (newOption.hoursDecimal !== undefined && newOption.hoursDecimal >= 0
        ? newOption.hoursDecimal
        : parseWorkedHours(newOption.shift, newOption.hours, currentBalances.contractType));

  const deltaHours = Math.round((newHours - oldHours) * 10) / 10;

  // Impact on Férié / Expected monthly base
  const wasOldFerie = categorizeShift(currentShift, currentHours) === 'FERIE';
  const isNewFerie = newOption.category === 'FERIE' || newOption.shift.toUpperCase() === 'FERIE';

  // Base adjustments if Férié added/removed
  let expectedBaseAdjustment = 0;
  if (!wasOldFerie && isNewFerie) expectedBaseAdjustment = -7;
  else if (wasOldFerie && !isNewFerie) expectedBaseAdjustment = +7;

  // CFA : -7 h sur l'objectif du mois (jours ouvrés uniquement)
  const cfaApplies = isOpenWeekday(params.targetDate);
  const wasOldCfa = cfaApplies && categorizeShift(currentShift, currentHours) === 'CFA';
  const isNewCfa = cfaApplies && (newOption.category === 'CFA' || newOption.shift.toUpperCase() === 'CFA');
  if (!wasOldCfa && isNewCfa) expectedBaseAdjustment -= 7;
  else if (wasOldCfa && !isNewCfa) expectedBaseAdjustment += 7;

  const newExpectedMonthHours = Math.max(0, currentBalances.expectedMonthHours + expectedBaseAdjustment);
  const newMonthHours = Math.round((currentBalances.monthHours + deltaHours) * 10) / 10;
  const newMonthBalance = isForfait
    ? 0
    : Math.round((newMonthHours - newExpectedMonthHours) * 10) / 10;

  let newWeekBalance: number | undefined;
  if (currentBalances.weekBalance !== undefined && !isForfait) {
    newWeekBalance = Math.round((currentBalances.weekBalance + deltaHours) * 10) / 10;
  }

  const newExerciseHours = isAnnualised
    ? Math.round((currentBalances.exerciseHours + deltaHours) * 10) / 10
    : 0;
  const newExerciseBalance = isAnnualised
    ? Math.round((currentBalances.exerciseBalance + deltaHours) * 10) / 10
    : 0;

  // Impact on leave
  const wasOldLeave = categorizeShift(currentShift, currentHours) === 'CONGES';
  const isNewLeave = newOption.category === 'CONGES' || newOption.shift.toUpperCase() === 'CONGES';
  let newPaidLeaveRemaining = currentBalances.paidLeaveRemaining;
  if (!wasOldLeave && isNewLeave) newPaidLeaveRemaining = Math.max(0, newPaidLeaveRemaining - 1);
  else if (wasOldLeave && !isNewLeave) newPaidLeaveRemaining += 1;

  // Impact on RTT
  const wasOldRtt = categorizeShift(currentShift, currentHours) === 'RTT';
  const isNewRtt = newOption.category === 'RTT' || newOption.shift.toUpperCase() === 'RTT';
  let newRttRemaining = currentBalances.rttRemaining;
  if (!wasOldRtt && isNewRtt) newRttRemaining = Math.max(0, newRttRemaining - 1);
  else if (wasOldRtt && !isNewRtt) newRttRemaining += 1;

  // Impact on Forfait Jour worked days
  const wasOldWorkedDay =
    categorizeShift(currentShift, currentHours) === 'AT' ||
    ['BASE', 'MATIN', 'SOIR', 'JOURNEE', 'HORAIRE', 'FORMATION'].includes(categorizeShift(currentShift, currentHours));
  const isNewWorkedDay =
    newOption.category === 'AT' ||
    newOption.shift.toUpperCase() === 'AT' ||
    ['BASE', 'MATIN', 'SOIR', 'JOURNEE', 'HORAIRE', 'FORMATION'].includes(newOption.category || '');

  let newForfaitDaysRemaining = currentBalances.forfaitDaysRemaining;
  if (isForfait) {
    if (!wasOldWorkedDay && isNewWorkedDay) newForfaitDaysRemaining = Math.max(0, newForfaitDaysRemaining - 1);
    else if (wasOldWorkedDay && !isNewWorkedDay) newForfaitDaysRemaining += 1;
  }

  let summaryText = '';
  let statusType: 'credit' | 'debit' | 'neutral' = 'neutral';

  if (isForfait) {
    if (!wasOldWorkedDay && isNewWorkedDay) {
      statusType = 'credit';
      summaryText = `+1 jour travaillé comptabilisé (reste ${newForfaitDaysRemaining}j à faire sur l'exercice)`;
    } else if (wasOldWorkedDay && !isNewWorkedDay) {
      statusType = 'debit';
      summaryText = `-1 jour travaillé (reste ${newForfaitDaysRemaining}j à faire sur l'exercice)`;
    } else if (isNewRtt) {
      statusType = 'neutral';
      summaryText = `RTT posé (reste ${newRttRemaining} RTT)`;
    } else if (isNewFerie) {
      statusType = 'neutral';
      summaryText = `Jour férié chômé (reste ${newForfaitDaysRemaining}j)`;
    } else {
      statusType = 'neutral';
      summaryText = `Reste ${newForfaitDaysRemaining}j à faire sur l'exercice`;
    }
  } else if (isAnnualised) {
    // Annualisé
    if (isNewFerie) {
      statusType = 'neutral';
      summaryText = `Jour Férié chômé (-7h sur la base à faire du mois)`;
    } else if (deltaHours > 0) {
      statusType = 'credit';
      summaryText = `+${deltaHours}h sur le planning (vous lui devrez ${Math.abs(newExerciseBalance)}h sur l'année)`;
    } else if (deltaHours < 0) {
      statusType = 'debit';
      summaryText = `${deltaHours}h sur le planning (${newExerciseBalance < 0 ? `il vous devra ${Math.abs(newExerciseBalance)}h sur l'année` : `solde restant dû : +${newExerciseBalance}h`})`;
    } else {
      statusType = 'neutral';
      summaryText = `Aucun changement d'heures (solde année : ${newExerciseBalance > 0 ? `+${newExerciseBalance}h` : `${newExerciseBalance}h`})`;
    }
  } else {
    // 35h: Semaine et mois uniquement, pas de cumul annuel d'heures
    if (isNewFerie) {
      statusType = 'neutral';
      summaryText = `Jour Férié chômé (-7h sur la base du mois)`;
    } else if (deltaHours > 0) {
      statusType = 'credit';
      summaryText = `+${deltaHours}h sur le planning (solde mois : ${newMonthBalance > 0 ? `+${newMonthBalance}h` : `${newMonthBalance}h`})`;
    } else if (deltaHours < 0) {
      statusType = 'debit';
      summaryText = `${deltaHours}h sur le planning (solde mois : ${newMonthBalance > 0 ? `+${newMonthBalance}h` : `${newMonthBalance}h`})`;
    } else {
      statusType = 'neutral';
      summaryText = `Aucun changement d'heures (solde mois : ${newMonthBalance > 0 ? `+${newMonthBalance}h` : `${newMonthBalance}h`})`;
    }
  }

  return {
    deltaHours,
    newMonthHours,
    newMonthBalance,
    newWeekBalance,
    newExerciseHours,
    newExerciseBalance,
    newPaidLeaveRemaining,
    newRttRemaining,
    newForfaitDaysRemaining,
    summaryText,
    statusType,
  };
}
