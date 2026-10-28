import React from 'react';
import { Employee } from '../types/planning';
import { RefreshCw, ChevronDown, Sun, Moon } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { useTheme } from '../hooks/useTheme';

interface HeaderProps {
  storeName?: string;
  currentEmployee: Employee | null;
  onOpenProfileSelector: () => void;
  onRefresh: () => void;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  isRealtimeConnected?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  storeName,
  currentEmployee,
  onOpenProfileSelector,
  onRefresh,
  isSyncing,
  lastSyncTime,
  isRealtimeConnected = true,
}) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 text-slate-900 dark:text-white shadow-xs dark:shadow-md border-b border-slate-200 dark:border-slate-800/80 backdrop-blur-md transition-colors duration-200">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        {/* Brand Zone */}
        <div className="flex items-center gap-2.5 min-w-0">
          <AppLogo size="sm" variant="symbol" className="border border-slate-200 dark:border-slate-700/60 shadow-2xs" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-tight truncate flex items-center gap-1">
                <span>{storeName && storeName !== 'CanoShift' ? storeName : 'CanoShift'}</span>
              </h1>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  isRealtimeConnected
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30'
                    : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30'
                }`}
                title={
                  isRealtimeConnected
                    ? 'Connecté en direct à la base de données CanoShift'
                    : 'Tentative de reconnexion temps réel...'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isRealtimeConnected ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-amber-500 dark:bg-amber-400'
                  }`}
                />
                {isRealtimeConnected ? 'Direct' : 'Sync'}
              </span>
            </div>
          </div>
        </div>

        {/* Action & Profile Zone */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Theme Switcher (Sun / Moon) */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
            title={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-emerald-700" />
            )}
          </button>

          {/* Refresh Action */}
          <button
            onClick={onRefresh}
            disabled={isSyncing}
            title={
              lastSyncTime
                ? `Dernière synchro: ${lastSyncTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Synchroniser le planning'
            }
            aria-label="Synchroniser le planning"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isSyncing ? 'animate-spin text-emerald-600 dark:text-emerald-400' : ''}`}
            />
          </button>

          {/* Profile Switcher */}
          <button
            onClick={onOpenProfileSelector}
            className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 transition-colors text-left"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-xs"
              style={{ backgroundColor: currentEmployee?.color || '#166534' }}
            >
              {currentEmployee ? currentEmployee.name.charAt(0) : '?'}
            </div>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[85px] truncate">
              {currentEmployee ? currentEmployee.name : 'Choisir'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          </button>
        </div>
      </div>
    </header>
  );
};
