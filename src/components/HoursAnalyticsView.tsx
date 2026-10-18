import React, { useState, useMemo } from 'react';
import { Employee, EmployeeMonthSchedule, MonthItem } from '../types/planning';
import { MonthSelector } from './MonthSelector';
import { HoursChart, parseHoursFromDay } from './HoursChart';
import { categorizeShift } from '../config/constants';
import { calculateEmployeeBalances, getMonthWorkingCalendar } from '../services/hoursService';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
  ComposedChart,
  Line,
} from 'recharts';
import {
  Users,
  User,
  Clock,
  Briefcase,
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Award,
  Scale,
} from 'lucide-react';

interface HoursAnalyticsViewProps {
  employees: Employee[];
  currentEmployee: Employee | null;
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  mySchedule: EmployeeMonthSchedule | null;
  selectedMonth: string;
  allMonths: MonthItem[];
  visibleMonths: string[];
  isLoading: boolean;
  isOffline: boolean;
  onSelectMonth: (monthKey: string) => void;
  onRefresh: () => void;
}

const EMPLOYEE_COLORS = [
  '#059669', // Emerald
  '#0284c7', // Sky
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#e11d48', // Rose
  '#0d9488', // Teal
  '#4f46e5', // Indigo
  '#ea580c', // Orange
  '#16a34a', // Green
  '#64748b', // Slate
];

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

