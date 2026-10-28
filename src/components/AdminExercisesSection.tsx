import React, { useMemo, useState } from 'react';
import { CalendarDays, Eye, EyeOff, Plus, Trash2, AlertTriangle } from 'lucide-react';
import type { MonthItem } from '../types/planning';
import { getExerciseMonthItems, getExerciseStartYear, getCurrentExerciseStartYear } from '../shared/planning';

interface AdminExercisesSectionProps {
  allMonths: MonthItem[];
  visibleMonths: string[];
  /** Enregistre la nouvelle liste de mois et de mois visibles ; supprime les données des mois listés dans deletedMonthKeys. */
  onApply: (allMonths: MonthItem[], visibleMonths: string[], deletedMonthKeys?: string[]) => Promise<void>;
  showToast: (type: 'success' | 'error', text: string) => void;
}

const exerciseLabel = (startYear: number) => `${startYear}-${startYear + 1}`;

/**
 * Gestion des mois PAR EXERCICE (1er juin → 31 mai) : chaque exercice est une entité distincte,
 * on ne crée ni ne supprime jamais un mois isolé. La visibilité commande l'affichage du planning
 * dans les vues « Mon planning », « Équipe » et « Heures ».
 */
export const AdminExercisesSection: React.FC<AdminExercisesSectionProps> = ({
  allMonths,
  visibleMonths,
  onApply,
  showToast,
}) => {
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const exercises = useMemo(() => {
    const byYear = new Map<number, MonthItem[]>();
    for (const m of allMonths) {
      const y = getExerciseStartYear(m.key);
      byYear.set(y, [...(byYear.get(y) || []), m]);
    }
    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([startYear, months]) => ({ startYear, months: months.sort((a, b) => a.key.localeCompare(b.key)) }));
  }, [allMonths]);

  const nextStartYear = exercises.length ? exercises[exercises.length - 1].startYear + 1 : getCurrentExerciseStartYear();

  const apply = async (all: MonthItem[], vis: string[], deleted: string[] = []) => {
    setBusy(true);
    try {
      await onApply(all, vis, deleted);
    } finally {
      setBusy(false);
    }
  };

  const toggleMonth = async (key: string) => {
    const next = visibleMonths.includes(key) ? visibleMonths.filter((k) => k !== key) : [...visibleMonths, key];
    if (next.length === 0) {
      showToast('error', 'Au moins un mois doit rester visible.');
      return;
    }
    await apply(allMonths, next);
  };

  const toggleExercise = async (startYear: number, show: boolean) => {
    const keys = exercises.find((e) => e.startYear === startYear)?.months.map((m) => m.key) || [];
    const next = show
      ? [...visibleMonths, ...keys.filter((k) => !visibleMonths.includes(k))]
      : visibleMonths.filter((k) => !keys.includes(k));
    if (next.length === 0) {
      showToast('error', 'Au moins un mois doit rester visible.');
      return;
    }
    await apply(allMonths, next);
    showToast('success', `Exercice ${exerciseLabel(startYear)} ${show ? 'affiché' : 'masqué'} dans les vues.`);
  };

  const addNextExercise = async () => {
    const items = getExerciseMonthItems(nextStartYear).filter((it) => !allMonths.some((m) => m.key === it.key));
    if (items.length === 0) {
      showToast('error', 'Cet exercice existe déjà.');
      return;
    }
    await apply([...allMonths, ...items], [...visibleMonths, ...items.map((i) => i.key)]);
    showToast('success', `Exercice ${exerciseLabel(nextStartYear)} ajouté : 12 mois créés, journées générées pour tous les salariés.`);
  };

  const confirmDelete = async () => {
    if (toDelete === null) return;
    const label = exerciseLabel(toDelete);
    if (confirmText.trim() !== label) return;
    const ex = exercises.find((e) => e.startYear === toDelete);
    if (!ex) return;
    if (exercises.length <= 1) {
      showToast('error', "Impossible de supprimer l'unique exercice.");
      setToDelete(null);
      return;
    }
    const keys = ex.months.map((m) => m.key);
    const remaining = allMonths.filter((m) => !keys.includes(m.key));
    const vis = visibleMonths.filter((k) => !keys.includes(k));
    if (vis.length === 0 && remaining.length > 0) vis.push(remaining[0].key);
    setToDelete(null);
    setConfirmText('');
    await apply(remaining, vis, keys);
    showToast('success', `Exercice ${label} supprimé.`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <CalendarDays className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Exercices (1er juin → 31 mai)</h3>
            <p className="text-xs text-slate-600 mt-1">
              Chaque exercice regroupe ses 12 mois. Un exercice ou un mois <strong>visible</strong> apparaît dans « Mon planning »,
              « Équipe » et « Heures » ; masqué, il reste enregistré mais n'est plus consultable par les salariés.
            </p>
          </div>
        </div>
      </div>

      {exercises.map((ex) => {
        const shown = ex.months.filter((m) => visibleMonths.includes(m.key)).length;
        const allShown = shown === ex.months.length;
        return (
          <div key={ex.startYear} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Exercice {exerciseLabel(ex.startYear)}</h4>
                <p className="text-xs text-slate-500">
                  {ex.months.length} mois · {shown} visible{shown > 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleExercise(ex.startYear, !allShown)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {allShown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {allShown ? "Masquer l'exercice" : "Afficher l'exercice"}
                </button>
                {exercises.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setToDelete(ex.startYear);
                      setConfirmText('');
                    }}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-60"
                    title="Supprimer l'exercice"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {ex.months.map((m) => {
                const on = visibleMonths.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleMonth(m.key)}
                    className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-60 ${
                      on
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-400 line-through'
                    }`}
                    title={on ? 'Visible — cliquer pour masquer' : 'Masqué — cliquer pour afficher'}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-900">Exercice suivant : {exerciseLabel(nextStartYear)}</p>
          <p className="text-xs text-emerald-800/80">
            Crée les 12 mois (juin → mai) et génère les journées de tous les salariés : férié, repos le week-end, journée de
            base le reste du temps. Les exercices existants ne sont jamais modifiés.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={addNextExercise}
          className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          Ajouter l'exercice
        </button>
      </div>

      {toDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 space-y-3 shadow-xl">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <h4 className="text-sm font-bold">Supprimer l'exercice {exerciseLabel(toDelete)} ?</h4>
            </div>
            <p className="text-xs text-slate-600">
              Les plannings et notes des 12 mois de cet exercice seront définitivement supprimés. Pense à faire une sauvegarde
              avant. Pour confirmer, saisis <strong>{exerciseLabel(toDelete)}</strong> :
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={exerciseLabel(toDelete)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToDelete(null)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={confirmText.trim() !== exerciseLabel(toDelete)}
                onClick={confirmDelete}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-40"
              >
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
