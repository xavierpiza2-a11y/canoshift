import crypto from 'crypto';

// ---------------------------------------------------------------------------
// SESSIONS (en mémoire — un redémarrage du serveur déconnecte tout le monde,
// les clients se réauthentifient automatiquement avec leur clé magasin)
// ---------------------------------------------------------------------------

export type SessionKind = 'store' | 'admin' | 'super';

interface Session {
  kind: SessionKind;
  storeId?: string;
  expiresAt: number;
}

const STORE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const ADMIN_TTL_MS = 8 * 60 * 60 * 1000; // 8 h
const SUPER_TTL_MS = 4 * 60 * 60 * 1000; // 4 h

const sessions = new Map<string, Session>();

function newId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(kind: SessionKind, storeId?: string): string {
  const id = newId();
  const ttl = kind === 'store' ? STORE_TTL_MS : kind === 'admin' ? ADMIN_TTL_MS : SUPER_TTL_MS;
  sessions.set(id, { kind, storeId, expiresAt: Date.now() + ttl });
  return id;
}

export function getSession(id: unknown, kind: SessionKind): { storeId?: string } | null {
  if (typeof id !== 'string' || id.length !== 64) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  if (s.kind !== kind) return null;
  return { storeId: s.storeId };
}

/** Révoque toutes les sessions d'un type pour un magasin (changement de clé ou de PIN). */
export function revokeStoreSessions(storeId: string, kind: SessionKind): void {
  for (const [id, s] of sessions) {
    if (s.kind === kind && s.storeId === storeId) sessions.delete(id);
  }
}

/** Retire les sessions d'un magasin supprimé. */
export function revokeAllForStore(storeId: string): void {
  for (const [id, s] of sessions) {
    if (s.storeId === storeId) sessions.delete(id);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// COMPARAISON À TEMPS CONSTANT
// ---------------------------------------------------------------------------
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// LIMITEUR DE TENTATIVES (échecs par clé, fenêtre glissante)
// ---------------------------------------------------------------------------
interface Bucket {
  fails: number;
  resetAt: number;
  blockedUntil: number;
}

export class FailureLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private maxFails: number,
    private windowMs: number,
    private blockMs: number
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, b] of this.buckets) {
        if (b.resetAt < now && b.blockedUntil < now) this.buckets.delete(k);
      }
    }, 5 * 60 * 1000).unref();
  }

  /** Retourne le nombre de secondes à attendre si bloqué, sinon 0. */
  check(key: string): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const now = Date.now();
    if (b.blockedUntil > now) return Math.ceil((b.blockedUntil - now) / 1000);
    return 0;
  }

  fail(key: string): void {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { fails: 0, resetAt: now + this.windowMs, blockedUntil: 0 };
      this.buckets.set(key, b);
    }
    b.fails += 1;
    if (b.fails >= this.maxFails) {
      b.blockedUntil = now + this.blockMs;
      b.fails = 0;
      b.resetAt = now + this.windowMs;
    }
  }

  success(key: string): void {
    this.buckets.delete(key);
  }
}

// ---------------------------------------------------------------------------
// CONFIG PUBLIQUE : jamais de PIN ni de clé magasin dans les réponses/diffusions
// ---------------------------------------------------------------------------
export function publicConfig<T extends Record<string, any> | null | undefined>(config: T): T {
  if (!config || typeof config !== 'object') return config;
  const { adminPin: _pin, apiToken: _token, ...rest } = config as Record<string, any>;
  return rest as T;
}
