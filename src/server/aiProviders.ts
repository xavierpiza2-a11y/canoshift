// Appel des fournisseurs d'IA (Gemini gratuit ou Claude), limite de générations et brouillons en mémoire.
// Aucune dépendance npm : appels HTTP directs (fetch) → pas de changement de package.json ni de bun.lock.
// Les clés ne quittent jamais le serveur et ne sont jamais journalisées.

import crypto from 'crypto';
import type { Cell, Evaluation } from '../shared/aiGeneration.ts';
import { AI_PROVIDER_LABELS, type AiProvider } from '../shared/aiPlanning.ts';

export type { AiProvider };

export interface AiEnvConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  configured: boolean;
  maxPerHour: number;
  timeoutMs: number;
  maxOutputTokens: number;
  baseUrl: string;
}

const PLACEHOLDER = /^(|MY_GEMINI_API_KEY|VOTRE.*|CHANGE.?ME|xxx+)$/i;

/** Lit la configuration à chaque appel (le .env est chargé au démarrage ; les tests peuvent la modifier). */
export function defaultProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  return (env.AI_PROVIDER || 'gemini').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'gemini';
}

/** Modèles autorisés pour un magasin (choisis par le gestionnaire) ; à défaut, le modèle par défaut du serveur. */
export function allowedProviders(features: { aiModels?: AiProvider[] } | undefined, env: NodeJS.ProcessEnv = process.env): AiProvider[] {
  const list = (features?.aiModels || []).filter((p) => p === 'gemini' || p === 'anthropic');
  return list.length ? list : [defaultProvider(env)];
}

/** Modèle réellement utilisé : le choix de l'administrateur s'il est autorisé, sinon le premier autorisé. */
export function chooseProvider(choice: AiProvider | undefined, allowed: AiProvider[]): AiProvider {
  return choice && allowed.includes(choice) ? choice : allowed[0];
}

export function providerOverview(allowed: AiProvider[], env: NodeJS.ProcessEnv = process.env) {
  return allowed.map((p) => {
    const c = readAiConfig(env, p);
    return { provider: p, label: AI_PROVIDER_LABELS[p], model: c.model, configured: c.configured };
  });
}

