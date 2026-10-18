import React, { useState, useMemo, useRef } from 'react';
import { Employee, EmployeeMonthSchedule, MonthItem } from '../types/planning';
import { MonthSelector } from './MonthSelector';
import { ShiftBadge } from './ShiftBadge';
import { DayNoteModal } from './DayNoteModal';
import { categorizeShift, formatHoursReadable } from '../config/constants';
import { getCategoryDetails } from '../config/categoryStyles';
import { getStoredTableau2Shifts, getStoredDayNotes } from '../services/api';
import { exportScheduleToICS } from '../services/icsExport';
import { calculateEmployeeBalances } from '../services/hoursService';
import {
  Calendar as CalendarIcon,
  ListFilter,
  Download,
  History,
  Clock,
  Briefcase,
  Home,
  Sparkles,
  Info,
  CalendarCheck,
  RefreshCw,
  Sun,
  Sunset,
  Palmtree,
  GraduationCap,
  Scale,
} from 'lucide-react';

interface EmployeeViewProps {
  currentEmployee: Employee;
  schedule: EmployeeMonthSchedule | null;
  isLoading: boolean;
  isOffline: boolean;
  selectedMonth: string;
  allMonths: MonthItem[];
  visibleMonths: string[];
  onSelectMonth: (monthKey: string) => void;
  onRefresh: () => void;
  onOpenHistory: () => void;
}

