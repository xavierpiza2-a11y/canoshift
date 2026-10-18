import React from 'react';
import { categorizeShift, formatHoursReadable } from '../config/constants';
import { getCategoryDetails } from '../config/categoryStyles';
import { getStoredTableau2Shifts } from '../services/api';

interface ShiftBadgeProps {
  shift: string;
  hours?: string;
  compact?: boolean;
  showHours?: boolean;
}

export const ShiftBadge: React.FC<ShiftBadgeProps> = ({
  shift,
  hours,
  compact = false,
  showHours = true,
}) => {
  // Determine shift category & color: check if exact match in stored Créneaux first
  let detectedCategory = '';
  let shiftColor: string | undefined = undefined;
  if (typeof window !== 'undefined') {
    const storedCreneaux = getStoredTableau2Shifts();
    const match = storedCreneaux.find(
      (opt) =>
        opt.label === shift ||
        opt.shift === shift ||
        (opt.shift === shift && opt.hours === hours)
    );
    if (match?.category) {
      detectedCategory = match.category;
    }
    if (match?.color) {
      shiftColor = match.color;
    }
  }

  if (!detectedCategory) {
    detectedCategory = categorizeShift(shift, hours);
  }

  const catDetails = getCategoryDetails(detectedCategory, shiftColor);
  const Icon = catDetails.Icon;

  // Format label: if shift is HORAIRE and hours exists, show hours
  let label = shift || 'Non défini';
  if (shift.toUpperCase() === 'HORAIRE' && hours) {
    label = hours;
  } else if (!shift && hours) {
    label = hours;
  }

  if (compact) {
    return (
      <span
        title={`${catDetails.name} · ${label}${hours && hours !== label ? ` (${hours})` : ''}`}
        className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] font-medium rounded-md border ${catDetails.badgeBg} ${catDetails.badgeText} ${catDetails.badgeBorder} whitespace-nowrap shadow-2xs select-none`}
      >
        {/* Pastille ronde qui correspond strictement à la catégorie */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${catDetails.dot} ring-1 ring-black/15 shadow-2xs`}
          aria-hidden="true"
        />
        {/* Logo/icône associé à la catégorie */}
        <Icon className="w-3 h-3 shrink-0 opacity-80" />
        <span className="truncate max-w-[105px] font-semibold">{label}</span>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div
        className={`inline-flex items-center gap-2 px-2.5 py-1 text-xs font-semibold rounded-lg border ${catDetails.badgeBg} ${catDetails.badgeText} ${catDetails.badgeBorder} shadow-2xs`}
      >
        {/* Pastille ronde de la catégorie */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${catDetails.dot} ring-1 ring-black/20`}
        />
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-85" />
        <span>{label}</span>
      </div>
      {showHours && hours && hours !== label && (
        <span className="text-xs text-slate-700 font-medium tracking-tight">
          {formatHoursReadable(hours)}
        </span>
      )}
    </div>
  );
};
