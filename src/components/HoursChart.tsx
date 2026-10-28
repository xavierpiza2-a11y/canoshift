import { coreShiftHours } from '../shared/planning';
import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { EmployeeMonthSchedule, Employee } from '../types/planning';
import { categorizeShift } from '../config/constants';
import { calculateEmployeeBalances } from '../services/hoursService';
import {
  Clock,
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  ChevronDown,
  ChevronUp,
  CheckCircle2
} from 'lucide-react';

interface HoursChartProps {
  schedule: EmployeeMonthSchedule | null;
  selectedMonth: string;
  monthLabel?: string;
  employeeName?: string;
}

/**
 * Extracts worked hours from shift text and hours string.
 */
export function parseHoursFromDay(shiftText: string, hoursText?: string): number {
  if (!shiftText && !hoursText) return 0;
  const coreHours = coreShiftHours(shiftText);
  if (coreHours !== null) return coreHours;
  const cat = categorizeShift(shiftText, hoursText);
  const sUpper = (shiftText || '').trim().toUpperCase();

  if (cat === 'REPOS' || cat === 'CONGES' || cat === 'RTT' || cat === 'FERIE' || cat === 'CFA') {
    return 0;
  }

  // AT (Accident du Travail) & Maladie : comptabilisé 7h
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

  // 1. Direct single numeric value like "7", "7h", "7.5", "7,5", "8h"
  const singleNumMatch = hStr.match(/^(\d+(?:[.,]\d+)?)\s*h?$/i);
  if (singleNumMatch) {
    const val = parseFloat(singleNumMatch[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val <= 16) return val;
  }

  // 2. Direct format like "7h30" or "8h15"
  const singleHoursMinsMatch = hStr.match(/^(\d{1,2})\s*h\s*(\d{2})$/i);
  if (singleHoursMinsMatch) {
    const h = parseInt(singleHoursMinsMatch[1], 10);
    const m = parseInt(singleHoursMinsMatch[2], 10);
    return Math.round((h + m / 60) * 100) / 100;
  }

  // 3. Time ranges like "9h-12h30 14h-19h" or "8h30/12h30 - 14h/18h"
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
    if (endDec < startDec) endDec += 24; // Handle shift crossing midnight
    const diff = endDec - startDec;
    if (diff > 0 && diff <= 16) {
      totalRangeHours += diff;
    }
  }

  if (matchesFound > 0 && totalRangeHours > 0) {
    return Math.round(totalRangeHours * 100) / 100;
  }

  // 4. Fallback defaults based on shift category
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
    case 'HORAIRE':
      return 7;
    default:
      return shiftText && shiftText.trim() !== '' ? 7 : 0;
  }
}

/**
 * Returns ISO week number for a given Date
 */
function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const CATEGORY_COLORS: Record<string, string> = {
  MATIN: '#0284c7', // Sky 600
  SOIR: '#d97706', // Amber 600
  JOURNEE: '#059669', // Emerald 600
  HORAIRE: '#78716c', // Stone 500
  FORMATION: '#9333ea', // Purple 600
  AUTRE: '#64748b', // Slate 500
};

