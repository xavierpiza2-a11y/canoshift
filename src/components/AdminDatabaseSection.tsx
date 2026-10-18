import React, { useState, useEffect, useRef } from 'react';
import {
  Employee,
  EmployeeMonthSchedule,
  Tableau2ShiftOption,
} from '../types/planning.ts';
import { checkServerHealth, ServerStatusResponse } from '../services/sharedConfigService.ts';
import {
  Server,
  HardDrive,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
  Terminal,
  FileJson,
  Users,
} from 'lucide-react';

interface AdminDatabaseSectionProps {
  storeName: string;
  selectedMonth: string;
  employees: Employee[];
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  tableau2Options: Tableau2ShiftOption[];
  dayNotes: Record<string, string>;
  onPlanningImported?: (
    monthKey: string,
    teamSchedules: Record<string, EmployeeMonthSchedule>,
    updatedEmployees?: Employee[]
  ) => void;
  onUpdateEmployees?: (employees: Employee[]) => void;
  showToast: (type: 'success' | 'error', message: string) => void;
}

export const AdminDatabaseSection: React.FC<AdminDatabaseSectionProps> = ({
  storeName,
  selectedMonth,
  employees,
  teamSchedules,
  tableau2Options,
  dayNotes,
  onPlanningImported,
  onUpdateEmployees,
  showToast,
}) => {
  const [serverStatus, setServerStatus] = useState<ServerStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await checkServerHealth();
      setServerStatus(res);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw new Error('Erreur lors de la génération de la sauvegarde');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `planning_sauvegarde_${storeName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('success', 'Sauvegarde complète téléchargée avec succès (.json)');
    } catch (err: any) {
      showToast('error', `Échec du téléchargement : ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Format de fichier de sauvegarde invalide.');
      }

      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erreur lors de la restauration');
      }

      showToast('success', 'Sauvegarde restaurée avec succès ! Rechargement en cours...');
      fetchStatus();
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      showToast('error', `Erreur de restauration : ${err.message}`);
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isServerConnected = Boolean(serverStatus && serverStatus.status === 'ok');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900">
              Serveur Autonome & Sauvegardes
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Fonctionnement 100% autonome sans Firebase ni MySQL. Les données sont stockées sur le serveur dans un volume persistant.
          </p>
        </div>

        <button
          onClick={fetchStatus}
          disabled={isLoadingStatus}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Server & Storage Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Connection status */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              État du Serveur
            </span>
            {isServerConnected ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                En ligne
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                <AlertTriangle className="w-3 h-3 text-rose-600" />
                Hors ligne
              </span>
            )}
          </div>
          <div className="text-lg font-bold text-slate-900">
            {isServerConnected ? 'Serveur Node.js actif' : 'Connexion perdue'}
          </div>
          <p className="text-[11px] text-slate-500">
            Synchronisation WebSocket en temps réel sur le réseau local ou via Internet.
          </p>
        </div>

        {/* Live connected devices */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Appareils en direct
            </span>
            <Users className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-lg font-bold text-slate-900">
            {serverStatus?.connectedClients ?? 1} appareil{(serverStatus?.connectedClients ?? 1) > 1 ? 's' : ''}
          </div>
          <p className="text-[11px] text-slate-500">
            Téléphones et ordinateurs recevant les mises à jour instantanément.
          </p>
        </div>

        {/* Persistent storage info */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Stockage Persistant
            </span>
            <HardDrive className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-sm font-semibold text-slate-800 truncate" title={serverStatus?.db.storageLocation || 'Volume Docker /data'}>
            {serverStatus?.db.storageLocation || 'Volume persistant'}
          </div>
          <p className="text-[11px] text-slate-500">
            {serverStatus?.db.totalMonths ?? 0} mois enregistrés · Écriture atomique sécurisée
          </p>
        </div>
      </div>

      {/* Backup and Restore Box */}
      <div className="p-5 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
            <FileJson className="w-4 h-4 text-emerald-700" />
            Sauvegarde & Restauration Complète
          </h3>
          <p className="text-xs text-emerald-800/90 mt-1">
            Exportez l’intégralité de la base de données (tous les mois, horaires, salariés, créneaux, notes et historique) dans un fichier JSON unique, ou restaurez un fichier existant.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Download backup button */}
          <button
            onClick={handleExportBackup}
            disabled={isExporting || !isServerConnected}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-xl transition-colors shadow-sm"
          >
            <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
            <span>{isExporting ? 'Téléchargement...' : 'Télécharger une sauvegarde (.json)'}</span>
          </button>

          {/* Upload restore button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelected}
            accept=".json,application/json"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring || !isServerConnected}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-emerald-900 bg-white hover:bg-emerald-100/60 border border-emerald-300 disabled:opacity-50 rounded-xl transition-colors shadow-sm"
          >
            <Upload className={`w-4 h-4 ${isRestoring ? 'animate-spin' : ''}`} />
            <span>{isRestoring ? 'Restauration en cours...' : 'Restaurer une sauvegarde (.json)'}</span>
          </button>
        </div>
      </div>

      {/* Docker Deployment Guide for VM Freebox */}
      <div className="p-5 rounded-xl border border-slate-200 bg-slate-900 text-slate-100 space-y-3">
        <div className="flex items-center gap-2 text-emerald-400">
          <Terminal className="w-4 h-4" />
          <h3 className="text-xs font-bold uppercase tracking-wider">
            Déploiement Docker sur VM Freebox ou Serveur Linux
          </h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Pour héberger cette application chez vous sur une VM Ubuntu (Freebox Delta / Ultra ou serveur personnel), lancez simplement cette commande dans le dossier du projet :
        </p>

        <div className="bg-black/60 rounded-lg p-3 font-mono text-xs text-emerald-300 select-all border border-slate-800">
          docker compose up -d
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
          <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            Le dossier <code className="text-emerald-300 font-mono">./data</code> contiendra toutes vos données persistantes. L’application sera accessible sur le port <strong>3000</strong> de l’adresse IP de votre VM.
          </span>
        </div>
      </div>
    </div>
  );
};
