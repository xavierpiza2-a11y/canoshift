import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, Check, X, RefreshCw, AlertTriangle, Sparkles, KeyRound } from 'lucide-react';
import type { MonthItem } from '../types/planning';
import {
  fetchAiStatus, generateAiDraft, applyAiDraft,
  type AiStatus, type AiDraftView,
} from '../services/api';
import type { AiPlanningSettings } from '../shared/aiPlanning';

interface Props {
  allMonths: MonthItem[];
  settings: AiPlanningSettings; // réglages enregistrés (la génération lit les réglages ENREGISTRÉS)
  settingsDirty: boolean;
  showToast: (type: 'success' | 'error', text: string) => void;
}

const inputCls = 'text-xs font-semibold text-slate-900 bg-white px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600';
const SHORT: Record<string, string> = { OUVERTURE: 'OUV', FERMETURE: 'FER', JOURNEE: 'JOU', REUNION: 'RÉU', CONGES: 'CP', REPOS: 'R', FERIE: 'FÉR' };
const short = (c: string) => SHORT[c] || (c.length > 4 ? c.slice(0, 4) : c);
const DOW = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

export const AdminAiGenerateSection: React.FC<Props> = ({ allMonths, settings, settingsDirty, showToast }) => {
  const months = useMemo(() => [...allMonths].sort((a, b) => a.key.localeCompare(b.key)), [allMonths]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [monthKey, setMonthKey] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<AiDraftView | null>(null);

  const refreshStatus = async () => {
    const r = await fetchAiStatus();
    if (r.success && r.status) { setStatus(r.status); setStatusError(''); } else setStatusError(r.error || '');
  };
  useEffect(() => { void refreshStatus(); }, []);
  useEffect(() => {
    if (!monthKey && months.length) {
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setMonthKey(months.find((m) => m.key === cur)?.key || months[0].key);
    }
  }, [months, monthKey]);
  // Le modèle choisi dans les réglages (une fois enregistré) change le modèle utilisé : on relit l'état
  useEffect(() => { void refreshStatus(); }, [settings.model]);
  useEffect(() => { setDraft(null); setError(''); }, [monthKey]);

  const handleGenerate = async () => {
    setBusy(true); setError(''); setDraft(null);
    const res = await generateAiDraft({ monthKey, instructions: instructions.trim() });
    setBusy(false);
    void refreshStatus();
    if (res.success && res.draft) setDraft(res.draft);
    else setError(res.error || 'La génération a échoué.');
  };

  const handleApply = async () => {
    if (!draft) return;
    setApplying(true);
    const res = await applyAiDraft(draft.draftId);
    setApplying(false);
    if (res.success) {
      const skipped = res.skipped?.length ? ` (${res.skipped.length} journée(s) modifiée(s) entre-temps ont été épargnées)` : '';
      showToast('success', `Planning appliqué : ${res.applied} jour(s) renseigné(s)${skipped}.`);
      setDraft(null);
    } else {
      showToast('error', res.error || "L'application a échoué.");
      if (res.code === 'DRAFT_GONE') setDraft(null);
    }
  };

  if (statusError && !status) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-4 text-xs text-rose-700 font-semibold">{statusError}</div>;
  }
  if (!status) return <div className="h-24 bg-slate-200/60 rounded-2xl animate-pulse" />;

  const limitReached = status.remaining <= 0;
  const monthLabel = months.find((m) => m.key === monthKey)?.label || monthKey;

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-xs overflow-hidden">
      <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-950"><Sparkles className="w-4 h-4 text-emerald-700" /> Générer le planning du mois</div>
        <span className="text-[10px] font-semibold text-emerald-800 text-right leading-tight">
          {status.allowed.find((m) => m.provider === status.provider)?.label.split(' (')[0] || status.provider} · {status.model}<br />{status.remaining} / {status.limitPerHour} génération(s) cette heure
        </span>
      </div>

      {!status.configured && (
        <div className="m-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2 leading-snug">
          <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
          <p>L'IA n'est pas encore configurée sur le serveur : la clé API est absente du fichier <b>.env</b>. Demandez à la personne qui gère le serveur de l'ajouter.</p>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className={inputCls}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>

        <p className="text-[11px] text-slate-500 leading-snug">
          La génération utilise les réglages enregistrés ci-dessous : horaires d'ouverture, effectifs, règles d'équipe, réglages par salarié (dont l'écart d'heures visé) et précisions du mois.
        </p>
        {settingsDirty && <p className="text-[11px] font-semibold text-amber-700">Des réglages modifiés ne sont pas enregistrés : la génération utilise les réglages enregistrés.</p>}

        <label className="block text-[11px] font-bold text-slate-600">
          Précisions pour {monthLabel}
          <textarea value={instructions} maxLength={2000} rows={3} onChange={(e) => setInstructions(e.target.value)} className={`${inputCls} w-full mt-1 font-normal`}
            placeholder="ex. : arrivage de plantes le 10 (3 personnes), inventaire le 28 au matin, Océane souhaite finir tôt le vendredi…" />
        </label>
        {settings.monthNotes[monthKey] && <p className="text-[10px] text-slate-500">Les « précisions du mois » enregistrées ci-dessous sont aussi transmises.</p>}
        <button type="button" onClick={handleGenerate} disabled={busy || applying || !status.configured || limitReached || !monthKey}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Génération en cours (jusqu'à 2 minutes)…</> : <><Bot className="w-4 h-4" /> {draft ? 'Régénérer' : 'Générer'} un brouillon pour {monthLabel}</>}
        </button>
        {limitReached && <p className="text-[11px] font-semibold text-amber-700">Limite atteinte : réessayez dans {status.retryAfterMinutes} min.</p>}
        {error && <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">{error}</p>}
      </div>

      {draft && (
        <div className="border-t border-emerald-200 p-4 space-y-3 bg-emerald-50/30">
          <p className="text-xs font-bold text-slate-800">Brouillon — rien n'est encore écrit dans le planning</p>
          {draft.comment && <p className="text-xs text-slate-600 italic">« {draft.comment} »</p>}
          <p className="text-[11px] text-slate-600">
            {draft.changes} jour(s) modifié(s){draft.autoRest ? `, dont ${draft.autoRest} remis en repos (magasin fermé)` : ''}.
            {draft.repaired && ' Une correction automatique a été appliquée.'}
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-[11px]">
              <thead><tr className="text-slate-500 text-left"><th className="p-2">Salarié</th><th className="p-2 text-right">Cible</th><th className="p-2 text-right">Planifié</th><th className="p-2 text-right">Écart</th></tr></thead>
              <tbody>
                {draft.stats.map((s) => (
                  <tr key={s.employee} className="border-t border-slate-100">
                    <td className="p-2 font-bold text-slate-800">{s.employee}</td>
                    <td className="p-2 text-right tabular-nums">{s.targetHours} h</td>
                    <td className="p-2 text-right tabular-nums">{s.plannedHours} h</td>
                    <td className={`p-2 text-right font-bold tabular-nums ${Math.abs(s.delta) > 3.5 ? 'text-rose-600' : 'text-emerald-700'}`}>{s.delta > 0 ? '+' : ''}{s.delta} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(draft.warningsTotal > 0 || draft.ignoredTotal > 0 || draft.missing > 0) && (
            <details className="rounded-xl border border-amber-200 bg-amber-50 p-3" open={draft.warningsTotal + draft.ignoredTotal <= 4}>
              <summary className="cursor-pointer text-xs font-bold text-amber-900 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />
                {draft.warningsTotal} point(s) à vérifier{draft.ignoredTotal ? `, ${draft.ignoredTotal} proposition(s) écartée(s)` : ''}{draft.missing ? `, ${draft.missing} jour(s) non traité(s)` : ''}
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-amber-900 list-disc pl-4">
                {draft.warnings.slice(0, 12).map((w, i) => <li key={`w${i}`}>{w}</li>)}
                {draft.warningsTotal > 12 && <li>… et {draft.warningsTotal - 12} autre(s).</li>}
                {draft.ignored.slice(0, 6).map((x, i) => <li key={`i${i}`}>{x.employee} {x.date !== '*' ? x.date.slice(8) + '/' + x.date.slice(5, 7) : ''} : écarté ({x.reason}).</li>)}
              </ul>
            </details>
          )}

          <div className="overflow-auto max-h-96 rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr><th className="p-1.5 text-left text-slate-500">Jour</th>{draft.grid.employees.map((n) => <th key={n} className="p-1.5 text-slate-600 font-bold">{n}</th>)}</tr>
              </thead>
              <tbody>
                {draft.grid.dates.map((d) => {
                  const open = draft.grid.open[d];
                  const dt = new Date(`${d}T12:00:00`);
                  return (
                    <tr key={d} className={`border-t border-slate-100 ${open ? '' : 'bg-slate-50 text-slate-400'}`}>
                      <td className="p-1.5 whitespace-nowrap font-semibold">{DOW[dt.getDay()]} {d.slice(8)}</td>
                      {draft.grid.employees.map((n) => {
                        const c = draft.grid.cells[n][d];
                        return (
                          <td key={n} className={`p-1 text-center font-bold ${c.changed ? 'bg-emerald-100 text-emerald-900' : c.locked ? 'text-slate-500 italic' : ''}`} title={c.locked ? 'Posé à la main (inchangé)' : c.changed ? 'Proposé par l’IA' : 'Inchangé'}>
                            {short(c.shift)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-500">Vert : proposé par l'IA · italique : posé à la main, inchangé · gris : magasin fermé.</p>

          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft(null)} disabled={applying} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl"><X className="w-4 h-4" /> Annuler</button>
            <button type="button" onClick={handleApply} disabled={applying || draft.changes === 0} className="flex-[2] inline-flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl">
              {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Appliquer au planning
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
