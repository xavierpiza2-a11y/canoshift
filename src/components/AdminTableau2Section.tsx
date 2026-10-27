import React, { useState } from 'react';
import { Tableau2ShiftOption } from '../types/planning';
import { DEFAULT_TABLEAU2_SHIFTS } from '../config/constants';
import {
  saveStoredTableau2Shifts,
  clearAllTableau2AndCategories,
  restoreExampleTableau2AndCategories,
} from '../services/api';
import {
  CATEGORY_COLORS,
  getCategoryDetails,
} from '../config/categoryStyles';
import {
  Clock,
  Plus,
  Trash2,
  Edit3,
  RotateCcw,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  SlidersHorizontal,
  Sparkles,
  Calendar,
  AlertTriangle,
} from 'lucide-react';

interface AdminTableau2SectionProps {
  tableau2Options: Tableau2ShiftOption[];
  onUpdateOptions: (newOptions: Tableau2ShiftOption[]) => void;
}

/**
 * Calculate duration in hours between 2 times HH:MM (e.g. "08:30" to "12:30" -> 4)
 */
function calculateTimeDiffHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map((v) => parseInt(v, 10) || 0);
  const [eh, em] = end.split(':').map((v) => parseInt(v, 10) || 0);
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 24 * 60; // handles midnight crossing
  const diffMins = endMins - startMins;
  return Math.max(0, Math.round((diffMins / 60) * 100) / 100);
}

/**
 * Format hours decimal into readable string (e.g. 7.5 -> "7h30", 4 -> "4h00")
 */
function formatDecimalToHoursMins(val?: number): string {
  if (val === undefined || isNaN(val) || val <= 0) return '0h00';
  const hours = Math.floor(val);
  const mins = Math.round((val - hours) * 60);
  return `${hours}h${mins.toString().padStart(2, '0')}`;
}

/**
 * Parses existing hours string into range components
 */
function parseHoursToRanges(hoursStr?: string) {
  if (!hoursStr) {
    return { amStart: '', amEnd: '', hasPm: false, pmStart: '', pmEnd: '' };
  }
  const clean = hoursStr.trim();
  const rangeRegex = /(\d{1,2})[h:](\d{2})\s*(?:[-/–—]|à)\s*(\d{1,2})[h:](\d{2})/gi;
  const matches: Array<{ s: string; e: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rangeRegex.exec(clean)) !== null) {
    matches.push({
      s: `${m[1].padStart(2, '0')}:${m[2]}`,
      e: `${m[3].padStart(2, '0')}:${m[4]}`,
    });
  }
  if (matches.length > 0) {
    const p1 = matches[0];
    const p2 = matches[1] || { s: '', e: '' };
    return {
      amStart: p1.s,
      amEnd: p1.e,
      hasPm: Boolean(p2.s && p2.e),
      pmStart: p2.s,
      pmEnd: p2.e,
    };
  }
  return { amStart: '', amEnd: '', hasPm: false, pmStart: '', pmEnd: '' };
}