export const HoursAnalyticsView: React.FC<HoursAnalyticsViewProps> = ({
  employees,
  currentEmployee,
  teamSchedules,
  mySchedule,
  selectedMonth,
  allMonths,
  visibleMonths,
  isLoading,
  isOffline,
  onSelectMonth,
  onRefresh,
}) => {
  // Main view mode: 'team' (total équipe) or 'employee' (par employé)
  const [mainMode, setMainMode] = useState<'team' | 'employee'>('team');

  // Currently selected employee for individual view
  const [selectedEmpName, setSelectedEmpName] = useState<string>(() => {
    return currentEmployee?.name || employees[0]?.name || '';
  });

  // Sub-view in Team mode: 'compare' | 'weekly' | 'pie'
  const [teamChartView, setTeamChartView] = useState<'compare' | 'weekly' | 'pie'>('compare');

  // Month label & working calendar info
  const currentMonthItem = useMemo(() => {
    return allMonths.find((m) => m.key === selectedMonth);
  }, [allMonths, selectedMonth]);
  const monthLabel = currentMonthItem?.label || selectedMonth;

  // Monthly working calendar base (Monday-Friday working days, weekends rest, holidays deducted)
  const monthWorkingCal = useMemo(() => {
    return getMonthWorkingCalendar(selectedMonth, undefined, currentMonthItem);
  }, [selectedMonth, currentMonthItem]);
  const standardMonthBaseHours = monthWorkingCal.standardBaseHours;

  // Find employee schedule safely
  const getEmployeeSchedule = (empName: string): EmployeeMonthSchedule | null => {
    const direct = teamSchedules[empName];
    if (direct) return direct;

    const lower = teamSchedules[empName.toLowerCase()];
    if (lower) return lower;

    const foundEntry = Object.entries(teamSchedules).find(
      ([k]) => k.toLowerCase() === empName.toLowerCase()
    );
    if (foundEntry) return foundEntry[1];

    if (currentEmployee && currentEmployee.name.toLowerCase() === empName.toLowerCase() && mySchedule) {
      return mySchedule;
    }

    return null;
  };

  // Compile stats for all employees in selected month
  const teamEmployeesStats = useMemo(() => {
    return employees.map((emp, index) => {
      const schedule = getEmployeeSchedule(emp.name);
      let calculatedHours = 0;
      let restDays = 0;

      if (schedule?.days) {
        Object.values(schedule.days).forEach((day) => {
          const cat = categorizeShift(day.shift, day.hours);
          if (cat === 'REPOS') {
            restDays++;
          }
          calculatedHours += parseHoursFromDay(day.shift, day.hours);
        });
      }

      const totalHours =
        schedule?.totalHours && schedule.totalHours > 0
          ? schedule.totalHours
          : Math.round(calculatedHours * 10) / 10;

      const isSynchronized = !!(schedule?.totalHours && schedule.totalHours > 0);
      const color = EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length];

      // Full Live Balances (Annual 1er Juin - 31 Mai, Leave & Quotas)
      const balances = calculateEmployeeBalances({
        employee: emp,
        selectedMonth,
        currentSchedule: schedule,
        teamSchedules,
        allMonths,
      });

      return {
        emp,
        name: emp.name,
        color,
        totalHours,
        restDays,
        isSynchronized,
        schedule,
        balances,
      };
    });
  }, [employees, teamSchedules, mySchedule, currentEmployee, selectedMonth, allMonths]);

  // Aggregate Team Totals
  const teamAggregate = useMemo(() => {
    let totalHours = 0;

    teamEmployeesStats.forEach((st) => {
      totalHours += st.totalHours;
    });

    const activeEmpCount = teamEmployeesStats.filter((st) => st.totalHours > 0).length || employees.length || 1;
    const avgHoursPerEmployee = Math.round((totalHours / activeEmpCount) * 10) / 10;

    return {
      totalHours: Math.round(totalHours * 10) / 10,
      activeEmpCount,
      avgHoursPerEmployee,
    };
  }, [teamEmployeesStats, employees]);

  // Aggregate Team Weekly Data
  const teamWeeklyData = useMemo(() => {
    if (!selectedMonth) return [];
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    const weekMap = new Map<
      number,
      {
        weekNumber: number;
        weekLabel: string;
        totalHours: number;
        firstDay: number;
        lastDay: number;
      }
    >();

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, month - 1, d);
      const weekNumber = getWeekNumber(dateObj);

      // Sum hours of all employees for this day
      let daySum = 0;
      employees.forEach((emp) => {
        const sched = getEmployeeSchedule(emp.name);
        const dayData = sched?.days ? sched.days[dateKey] : undefined;
        if (dayData) {
          daySum += parseHoursFromDay(dayData.shift, dayData.hours);
        }
      });

      const existing = weekMap.get(weekNumber);
      if (!existing) {
        weekMap.set(weekNumber, {
          weekNumber,
          weekLabel: `S${weekNumber}`,
          totalHours: daySum,
          firstDay: d,
          lastDay: d,
        });
      } else {
        existing.totalHours += daySum;
        existing.lastDay = d;
      }
    }

    let runningCumul = 0;
    return Array.from(weekMap.values()).map((w) => {
      runningCumul += w.totalHours;
      return {
        ...w,
        totalHours: Math.round(w.totalHours * 10) / 10,
        cumulativeHours: Math.round(runningCumul * 10) / 10,
        rangeLabel: `${w.firstDay}-${w.lastDay}`,
      };
    });
  }, [selectedMonth, employees, teamSchedules, mySchedule, currentEmployee]);

  // Data for Team Pie Chart (% of total hours per employee)
  const teamPieData = useMemo(() => {
    if (teamAggregate.totalHours === 0) return [];
    return teamEmployeesStats
      .filter((st) => st.totalHours > 0)
      .map((st) => ({
        name: st.name,
        hours: st.totalHours,
        percentage: Math.round((st.totalHours / teamAggregate.totalHours) * 100),
        color: st.color,
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [teamEmployeesStats, teamAggregate.totalHours]);

  // Active individual employee schedule
  const activeEmployeeSchedule = useMemo(() => {
    return getEmployeeSchedule(selectedEmpName);
  }, [selectedEmpName, teamSchedules, mySchedule, currentEmployee]);

  // Handle click to inspect an employee from team view
  const handleInspectEmployee = (empName: string) => {
    setSelectedEmpName(empName);
    setMainMode('employee');
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Month Navigation */}
      <MonthSelector
        allMonths={allMonths}
        visibleMonths={visibleMonths}
        selectedMonth={selectedMonth}
        onSelectMonth={onSelectMonth}
      />

      {/* Main Mode Toggle: Total Équipe vs Par Employé */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-2xs">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMainMode('team')}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              mainMode === 'team'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Total Équipe</span>
          </button>

          <button
            type="button"
            onClick={() => setMainMode('employee')}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              mainMode === 'employee'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Par Employé</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODE 1: TOTAL ÉQUIPE                                     */}
      {/* ======================================================== */}
      {mainMode === 'team' && (
        <div className="space-y-4">
          {/* Team KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 uppercase tracking-wider mb-1">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Heures Équipe</span>
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {teamAggregate.totalHours}
                <span className="text-sm font-bold text-emerald-600 ml-0.5">h</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Sur tout le mois de {monthLabel}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-800 uppercase tracking-wider mb-1">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>Moy. / Employé</span>
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {teamAggregate.avgHoursPerEmployee}
                <span className="text-sm font-bold text-blue-600 ml-0.5">h</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Base du mois : {standardMonthBaseHours}h ({monthWorkingCal.netWorkingDays}j ouvrés)
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-800 uppercase tracking-wider mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-purple-600" />
                <span>Moy. Hebdo Équipe</span>
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {teamWeeklyData.length > 0
                  ? Math.round((teamAggregate.totalHours / teamWeeklyData.length) * 10) / 10
                  : 0}
                <span className="text-sm font-bold text-purple-600 ml-0.5">h</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {teamWeeklyData.length} semaines dans le mois
              </p>
            </div>
          </div>

          {/* Recharts Team Analytics Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-4">
            {/* Chart Sub-tabs switcher */}
            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
              <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
                <button
                  type="button"
                  onClick={() => setTeamChartView('compare')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                    teamChartView === 'compare'
                      ? 'bg-white text-emerald-800 shadow-xs font-bold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Comparatif Équipe</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTeamChartView('weekly')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                    teamChartView === 'weekly'
                      ? 'bg-white text-emerald-800 shadow-xs font-bold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                  <span>Semaine par semaine</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTeamChartView('pie')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                    teamChartView === 'pie'
                      ? 'bg-white text-emerald-800 shadow-xs font-bold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  <PieIcon className="w-3.5 h-3.5 text-amber-600" />
                  <span>Répartition %</span>
                </button>
              </div>
            </div>

            {/* TEAM CHART 1: Comparative BarChart of Employees */}
            {teamChartView === 'compare' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Heures totales travaillées par employé ({monthLabel})</span>
                  <span className="text-emerald-700 font-medium">
                    Ligne de repère : {standardMonthBaseHours}h ({monthWorkingCal.netWorkingDays}j ouvrés)
                  </span>
                </div>

                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={teamEmployeesStats}
                      margin={{ top: 12, right: 10, left: -16, bottom: 25 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
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
                          const pct =
                            teamAggregate.totalHours > 0
                              ? Math.round((data.totalHours / teamAggregate.totalHours) * 100)
                              : 0;
                          return (
                            <div className="bg-slate-900 text-white text-xs rounded-xl p-3 shadow-lg border border-slate-800 space-y-1.5 min-w-[160px]">
                              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1">
                                <span className="font-bold text-slate-100">{data.name}</span>
                                {data.isSynchronized && (
                                  <span className="text-[9px] bg-emerald-900/80 text-emerald-300 px-1 py-0.5 rounded-sm">
                                    Sync
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between text-emerald-400 font-bold">
                                <span>Heures mois :</span>
                                <span className="tabular-nums">{data.totalHours} h</span>
                              </div>
                              <div className="flex items-center justify-between text-slate-300 text-[11px]">
                                <span>Part équipe :</span>
                                <span>{pct}%</span>
                              </div>
                              {data.balances?.contractType === 'FORFAIT_JOUR' ? (
                                <>
                                  <div className="flex items-center justify-between text-slate-300 text-[11px]">
                                    <span>Jours faits :</span>
                                    <span>{data.balances.exerciseWorkedDays} / {data.balances.forfaitDaysQuota} j</span>
                                  </div>
                                  <div className="flex items-center justify-between text-sky-400 text-[11px]">
                                    <span>Reste à faire :</span>
                                    <span>{data.balances.forfaitDaysRemaining} j</span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                                    <span className="text-slate-400">Écart mois ({data.balances?.expectedMonthHours}h) :</span>
                                    <span
                                      className={`font-semibold tabular-nums ${
                                        (data.balances?.monthBalance ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400'
                                      }`}
                                    >
                                      {(data.balances?.monthBalance ?? 0) > 0 ? `+${data.balances?.monthBalance}h` : `${data.balances?.monthBalance}h`}
                                    </span>
                                  </div>
                                  {data.balances?.hasAnnualHoursCounter && (
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400">Écart Cumulé à la Fin du Mois :</span>
                                      <span
                                        className={`font-semibold tabular-nums ${
                                          (data.balances?.exerciseBalance ?? 0) >= 0 ? 'text-sky-400' : 'text-amber-400'
                                        }`}
                                      >
                                        {(data.balances?.exerciseBalance ?? 0) > 0 ? `+${data.balances?.exerciseBalance}h` : `${data.balances?.exerciseBalance}h`}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )}
                              <div className="text-[10px] text-emerald-400 pt-1 text-center font-medium">
                                Touchez pour voir le détail
                              </div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine
                        y={standardMonthBaseHours}
                        stroke="#059669"
                        strokeDasharray="4 4"
                        label={{
                          value: `${standardMonthBaseHours}h (Base du mois)`,
                          position: 'top',
                          fill: '#059669',
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      />
                      <Bar
                        dataKey="totalHours"
                        name="Heures totales"
                        radius={[6, 6, 0, 0]}
                        onClick={(data) => {
                          if (data && data.name) {
                            handleInspectEmployee(data.name);
                          }
                        }}
                        className="cursor-pointer"
                      >
                        {teamEmployeesStats.map((entry, index) => (
                          <Cell
                            key={`emp-cell-${index}`}
                            fill={entry.totalHours >= standardMonthBaseHours ? '#059669' : '#0284c7'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="text-center text-xs text-slate-400">
                  Touchez ou cliquez sur la barre d'un équipier pour afficher son analyse détaillée.
                </div>
              </div>
            )}

            {/* TEAM CHART 2: Weekly Team Volume Evolution */}
            {teamChartView === 'weekly' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Charge horaire globale de l'équipe par semaine</span>
                  <span className="text-amber-600 font-medium">Courbe orange : cumul du mois</span>
                </div>

                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={teamWeeklyData}
                      margin={{ top: 12, right: 10, left: -16, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="weekLabel"
                        tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        unit="h"
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: '#d97706', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        unit="h"
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 text-white text-xs rounded-xl p-3 shadow-lg border border-slate-800 space-y-1">
                              <p className="font-bold text-slate-100">
                                {data.weekLabel} (Jours {data.rangeLabel})
                              </p>
                              <div className="flex items-center justify-between gap-4 text-emerald-400">
                                <span>Heures équipe :</span>
                                <span className="font-bold tabular-nums">{data.totalHours} h</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 text-amber-400">
                                <span>Total cumulé :</span>
                                <span className="font-bold tabular-nums">{data.cumulativeHours} h</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="totalHours"
                        name="Heures Équipe"
                        fill="#059669"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cumulativeHours"
                        name="Cumul mois"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={{ fill: '#f59e0b', r: 4 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* TEAM CHART 3: Pie Chart of Team Distribution */}
            {teamChartView === 'pie' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="h-56 w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={teamPieData}
                          dataKey="hours"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          onClick={(entry) => {
                            if (entry && entry.name) {
                              handleInspectEmployee(entry.name);
                            }
                          }}
                          className="cursor-pointer"
                        >
                          {teamPieData.map((entry, index) => (
                            <Cell key={`pie-cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const data = payload[0].payload;
                            return (
                              <div className="bg-slate-900 text-white text-xs rounded-xl p-2.5 shadow-lg border border-slate-800 space-y-1">
                                <p className="font-bold text-slate-100">{data.name}</p>
                                <p className="text-emerald-400 font-bold">
                                  {data.hours} h ({data.percentage}%)
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  Touchez pour voir le détail
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {teamPieData.map((st) => (
                      <button
                        key={st.name}
                        type="button"
                        onClick={() => handleInspectEmployee(st.name)}
                        className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/70 text-xs transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: st.color }}
                          />
                          <span className="font-bold text-slate-800">{st.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-slate-900 tabular-nums">
                            {st.hours}h
                          </span>
                          <span className="text-[10px] font-medium text-slate-500 ml-1">
                            ({st.percentage}%)
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Detailed Employee Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Récapitulatif des heures par employé</span>
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                {employees.length} collaborateurs
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {teamEmployeesStats.map((st) => {
                return (
                  <div
                    key={st.name}
                    className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-2xs shrink-0"
                        style={{ backgroundColor: st.color }}
                      >
                        {st.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 truncate">
                            {st.name}
                          </span>
                          {st.isSynchronized && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                              Sync
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5 flex-wrap">
                          <span className="font-semibold text-slate-700">{st.balances.contractLabel}</span>
                          {st.balances.contractType === 'FORFAIT_JOUR' ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-sky-700 font-bold">
                                Reste : {st.balances.forfaitDaysRemaining}j à faire
                              </span>
                            </>
                          ) : st.balances.hasAnnualHoursCounter ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className={st.balances.exerciseBalance > 0 ? 'text-sky-700 font-bold' : st.balances.exerciseBalance < 0 ? 'text-amber-700 font-bold' : 'text-slate-600'}>
                                Ecart Cumulé à la Fin du Mois : {st.balances.exerciseBalance > 0 ? `+${st.balances.exerciseBalance}h (dû salarié)` : st.balances.exerciseBalance < 0 ? `${st.balances.exerciseBalance}h (dû magasin)` : '0h (équilibré)'}
                              </span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-700 font-medium">CP restants : {st.balances.paidLeaveRemaining}j</span>
                          {st.balances.rttTotal > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-teal-700 font-medium">RTT restants : {st.balances.rttRemaining}j</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-base sm:text-lg font-black text-slate-900 tabular-nums leading-tight">
                          {st.totalHours}
                          <span className="text-xs font-bold text-emerald-600 ml-0.5">h</span>
                        </div>
                        <div
                          className={`text-[10px] font-semibold tabular-nums ${
                            st.balances.contractType === 'FORFAIT_JOUR'
                              ? 'text-sky-700 font-bold'
                              : st.balances.monthBalance >= 0
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {st.balances.contractType === 'FORFAIT_JOUR'
                            ? `${st.balances.exerciseWorkedDays}/${st.balances.forfaitDaysQuota}j faits`
                            : `${st.balances.monthBalance > 0 ? `+${st.balances.monthBalance}h` : `${st.balances.monthBalance}h`} (base ${st.balances.expectedMonthHours}h)`}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleInspectEmployee(st.name)}
                        className="p-2 rounded-xl bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-800 transition-colors"
                        title={`Consulter le détail pour ${st.name}`}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 2: PAR EMPLOYÉ                                      */}
      {/* ======================================================== */}
      {mainMode === 'employee' && (
        <div className="space-y-4">
          {/* Employee Selector Bar */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-600" />
                <span>Sélectionner un collaborateur :</span>
              </span>
              <span className="text-[11px] text-slate-400">
                {employees.length} profils disponibles
              </span>
            </div>

            {/* Horizontal pills list */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
              {employees.map((emp, index) => {
                const isSelected = emp.name.toLowerCase() === selectedEmpName.toLowerCase();
                const color = EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length];
                const sched = getEmployeeSchedule(emp.name);
                const hrs = sched?.totalHours;

                return (
                  <button
                    key={emp.name}
                    type="button"
                    onClick={() => setSelectedEmpName(emp.name)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all shrink-0 ${
                      isSelected
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: isSelected ? '#ffffff' : color }}
                    />
                    <span>{emp.name}</span>
                    {typeof hrs === 'number' && hrs > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                          isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-white text-slate-600'
                        }`}
                      >
                        {hrs}h
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Employee Recharts Analytics */}
          {activeEmployeeSchedule ? (
            <HoursChart
              schedule={activeEmployeeSchedule}
              selectedMonth={selectedMonth}
              monthLabel={monthLabel}
              employeeName={selectedEmpName}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                Aucune donnée horaire disponible pour {selectedEmpName} en {monthLabel}
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Le planning de ce collaborateur n'est pas encore synchronisé pour le mois sélectionné.
              </p>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-xl hover:bg-emerald-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualiser les données</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
