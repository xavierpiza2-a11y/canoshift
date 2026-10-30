import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Plus, X, Save, RefreshCw, Clock, Users, CalendarDays, UserCog, StickyNote, Cpu } from 'lucide-react';
import type { Employee, MonthItem } from '../types/planning';
import { fetchAiPlanningSettings, saveAiPlanningSettings, fetchAiStatus, type AiModelInfo } from '../services/api';
import { AdminAiGenerateSection } from './AdminAiGenerateSection';
import {
  ISO_WEEKDAYS,
  WEEKDAY_LABELS,
  AiSettingsError,
  defaultEmployeeRules,
  normalizeAiSettings,
  type AiPlanningSettings,
  type DayRule,
  type IsoWeekday,
  type TimeRange,
} from '../shared/aiPlanning';

interface Props {
  employees: Employee[];
  allMonths: MonthItem[];
  showToast: (type: 'success' | 'error', text: string) => void;
}

const DEFAULT_RANGE: TimeRange = { start: '09:00', end: '19:00' };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const inputCls =
  'text-xs font-semibold text-slate-900 bg-white px-2 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600';
const cardCls = 'bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden';

const Card: React.FC<{ title: string; icon: React.ReactNode; hint?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title, icon, hint, defaultOpen, children,
}) => (
  <details className={cardCls} open={defaultOpen}>
    <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none text-sm font-bold text-slate-800">
      {icon}
      <span>{title}</span>
    </summary>
    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
      {hint && <p className="text-[11px] text-slate-500 leading-snug">{hint}</p>}
      {children}
    </div>
  </details>
);

