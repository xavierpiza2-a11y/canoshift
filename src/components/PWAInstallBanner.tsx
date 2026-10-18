import React, { useState } from 'react';
import { Download, X, Share, PlusSquare, HelpCircle, Smartphone, Monitor, ShieldAlert } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isHttpExternal, install } = usePWAInstall();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showTip, setShowTip] = useState(false);

  if (isInstalled || isDismissed) return null;

  // Show if installable, on iOS, or if accessed via external HTTP (where automatic prompt is blocked by browser)
  if (!isInstallable && !isIOS && !isHttpExternal) return null;

  return (
    <div className="bg-slate-900/95 backdrop-blur-md text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3 text-xs border-b border-slate-800">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-emerald-950 flex items-center justify-center shrink-0 border border-emerald-500/40">
          <Download className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-white truncate">Installer CanoShift</p>
          <p className="text-[10px] text-slate-400 truncate">
            {isHttpExternal
              ? 'Installer sur écran d’accueil (Mode IP / HTTP)'
              : 'Accès direct 1-clic et consultation hors ligne'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isInstallable ? (
          <button
            onClick={install}
            className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded-md hover:bg-emerald-500 transition-colors shadow-2xs"
          >
            Installer
          </button>
        ) : (
          <button
            onClick={() => setShowTip(!showTip)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 rounded-md hover:bg-slate-700 transition-colors shadow-2xs"
          >
            <HelpCircle className="w-3 h-3 text-emerald-400" />
            <span>{isIOS ? 'Astuce iPhone' : 'Comment installer ?'}</span>
          </button>
        )}

        <button
          onClick={() => setIsDismissed(true)}
          className="p-1 text-slate-400 hover:text-white rounded"
          aria-label="Fermer la bannière"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {showTip && (
        <div className="fixed inset-x-4 top-14 sm:inset-x-auto sm:right-6 sm:w-96 z-50 bg-slate-900 text-slate-100 p-4 rounded-2xl shadow-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between font-bold text-xs text-white border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              Installation CanoShift sur smartphone / PC
            </span>
            <button
              onClick={() => setShowTip(false)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isHttpExternal && !isIOS && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p>
                Sur une adresse IP (<strong>http://...</strong>), les navigateurs bloquent le bouton automatique mais permettent l'installation manuelle en 5 secondes :
              </p>
            </div>
          )}

          <div className="space-y-3 text-xs text-slate-700">
            {/* Android Chrome */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
                <span>Sur Android (Chrome) :</span>
              </div>
              <p className="text-[11px] text-slate-600 pl-5">
                1. Appuyez sur les <strong>3 points verticaux (⋮)</strong> en haut à droite.
                <br />
                2. Choisissez <strong>« Ajouter à l'écran d'accueil »</strong> ou <strong>« Installer »</strong>.
              </p>
            </div>

            {/* iOS Safari */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Share className="w-3.5 h-3.5 text-blue-600" />
                <span>Sur iPhone / iPad (Safari) :</span>
              </div>
              <p className="text-[11px] text-slate-600 pl-5">
                1. Appuyez sur le bouton <strong>Partager</strong> <Share className="inline w-3 h-3 text-blue-600" /> en bas de l'écran.
                <br />
                2. Faites défiler et choisissez <strong>« Sur l'écran d'accueil »</strong> <PlusSquare className="inline w-3 h-3 text-slate-600" />.
                <br />
                3. Appuyez sur <strong>« Ajouter »</strong> en haut à droite.
              </p>
            </div>

            {/* PC Chrome / Edge */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-indigo-600" />
                <span>Sur PC (Chrome / Edge) :</span>
              </div>
              <p className="text-[11px] text-slate-600 pl-5">
                Menu 3 points → <strong>« Enregistrer et partager »</strong> → <strong>« Créer un raccourci »</strong> (cochez <em>« Ouvrir dans une fenêtre »</em>).
              </p>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => setShowTip(false)}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors"
            >
              J'ai compris
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
