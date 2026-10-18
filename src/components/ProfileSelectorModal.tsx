import React from 'react';
import { Employee } from '../types/planning';
import { Check, X, ArrowRight, LockKeyhole } from 'lucide-react';

interface ProfileSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  currentEmployee: Employee | null;
  onSelectEmployee: (emp: Employee) => void;
  onLockToTokenGate?: () => void;
}

export const ProfileSelectorModal: React.FC<ProfileSelectorModalProps> = ({
  isOpen,
  onClose,
  employees,
  currentEmployee,
  onSelectEmployee,
  onLockToTokenGate,
}) => {
  if (!isOpen) return null;

  const handleChooseEmployee = (emp: Employee) => {
    onSelectEmployee(emp);
    onClose();
  };

  const handleLockAndExit = () => {
    if (onLockToTokenGate) {
      onLockToTokenGate();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[85vh] text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div>
            <h2 className="text-base font-bold text-white">
              Choisir mon profil
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sélectionnez votre profil pour consulter votre planning
            </p>
          </div>
          {currentEmployee && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Employee List */}
        <div className="p-4 overflow-y-auto space-y-2">
          {employees.map((emp) => {
            const isSelected = currentEmployee?.name === emp.name;
            return (
              <button
                key={emp.name}
                onClick={() => handleChooseEmployee(emp)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-950/40 ring-1 ring-emerald-500/40'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-800/60 active:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-xs shrink-0"
                    style={{ backgroundColor: emp.color }}
                  >
                    {emp.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {emp.name}
                      </span>
                      {emp.role && (
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-medium border border-slate-700">
                          {emp.role}
                        </span>
                      )}
                      {(emp.isAdmin ||
                        (emp.role && emp.role.trim().toLowerCase().includes('responsable')) ||
                        emp.name.trim().toLowerCase() === 'responsable') && (
                        <span className="text-[10px] bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded font-bold border border-emerald-500/30 flex items-center gap-1">
                          <span>Admin</span>
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">
                      Consulter le planning
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {isSelected ? (
                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-slate-950">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  ) : (
                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer: Quitter vers l'écran de sécurité (Token Gate) */}
        {onLockToTokenGate && (
          <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-center">
            <button
              onClick={handleLockAndExit}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-semibold text-rose-400 bg-rose-950/40 hover:bg-rose-950/60 rounded-xl transition-colors border border-rose-800/40 active:scale-[0.99]"
            >
              <LockKeyhole className="w-3.5 h-3.5 text-rose-400" />
              <span>Verrouiller & Revenir à l'écran de sécurité</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