export function readAiConfig(env: NodeJS.ProcessEnv = process.env, forced?: AiProvider): AiEnvConfig {
  const provider: AiProvider = forced ?? defaultProvider(env);
  const apiKey = ((provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY) || '').trim().replace(/^["']|["']$/g, '');
  const intOf = (v: string | undefined, def: number, min: number, max: number) => {
    const n = Number.parseInt((v || '').trim(), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    provider,
    model: ((provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.GEMINI_MODEL) || (provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gemini-3.8-flash')).trim(),
    apiKey,
    configured: !PLACEHOLDER.test(apiKey),
    maxPerHour: intOf(env.AI_MAX_GENERATIONS_PER_HOUR, 10, 1, 1000), // limite par magasin et par heure
    timeoutMs: intOf(env.AI_TIMEOUT_SECONDS, 120, 10, 600) * 1000,
    maxOutputTokens: intOf(env.AI_MAX_OUTPUT_TOKENS, 16000, 1000, 64000),
    baseUrl: ((provider === 'anthropic' ? env.ANTHROPIC_BASE_URL : env.GEMINI_BASE_URL) || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://generativelanguage.googleapis.com')).replace(/\/+$/, ''),
  };
}

export class AiProviderError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

function friendly(provider: AiProvider, status: number): string {
  const who = provider === 'anthropic' ? 'Claude' : 'Gemini';
  if (status === 400) return `${who} a refusé la demande (modèle indisponible ou requête invalide). Vérifie le nom du modèle dans le fichier .env.`;
  if (status === 401 || status === 403) return `Clé API ${who} refusée. Vérifie-la dans le fichier .env.`;
  if (status === 404) return `Modèle ${who} introuvable. Vérifie le nom du modèle dans le fichier .env.`;
  if (status === 429) return `Quota ${who} atteint (offre gratuite limitée). Réessaie plus tard ou change de modèle.`;
  if (status >= 500) return `${who} est momentanément indisponible. Réessaie dans quelques minutes.`;
  return `Erreur ${who} (${status}).`;
}

/** Envoie le prompt au fournisseur et renvoie le texte de la réponse. */
export async function callModel(system: string, user: string, cfg: AiEnvConfig = readAiConfig(), fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!cfg.configured) throw new AiProviderError("Aucune clé API configurée sur le serveur (fichier .env).", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    let res: Response;
    if (cfg.provider === 'anthropic') {
      res = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: Math.min(cfg.maxOutputTokens, 16000), temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
      });
    } else {
      res = await fetchImpl(`${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: cfg.maxOutputTokens },
        }),
      });
    }
    if (!res.ok) throw new AiProviderError(friendly(cfg.provider, res.status), res.status === 429 ? 429 : 502);
    const data: any = await res.json().catch(() => ({}));
    const text: string = cfg.provider === 'anthropic'
      ? (data?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
      : (data?.candidates?.[0]?.content?.parts || []).map((p: any) => (p?.thought ? '' : p?.text || '')).join('');
    if (!text.trim()) {
      const blocked = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
      throw new AiProviderError(`Réponse vide de l'IA${blocked ? ` (${blocked})` : ''}. Réessaie.`);
    }
    return text;
  } catch (err: any) {
    if (err instanceof AiProviderError) throw err;
    if (err?.name === 'AbortError') throw new AiProviderError(`L'IA n'a pas répondu à temps (${Math.round(cfg.timeoutMs / 1000)} s). Réessaie.`, 504);
    throw new AiProviderError("Impossible de joindre le service d'IA (réseau de la VM ?).");
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Limite de générations par magasin (fenêtre glissante d'1 heure) + une seule génération à la fois par magasin
// ---------------------------------------------------------------------------
const history = new Map<string, number[]>();
const running = new Set<string>();
const HOUR = 3600_000;

export function rateStatus(storeId: string, max: number, now = Date.now()): { used: number; remaining: number; retryAfterMinutes: number } {
  const list = (history.get(storeId) || []).filter((t) => now - t < HOUR);
  history.set(storeId, list);
  return { used: list.length, remaining: Math.max(0, max - list.length), retryAfterMinutes: list.length >= max ? Math.max(1, Math.ceil((HOUR - (now - list[0])) / 60_000)) : 0 };
}

/** Réserve une génération ; renvoie une erreur lisible si la limite est atteinte ou si une génération est déjà en cours. */
export function acquireGeneration(storeId: string, max: number): { ok: true; release: () => void } | { ok: false; status: number; error: string } {
  if (running.has(storeId)) return { ok: false, status: 409, error: 'Une génération est déjà en cours pour ce magasin.' };
  const st = rateStatus(storeId, max);
  if (st.remaining <= 0) return { ok: false, status: 429, error: `Limite atteinte : ${max} génération(s) par heure. Réessaie dans ${st.retryAfterMinutes} min.` };
  history.get(storeId)!.push(Date.now());
  running.add(storeId);
  return { ok: true, release: () => { running.delete(storeId); } };
}

/** Rend une génération au compteur (ex. le fournisseur est en panne : cela ne doit pas consommer la limite). */
export function refundGeneration(storeId: string): void {
  const list = history.get(storeId);
  if (list?.length) list.pop();
}

export function _resetAiLimits(): void { history.clear(); running.clear(); drafts.clear(); }

// ---------------------------------------------------------------------------
// Brouillons : jamais écrits dans le planning avant validation par l'admin
// ---------------------------------------------------------------------------
export interface Draft {
  id: string; storeId: string; monthKey: string; createdAt: number;
  cells: Cell[]; // propositions valides + jours fermés remis en repos
  evaluation: Evaluation;
  provider: AiProvider; model: string;
}
const drafts = new Map<string, Draft>();
const DRAFT_TTL = HOUR;
const MAX_DRAFTS_PER_STORE = 10;

export function saveDraft(d: Omit<Draft, 'id' | 'createdAt'>): Draft {
  const now = Date.now();
  for (const [k, v] of drafts) if (now - v.createdAt > DRAFT_TTL) drafts.delete(k);
  const mine = [...drafts.values()].filter((x) => x.storeId === d.storeId).sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length >= MAX_DRAFTS_PER_STORE) drafts.delete(mine.shift()!.id);
  const draft: Draft = { ...d, id: crypto.randomUUID(), createdAt: now };
  drafts.set(draft.id, draft);
  return draft;
}

export function getDraft(storeId: string, id: string): Draft | undefined {
  const d = drafts.get(String(id));
  if (!d || d.storeId !== storeId || Date.now() - d.createdAt > DRAFT_TTL) return undefined; // jamais le brouillon d'un autre magasin
  return d;
}
export function deleteDraft(id: string): void { drafts.delete(id); }