export const AdminTableau2Section: React.FC<AdminTableau2SectionProps> = ({
  tableau2Options,
  onUpdateOptions,
}) => {
  // Modal state for Add/Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

  // Form Fields
  const [formLabel, setFormLabel] = useState('');
  const [formShiftCode, setFormShiftCode] = useState('');
  const [isCodeManuallyModified, setIsCodeManuallyModified] = useState(false);
  const [isWithoutHours, setIsWithoutHours] = useState(false);

  // AM Range
  const [amStart, setAmStart] = useState('08:30');
  const [amEnd, setAmEnd] = useState('12:30');

  // PM Range
  const [hasPm, setHasPm] = useState(true);
  const [pmStart, setPmStart] = useState('13:30');
  const [pmEnd, setPmEnd] = useState('17:00');

  // Manual hours decimal override if wanted
  const [customHoursDecimal, setCustomHoursDecimal] = useState<number | null>(null);

  // Styling & Status
  const [formColor, setFormColor] = useState('emerald');
  const [formDayStatus, setFormDayStatus] = useState<'PRESENT' | 'REPOS' | 'ABSENT'>('PRESENT');
  const [formDescription, setFormDescription] = useState('');

  // Modals for Wipe & Restore
  const [shiftToDelete, setShiftToDelete] = useState<Tableau2ShiftOption | null>(null);
  const [isWipeAllOpen, setIsWipeAllOpen] = useState(false);
  const [isRestoreExamplesOpen, setIsRestoreExamplesOpen] = useState(false);

  // Toast Notification
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 3500);
  };

  // --- AUTOMATIC CALCULATIONS ---
  const computedDuration: number = React.useMemo(() => {
    if (isWithoutHours) return 0;
    if (customHoursDecimal !== null && !isNaN(customHoursDecimal)) {
      return customHoursDecimal;
    }
    const amDiff = amStart && amEnd ? calculateTimeDiffHours(amStart, amEnd) : 0;
    const pmDiff = hasPm && pmStart && pmEnd ? calculateTimeDiffHours(pmStart, pmEnd) : 0;
    return Math.round((amDiff + pmDiff) * 100) / 100;
  }, [isWithoutHours, customHoursDecimal, amStart, amEnd, hasPm, pmStart, pmEnd]);

  const computedHoursString: string = React.useMemo(() => {
    if (isWithoutHours) return '';
    const parts: string[] = [];
    if (amStart && amEnd) {
      parts.push(`${amStart}-${amEnd}`);
    }
    if (hasPm && pmStart && pmEnd) {
      parts.push(`${pmStart}-${pmEnd}`);
    }
    return parts.join(' , ');
  }, [isWithoutHours, amStart, amEnd, hasPm, pmStart, pmEnd]);

  const fullDisplayLabel: string = React.useMemo(() => {
    const title = formLabel.trim() || 'NOUVEAU CRÉNEAU';
    if (!computedHoursString) return title;
    return `${title} · ${computedHoursString} (${formatDecimalToHoursMins(computedDuration)})`;
  }, [formLabel, computedHoursString, computedDuration]);

  // Sync Shift Code from Label Title if not manually modified
  const handleLabelChange = (newTitle: string) => {
    setFormLabel(newTitle);
    if (!isCodeManuallyModified) {
      // Auto-generate clean uppercase shift code
      const autoCode = newTitle
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      setFormShiftCode(autoCode || 'HORAIRE');
    }

    // Smart default for dayStatus if relevant keywords
    const upper = newTitle.toUpperCase();
    if (upper.includes('REPOS')) {
      setFormDayStatus('REPOS');
      setFormColor('slate');
      setIsWithoutHours(true);
    } else if (upper.includes('CONGE') || upper.includes('RTT') || upper.includes('MALADIE') || upper.includes('AT')) {
      setFormDayStatus('ABSENT');
      setFormColor('amber');
      setIsWithoutHours(true);
    } else if (upper.includes('FORMATION')) {
      setFormDayStatus('PRESENT');
      setFormColor('purple');
    } else if (upper.includes('SOIR') || upper.includes('FERMETURE')) {
      setFormColor('orange');
    } else if (upper.includes('MATIN') || upper.includes('OUVERTURE')) {
      setFormColor('sky');
    }
  };

  // Handlers for modifying time plage — automatically reset custom override so duration syncs in real-time
  const handleAmStartChange = (val: string) => {
    setAmStart(val);
    setCustomHoursDecimal(null);
  };

  const handleAmEndChange = (val: string) => {
    setAmEnd(val);
    setCustomHoursDecimal(null);
  };

  const handleHasPmChange = (checked: boolean) => {
    setHasPm(checked);
    setCustomHoursDecimal(null);
  };

  const handlePmStartChange = (val: string) => {
    setPmStart(val);
    setCustomHoursDecimal(null);
  };

  const handlePmEndChange = (val: string) => {
    setPmEnd(val);
    setCustomHoursDecimal(null);
  };

  // --- OPEN MODAL (ADD) ---
  const handleOpenAdd = () => {
    setEditingShiftId(null);
    setFormLabel('');
    setFormShiftCode('HORAIRE');
    setIsCodeManuallyModified(false);
    setIsWithoutHours(false);
    setAmStart('08:30');
    setAmEnd('12:30');
    setHasPm(true);
    setPmStart('13:30');
    setPmEnd('17:00');
    setCustomHoursDecimal(null);
    setFormColor('emerald');
    setFormDayStatus('PRESENT');
    setFormDescription('');
    setIsModalOpen(true);
  };

  // --- OPEN MODAL (EDIT) ---
  const handleOpenEdit = (opt: Tableau2ShiftOption) => {
    if (opt.locked) return; // catégorie de base : non modifiable
    setEditingShiftId(opt.id);
    const parsed = parseHoursToRanges(opt.hours);
    const hasRanges = Boolean(parsed.amStart && parsed.amEnd);

    // Extract title from label if it has " · "
    const rawTitle = opt.label.includes(' · ') ? opt.label.split(' · ')[0].trim() : opt.label;
    setFormLabel(rawTitle || opt.shift);
    setFormShiftCode(opt.shift);
    setIsCodeManuallyModified(true);
    setIsWithoutHours(!opt.hours && !hasRanges);

    if (hasRanges) {
      setAmStart(parsed.amStart);
      setAmEnd(parsed.amEnd);
      setHasPm(parsed.hasPm);
      setPmStart(parsed.pmStart || '13:30');
      setPmEnd(parsed.pmEnd || '17:00');
      // When shift has time ranges, do NOT freeze customHoursDecimal; compute live from ranges!
      setCustomHoursDecimal(null);
    } else {
      setAmStart('08:30');
      setAmEnd('12:30');
      setHasPm(false);
      setPmStart('13:30');
      setPmEnd('17:00');
      setCustomHoursDecimal(opt.hoursDecimal ?? null);
    }

    setFormColor(opt.color || 'emerald');
    setFormDayStatus(opt.dayStatus || 'PRESENT');
    setFormDescription(opt.description || '');
    setIsModalOpen(true);
  };

  // --- SAVE SHIFT (ADD / EDIT) ---
  const handleSaveShift = (e: React.FormEvent) => {
    e.preventDefault();

    const title = formLabel.trim();
    if (!title) {
      showNotification('error', 'Le libellé de l’horaire est obligatoire.');
      return;
    }

    const shiftCode = formShiftCode.trim().toUpperCase() || title.toUpperCase();
    const finalHours = isWithoutHours ? '' : computedHoursString;
    const isAt = shiftCode === 'AT' || /\bAT\b/i.test(shiftCode) || title.toUpperCase().includes('MALADIE');
    const finalDecimal = isWithoutHours
      ? (customHoursDecimal !== null && customHoursDecimal !== undefined ? customHoursDecimal : (isAt ? 7 : 0))
      : computedDuration;
    const finalLabel = fullDisplayLabel;

    if (editingShiftId) {
      // Update existing
      const updated = tableau2Options.map((opt) => {
        if (opt.id === editingShiftId) {
          return {
            ...opt,
            shift: shiftCode,
            hours: finalHours,
            hoursDecimal: finalDecimal,
            category: shiftCode,
            color: formColor,
            dayStatus: formDayStatus,
            label: finalLabel,
            description: formDescription.trim(),
          };
        }
        return opt;
      });
      saveStoredTableau2Shifts(updated);
      onUpdateOptions(updated);
      showNotification('success', `Créneau « ${finalLabel} » mis à jour.`);
    } else {
      // Create new
      const newId = `shift_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const newOption: Tableau2ShiftOption = {
        id: newId,
        shift: shiftCode,
        hours: finalHours,
        hoursDecimal: finalDecimal,
        category: shiftCode,
        color: formColor,
        dayStatus: formDayStatus,
        label: finalLabel,
        description: formDescription.trim(),
      };
      const updated = [...tableau2Options, newOption];
      saveStoredTableau2Shifts(updated);
      onUpdateOptions(updated);
      showNotification('success', `Nouveau créneau « ${newOption.label} » ajouté.`);
    }

    setIsModalOpen(false);
  };

  // --- REORDERING ---
  const handleMoveShift = (globalIndex: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? globalIndex - 1 : globalIndex + 1;
    if (targetIndex < 0 || targetIndex >= tableau2Options.length) return;

    const newOptions = [...tableau2Options];
    const [moved] = newOptions.splice(globalIndex, 1);
    newOptions.splice(targetIndex, 0, moved);

    saveStoredTableau2Shifts(newOptions);
    onUpdateOptions(newOptions);
  };

  const handleMoveToTop = (globalIndex: number) => {
    if (globalIndex <= 0) return;

    const newOptions = [...tableau2Options];
    const [moved] = newOptions.splice(globalIndex, 1);
    newOptions.unshift(moved);

    saveStoredTableau2Shifts(newOptions);
    onUpdateOptions(newOptions);
    showNotification('success', `« ${moved.label} » placé en tête de liste (1er choix sous Excel).`);
  };

  // --- QUICK TOGGLE STATUS ---
  const handleQuickUpdateDayStatus = (id: string, status: 'PRESENT' | 'REPOS' | 'ABSENT') => {
    const updated = tableau2Options.map((opt) =>
      opt.id === id ? { ...opt, dayStatus: status } : opt
    );
    saveStoredTableau2Shifts(updated);
    onUpdateOptions(updated);
    const label = status === 'PRESENT' ? 'Présent' : status === 'REPOS' ? 'Repos' : 'Absent';
    showNotification('success', `Statut Vue Jour réglé sur « ${label} »`);
  };

  // --- DELETE SHIFT ---
  const handleConfirmDelete = () => {
    if (!shiftToDelete || shiftToDelete.locked) return; // catégorie de base : non supprimable
    const updated = tableau2Options.filter((opt) => opt.id !== shiftToDelete.id);
    saveStoredTableau2Shifts(updated);
    onUpdateOptions(updated);
    const deletedLabel = shiftToDelete.label;
    setShiftToDelete(null);
    showNotification('success', `Créneau « ${deletedLabel} » supprimé.`);
  };

  // --- WIPE TO ZERO ---
  const handleConfirmWipeAll = async () => {
    const { shifts } = await clearAllTableau2AndCategories();
    onUpdateOptions(shifts);
    setIsWipeAllOpen(false);
    showNotification('success', 'Remise à zéro effectuée : créneaux vierges (page blanche).');
  };

  // --- RESTORE EXAMPLES ---
  const handleConfirmRestoreExamples = async () => {
    const { shifts } = await restoreExampleTableau2AndCategories();
    onUpdateOptions(shifts);
    setIsRestoreExamplesOpen(false);
    showNotification('success', 'Exemples de créneaux officiels rechargés avec succès.');
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-700" />
            <h3 className="text-sm font-bold text-slate-900">
              Gestion des Créneaux Horaires & Ordre Excel
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Définissez vos plages horaires au format 00:00-00:00 (AM/AP), choisissez leur couleur et organisez leur ordre pour Excel.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setIsWipeAllOpen(true)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 font-semibold text-xs border border-slate-200 transition-colors"
            title="Effacer tous les créneaux pour démarrer sur une page 100% blanche"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span>Remettre à zéro</span>
          </button>

          <button
            type="button"
            onClick={() => setIsRestoreExamplesOpen(true)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-100 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200 text-slate-700 font-semibold text-xs border border-slate-200 transition-colors"
            title="Recharger les exemples types de créneaux"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
            <span>Recharger les exemples</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Créer un créneau</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 animate-in fade-in duration-200 ${
            notification.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold'
              : 'bg-rose-50 border border-rose-200 text-rose-900 font-semibold'
          }`}
        >
          {notification.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Notice Banner */}
      <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 flex items-start sm:items-center justify-between gap-3 text-xs text-emerald-950 shadow-2xs">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="leading-snug">
            <strong>Ordre d'apparition dans Excel :</strong> Utilisez les flèches <span className="font-semibold text-emerald-800">▲ / ▼</span> ou <span className="font-semibold text-emerald-800">« En haut »</span> pour placer les créneaux les plus utilisés en début de menu déroulant.
          </span>
        </div>
        <span className="text-[11px] font-bold text-emerald-800 whitespace-nowrap bg-emerald-100/60 px-2 py-0.5 rounded-lg border border-emerald-200">
          {tableau2Options.length} créneau(x)
        </span>
      </div>

      {/* Shifts List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="divide-y divide-slate-100">
          {tableau2Options.map((opt, globalIndex) => {
            const shiftColorConfig =
              CATEGORY_COLORS.find((c) => c.id === opt.color) || CATEGORY_COLORS[0];
            const hoursDisplay = opt.hours || 'Sans horaire';
            const durationDisplay =
              opt.hoursDecimal && opt.hoursDecimal > 0
                ? formatDecimalToHoursMins(opt.hoursDecimal)
                : '0h00';

            return (
              <div
                key={opt.id}
                className="p-3 sm:p-4 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                {/* Left: Position, Badge, Label & Details */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Order Rank */}
                  <div
                    className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0"
                    title={`Rang #${globalIndex + 1} dans la liste déroulante Excel`}
                  >
                    #{globalIndex + 1}
                  </div>

                  {/* Shift Badge with direct color swatch */}
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg border shadow-2xs shrink-0 select-none ${shiftColorConfig.badgeBg} ${shiftColorConfig.badgeText} ${shiftColorConfig.badgeBorder}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${shiftColorConfig.dot} ring-1 ring-black/15`}
                    />
                    <span>{opt.shift}</span>
                  </span>

                  {/* Label & Hours */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {opt.label}
                      </p>

                      {/* Day status badge with 1-click toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const current = opt.dayStatus || 'PRESENT';
                          const next =
                            current === 'PRESENT'
                              ? 'REPOS'
                              : current === 'REPOS'
                              ? 'ABSENT'
                              : 'PRESENT';
                          handleQuickUpdateDayStatus(opt.id, next);
                        }}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-2xs flex items-center gap-1 ${
                          opt.dayStatus === 'REPOS'
                            ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                            : opt.dayStatus === 'ABSENT'
                            ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200'
                        }`}
                        title="Cliquer pour changer : Présent -> Repos -> Absent"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            opt.dayStatus === 'REPOS'
                              ? 'bg-slate-500'
                              : opt.dayStatus === 'ABSENT'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                        />
                        <span>
                          {opt.dayStatus === 'REPOS'
                            ? 'Vue Jour : Repos'
                            : opt.dayStatus === 'ABSENT'
                            ? 'Vue Jour : Absent'
                            : 'Vue Jour : Présent'}
                        </span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                      <span className="font-mono text-emerald-800 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/50">
                        {hoursDisplay}
                      </span>
                      {opt.hoursDecimal !== undefined && opt.hoursDecimal > 0 && (
                        <span className="font-bold text-slate-700">
                          {opt.hoursDecimal}h ({durationDisplay})
                        </span>
                      )}
                      {opt.description && (
                        <span className="text-slate-400 truncate">
                          · {opt.description}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Reorder & Edit/Delete Buttons */}
                <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                  {opt.locked && (
                    <span
                      className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold border border-slate-200 mr-1"
                      title="Catégorie de base : non modifiable et non supprimable (l'ordre reste modifiable)"
                    >
                      🔒 Verrouillé
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleMoveToTop(globalIndex)}
                    disabled={globalIndex === 0}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-800 hover:bg-emerald-50 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                    title="Placer tout en haut (1er choix dans Excel)"
                  >
                    <ArrowUpToLine className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMoveShift(globalIndex, 'up')}
                    disabled={globalIndex === 0}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-800 hover:bg-emerald-50 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                    title="Monter d'un rang"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMoveShift(globalIndex, 'down')}
                    disabled={globalIndex === tableau2Options.length - 1}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-800 hover:bg-emerald-50 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                    title="Descendre d'un rang"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {!opt.locked && (
                  <>
                  <div className="w-px h-4 bg-slate-200 mx-1" />

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(opt)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                    title="Modifier ce créneau"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShiftToDelete(opt)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Supprimer ce créneau"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </>
                  )}
                </div>
              </div>
            );
          })}

          {tableau2Options.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-xs">
              <div className="p-6 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 space-y-3 max-w-md mx-auto">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">
                    Page blanche · Aucun créneau configuré
                  </p>
                  <p className="text-xs text-slate-500">
                    Tous les créneaux ont été remis à zéro. Vous êtes libre de créer vos propres horaires sur-mesure ou de recharger les exemples de base.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={handleOpenAdd}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Créer un créneau</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRestoreExamplesOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                    <span>Recharger les exemples</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: CRÉER / MODIFIER UN CRÉNEAU */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto space-y-4 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {editingShiftId ? 'Modifier le créneau horaire' : 'Créer un nouveau créneau horaire'}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Module intuitif de saisie avec plages AM/AP au format 00:00-00:00
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveShift} className="space-y-4">
              {/* 1. Libellé et Code Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Libellé manuel *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: OUVERTURE, MATIN, FERMETURE, REPOS..."
                    value={formLabel}
                    onChange={(e) => handleLabelChange(e.target.value)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                  />
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    La plage horaire sera automatiquement rattachée à ce libellé.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Code Shift (automatique)
                    </label>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Pour le planning Excel</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={formShiftCode}
                    onChange={(e) => {
                      setFormShiftCode(e.target.value.toUpperCase());
                      setIsCodeManuallyModified(true);
                    }}
                    className="w-full text-xs font-mono font-black text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-600 uppercase shadow-xs"
                  />
                </div>
              </div>

              {/* 2. Plages Horaires AM & AP (Format 00:00-00:00) */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Plages horaires du créneau (00:00-00:00) :</span>
                  </span>

                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={isWithoutHours}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsWithoutHours(checked);
                        if (checked) {
                          setFormDayStatus('REPOS');
                        } else {
                          setFormDayStatus('PRESENT');
                        }
                      }}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Sans horaire (Repos, Congé, RTT...)</span>
                  </label>
                </div>

                {!isWithoutHours ? (
                  <div className="space-y-3 pt-1">
                    {/* Plage 1: Matin (AM) */}
                    <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                          Plage 1 (Matin / AM)
                        </span>
                        {amStart && amEnd && (
                          <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60">
                            {amStart}-{amEnd} ({formatDecimalToHoursMins(calculateTimeDiffHours(amStart, amEnd))})
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Heure début (00:00)
                          </label>
                          <input
                            type="time"
                            value={amStart}
                            onChange={(e) => handleAmStartChange(e.target.value)}
                            className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-600 focus:outline-none shadow-2xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Heure fin (00:00)
                          </label>
                          <input
                            type="time"
                            value={amEnd}
                            onChange={(e) => handleAmEndChange(e.target.value)}
                            className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-600 focus:outline-none shadow-2xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Checkbox for 2nd range */}
                    <div className="flex items-center justify-between px-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800 dark:text-slate-200 select-none">
                        <input
                          type="checkbox"
                          checked={hasPm}
                          onChange={(e) => handleHasPmChange(e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>Ajouter une 2ème plage (Après-midi / AP - Coupure)</span>
                      </label>
                    </div>

                    {/* Plage 2: Après-midi (AP) */}
                    {hasPm && (
                      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                            Plage 2 (Après-midi / AP)
                          </span>
                          {pmStart && pmEnd && (
                            <span className="text-[11px] font-mono font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-800">
                              {pmStart}-{pmEnd} ({formatDecimalToHoursMins(calculateTimeDiffHours(pmStart, pmEnd))})
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                              Heure début (00:00)
                            </label>
                            <input
                              type="time"
                              value={pmStart}
                              onChange={(e) => handlePmStartChange(e.target.value)}
                              className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-600 focus:outline-none shadow-2xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                              Heure fin (00:00)
                            </label>
                            <input
                              type="time"
                              value={pmEnd}
                              onChange={(e) => handlePmEndChange(e.target.value)}
                              className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-600 focus:outline-none shadow-2xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Total Duration calculated automatically */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-emerald-700" />
                          <span className="font-bold text-slate-800">Durée comptabilisée automatique :</span>
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.5 rounded-md">
                            Temps réel
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-emerald-800 font-medium">
                          Format rattaché : <strong className="text-emerald-950 font-bold">{computedHoursString || '—'}</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <input
                              type="number"
                              step="0.25"
                              min="0"
                              max="24"
                              value={computedDuration}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setCustomHoursDecimal(isNaN(val) ? 0 : val);
                              }}
                              className="w-16 px-1.5 py-0.5 text-right text-base font-extrabold text-emerald-950 font-mono bg-white border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none shadow-2xs"
                              title="Ajustement manuel possible (se recalcule automatiquement dès modification des plages)"
                            />
                            <span className="text-base font-extrabold text-emerald-950 font-mono">h</span>
                          </div>
                          <p className="text-[10px] font-bold text-emerald-800">
                            ({formatDecimalToHoursMins(computedDuration)})
                          </p>
                        </div>
                        {customHoursDecimal !== null && (
                          <button
                            type="button"
                            onClick={() => setCustomHoursDecimal(null)}
                            title="Rétablir le calcul automatique d'après la plage"
                            className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-100 rounded transition-colors text-xs flex items-center gap-0.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-800">Créneau sans plage horaire</span>
                      <p className="text-[11px] text-slate-500">
                        {formShiftCode === 'AT' || /\bAT\b/i.test(formShiftCode) || formLabel.toUpperCase().includes('MALADIE')
                          ? 'Comptabilisé 7h en temps de travail (ou 1j en forfait jour)'
                          : 'Durée comptabilisée par défaut'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-600">Durée :</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        value={
                          customHoursDecimal !== null && customHoursDecimal !== undefined
                            ? customHoursDecimal
                            : (formShiftCode === 'AT' || /\bAT\b/i.test(formShiftCode) || formLabel.toUpperCase().includes('MALADIE') ? 7 : 0)
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setCustomHoursDecimal(isNaN(val) ? 0 : val);
                        }}
                        className="w-16 px-2 py-1 text-right text-xs font-bold font-mono bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                      <span className="text-xs font-bold text-slate-700">h</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Choix de la couleur avec pastille & aperçu direct */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    Couleur du badge et de la pastille :
                  </label>
                  <span className="text-xs text-slate-600">
                    Sélection : <strong className="text-slate-900">{CATEGORY_COLORS.find((c) => c.id === formColor)?.label || formColor}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-h-40 overflow-y-auto p-1.5 bg-slate-50 rounded-2xl border border-slate-200">
                  {CATEGORY_COLORS.map((col) => {
                    const isSelected = formColor === col.id;
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => setFormColor(col.id)}
                        className={`flex items-center gap-1.5 p-2 rounded-xl text-xs font-bold border transition-all text-left shadow-2xs ${col.badgeBg} ${col.badgeText} ${col.badgeBorder} ${
                          isSelected
                            ? 'ring-2 ring-emerald-600 scale-[1.02]'
                            : 'opacity-85 hover:opacity-100 hover:scale-[1.01]'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot} ring-1 ring-black/20`} />
                        <span className="truncate">{col.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 ml-auto shrink-0 stroke-[3]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Statut Vue Jour & Remarque */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Statut Vue Jour Équipe
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      onClick={() => setFormDayStatus('PRESENT')}
                      className={`p-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition-all ${
                        formDayStatus === 'PRESENT'
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-950 ring-2 ring-emerald-500'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-black/10" />
                      <span>Présent</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormDayStatus('REPOS')}
                      className={`p-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition-all ${
                        formDayStatus === 'REPOS'
                          ? 'bg-slate-100 border-slate-400 text-slate-900 ring-2 ring-slate-500'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400 ring-1 ring-black/10" />
                      <span>Repos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormDayStatus('ABSENT')}
                      className={`p-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition-all ${
                        formDayStatus === 'ABSENT'
                          ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-500'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-1 ring-black/10" />
                      <span>Absent</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Description / Remarque (optionnel)
                  </label>
                  <input
                    type="text"
                    placeholder="ex: Vacation renfort samedi..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
                  />
                </div>
              </div>

              {/* 5. Aperçu Direct de la pastille et du libellé complet */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  Aperçu direct de l'affichage final :
                </span>
                <div className="flex items-center gap-2">
                  {(() => {
                    const previewColor =
                      CATEGORY_COLORS.find((c) => c.id === formColor) || CATEGORY_COLORS[0];
                    return (
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border shadow-2xs select-none ${previewColor.badgeBg} ${previewColor.badgeText} ${previewColor.badgeBorder}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${previewColor.dot} ring-1 ring-black/15`} />
                        <span>{formShiftCode || 'CODE'}</span>
                      </span>
                    );
                  })()}
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {fullDisplayLabel}
                  </span>
                </div>
              </div>

              {/* Actions Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
                >
                  {editingShiftId ? 'Enregistrer les modifications' : 'Créer le créneau'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION SUPPRESSION CRÉNEAU */}
      {shiftToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Supprimer ce créneau ?
              </h4>
              <p className="text-xs text-slate-700 font-semibold mt-1">
                « {shiftToDelete.label} »
              </p>
              <p className="text-[11px] text-slate-500">
                Cette suppression est immédiate dans l'application et retirera ce choix des futurs fichiers Excel exportés.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShiftToDelete(null)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION REMISE À ZÉRO (PAGE BLANCHE) */}
      {isWipeAllOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Remise à zéro complète (Page blanche) ?
              </h4>
              <p className="text-xs text-slate-500">
                Cette action va effacer <strong>tous les créneaux horaires</strong> pour vous laisser démarrer sur une page 100% vierge.
              </p>
              <p className="text-[11px] text-amber-700 font-medium pt-1">
                Vous serez libre de créer vos propres horaires sur-mesure. Vous pourrez aussi recharger les exemples à tout moment.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsWipeAllOpen(false)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmWipeAll}
                className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Tout remettre à zéro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION RECHARGER LES EXEMPLES */}
      {isRestoreExamplesOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <RotateCcw className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-sm font-bold text-slate-900">
                Recharger les exemples types ?
              </h4>
              <p className="text-xs text-slate-500">
                Les créneaux de référence officiels (Matin, Soir, Journée, Repos, Congés, RTT...) au format 00:00-00:00 seront réinjectés dans l'application.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsRestoreExamplesOpen(false)}
                className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmRestoreExamples}
                className="py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                Recharger les exemples
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