/** Une journée : ouvert / fermé + une ou deux plages horaires (pause déjeuner). */
const DayRuleEditor: React.FC<{ rule: DayRule; onChange: (r: DayRule) => void; closedLabel?: string }> = ({ rule, onChange, closedLabel }) => {
  const setRange = (i: number, patch: Partial<TimeRange>) =>
    onChange({ open: true, ranges: rule.ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={rule.open}
          onChange={(e) => onChange(e.target.checked ? { open: true, ranges: rule.ranges.length ? rule.ranges : [{ ...DEFAULT_RANGE }] } : { open: false, ranges: [] })}
          className="w-4 h-4 accent-emerald-600"
        />
        <span>{rule.open ? 'Ouvert' : closedLabel || 'Fermé'}</span>
      </label>
      {rule.open &&
        rule.ranges.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <input type="time" value={r.start} onChange={(e) => setRange(i, { start: e.target.value })} className={inputCls} />
            <span className="text-slate-400 text-xs">→</span>
            <input type="time" value={r.end} onChange={(e) => setRange(i, { end: e.target.value })} className={inputCls} />
            {i === 1 && (
              <button type="button" title="Retirer la 2e plage" onClick={() => onChange({ open: true, ranges: rule.ranges.slice(0, 1) })} className="p-1 text-slate-400 hover:text-rose-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        ))}
      {rule.open && rule.ranges.length === 1 && (
        <button
          type="button"
          onClick={() => onChange({ open: true, ranges: [{ start: rule.ranges[0].start, end: '12:30' }, { start: '14:00', end: rule.ranges[0].end }] })}
          className="text-[11px] font-semibold text-emerald-700 hover:underline"
        >
          + pause midi
        </button>
      )}
    </div>
  );
};

/** Règle propre à un mois : « Habituel » ou une règle spécifique. */
const OverrideEditor: React.FC<{ base: DayRule; value: DayRule | undefined; onChange: (r: DayRule | undefined) => void }> = ({ base, value, onChange }) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
      <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? undefined : clone(base))} className="w-4 h-4 accent-emerald-600" />
      <span>Comme d'habitude ({base.open ? base.ranges.map((r) => `${r.start}-${r.end}`).join(' / ') : 'fermé'})</span>
    </label>
    {value && <DayRuleEditor rule={value} onChange={onChange} />}
  </div>
);

const MonthSelect: React.FC<{ months: MonthItem[]; value: string; onChange: (k: string) => void }> = ({ months, value, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
    {months.map((m) => (
      <option key={m.key} value={m.key}>{m.label}</option>
    ))}
  </select>
);

export const AdminAiPlanningSection: React.FC<Props> = ({ employees, allMonths, showToast }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState<AiPlanningSettings | null>(null);
  const sortedMonths = useMemo(() => [...allMonths].sort((a, b) => a.key.localeCompare(b.key)), [allMonths]);
  const [monthKey, setMonthKey] = useState('');
  const [notesMonth, setNotesMonth] = useState('');
  const [newDate, setNewDate] = useState('');
  const [models, setModels] = useState<AiModelInfo[]>([]); // modèles autorisés par le gestionnaire pour ce magasin

  const load = async () => {
    setLoading(true);
    setLoadError('');
    const res = await fetchAiPlanningSettings();
    if (res.success && res.settings) {
      setDraft(clone(res.settings));
      setSaved(JSON.stringify(res.settings));
    } else {
      setLoadError(res.error || 'Impossible de charger les réglages.');
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { void fetchAiStatus().then((r) => r.success && r.status && setModels(r.status.allowed)); }, []);

  useEffect(() => {
    if (!monthKey && sortedMonths.length) {
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const k = sortedMonths.find((m) => m.key === cur)?.key || sortedMonths[0].key;
      setMonthKey(k);
      setNotesMonth(k);
    }
  }, [sortedMonths, monthKey]);

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const update = (fn: (d: AiPlanningSettings) => void) => setDraft((prev) => { if (!prev) return prev; const n = clone(prev); fn(n); return n; });

  const handleSave = async () => {
    if (!draft) return;
    try {
      normalizeAiSettings(draft, employees.map((e) => e.name), true); // mêmes contrôles que le serveur, message immédiat
    } catch (e: any) {
      showToast('error', e instanceof AiSettingsError ? e.message : 'Réglages invalides.');
      return;
    }
    setSaving(true);
    const res = await saveAiPlanningSettings(draft);
    setSaving(false);
    if (res.success && res.settings) {
      setDraft(clone(res.settings));
      setSaved(JSON.stringify(res.settings));
      showToast('success', 'Réglages de la planification IA enregistrés.');
    } else {
      showToast('error', res.error || "Impossible d'enregistrer les réglages.");
    }
  };

  if (loading) return <div className="h-24 bg-slate-200/60 rounded-2xl animate-pulse" />;
  if (loadError || !draft) {
    return (
      <div className={`${cardCls} p-5 text-center space-y-3`}>
        <p className="text-xs text-rose-700 font-semibold">{loadError || 'Réglages indisponibles.'}</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-lg border border-emerald-200">
          <RefreshCw className="w-3.5 h-3.5" /> Réessayer
        </button>
      </div>
    );
  }

  const monthOv = draft.monthOverrides[monthKey] || {};
  const setMonthWeekly = (day: IsoWeekday, rule: DayRule | undefined) =>
    update((d) => {
      const ov = d.monthOverrides[monthKey] || {};
      const weekly = { ...(ov.weekly || {}) };
      if (rule) weekly[day] = rule; else delete weekly[day];
      ov.weekly = weekly;
      if (!Object.keys(weekly).length) delete ov.weekly;
      if (!ov.weekly && !ov.holidays) delete d.monthOverrides[monthKey]; else d.monthOverrides[monthKey] = ov;
    });
  const setMonthHolidays = (rule: DayRule | undefined) =>
    update((d) => {
      const ov = d.monthOverrides[monthKey] || {};
      if (rule) ov.holidays = rule; else delete ov.holidays;
      if (!ov.weekly && !ov.holidays) delete d.monthOverrides[monthKey]; else d.monthOverrides[monthKey] = ov;
    });

  const numInput = (value: number, onChange: (n: number) => void, min = 0, max = 50) => (
    <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${inputCls} w-16 text-center`} />
  );

  return (
    <div className="space-y-3 pb-20">
      <AdminAiGenerateSection allMonths={allMonths} settings={JSON.parse(saved) as AiPlanningSettings} settingsDirty={dirty} showToast={showToast} />

      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-950 leading-relaxed flex gap-3">
        <Bot className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
        <p>
          Ces réglages sont propres à votre magasin. L'IA devra respecter <b>strictement</b> les horaires d'ouverture et les créneaux de l'onglet « Créneaux », et tenir compte
          de tout ce qui est déjà posé sur le planning (congés, CFA, RTT…).
        </p>
      </div>

      <Card title="Modèle d'IA" icon={<Cpu className="w-4 h-4 text-emerald-600" />} defaultOpen
        hint="Les modèles proposés sont ceux que le gestionnaire a activés pour votre magasin. Chaque modèle utilise sa propre clé, configurée sur le serveur.">
        {models.length === 0 ? (
          <p className="text-xs text-slate-500">Chargement…</p>
        ) : (
          <div className={`grid gap-2 ${models.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {models.map((m) => {
              const selected = (models.some((x) => x.provider === draft.model) ? draft.model : models[0].provider) === m.provider;
              return (
                <button key={m.provider} type="button" disabled={models.length === 1} onClick={() => update((d) => { d.model = m.provider; })}
                  className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'} disabled:cursor-default`}>
                  <span className="block text-xs font-bold">{m.label}</span>
                  <span className={`block text-[10px] ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>{m.model}</span>
                  {!m.configured && <span className={`block text-[10px] font-semibold mt-0.5 ${selected ? 'text-amber-200' : 'text-amber-700'}`}>Clé absente du serveur</span>}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Horaires d'ouverture habituels" icon={<Clock className="w-4 h-4 text-emerald-600" />} defaultOpen
        hint="Le samedi est ouvert par défaut : décochez-le s'il est fermé. Ajoutez une pause midi si le magasin ferme entre 12h et 14h.">
        <div className="space-y-2.5">
          {ISO_WEEKDAYS.map((day) => (
            <div key={day} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 pb-2 border-b border-slate-100 last:border-0">
              <span className="w-24 text-xs font-bold text-slate-800">{WEEKDAY_LABELS[day]}</span>
              <DayRuleEditor rule={draft.weekly[day]} onChange={(r) => update((d) => { d.weekly[day] = r; })} />
            </div>
          ))}
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 pt-1">
            <span className="w-24 text-xs font-bold text-slate-800">Jours fériés</span>
            <DayRuleEditor rule={draft.holidays} onChange={(r) => update((d) => { d.holidays = r; })} />
          </div>
        </div>
      </Card>

      <Card title="Exceptions d'un mois" icon={<CalendarDays className="w-4 h-4 text-emerald-600" />}
        hint="Pour un mois particulier (ouverture des dimanches en décembre, jours fériés travaillés en mai…). Seuls les jours que vous modifiez changent.">
        <MonthSelect months={sortedMonths} value={monthKey} onChange={setMonthKey} />
        <div className="space-y-2.5">
          {ISO_WEEKDAYS.map((day) => (
            <div key={day} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 pb-2 border-b border-slate-100">
              <span className="w-24 text-xs font-bold text-slate-800 sm:pt-0.5">{WEEKDAY_LABELS[day]}</span>
              <OverrideEditor base={draft.weekly[day]} value={monthOv.weekly?.[day]} onChange={(r) => setMonthWeekly(day, r)} />
            </div>
          ))}
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
            <span className="w-24 text-xs font-bold text-slate-800 sm:pt-0.5">Jours fériés</span>
            <OverrideEditor base={draft.holidays} value={monthOv.holidays} onChange={setMonthHolidays} />
          </div>
        </div>
      </Card>

      <Card title="Exceptions d'une date précise" icon={<CalendarDays className="w-4 h-4 text-emerald-600" />}
        hint="Pour un jour en particulier : inventaire (fermé), ouverture exceptionnelle… Elle l'emporte sur toutes les autres règles.">
        <div className="flex items-center gap-2">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={inputCls} />
          <button type="button" disabled={!newDate || !!draft.dateOverrides[newDate]}
            onClick={() => { update((d) => { d.dateOverrides[newDate] = { open: false, ranges: [] }; }); setNewDate(''); }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 disabled:opacity-40 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>
        {Object.keys(draft.dateOverrides).sort().map((dk) => (
          <div key={dk} className="flex items-start gap-2 py-2 border-t border-slate-100">
            <span className="w-24 text-xs font-bold text-slate-800 pt-0.5">{dk.split('-').reverse().join('/')}</span>
            <div className="flex-1"><DayRuleEditor rule={draft.dateOverrides[dk]} onChange={(r) => update((d) => { d.dateOverrides[dk] = r; })} /></div>
            <button type="button" title="Supprimer" onClick={() => update((d) => { delete d.dateOverrides[dk]; })} className="p-1 text-slate-400 hover:text-rose-600"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </Card>

      <Card title="Effectifs" icon={<Users className="w-4 h-4 text-emerald-600" />}
        hint="Nombre minimum de personnes présentes. Laissez vide un jour renforcé pour garder le minimum habituel.">
        <div className="grid grid-cols-3 gap-2 text-[11px] font-semibold text-slate-600">
          <label className="flex flex-col items-center gap-1">À l'ouverture{numInput(draft.staffing.minOpening, (n) => update((d) => { d.staffing.minOpening = n; }))}</label>
          <label className="flex flex-col items-center gap-1">À la fermeture{numInput(draft.staffing.minClosing, (n) => update((d) => { d.staffing.minClosing = n; }))}</label>
          <label className="flex flex-col items-center gap-1">Par jour{numInput(draft.staffing.minPerDay, (n) => update((d) => { d.staffing.minPerDay = n; }))}</label>
        </div>
        <p className="text-[11px] font-bold text-slate-700 pt-1">Jours plus chargés (effectif par jour)</p>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-[11px] font-semibold text-slate-600">
          {ISO_WEEKDAYS.map((day) => (
            <label key={day} className="flex flex-col items-center gap-1">
              {WEEKDAY_LABELS[day].slice(0, 3)}
              <input type="number" inputMode="numeric" min={0} max={50} placeholder="—" value={draft.staffing.busyDays[day] ?? ''}
                onChange={(e) => update((d) => { if (e.target.value === '') delete d.staffing.busyDays[day]; else d.staffing.busyDays[day] = Number(e.target.value); })}
                className={`${inputCls} w-14 text-center`} />
            </label>
          ))}
        </div>
      </Card>

      <Card title="Règles d'équipe" icon={<UserCog className="w-4 h-4 text-emerald-600" />}>
        <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
          <span>Jours travaillés consécutifs au maximum</span>
          {numInput(draft.teamRules.maxConsecutiveDays, (n) => update((d) => { d.teamRules.maxConsecutiveDays = n; }), 1, 14)}
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={draft.teamRules.weekendRotation} onChange={(e) => update((d) => { d.teamRules.weekendRotation = e.target.checked; })} className="w-4 h-4 accent-emerald-600" />
          Alterner les week-ends travaillés (rotation)
        </label>
      </Card>

      <Card title="Réglages par salarié" icon={<Users className="w-4 h-4 text-emerald-600" />}
        hint="Écart d'heures visé : en plus (+) ou en moins (−) par rapport à l'objectif du mois, pour ajuster l'annualisation. 0 = viser l'objectif exact.">
        {employees.map((emp) => {
          const r = draft.employees[emp.name] || defaultEmployeeRules();
          const set = (patch: Partial<typeof r>) => update((d) => { d.employees[emp.name] = { ...(d.employees[emp.name] || defaultEmployeeRules()), ...patch }; });
          return (
            <details key={emp.name} className="rounded-xl border border-slate-200 bg-slate-50/60">
              <summary className="px-3 py-2 cursor-pointer text-xs font-bold text-slate-800 flex items-center justify-between">
                <span>{emp.name}</span>
                <span className="text-[10px] font-semibold text-slate-500">
                  {r.targetHoursGap ? `${r.targetHoursGap > 0 ? '+' : ''}${r.targetHoursGap} h visées` : 'écart 0 h'}
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-700">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.canOpen} onChange={(e) => set({ canOpen: e.target.checked })} className="w-4 h-4 accent-emerald-600" /> Peut ouvrir</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.canClose} onChange={(e) => set({ canClose: e.target.checked })} className="w-4 h-4 accent-emerald-600" /> Peut fermer</label>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-600 mb-1">Jours de repos fixes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ISO_WEEKDAYS.map((day) => {
                      const on = r.fixedRestWeekdays.includes(day);
                      return (
                        <button key={day} type="button" onClick={() => set({ fixedRestWeekdays: on ? r.fixedRestWeekdays.filter((x) => x !== day) : [...r.fixedRestWeekdays, day].sort() as IsoWeekday[] })}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                          {WEEKDAY_LABELS[day].slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                  <span>Écart d'heures visé (h)</span>
                  <input type="number" inputMode="decimal" step={0.5} min={-100} max={100} value={r.targetHoursGap} onChange={(e) => set({ targetHoursGap: Number(e.target.value) })} className={`${inputCls} w-20 text-center`} />
                </label>
                <label className="block text-[11px] font-bold text-slate-600">
                  Contraintes particulières
                  <textarea value={r.constraints} maxLength={2000} rows={2} onChange={(e) => set({ constraints: e.target.value })}
                    placeholder="ex. : pas le jeudi matin (cours), préfère les après-midi…" className={`${inputCls} w-full mt-1 font-normal`} />
                </label>
              </div>
            </details>
          );
        })}
      </Card>

      <Card title="Précisions du mois" icon={<StickyNote className="w-4 h-4 text-emerald-600" />}
        hint="Arrivages, promotions, inventaire, événements… L'IA en tient compte pour ce mois. Les informations posées sur chaque jour du planning sont lues automatiquement.">
        <MonthSelect months={sortedMonths} value={notesMonth} onChange={setNotesMonth} />
        <textarea value={draft.monthNotes[notesMonth] || ''} maxLength={2000} rows={4}
          onChange={(e) => update((d) => { if (e.target.value.trim()) d.monthNotes[notesMonth] = e.target.value; else delete d.monthNotes[notesMonth]; })}
          placeholder="ex. : arrivage de plantes le 10, besoin de 3 personnes ; inventaire le 28 au matin…" className={`${inputCls} w-full font-normal`} />
        <p className="text-[10px] text-slate-400 text-right">{(draft.monthNotes[notesMonth] || '').length} / 2000</p>
      </Card>

      {dirty && (
        <div className="fixed bottom-16 sm:bottom-4 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 bg-white border border-emerald-300 shadow-lg rounded-2xl px-3 py-2">
            <span className="text-[11px] font-semibold text-slate-600">Modifications non enregistrées</span>
            <button type="button" onClick={() => setDraft(JSON.parse(saved))} className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg">Annuler</button>
            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
