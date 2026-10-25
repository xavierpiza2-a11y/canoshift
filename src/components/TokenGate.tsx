import React, { useState } from 'react';
import { verifyApiTokenWithStore, setApiToken, setActiveStore } from '../services/api';
import { KeyRound, ShieldCheck, ArrowRight, AlertCircle, Eye, EyeOff, Lock, Store, Sun, Moon } from 'lucide-react';
import { SuperAdminModal } from './SuperAdminModal';
import { AppLogo } from './AppLogo';
import { BrandFooter } from './BrandFooter';
import { useTheme } from '../hooks/useTheme';

interface TokenGateProps {
  storeName?: string;
  infoMessage?: string;
  onTokenSuccess: (token: string, store?: { id: string; name: string; token: string }) => void;
}

export const TokenGate: React.FC<TokenGateProps> = ({ storeName, infoMessage, onTokenSuccess }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSuperAdminOpen, setIsSuperAdminOpen] = useState(false);
  const { isDark, toggleTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = tokenInput.trim().toUpperCase();

    if (!entered) {
      setErrorMessage("Veuillez saisir la clé d'accès.");
      return;
    }

    setIsValidating(true);
    setErrorMessage('');

    // Validation via base de données du serveur avec identification automatique du magasin
    const result = await verifyApiTokenWithStore(entered);

    if (result.valid) {
      setApiToken(entered);
      if (result.store) {
        setActiveStore(result.store);
      }
      setTimeout(() => {
        setIsValidating(false);
        onTokenSuccess(entered, result.store);
      }, 200);
    } else {
      setIsValidating(false);
      setErrorMessage("Clé d'accès incorrecte. Vérifiez auprès de votre responsable.");
    }
  };

  const handleSwitchToStoreFromSuperAdmin = async (store: { id: string; name: string; token: string }) => {
    // Ouvre une vraie session magasin avec la clé de ce magasin
    await verifyApiTokenWithStore(store.token);
    setActiveStore(store);
    setApiToken(store.token);
    onTokenSuccess(store.token, store);
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden transition-colors duration-200">
      {/* Theme switcher toggle button */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
        title={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
        className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-white/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-amber-300 transition-all shadow-md active:scale-95 cursor-pointer"
      >
        {isDark ? (
          <Sun className="w-4 h-4 text-amber-400" />
        ) : (
          <Moon className="w-4 h-4 text-emerald-800" />
        )}
      </button>

      {/* Background styling glow elements */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-500/15 dark:bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-emerald-700/15 dark:bg-emerald-800/25 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm z-10 space-y-5">
        {/* App Brand Header */}
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
            <AppLogo size="xl" variant="full" className="shadow-2xs" />
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-emerald-400/90 font-semibold mt-1">
              Gestion des Planning et Temps.
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 text-slate-800 dark:text-slate-100 transition-colors">
          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold mb-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Accès Sécurisé Magasin</span>
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Clé d'accès requise
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Saisissez la clé d'accès de votre établissement pour charger son planning en direct.
            </p>
          </div>

          {infoMessage && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2 shadow-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="font-medium leading-relaxed">{infoMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Clé d'accès :
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type={showToken ? 'text' : 'password'}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  autoFocus
                  placeholder="ex: CANOSHIFT"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setErrorMessage('');
                  }}
                  className="w-full pl-10 pr-10 py-3 text-sm font-mono tracking-wider font-semibold rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent uppercase placeholder:normal-case placeholder:font-sans"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errorMessage && (
                <div className="flex flex-col gap-1 text-rose-600 dark:text-rose-400 text-xs font-medium pt-1">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isValidating || !tokenInput.trim()}
              className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 dark:shadow-emerald-950/50 hover:shadow-xl active:scale-[0.98] cursor-pointer"
            >
              {isValidating ? (
                <span>Vérification...</span>
              ) : (
                <>
                  <span>Déverrouiller l'accès</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Super-Admin Direct Entry Point */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSuperAdminOpen(true)}
              className="w-full py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
            >
              <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Espace Gestionnaire Multi-Magasins</span>
            </button>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
              Accès protégé par mot de passe (Réseau & Multi-Boutiques)
            </p>
          </div>
        </div>
      </div>

      {/* Super Admin Modal */}
      <SuperAdminModal
        isOpen={isSuperAdminOpen}
        onClose={() => setIsSuperAdminOpen(false)}
        onSwitchToStore={handleSwitchToStoreFromSuperAdmin}
      />
    </div>
  );
};