export const HoursChart: React.FC<HoursChartProps> = ({
  schedule,
  selectedMonth,
  monthLabel,
  employeeName,
}) => {
  const [activeView, setActiveView] = useState<'weekly' | 'daily' | 'category'>('weekly');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Parse days data
  const daysData = useMemo(() => {
    if (!selectedMonth) return [];
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    let cumulative = 0;
    const list: Array<{
      dateKey: string;
      dayNum: number;
      dayLabel: string;
      weekdayShort: string;
      weekNumber: number;
      shift: string;
      hoursStr: string;
      hours: number;
      cumulativeHours: number;
      category: string;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, month - 1, d);
      const dayData = schedule?.days ? schedule.days[dateKey] : undefined;

      const shiftText = dayData?.shift || '';
      const hoursStr = dayData?.hours || '';
      const hours = parseHoursFromDay(shiftText, hoursStr);
      cumulative += hours;

      const weekdayShort = dateObj.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
      const weekNumber = getWeekNumber(dateObj);
      const category = categorizeShift(shiftText, hoursStr);

      list.push({
        dateKey,
        dayNum: d,
        dayLabel: `${d}`,
        weekdayShort,
        weekNumber,
        shift: shiftText,
        hoursStr,
        hours: Math.round(hours * 10) / 10,
        cumulativeHours: Math.round(cumulative * 10) / 10,
        category,
      });
    }

    return list;
  }, [selectedMonth, schedule]);

  // Aggregate by week
  const weeklyData = useMemo(() => {
    const map = new Map<
      number,
      {
        weekNumber: number;
        weekLabel: string;
        workedHours: number;
        workedDays: number;
        firstDay: number;
        lastDay: number;
      }
    >();

    daysData.forEach((day) => {
      const existing = map.get(day.weekNumber);
      if (!existing) {
        map.set(day.weekNumber, {
          weekNumber: day.weekNumber,
          weekLabel: `S${day.weekNumber}`,
          workedHours: day.hours,
          workedDays: day.hours > 0 ? 1 : 0,
          firstDay: day.dayNum,
          lastDay: day.dayNum,
        });
      } else {
        existing.workedHours += day.hours;
        if (day.hours > 0) existing.workedDays++;
        existing.lastDay = day.dayNum;
      }
    });

    let runningCumul = 0;
    return Array.from(map.values()).map((w) => {
      runningCumul += w.workedHours;
      return {
        ...w,
        workedHours: Math.round(w.workedHours * 10) / 10,
        cumulativeHours: Math.round(runningCumul * 10) / 10,
        rangeLabel: `${w.firstDay}-${w.lastDay}`,
        targetHours: 35, // Base légale hebdomadaire
      };
    });
  }, [daysData]);

  // Aggregate by category
  const categoryData = useMemo(() => {
    const map = new Map<string, { category: string; hours: number; count: number }>();

    daysData.forEach((day) => {
      if (day.hours > 0) {
        const cat = day.category || 'HORAIRE';
        const existing = map.get(cat);
        if (!existing) {
          map.set(cat, { category: cat, hours: day.hours, count: 1 });
        } else {
          existing.hours += day.hours;
          existing.count += 1;
        }
      }
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        hours: Math.round(item.hours * 10) / 10,
        color: CATEGORY_COLORS[item.category] || '#64748b',
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [daysData]);

  // Overall total hours
  const calculatedTotalHours = useMemo(() => {
    return Math.round(daysData.reduce((acc, d) => acc + d.hours, 0) * 10) / 10;
  }, [daysData]);

  const effectiveTotalHours = useMemo(() => {
    if (schedule?.totalHours && schedule.totalHours > 0) {
      return schedule.totalHours;
    }
    return calculatedTotalHours;
  }, [schedule, calculatedTotalHours]);

  // Resolve employee config & live balances
  const employeeBalances = useMemo(() => {
    let empObj: Employee = { name: employeeName || schedule?.employee || 'Collaborateur', color: '#166534' };
    if (typeof window !== 'undefined') {
      try {
        const cachedCfg = localStorage.getItem('planning_cached_config');
        if (cachedCfg) {
          const parsed = JSON.parse(cachedCfg);
          const found = parsed.employees?.find(
            (e: Employee) => e.name.toLowerCase() === (employeeName || schedule?.employee || '').toLowerCase()
          );
          if (found) empObj = found;
        }
      } catch {
        // ignore
      }
    }
    return calculateEmployeeBalances({
      employee: empObj,
      selectedMonth,
      currentSchedule: schedule,
    });
  }, [employeeName, schedule, selectedMonth]);

  // Monthly balance relative to dynamic working days base
  const differenceWithStandard = employeeBalances.monthBalance;

  // Average weekly hours
  const weeklyAverage = useMemo(() => {
    if (weeklyData.length === 0) return 0;
    const fullWeeks = weeklyData.filter((w) => w.workedHours > 0);
    if (fullWeeks.length === 0) return 0;
    return Math.round((effectiveTotalHours / fullWeeks.length) * 10) / 10;
  }, [weeklyData, effectiveTotalHours]);

  if (!schedule || daysData.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden transition-all">
      {/* Header Banner */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-linear-to-r from-emerald-50/70 via-white to-slate-50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  Total des heures travaillées
                </h3>
                {schedule.totalHours && schedule.totalHours > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-100/80 px-1.5 py-0.5 rounded-md">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Synchronisé
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {monthLabel || selectedMonth} {employeeName ? `· ${employeeName}` : ''} · <span className="font-semibold text-slate-700">{employeeBalances.contractLabel}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-black text-emerald-700 tabular-nums leading-none">
                {effectiveTotalHours}
                <span className="text-sm font-bold text-emerald-600 ml-0.5">h</span>
              </div>
              <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                CP restants : <span className="text-amber-700 font-bold">{employeeBalances.paidLeaveRemaining}j</span>
                {employeeBalances.rttTotal > 0 && (
                  <span className="ml-1 text-teal-700">· RTT : {employeeBalances.rttRemaining}j</span>
                )}
              </p>
            </div>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-1"
              title={isCollapsed ? 'Déplier le graphique' : 'Replier le graphique'}
              aria-label="Afficher ou masquer le graphique"
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Highlight Stats Row */}
        {!isCollapsed && (
          <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-slate-200/60 text-center">
            {employeeBalances.contractType === 'FORFAIT_JOUR' ? (
              <>
                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Jours Faits
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                    {employeeBalances.exerciseWorkedDays} / {employeeBalances.forfaitDaysQuota} j
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Reste à faire
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-sky-700 tabular-nums">
                    {employeeBalances.forfaitDaysRemaining} j
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    RTT Restants
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-teal-700 tabular-nums">
                    {employeeBalances.rttRemaining} j
                  </span>
                </div>
              </>
            ) : employeeBalances.contractType === 'ANNUALISE' ? (
              <>
                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Écart Mois ({employeeBalances.expectedMonthHours}h)
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-bold tabular-nums ${
                      differenceWithStandard >= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {differenceWithStandard > 0 ? `+${differenceWithStandard}h` : `${differenceWithStandard}h`}
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Écart Cumulé à la Fin du Mois
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-bold tabular-nums ${
                      employeeBalances.exerciseBalance > 0
                        ? 'text-sky-700'
                        : employeeBalances.exerciseBalance < 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {employeeBalances.exerciseBalance > 0
                      ? `+${employeeBalances.exerciseBalance}h`
                      : `${employeeBalances.exerciseBalance}h`}
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Fin d'exercice (31 Mai)
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-bold tabular-nums ${
                      employeeBalances.projectedExerciseEndBalance > 0
                        ? 'text-sky-700'
                        : employeeBalances.projectedExerciseEndBalance < 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {employeeBalances.projectedExerciseEndBalance > 0
                      ? `+${employeeBalances.projectedExerciseEndBalance}h`
                      : `${employeeBalances.projectedExerciseEndBalance}h`}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Moy. Hebdo
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                    {weeklyAverage > 0 ? `${weeklyAverage}h` : '—'}
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Écart Mois ({employeeBalances.expectedMonthHours}h)
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-bold tabular-nums ${
                      differenceWithStandard >= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {differenceWithStandard > 0 ? `+${differenceWithStandard}h` : `${differenceWithStandard}h`}
                  </span>
                </div>

                <div className="bg-white/80 rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block">
                    Écart Cumulé à la Fin du Mois
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-bold tabular-nums ${
                      employeeBalances.exerciseBalance > 0
                        ? 'text-sky-700'
                        : employeeBalances.exerciseBalance < 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {employeeBalances.exerciseBalance > 0
                      ? `+${employeeBalances.exerciseBalance}h`
                      : `${employeeBalances.exerciseBalance}h`}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Chart Body */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5 space-y-3">
          {/* Sub-view Switcher Tabs */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setActiveView('weekly')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeView === 'weekly'
                    ? 'bg-white text-emerald-800 shadow-xs font-bold'
                    : 'hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Par semaine</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('daily')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeView === 'daily'
                    ? 'bg-white text-emerald-800 shadow-xs font-bold'
                    : 'hover:text-slate-900'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                <span>Progression quotidienne</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('category')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  activeView === 'category'
                    ? 'bg-white text-emerald-800 shadow-xs font-bold'
                    : 'hover:text-slate-900'
                }`}
              >
                <PieIcon className="w-3.5 h-3.5 text-amber-600" />
                <span>Répartition</span>
              </button>
            </div>

            <span className="text-[11px] font-medium text-slate-400">
              Graphique interactif Recharts
            </span>
          </div>

          {/* VIEW 1: Weekly Breakdown + Cumulative Progress */}
          {activeView === 'weekly' && (
            <div className="space-y-2">
              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={weeklyData}
                    margin={{ top: 12, right: 10, left: -16, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="weekLabel"
                      tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      unit="h"
                      domain={[0, 'dataMax + 8']}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fill: '#059669', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      unit="h"
                      domain={[0, Math.ceil(effectiveTotalHours * 1.15)]}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white text-xs rounded-xl p-2.5 shadow-lg border border-slate-800 space-y-1">
                            <p className="font-bold text-slate-200">
                              {data.weekLabel} (Jours {data.rangeLabel})
                            </p>
                            <div className="flex items-center justify-between gap-4 text-emerald-400">
                              <span>Travaillées :</span>
                              <span className="font-bold tabular-nums">{data.workedHours} h</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-emerald-300">
                              <span>Total cumulé :</span>
                              <span className="font-bold tabular-nums">{data.cumulativeHours} h</span>
                            </div>
                            {employeeBalances.contractType === 'FORFAIT_JOUR' ? (
                              <div className="flex items-center justify-between gap-4 text-slate-400 text-[10px] pt-0.5 border-t border-slate-800">
                                <span>Jours réalisés :</span>
                                <span>{data.workedDays} j</span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-4 text-slate-400 text-[10px] pt-0.5 border-t border-slate-800">
                                <span>Quota hebdo :</span>
                                <span>{employeeBalances.weeklyQuota} h</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      yAxisId="left"
                      y={employeeBalances.weeklyQuota || 35}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      label={{
                        value: `${employeeBalances.weeklyQuota || 35}h (Base hebdo)`,
                        position: 'top',
                        fill: '#059669',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="workedHours"
                      name="Heures hebdo"
                      fill="#047857"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={44}
                    >
                      {weeklyData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.workedHours >= (employeeBalances.weeklyQuota || 35) ? '#059669' : '#0d9488'}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cumulativeHours"
                      name="Total cumulé"
                      stroke="#f59e0b"
                      strokeWidth={2.5}
                      dot={{ fill: '#f59e0b', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Legend & caption */}
              <div className="flex items-center justify-center gap-6 pt-1 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-emerald-600 inline-block" />
                  <span>Heures travaillées / semaine</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-1 bg-amber-500 inline-block rounded-full" />
                  <span>Progression cumulée (Total {effectiveTotalHours}h)</span>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: Daily Progression / Timeline */}
          {activeView === 'daily' && (
            <div className="space-y-2">
              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={daysData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="dayLabel"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tickLine={false}
                      interval={2}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      unit="h"
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white text-xs rounded-xl p-2.5 shadow-lg border border-slate-800 space-y-1">
                            <p className="font-bold text-slate-200">
                              {data.weekdayShort} {data.dayNum} ({data.dateKey})
                            </p>
                            <div className="flex items-center justify-between gap-4 text-emerald-400">
                              <span>Poste :</span>
                              <span className="font-bold">{data.shift || 'Repos'}</span>
                            </div>
                            {data.hoursStr && (
                              <div className="text-slate-300 text-[11px]">
                                Plage : {data.hoursStr}
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-4 text-white font-bold pt-1 border-t border-slate-800">
                              <span>Heures :</span>
                              <span className="tabular-nums">{data.hours} h</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-amber-400 text-[10px]">
                              <span>Cumul mois :</span>
                              <span className="tabular-nums">{data.cumulativeHours} h</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="hours"
                      name="Heures jour"
                      radius={[4, 4, 0, 0]}
                    >
                      {daysData.map((entry, index) => (
                        <Cell
                          key={`day-cell-${index}`}
                          fill={
                            entry.hours === 0
                              ? '#f1f5f9'
                              : CATEGORY_COLORS[entry.category] || '#059669'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="text-center text-xs text-slate-400">
                Survolez ou touchez une barre pour inspecter le détail journalier.
              </div>
            </div>
          )}

          {/* VIEW 3: Category Distribution */}
          {activeView === 'category' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                {/* Donut Chart */}
                <div className="h-48 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="hours"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius={46}
                        outerRadius={72}
                        paddingAngle={3}
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`pie-cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const data = payload[0].payload;
                          const pct =
                            effectiveTotalHours > 0
                              ? Math.round((data.hours / effectiveTotalHours) * 100)
                              : 0;
                          return (
                            <div className="bg-slate-900 text-white text-xs rounded-xl p-2.5 shadow-lg border border-slate-800 space-y-1">
                              <p className="font-bold text-slate-200 capitalize">
                                {data.category}
                              </p>
                              <p className="text-emerald-400 font-bold">
                                {data.hours} h ({pct}%)
                              </p>
                              <p className="text-slate-400 text-[10px]">
                                {data.count} vacation(s)
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend List */}
                <div className="space-y-2">
                  {categoryData.map((cat) => {
                    const pct =
                      effectiveTotalHours > 0
                        ? Math.round((cat.hours / effectiveTotalHours) * 100)
                        : 0;
                    return (
                      <div
                        key={cat.category}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="font-semibold text-slate-800 capitalize">
                            {cat.category.toLowerCase()}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({cat.count} j)
                          </span>
                        </div>
                        <div className="text-right font-bold text-slate-900 tabular-nums">
                          {cat.hours}h <span className="text-[10px] font-normal text-slate-500">({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
