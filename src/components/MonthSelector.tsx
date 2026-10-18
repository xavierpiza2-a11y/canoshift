import React from 'react';
import { MonthItem } from '../types/planning';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

interface MonthSelectorProps {
  allMonths: MonthItem[];
  visibleMonths: string[];
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
}

export const MonthSelector: React.FC<MonthSelectorProps> = ({
  allMonths,
  visibleMonths,
  selectedMonth,
  onSelectMonth,
}) => {
  // Filter months to only those visible or all if empty
  const activeMonthsList = allMonths.filter((m) =>
    visibleMonths.length > 0 ? visibleMonths.includes(m.key) : true
  );

  const currentIndex = activeMonthsList.findIndex((m) => m.key === selectedMonth);
  const currentItem =
    activeMonthsList[currentIndex] ||
    allMonths.find((m) => m.key === selectedMonth) || {
      key: selectedMonth,
      label: selectedMonth,
      tab: selectedMonth,
    };

  const handlePrev = () => {
    if (currentIndex > 0) {
      onSelectMonth(activeMonthsList[currentIndex - 1].key);
    }
  };

  const handleNext = () => {
    if (currentIndex < activeMonthsList.length - 1) {
      onSelectMonth(activeMonthsList[currentIndex + 1].key);
    }
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 shadow-sm p-2.5 flex items-center justify-between gap-2">
      <button
        onClick={handlePrev}
        disabled={currentIndex <= 0}
        aria-label="Mois précédent"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 min-w-0">
        <CalendarDays className="w-4 h-4 text-emerald-400 shrink-0" />
        <select
          value={selectedMonth}
          onChange={(e) => onSelectMonth(e.target.value)}
          aria-label="Sélectionner le mois"
          className="bg-transparent text-sm font-bold text-slate-100 focus:outline-none cursor-pointer truncate py-1 pr-6"
        >
          {activeMonthsList.map((m) => (
            <option key={m.key} value={m.key} className="bg-slate-900 text-slate-100">
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleNext}
        disabled={currentIndex >= activeMonthsList.length - 1}
        aria-label="Mois suivant"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};
