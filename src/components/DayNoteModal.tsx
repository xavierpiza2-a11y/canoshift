import React, { useState, useEffect } from 'react';
import { X, Calendar, Check, Trash2, Tag, Info } from 'lucide-react';
import { updateDayNoteInStore } from '../services/api';

interface DayNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateKey: string;
  monthKey: string;
  initialNote?: string;
  onSaved?: (dateKey: string, noteText: string) => void;
}

const QUICK_SUGGESTIONS = [
  "Réunion d'équipe",
  "RDV Médecine du travail",
  "Inventaire rayon",
  "Livraison fournisseur",
  "Fermeture exceptionnelle",
  "Formation collective",
];

export const DayNoteModal: React.FC<DayNoteModalProps> = ({
  isOpen,
  onClose,
  dateKey,
  monthKey,
  initialNote = '',
  onSaved,
}) => {
  const [noteText, setNoteText] = useState(initialNote);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNoteText(initialNote || '');
    }
  }, [isOpen, initialNote]);

  if (!isOpen) return null;

  // Format date in French
  const formattedDate = (() => {
    try {
      const [y, m, d] = dateKey.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const str = date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      return str.charAt(0).toUpperCase() + str.slice(1);
    } catch {
      return dateKey;
    }
  })();

  const handleSave = () => {
    setIsSaving(true);
    const cleanNote = noteText.trim();
    updateDayNoteInStore(monthKey, dateKey, cleanNote);
    if (onSaved) {
      onSaved(dateKey, cleanNote);
    }
    setIsSaving(false);
    onClose();
  };

  const handleDelete = () => {
    setIsSaving(true);
    updateDayNoteInStore(monthKey, dateKey, '');
    if (onSaved) {
      onSaved(dateKey, '');
    }
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xl max-w-md w-full space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                Information du Jour
              </h4>
              <p className="text-[11px] font-semibold text-emerald-800">
                {formattedDate}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Suggestions */}
        <div>
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
            <Tag className="w-3 h-3 text-slate-400" />
            <span>Suggestions rapides</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => {
                  setNoteText((prev) => {
                    const trimmed = prev.trim();
                    if (!trimmed) return sug;
                    if (trimmed.includes(sug)) return trimmed;
                    return `${trimmed} · ${sug}`;
                  });
                }}
                className="text-[11px] bg-slate-100 hover:bg-emerald-50 hover:text-emerald-900 hover:border-emerald-300 border border-slate-200 text-slate-700 px-2 py-1 rounded-lg transition-colors font-medium"
              >
                + {sug}
              </button>
            ))}
          </div>
        </div>

        {/* Note input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>Détail de l'information / RDV / Réunion</span>
            {noteText && (
              <span className="text-[10px] text-slate-400 font-normal">
                {noteText.length} caractères
              </span>
            )}
          </label>
          <textarea
            autoFocus
            rows={3}
            placeholder="Ex : Réunion d'équipe à 14h, RDV médecine du travail, Inventaire rayon..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-slate-50/50 resize-none font-medium text-slate-800"
          />
          <div className="flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-200">
            <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Cette information s'affichera dans Mon Planning, la Vue par Jour, la Vue Mensuelle et les exports Excel et PDF.
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2">
          {initialNote ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-2 rounded-xl transition-colors font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Supprimer l'info</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Enregistrer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
