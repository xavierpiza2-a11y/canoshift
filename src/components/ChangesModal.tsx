import React from 'react';
import { ChangeEntry } from '../types/planning';
import { Bell, Check, X, AlertTriangle, ArrowRight } from 'lucide-react';
import { formatHoursReadable } from '../config/constants';

interface ChangesModalProps {
  isOpen: boolean;
  changes: ChangeEntry[];
  employeeName: string;
  onClose: () => void;
  onAcknowledge: () => void;
}

export const ChangesModal: React.FC<ChangesModalProps> = ({
  isOpen,
  changes,
  employeeName,
  onClose,
  onAcknowledge,
}) => {
  if (!isOpen || changes.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-amber-100 flex items-center justify-between bg-amber-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-950">Changement de planning !</h3>
              <p className="text-xs text-amber-800">Pour {employeeName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-amber-700 hover:text-amber-950 hover:bg-amber-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Changes List */}
        <div className="p-4 overflow-y-auto space-y-3">
          <p className="text-xs text-slate-600">
            Une ou plusieurs modifications ont été apportées récemment à votre planning :
          </p>

          <div className="space-y-2">
            {changes.map((change, idx) => (
              <div
                key={idx}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span>Date : {change.date}</span>
                  {change.timestamp && (
                    <span className="text-[10px] text-slate-400 font-normal">
                      {change.timestamp}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-slate-700 pt-1">
                  <span className="line-through text-slate-400">
                    {change.previousShift || 'Aucun'} {change.previousHours ? `(${change.previousHours})` : ''}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-emerald-800">
                    {change.newShift || 'Non défini'} {change.newHours ? `(${formatHoursReadable(change.newHours)})` : ''}
                  </span>
                </div>

                {change.comment && (
                  <p className="text-[11px] text-slate-500 italic mt-1">{change.comment}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
          <button
            onClick={onAcknowledge}
            className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>J'ai bien pris note</span>
          </button>
        </div>
      </div>
    </div>
  );
};