export const EmployeeView: React.FC<EmployeeViewProps> = ({
  currentEmployee,
  schedule,
  isLoading,
  isOffline,
  selectedMonth,
  allMonths,
  visibleMonths,
  onSelectMonth,
  onRefresh,
  onOpenHistory,
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const todayRef = useRef<HTMLDivElement | null>(null);

  // Day Note Modal State & reactive version counter
  const [isDayNoteModalOpen, setIsDayNoteModalOpen] = useState(false);
  const [targetNoteDate, setTargetNoteDate] = useState<string>('');
  const [targetInitialNote, setTargetInitialNote] = useState<string>('');
  const [notesVersion, setNotesVersion] = useState(0);

  const handleOpenDayNoteModal = (dateKey: string) => {
    setTargetNoteDate(dateKey);
    const notes = getStoredDayNotes(selectedMonth);
    setTargetInitialNote(notes[dateKey] || '');
    setIsDayNoteModalOpen(true);
  };

  const isResponsableAdmin = Boolean(
    currentEmployee?.isAdmin ||
      currentEmployee?.name?.trim().toLowerCase() === 'responsable' ||
      (currentEmployee?.role && currentEmployee.role.trim().toLowerCase().includes('responsable'))
  );

  // Month label
  const currentMonthItem = useMemo(() => {
    return allMonths.find((m) => m.key === selectedMonth);
  }, [allMonths, selectedMonth]);
  const monthLabel = currentMonthItem?.label || selectedMonth;

  // Today in YYYY-MM-DD
  const todayStr = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // Day notes for the current month
  const monthDayNotes = useMemo(() => {
    return getStoredDayNotes(selectedMonth);
  }, [selectedMonth, schedule, notesVersion]);

  const daysEntries = useMemo(() => {
    const [yearStr, monthStr] = (selectedMonth || '').split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      if (!schedule || !schedule.days) return [];
      return Object.entries(schedule.days).sort(([a], [b]) => a.localeCompare(b));
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const list: Array<[string, { shift: string; hours?: string; info?: string }]> = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = String(d).padStart(2, '0');
      const mStr = String(month).padStart(2, '0');
      const dateKey = `${year}-${mStr}-${dStr}`;
      const dayData = schedule?.days ? schedule.days[dateKey] : undefined;
      list.push([dateKey, dayData || { shift: '', hours: '' }]);
    }
    return list;
  }, [selectedMonth, schedule]);

  // Live Balances & Annual Exercise (1er Juin - 31 Mai)
  const employeeBalances = useMemo(() => {
    return calculateEmployeeBalances({
      employee: currentEmployee,
      selectedMonth,
      targetDate: todayStr,
      currentSchedule: schedule,
    });
  }, [currentEmployee, selectedMonth, schedule, todayStr]);

  // Statistics calculation
  const stats = useMemo(() => {
    let restDays = 0;
    let rttOrLeaves = 0;

    daysEntries.forEach(([_, day]) => {
      const cat = categorizeShift(day.shift, day.hours);
      if (cat === 'REPOS') {
        restDays++;
      } else if (cat === 'CONGES' || cat === 'RTT') {
        rttOrLeaves++;
      }
    });

    const totalHours = schedule?.totalHours || 0;

    return { restDays, rttOrLeaves, totalHours };
  }, [daysEntries, schedule]);

  // Auto-scroll to today
  const scrollToToday = () => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Automatically jump directly to today whenever view is loaded or month/view changes
  React.useEffect(() => {
    if (!isLoading && daysEntries.length > 0) {
      const doScroll = () => {
        if (todayRef.current) {
          todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
      const t1 = setTimeout(doScroll, 80);
      const t2 = setTimeout(doScroll, 250);
      const t3 = setTimeout(doScroll, 600);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isLoading, daysEntries, viewMode, selectedMonth]);

  const handleExportICS = () => {
    if (schedule) {
      exportScheduleToICS(schedule, currentEmployee.name);
    }
  };

  const formatWeekdayFrench = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('fr-FR', { weekday: 'long' });
    } catch {
      return '';
    }
  };

  // Helper to render enlarged centered shift bubble for list view
  const renderEnlargedShiftBadge = (shift: string, hours?: string) => {
    let shiftColor: string | undefined = undefined;
    if (typeof window !== 'undefined') {
      const storedCreneaux = getStoredTableau2Shifts();
      const match = storedCreneaux.find(
        (opt) =>
          opt.label === shift ||
          opt.shift === shift ||
          (opt.shift === shift && opt.hours === hours)
      );
      if (match?.color) {
        shiftColor = match.color;
      }
    }

    const category = categorizeShift(shift, hours);
    const catDetails = getCategoryDetails(category, shiftColor);
    const Icon = catDetails.Icon;

    let mainLabel = shift || 'Non défini';
    if (shift.toUpperCase() === 'HORAIRE' && hours) {
      mainLabel = hours;
    } else if (!shift && hours) {
      mainLabel = hours;
    }

    const hasDistinctHours = hours && hours !== mainLabel;

    return (
      <div
        className={`inline-flex flex-col items-center justify-center px-4 py-2 rounded-xl border ${catDetails.badgeBg} ${catDetails.badgeText} ${catDetails.badgeBorder} shadow-2xs max-w-full`}
      >
        <div className="flex items-center gap-2 font-bold text-sm sm:text-base leading-tight">
          {/* Pastille ronde de la catégorie */}
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${catDetails.dot} ring-1 ring-black/15 shadow-2xs`} />
          <Icon className="w-4 h-4 shrink-0 text-current opacity-85" />
          <span className="truncate">{mainLabel}</span>
        </div>
        {hasDistinctHours && (
          <span className="text-xs sm:text-sm font-semibold tracking-tight text-current opacity-85 mt-0.5">
            {hours}
          </span>
        )}
      </div>
    );
  };

  // Calendar grid preparation
  const calendarGrid = useMemo(() => {
    if (!selectedMonth) return [];
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const totalDays = lastDay.getDate();

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const cells: Array<{
      dayNumber: number | null;
      dateKey: string | null;
      shiftData?: { shift: string; hours?: string; info?: string };
    }> = [];

    for (let i = 0; i < startDayOfWeek; i++) {
      cells.push({ dayNumber: null, dateKey: null });
    }

    for (let d = 1; d <= totalDays; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const shiftData = schedule?.days ? schedule.days[dateKey] : undefined;
      cells.push({
        dayNumber: d,
        dateKey,
        shiftData,
      });
    }

    return cells;
  }, [selectedMonth, schedule]);

  return (
    <div className="space-y-4 pb-20">
      {/* Month Navigation */}
      <MonthSelector
        allMonths={allMonths}
        visibleMonths={visibleMonths}
        selectedMonth={selectedMonth}
        onSelectMonth={onSelectMonth}
      />

      {/* Monthly & Annual Metric Summary */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Card 1: Heures du mois */}
          <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
            <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
              <Clock className="w-3 h-3 text-emerald-600" />
              <span>Heures Mois</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">
              {stats.totalHours > 0 ? `${stats.totalHours}h` : '—'}
            </p>
          </div>

          {employeeBalances.contractType === 'FORFAIT_JOUR' ? (
            <>
              {/* Forfait Jour : Jours Travaillés Exercice */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Briefcase className="w-3 h-3 text-emerald-600" />
                  <span>Jours Faits</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">
                  {employeeBalances.exerciseWorkedDays}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">/ {employeeBalances.forfaitDaysQuota}j</span>
                </p>
              </div>

              {/* Forfait Jour : Reste à faire */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Scale className="w-3 h-3 text-sky-600" />
                  <span>Reste à faire</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-sky-700 tabular-nums">
                  {employeeBalances.forfaitDaysRemaining}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">j</span>
                </p>
              </div>

              {/* Forfait Jour : CP Restants */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Palmtree className="w-3 h-3 text-amber-600" />
                  <span>CP Restants</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-amber-700 tabular-nums">
                  {employeeBalances.paidLeaveRemaining}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">j</span>
                </p>
              </div>
            </>
          ) : employeeBalances.contractType === 'HEBDO_35H' ? (
            <>
              {/* 35h : Heures Semaine en cours */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Clock className="w-3 h-3 text-blue-600" />
                  <span>Heures Semaine</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">
                  {employeeBalances.weekHours !== undefined ? `${employeeBalances.weekHours}h` : '—'}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">/ {employeeBalances.weekQuota ?? 35}h</span>
                </p>
              </div>

              {/* 35h : Écart Mois */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Scale className="w-3 h-3 text-sky-600" />
                  <span>Écart Mois</span>
                </div>
                <p
                  className={`text-base sm:text-lg font-bold tabular-nums ${
                    employeeBalances.monthBalance > 0
                      ? 'text-sky-700'
                      : employeeBalances.monthBalance < 0
                      ? 'text-amber-700'
                      : 'text-slate-900'
                  }`}
                >
                  {employeeBalances.monthBalance > 0
                    ? `+${employeeBalances.monthBalance}h`
                    : `${employeeBalances.monthBalance}h`}
                </p>
              </div>

              {/* 35h : Congés Payés Restants (sur l'exercice 1er Juin - 31 Mai) */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Palmtree className="w-3 h-3 text-amber-600" />
                  <span>CP Restants</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-amber-700 tabular-nums">
                  {employeeBalances.paidLeaveRemaining}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">j</span>
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Annualisé : Écart Mois */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Scale className="w-3 h-3 text-sky-600" />
                  <span>Écart Mois</span>
                </div>
                <p
                  className={`text-base sm:text-lg font-bold tabular-nums ${
                    employeeBalances.monthBalance > 0
                      ? 'text-sky-700'
                      : employeeBalances.monthBalance < 0
                      ? 'text-amber-700'
                      : 'text-slate-900'
                  }`}
                >
                  {employeeBalances.monthBalance > 0
                    ? `+${employeeBalances.monthBalance}h`
                    : `${employeeBalances.monthBalance}h`}
                </p>
              </div>

              {/* Annualisé : Écart Année (1er Juin - 31 Mai) */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Scale className="w-3 h-3 text-emerald-600" />
                  <span>Écart Cumulé à la Fin du Mois</span>
                </div>
                <p
                  className={`text-base sm:text-lg font-bold tabular-nums ${
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
                </p>
              </div>

              {/* Congés Payés Restants */}
              <div className="bg-white rounded-xl border border-slate-200 p-2.5 text-center shadow-xs">
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center justify-center gap-1 mb-1">
                  <Palmtree className="w-3 h-3 text-amber-600" />
                  <span>CP Restants</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-amber-700 tabular-nums">
                  {employeeBalances.paidLeaveRemaining}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">j</span>
                </p>
              </div>
            </>
          )}
        </div>

        {/* Info strip */}
        <div className="flex items-center justify-between px-2 text-[11px] text-slate-500 flex-wrap gap-1">
          <span>
            Exercice conventionnel : <strong className="text-slate-700">{employeeBalances.exercise.label}</strong>
          </span>
          <span className="flex items-center gap-2">
            <span>Régime : <strong className="text-slate-700">{employeeBalances.contractLabel}</strong></span>
            {employeeBalances.rttTotal > 0 && (
              <span>· RTT restants : <strong className="text-teal-700">{employeeBalances.rttRemaining}j</strong></span>
            )}
          </span>
        </div>
      </div>

      {/* Action Controls & View Switcher */}
      <div className="flex items-center justify-between gap-2">
        {/* View Switcher */}
        <div className="inline-flex p-1 bg-slate-200/70 rounded-lg text-xs font-medium">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>Liste</span>
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'calendar'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Grille</span>
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5">
          {daysEntries.some(([d]) => d === todayStr) && (
            <button
              onClick={scrollToToday}
              className="text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Aujourd'hui</span>
            </button>
          )}

          <button
            onClick={handleExportICS}
            title="Exporter vers mon agenda (iPhone, Android, Outlook)"
            className="text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 p-2 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
          </button>

          <button
            onClick={onOpenHistory}
            title="Historique des modifications"
            className="text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 p-2 rounded-lg transition-colors"
          >
            <History className="w-3.5 h-3.5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="space-y-3 py-6">
          <div className="h-16 bg-slate-200/60 rounded-xl animate-pulse" />
          <div className="h-16 bg-slate-200/60 rounded-xl animate-pulse" />
          <div className="h-16 bg-slate-200/60 rounded-xl animate-pulse" />
        </div>
      ) : daysEntries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800">
            Aucun planning disponible pour ce mois
          </h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Le planning du mois sélectionné n'a pas encore été renseigné ou importé.
          </p>
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualiser l'affichage</span>
          </button>
        </div>
      ) : viewMode === 'list' ? (
        /* List Mode: Clean card with date abbreviation on left & centered enlarged bubble */
        <div className="space-y-2.5">
          {daysEntries.map(([dateStr, dayShift]) => {
            const isToday = dateStr === todayStr;
            const weekday = formatWeekdayFrench(dateStr);
            const isWeekend = weekday === 'samedi' || weekday === 'dimanche';
            const dayNum = dateStr.split('-')[2];
            const dayInfo = monthDayNotes[dateStr] || '';

            return (
              <div
                key={dateStr}
                ref={isToday ? todayRef : null}
                className={`relative rounded-2xl border p-3.5 transition-all bg-white flex flex-col justify-center ${
                  isToday
                    ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm'
                    : 'border-slate-200 shadow-2xs hover:border-slate-300'
                }`}
              >
                {/* Main Row: Left abbreviation & Center enlarged bubble */}
                <div className="flex items-center justify-between gap-3">
                  {/* Left: Abbreviation of the date */}
                  <div
                    className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl shrink-0 ${
                      isToday
                        ? 'bg-emerald-600 text-white font-bold shadow-xs'
                        : isWeekend
                        ? 'bg-slate-100 text-slate-700 border border-slate-200'
                        : 'bg-emerald-50 text-emerald-950 font-semibold border border-emerald-200/60'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-bold leading-tight">
                      {weekday.slice(0, 3)}
                    </span>
                    <span className="text-base font-extrabold leading-tight tabular-nums">
                      {dayNum}
                    </span>
                  </div>

                  {/* Center: Enlarged, centered shift and hours bubble */}
                  <div className="flex-1 flex items-center justify-center px-2">
                    {renderEnlargedShiftBadge(dayShift.shift, dayShift.hours)}
                  </div>

                  {/* Right: Today Pill or placeholder to keep perfect balance */}
                  <div className="w-12 shrink-0 flex justify-end">
                    {isToday && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/90 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        Auj.
                      </span>
                    )}
                  </div>
                </div>

                {/* Information sur le jour (en dessous du jour concerné, en plus petit que la pastille horaire) */}
                {dayInfo ? (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => handleOpenDayNoteModal(dateStr)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50/90 hover:bg-amber-100/90 text-amber-950 border border-amber-200/90 rounded-lg text-xs font-semibold shadow-2xs max-w-full transition-colors cursor-pointer group"
                      title="Cliquer pour modifier ou consulter cette information du jour"
                    >
                      <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 group-hover:scale-110 transition-transform" />
                      <span className="truncate">{dayInfo}</span>
                    </button>
                  </div>
                ) : isResponsableAdmin ? (
                  <div className="mt-1 flex justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleOpenDayNoteModal(dateStr)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-amber-800 transition-colors"
                    >
                      + Ajouter une info
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        /* Calendar Grid Mode */
        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs">
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d, i) => (
              <span
                key={d}
                className={`text-[11px] font-bold ${
                  i >= 5 ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarGrid.map((cell, idx) => {
              if (!cell.dayNumber) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="h-20 bg-slate-50/40 rounded-lg border border-dashed border-slate-100"
                  />
                );
              }

              const isToday = cell.dateKey === todayStr;
              const shift = cell.shiftData?.shift || '';
              const hours = cell.shiftData?.hours;
              const cellDayInfo = cell.dateKey ? (monthDayNotes[cell.dateKey] || '') : '';

              return (
                <div
                  key={cell.dateKey}
                  ref={isToday ? todayRef : null}
                  className={`min-h-[82px] p-1.5 rounded-lg border flex flex-col justify-between transition-colors ${
                    isToday
                      ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500'
                      : 'border-slate-100 bg-white hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        isToday
                          ? 'w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]'
                          : 'text-slate-700'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {cellDayInfo && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title={cellDayInfo} />
                    )}
                  </div>

                  {shift ? (
                    <div className="mt-1">
                      <ShiftBadge shift={shift} hours={hours} compact={true} />
                      {hours && (
                        <p className="text-[9px] text-slate-500 truncate mt-0.5 font-medium leading-none">
                          {formatHoursReadable(hours)}
                        </p>
                      )}
                      {cellDayInfo && (
                        <button
                          type="button"
                          onClick={() => cell.dateKey && handleOpenDayNoteModal(cell.dateKey)}
                          className="mt-1 w-full text-left text-[8.5px] font-semibold text-amber-950 bg-amber-100/90 hover:bg-amber-200 border border-amber-300/80 px-1 py-0.5 rounded truncate leading-tight flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                          title={`Information : ${cellDayInfo} (Cliquer pour modifier)`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                          <span className="truncate">{cellDayInfo}</span>
                        </button>
                      )}
                    </div>
                  ) : cellDayInfo ? (
                    <button
                      type="button"
                      onClick={() => cell.dateKey && handleOpenDayNoteModal(cell.dateKey)}
                      className="mt-1 w-full text-left text-[8.5px] font-semibold text-amber-950 bg-amber-100/90 hover:bg-amber-200 border border-amber-300/80 px-1 py-0.5 rounded truncate leading-tight flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                      title={`Information : ${cellDayInfo} (Cliquer pour modifier)`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="truncate">{cellDayInfo}</span>
                    </button>
                  ) : (
                    <div className="text-[10px] text-slate-300 italic">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day Note Modal for consultation & quick modification */}
      <DayNoteModal
        isOpen={isDayNoteModalOpen}
        onClose={() => setIsDayNoteModalOpen(false)}
        dateKey={targetNoteDate}
        monthKey={selectedMonth}
        initialNote={targetInitialNote}
        onSaved={() => {
          setNotesVersion((v) => v + 1);
          onRefresh();
        }}
      />
    </div>
  );
};
