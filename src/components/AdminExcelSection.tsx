import React, { useState, useRef } from 'react';
import {
  Employee,
  EmployeeMonthSchedule,
  MonthItem,
  Tableau2ShiftOption,
} from '../types/planning';
import {
  generatePlanningTemplateXLSX,
  downloadExcelFile,
  parsePlanningFromXLSX,
  ParsedExcelPlanning,
} from '../services/excelService';
import { saveLocalTeamPlanning, getStoredDayNotes, saveStoredDayNotes, getStoreName } from '../services/api';
import { broadcastSync } from '../services/syncBroadcast';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Calendar,
  Users,
  Clock,
  Sparkles,
  Info,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

interface AdminExcelSectionProps {
  storeName?: string;
  employees: Employee[];
  allMonths: MonthItem[];
  selectedMonth: string;
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  tableau2Options: Tableau2ShiftOption[];
  onPlanningImported: (
    monthKey: string,
    teamSchedules: Record<string, EmployeeMonthSchedule>,
    updatedEmployees?: Employee[]
  ) => void;
  onSelectMonth?: (m: string) => void;
}

export const AdminExcelSection: React.FC<AdminExcelSectionProps> = ({
  storeName,
  employees,
  allMonths,
  selectedMonth,
  teamSchedules,
  tableau2Options,
  onPlanningImported,
}) => {
  const [targetMonth, setTargetMonth] = useState<string>(selectedMonth || '2026-09');
  const [dragActive, setDragActive] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedExcelPlanning | null>(null);
  const [parsedFileName, setParsedFileName] = useState<string>('');
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Download blank template with rightmost info column
  const handleDownloadTemplate = async () => {
    try {
      const effectiveStore = (storeName || getStoreName()).trim();
      const cleanStore = effectiveStore.replace(/[^a-zA-Z0-9]/g, '_');
      const existingNotes = getStoredDayNotes(targetMonth);
      const data = await generatePlanningTemplateXLSX(
        targetMonth,
        employees,
        tableau2Options,
        undefined,
        existingNotes,
        effectiveStore
      );
      const fileName = `Modele_Planning_${cleanStore}_${targetMonth}.xlsx`;
      downloadExcelFile(data, fileName);
    } catch (err: any) {
      setImportStatus({
        type: 'error',
        text: `Erreur lors de la génération du modèle : ${err.message}`,
      });
    }
  };

  // Download filled planning with current data, hours & day notes
  const handleDownloadFullPlanning = async () => {
    try {
      const effectiveStore = (storeName || getStoreName()).trim();
      const cleanStore = effectiveStore.replace(/[^a-zA-Z0-9]/g, '_');
      const existingNotes = getStoredDayNotes(targetMonth);
      const data = await generatePlanningTemplateXLSX(
        targetMonth,
        employees,
        tableau2Options,
        teamSchedules,
        existingNotes,
        effectiveStore
      );
      const fileName = `Planning_${cleanStore}_Complet_${targetMonth}.xlsx`;
      downloadExcelFile(data, fileName);
    } catch (err: any) {
      setImportStatus({
        type: 'error',
        text: `Erreur lors de l'export du planning : ${err.message}`,
      });
    }
  };

  // Parse uploaded file
  const handleProcessFile = async (file: File) => {
    if (!file) return;
    setIsParsing(true);
    setImportStatus(null);
    setParsedResult(null);
    setParsedFileName(file.name);

    try {
      const parsed = await parsePlanningFromXLSX(file, employees, tableau2Options);
      setParsedResult(parsed);
      if (parsed.monthKey && allMonths.some((m) => m.key === parsed.monthKey)) {
        setTargetMonth(parsed.monthKey);
      }
    } catch (err: any) {
      setImportStatus({
        type: 'error',
        text: err.message || 'Impossible de lire le fichier Excel.',
      });
    } finally {
      setIsParsing(false);
    }
  };

  // Drag & drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  // Confirm and apply parsed planning to application state
  const handleConfirmImport = () => {
    if (!parsedResult) return;

    const monthKey = parsedResult.monthKey || targetMonth;

    // Check if new employees need to be created
    const updatedEmployeesList = [...employees];
    let addedCount = 0;
    const palette = [
      '#1a6b2a',
      '#1d4ed8',
      '#9d174d',
      '#6d28d9',
      '#854d0e',
      '#0e7490',
      '#c2410c',
      '#be185d',
    ];

    for (const empName of parsedResult.detectedEmployees) {
      const exists = updatedEmployeesList.some(
        (e) => e.name.toLowerCase() === empName.toLowerCase()
      );
      if (!exists) {
        updatedEmployeesList.push({
          name: empName,
          color: palette[updatedEmployeesList.length % palette.length],
          role: 'Conseiller',
        });
        addedCount++;
      }
    }

    // Persist to local storage
    saveLocalTeamPlanning(
      monthKey,
      parsedResult.teamSchedules,
      addedCount > 0 ? updatedEmployeesList : undefined
    );

    // Save day notes extracted from the rightmost column
    if (parsedResult.dayNotes && Object.keys(parsedResult.dayNotes).length > 0) {
      saveStoredDayNotes(monthKey, parsedResult.dayNotes);
    }

    // Notify parent component
    onPlanningImported(
      monthKey,
      parsedResult.teamSchedules,
      addedCount > 0 ? updatedEmployeesList : undefined
    );

    // Broadcast immediate update across all open tabs and windows
    broadcastSync({
      type: 'PLANNING_UPDATED',
      monthKey,
      teamSchedules: parsedResult.teamSchedules,
      employees: addedCount > 0 ? updatedEmployeesList : undefined,
    });

    const notesCount = parsedResult.dayNotes ? Object.keys(parsedResult.dayNotes).length : 0;
    setImportStatus({
      type: 'success',
      text: `Planning de ${monthKey} importé avec succès ! (${parsedResult.stats.totalShifts} créneaux pour ${parsedResult.detectedEmployees.length} salariés${notesCount > 0 ? ` · ${notesCount} info(s) du jour intégrée(s)` : ''})`,
    });

    setParsedResult(null);
  };

  const monthLabel =
    allMonths.find((m) => m.key === targetMonth)?.label || targetMonth;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-emerald-800 to-emerald-950 text-white rounded-2xl p-5 shadow-sm border border-emerald-700/50">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-700/60 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-6 h-6 text-emerald-200" />
          </div>
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              Gestion Excel Autonome (.xlsx)
              <span className="text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-400/30">
                100% Autonome & Local
              </span>
            </h3>
            <p className="text-xs text-emerald-100/90 mt-1 leading-relaxed">
              Travaillez sous Excel à votre convenance : les employés sont en colonnes,
              les dates en lignes, et chaque case dispose d'une liste déroulante dynamique
              alimentée par vos Créneaux pour le calcul automatique des heures.
            </p>
          </div>
        </div>
      </div>

      {/* Month Selector Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 w-full sm:w-auto">
          <Calendar className="w-4 h-4 text-emerald-700" />
          <span>Mois de travail sélectionné :</span>
        </div>
        <select
          value={targetMonth}
          onChange={(e) => setTargetMonth(e.target.value)}
          className="w-full sm:w-64 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
        >
          {allMonths.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.key})
            </option>
          ))}
        </select>
      </div>

      {/* Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* CARD 1: EXPORT / TÉLÉCHARGEMENT */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Exporter / Fichier Modèle
                </h4>
                <p className="text-[11px] text-slate-500">
                  Générer un classeur .xlsx pour {monthLabel}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
              <div className="flex items-center gap-2 text-slate-700 font-medium">
                <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Ce fichier type contient :</span>
              </div>
              <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5 ml-1">
                <li>
                  <strong>Feuille 1 « Planning » :</strong> Les dates du mois en
                  lignes, vos {employees.length} salariés en colonnes, et <strong>un menu déroulant interactif</strong> par case.
                </li>
                <li>
                  <strong>Feuille 2 « Créneaux » :</strong> La liste de vos créneaux et horaires possibles avec calcul automatique.
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-xs shadow-xs transition-colors"
            >
              <Download className="w-4 h-4" />
              Télécharger le modèle Excel type (.xlsx)
            </button>

            <button
              type="button"
              onClick={handleDownloadFullPlanning}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              Exporter le planning actuel avec les heures (.xlsx)
            </button>
          </div>
        </div>

        {/* CARD 2: IMPORT DU FICHIER */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Importer un planning (.xlsx)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Glisser-déposer votre fichier rempli
                </p>
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-emerald-600 bg-emerald-50/70 scale-[0.99]'
                  : 'border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleProcessFile(e.target.files[0]);
                  }
                }}
              />

              <div className="flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  {isParsing ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    {isParsing
                      ? 'Analyse du fichier en cours...'
                      : 'Cliquez ou déposez votre fichier .xlsx'}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Employés en colonnes · Dates en lignes
                  </p>
                </div>
              </div>
            </div>
          </div>

          {importStatus && (
            <div
              className={`rounded-xl p-3 text-xs flex items-start gap-2 ${
                importStatus.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border border-rose-200 text-rose-900'
              }`}
            >
              {importStatus.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="leading-snug">{importStatus.text}</div>
            </div>
          )}
        </div>
      </div>

      {/* PREVIEW MODAL / ACCORDION IF PARSED RESULT READY */}
      {parsedResult && (
        <div className="bg-white rounded-2xl border-2 border-emerald-500 p-5 shadow-md space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Aperçu avant application : {parsedFileName}
                </h4>
                <p className="text-[11px] text-slate-500">
                  Mois détecté : <strong>{parsedResult.monthKey}</strong> ·{' '}
                  {parsedResult.stats.totalDays} jours analysés
                </p>
              </div>
            </div>

            <button
              onClick={() => setParsedResult(null)}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
            >
              Annuler
            </button>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Salariés
              </span>
              <span className="text-base font-bold text-slate-800">
                {parsedResult.detectedEmployees.length}
              </span>
            </div>

            <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Jours traités
              </span>
              <span className="text-base font-bold text-slate-800">
                {parsedResult.stats.totalDays}
              </span>
            </div>

            <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Créneaux lus
              </span>
              <span className="text-base font-bold text-emerald-700">
                {parsedResult.stats.totalShifts}
              </span>
            </div>

            <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Total heures équipe
              </span>
              <span className="text-base font-bold text-emerald-700">
                {Object.values(parsedResult.stats.employeeHours).reduce(
                  (a, b) => a + b,
                  0
                )}
                h
              </span>
            </div>
          </div>

          {/* Employee Hours Preview Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 flex justify-between">
              <span>Salarié détecté (en colonne dans Excel)</span>
              <span>Heures totales calculées</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {parsedResult.detectedEmployees.map((name) => {
                const hrs = parsedResult.stats.employeeHours[name] || 0;
                const isKnown = employees.some(
                  (e) => e.name.toLowerCase() === name.toLowerCase()
                );
                return (
                  <div
                    key={name}
                    className="px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{name}</span>
                      {!isKnown && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                          Nouveau salarié
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                      {hrs} h
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day Notes Preview if present */}
          {parsedResult.dayNotes && Object.keys(parsedResult.dayNotes).length > 0 && (
            <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                <Info className="w-4 h-4 text-amber-600" />
                <span>
                  {Object.keys(parsedResult.dayNotes).length} information(s) / événement(s) du jour détecté(s) dans la colonne de droite :
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 divide-y divide-amber-200/50 text-[11px]">
                {Object.entries(parsedResult.dayNotes).map(([d, note]) => (
                  <div key={d} className="pt-1 flex items-start gap-2">
                    <span className="font-bold text-slate-700 shrink-0 tabular-nums">{d} :</span>
                    <span className="text-amber-950 font-medium">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm Button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setParsedResult(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Rejeter
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Appliquer ce planning à l'application
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
