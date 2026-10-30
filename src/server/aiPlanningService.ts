// Orchestration d'une génération : contexte → modèle → validation stricte → (une correction éventuelle) → brouillon.
import {
  SYSTEM_PROMPT, buildContext, buildUserPrompt, evaluateProposal, extractJson, feedbackFor,
  type Cell, type Evaluation, type GenContext,
} from '../shared/aiGeneration.ts';
import { generateDefaultDay } from '../shared/planning.ts';
import { dbBuildGenInput } from './db.ts';
import { callModel, readAiConfig, saveDraft, AiProviderError, type AiEnvConfig, type Draft } from './aiProviders.ts';

export interface GridCell { shift: string; changed: boolean; locked: boolean }
export interface DraftView {
  draftId: string; monthKey: string; provider: string; model: string; repaired: boolean;
  comment: string; stats: Evaluation['stats']; warnings: string[]; warningsTotal: number;
  ignored: Evaluation['ignored']; ignoredTotal: number; missing: number; changes: number; autoRest: number;
  grid: { dates: string[]; open: Record<string, boolean>; employees: string[]; cells: Record<string, Record<string, GridCell>> };
}

function tryEvaluate(ctx: GenContext, text: string): { ev?: Evaluation; error?: string } {
  try { return { ev: evaluateProposal(ctx, extractJson(text)) }; } catch (e: any) { return { error: e.message }; }
}

export async function generateDraft(
  storeId: string,
  opts: { monthKey: string; instructions: string },
  cfg: AiEnvConfig = readAiConfig(),
  call: typeof callModel = callModel
): Promise<DraftView> {
  const t0 = Date.now();
  const input = dbBuildGenInput(storeId, opts.monthKey, opts.instructions);
  const ctx = buildContext(input);
  if (!ctx.employees.some((e) => e.editable.size > 0) && ctx.autoRest.length === 0) {
    throw new AiProviderError('Rien à générer : toutes les journées de ce mois sont déjà posées ou le magasin est fermé.', 400);
  }

  let calls = 1;
  let text = await call(SYSTEM_PROMPT, buildUserPrompt(ctx), cfg);
  let first = tryEvaluate(ctx, text);
  let ev = first.ev;
  let repaired = false;

  // Une seule correction : si la réponse est inexploitable ou comporte des problèmes, on la renvoie avec le détail.
  if (!ev || ev.hardCount > 0) {
    const feedback = ev ? feedbackFor(ctx, ev) : [first.error || 'Réponse inexploitable : renvoie uniquement le JSON demandé.'];
    try {
      calls++;
      text = await call(SYSTEM_PROMPT, buildUserPrompt(ctx, feedback), cfg);
      const second = tryEvaluate(ctx, text);
      if (second.ev && (!ev || second.ev.hardCount <= ev.hardCount)) { ev = second.ev; repaired = true; }
    } catch (err) {
      if (!ev) throw err; // pas de première proposition exploitable : on remonte l'erreur
    }
  }
  if (!ev) throw new AiProviderError(first.error || "La réponse de l'IA n'est pas exploitable.", 502);

  const cells: Cell[] = [...ctx.autoRest, ...ev.accepted];
  const draft: Draft = saveDraft({ storeId, monthKey: opts.monthKey, cells, evaluation: ev, provider: cfg.provider, model: cfg.model });

  // Vue d'ensemble pour l'écran d'aperçu (état final du mois par salarié)
  const proposed = new Map(cells.map((c) => [`${c.employee}|${c.date}`, c]));
  const grid: DraftView['grid'] = { dates: ctx.days.map((d) => d.date), open: Object.fromEntries(ctx.days.map((d) => [d.date, d.open])), employees: ctx.employees.map((e) => e.name), cells: {} };
  let changes = 0;
  for (const e of ctx.employees) {
    grid.cells[e.name] = {};
    for (const d of ctx.days) {
      const p = proposed.get(`${e.name}|${d.date}`);
      const cur = input.existing[e.name]?.[d.date];
      const curShift = (cur?.shift || generateDefaultDay(d.date).shift).trim().toUpperCase();
      const shift = (p?.shift ?? curShift).toUpperCase();
      const changed = !!p && (p.shift.toUpperCase() !== curShift || (p.hours || '') !== (cur?.hours || ''));
      if (changed) changes++;
      grid.cells[e.name][d.date] = { shift, changed, locked: !e.editable.has(d.date) && !!e.locked[d.date] };
    }
  }
  console.log(`[IA] magasin=${storeId} mois=${opts.monthKey} fournisseur=${cfg.provider}/${cfg.model} appels=${calls} durée=${Date.now() - t0}ms cellules=${cells.length} ignorées=${ev.ignored.length} avertissements=${ev.warnings.length}`);

  return {
    draftId: draft.id, monthKey: opts.monthKey, provider: cfg.provider, model: cfg.model, repaired,
    comment: ev.comment, stats: ev.stats, warnings: ev.warnings.slice(0, 40), warningsTotal: ev.warnings.length,
    ignored: ev.ignored.slice(0, 40), ignoredTotal: ev.ignored.length, missing: ev.missing, changes, autoRest: ctx.autoRest.length, grid,
  };
}
