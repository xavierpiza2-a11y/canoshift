import {
  ConfigData,
  Employee,
  EmployeeMonthSchedule,
  DayShift,
  ChangeEntry,
  HistoryEntry,
  MonthItem,
  Tableau2ShiftOption,
  ShiftCategoryItem,
} from '../types/planning';
import {
  DEFAULT_API_TOKEN,
  DEFAULT_STORE_NAME,
  DEFAULT_EMPLOYEES,
  DEFAULT_VISIBLE_MONTHS,
  DEFAULT_ALL_MONTHS,
  DEFAULT_TABLEAU2_SHIFTS,
  DEFAULT_CATEGORIES
} from '../config/constants';
import { realtimeClient, RealtimeMessage } from './realtimeClient';
import type { AiPlanningSettings } from '../shared/aiPlanning';

// Local storage display cache keys
const KEY_ACTIVE_STORE_ID = 'planning_active_store_id';
const KEY_STORE_NAME = 'planning_store_name';
const KEY_API_TOKEN = 'planning_api_token';
const KEY_CACHED_CONFIG = 'planning_cached_config';
const KEY_CACHED_TABLEAU2 = 'planning_tableau2_shifts';
const KEY_CACHED_CATEGORIES = 'planning_shift_categories';
const KEY_CHANGES_PREFIX = 'planning_changes_';
const KEY_HISTORY_PREFIX = 'planning_history_';
const KEY_DAY_NOTES_PREFIX = 'planning_day_notes_';
const CACHE_PREFIX_SCHEDULE = 'planning_sched_';
const CACHE_PREFIX_TEAM = 'planning_team_';

export const STORAGE_KEY_SUPERADMIN_SESSION = 'planning_superadmin_session';

// ---------------------------------------------------------------------------
// ACTIVE STORE STATE & HEADERS
// ---------------------------------------------------------------------------
export function getActiveStoreId(): string {
  if (typeof window === 'undefined') return 'store_main';
  return localStorage.getItem(KEY_ACTIVE_STORE_ID) || 'store_main';
}

export function setActiveStore(store: { id: string; name: string; token: string }): void {
  if (typeof window === 'undefined') return;
  const currentId = localStorage.getItem(KEY_ACTIVE_STORE_ID);
  if (currentId && currentId !== store.id) {
    // Clear previous store's cached plannings and notes to ensure clean isolation
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith(CACHE_PREFIX_SCHEDULE) ||
          k.startsWith(CACHE_PREFIX_TEAM) ||
          k.startsWith('planning_cached_') ||
          k.startsWith(KEY_DAY_NOTES_PREFIX) ||
          k.startsWith(KEY_CHANGES_PREFIX) ||
          k.startsWith(KEY_HISTORY_PREFIX))
      ) {
        localStorage.removeItem(k);
      }
    }
  }

  localStorage.setItem(KEY_ACTIVE_STORE_ID, store.id);
  localStorage.setItem(KEY_STORE_NAME, store.name);
  localStorage.setItem(KEY_API_TOKEN, store.token.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// SESSIONS D'AUTHENTIFICATION (en mémoire uniquement — jamais de PIN stocké)
// ---------------------------------------------------------------------------
// Les anciennes versions mémorisaient le PIN administrateur en clair sur l'appareil : on l'efface.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('planning_admin_pin');
  } catch {
    // stockage indisponible
  }
}

let storeSession = '';
let adminSession = '';
let superSession = '';
let authLost = false;
let refreshing: Promise<boolean> | null = null;

export function setStoreSession(session: string): void {
  storeSession = session || '';
  if (storeSession) authLost = false;
}
export function setAdminSession(session: string): void {
  adminSession = session || '';
}
export function clearAdminSession(): void {
  adminSession = '';
}

export function getStoreHeaders(): Record<string, string> {
  const storeId = getActiveStoreId();
  const headers: Record<string, string> = {};
  if (storeId) {
    headers['X-Store-Id'] = storeId;
  }
  if (storeSession) headers['Authorization'] = `Bearer ${storeSession}`;
  if (adminSession) headers['X-Admin-Session'] = adminSession;
  return headers;
}

function notifyAuthLost(): void {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem('planning_token_validated')) return;
  window.dispatchEvent(new CustomEvent('canoshift:auth-lost'));
}

/** Obtient une nouvelle session magasin à partir de la clé mémorisée sur l'appareil. */
export function refreshStoreSession(): Promise<boolean> {
  if (authLost) return Promise.resolve(false);
  if (refreshing) return refreshing;
  const saved = (typeof window !== 'undefined' ? localStorage.getItem(KEY_API_TOKEN) : '') || '';
  const token = saved.trim().toUpperCase();
  if (!token) return Promise.resolve(false);

  refreshing = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.valid && data.session) {
          setStoreSession(data.session);
          return true;
        }
        if (data.valid === false) {
          // La clé du magasin a changé : l'appareil doit ressaisir la nouvelle clé
          authLost = true;
          storeSession = '';
          notifyAuthLost();
        }
      }
    } catch {
      // réseau indisponible : on réessaiera plus tard
    }
    return false;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** fetch avec session magasin / admin / gestionnaire, et renouvellement automatique de session. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const isSuperPath = input.includes('/api/superadmin');
  const build = (): RequestInit => ({
    ...init,
    headers: {
      ...((init.headers as Record<string, string>) || {}),
      ...(isSuperPath ? {} : getStoreHeaders()),
      ...(isSuperPath && superSession ? { 'X-Superadmin-Token': superSession } : {}),
    },
  });

  if (!isSuperPath && !storeSession) {
    await refreshStoreSession();
  }
  let res = await fetch(input, build());
  if (res.status === 401 && !isSuperPath) {
    if (await refreshStoreSession()) {
      res = await fetch(input, build());
    }
  }
  if (res.status === 403 && !isSuperPath && typeof window !== 'undefined') {
    // Session administrateur expirée ou révoquée (PIN changé)
    try {
      const body = await res.clone().json();
      if (body?.code === 'ADMIN_REQUIRED') {
        clearAdminSession();
        window.dispatchEvent(new CustomEvent('canoshift:admin-expired'));
      }
    } catch {
      // ignore
    }
  }
  return res;
}

/** Télécharge un fichier protégé (les liens <a href> ne peuvent pas envoyer de session). */
export async function downloadAuthed(path: string, filename: string): Promise<boolean> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

// Le WebSocket s'authentifie avec la session magasin
realtimeClient.setSessionProvider(async () => {
  if (!storeSession) await refreshStoreSession();
  return storeSession;
});

function notifyDataChange(eventType: string, data: any) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('planning_database_sync', { detail: { eventType, data } }));
  }
}

// Listen to WebSocket broadcasts from backend
if (typeof window !== 'undefined') {
  realtimeClient.onMessage((msg: RealtimeMessage & { storeId?: string }) => {
    // Filter out messages for another store to avoid cross-contamination
    const activeStoreId = getActiveStoreId();
    if (msg.storeId && msg.storeId !== activeStoreId) {
      return;
    }

    switch (msg.type) {
      case 'CONFIG_UPDATED': {
        if (msg.config) {
          localStorage.setItem(KEY_CACHED_CONFIG, JSON.stringify(msg.config));
          if (msg.config.storeName) {
            localStorage.setItem(KEY_STORE_NAME, msg.config.storeName);
          }
          if (msg.config.apiToken) {
            localStorage.setItem(KEY_API_TOKEN, msg.config.apiToken);
          }
          if (msg.config.tableau2Shifts) {
            localStorage.setItem(KEY_CACHED_TABLEAU2, JSON.stringify(msg.config.tableau2Shifts));
          }
          if (msg.config.categories) {
            localStorage.setItem(KEY_CACHED_CATEGORIES, JSON.stringify(msg.config.categories));
          }
        }
        notifyDataChange('CONFIG_UPDATED', msg.config);
        break;
      }
      case 'FEATURES_UPDATED': {
        notifyDataChange('FEATURES_UPDATED', msg.features);
        break;
      }
      case 'SCHEDULES_UPDATED': {
        if (msg.monthKey && msg.teamSchedules) {
          localStorage.setItem(`${CACHE_PREFIX_TEAM}${msg.monthKey}`, JSON.stringify(msg.teamSchedules));
          for (const [empName, sched] of Object.entries(msg.teamSchedules)) {
            localStorage.setItem(`${CACHE_PREFIX_SCHEDULE}${empName}_${msg.monthKey}`, JSON.stringify(sched));
          }
        }
        notifyDataChange('SCHEDULES_UPDATED', msg);
        break;
      }
      case 'SHIFT_UPDATED': {
        const { monthKey, employeeName, schedule } = msg;
        if (monthKey && employeeName && schedule) {
          const teamKey = `${CACHE_PREFIX_TEAM}${monthKey}`;
          const raw = localStorage.getItem(teamKey);
          let teamMap: Record<string, any> = {};
          if (raw) {
            try {
              teamMap = JSON.parse(raw);
            } catch {
              teamMap = {};
            }
          }
          teamMap[employeeName] = schedule;
          localStorage.setItem(teamKey, JSON.stringify(teamMap));
          localStorage.setItem(`${CACHE_PREFIX_SCHEDULE}${employeeName}_${monthKey}`, JSON.stringify(schedule));
        }

        notifyDataChange('SHIFT_UPDATED', msg);
        break;
      }
      case 'NOTES_UPDATED': {
        if (msg.monthKey && msg.notes) {
          localStorage.setItem(`${KEY_DAY_NOTES_PREFIX}${msg.monthKey}`, JSON.stringify(msg.notes));
        }
        notifyDataChange('NOTES_UPDATED', msg);
        break;
      }
      case 'MONTH_DELETED': {
        if (msg.monthKey) {
          localStorage.removeItem(`${CACHE_PREFIX_TEAM}${msg.monthKey}`);
          localStorage.removeItem(`${KEY_DAY_NOTES_PREFIX}${msg.monthKey}`);
        }
        notifyDataChange('MONTH_DELETED', msg);
        break;
      }
      case 'STORE_RESET': {
        if (typeof window !== 'undefined') {
          const tokenVal = localStorage.getItem('planning_token_validated');
          const apiToken = localStorage.getItem('planning_api_token');
          const store = localStorage.getItem(KEY_STORE_NAME);
          const activeId = localStorage.getItem(KEY_ACTIVE_STORE_ID);
          localStorage.clear();
          if (tokenVal) localStorage.setItem('planning_token_validated', tokenVal);
          if (apiToken) localStorage.setItem('planning_api_token', apiToken);
          if (store) localStorage.setItem(KEY_STORE_NAME, store);
          if (activeId) localStorage.setItem(KEY_ACTIVE_STORE_ID, activeId);
        }
        notifyDataChange('STORE_RESET', msg);
        break;
      }
      case 'HISTORY_CLEARED': {
        if (typeof window !== 'undefined') {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(KEY_HISTORY_PREFIX)) {
              localStorage.removeItem(k);
            }
          }
        }
        notifyDataChange('HISTORY_CLEARED', msg);
        break;
      }
      case 'EMPLOYEE_HISTORY_CLEARED': {
        if (typeof window !== 'undefined' && msg.employeeName) {
          localStorage.removeItem(`${KEY_HISTORY_PREFIX}${msg.employeeName.toLowerCase()}`);
        }
        notifyDataChange('EMPLOYEE_HISTORY_CLEARED', msg);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// CACHE ACCESSORS (USED ONLY FOR ZERO-LATENCY INSTANT DISPLAY)
// ---------------------------------------------------------------------------
export function getStoredDayNotes(monthKey: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(`${KEY_DAY_NOTES_PREFIX}${monthKey}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore
    }
  }
  return {};
}

export function getCachedConfig(): ConfigData | null {
  if (typeof window === 'undefined') return null;
  const cached = localStorage.getItem(KEY_CACHED_CONFIG);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function getCachedEmployeeSchedule(
  employeeName: string,
  monthKey: string
): EmployeeMonthSchedule | null {
  if (typeof window === 'undefined') return null;
  const cacheKey = `${CACHE_PREFIX_SCHEDULE}${employeeName}_${monthKey}`;
  const cached = localStorage.getItem(cacheKey);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function getCachedTeamPlanning(
  monthKey: string
): Record<string, EmployeeMonthSchedule> | null {
  if (typeof window === 'undefined') return null;
  const cacheKey = `${CACHE_PREFIX_TEAM}${monthKey}`;
  const cached = localStorage.getItem(cacheKey);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function getApiToken(): string {
  if (typeof window === 'undefined') return DEFAULT_API_TOKEN;
  return localStorage.getItem(KEY_API_TOKEN) || DEFAULT_API_TOKEN;
}

export function setApiToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY_API_TOKEN, token.trim());
  }
}

export async function verifyApiTokenWithStore(token: string): Promise<{
  valid: boolean;
  store?: { id: string; name: string; token: string };
}> {
  const entered = (token || '').trim().toUpperCase();
  if (!entered) return { valid: false };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: entered }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.valid && data.store) {
        setStoreSession(data.session || '');
        setActiveStore(data.store);
        return { valid: true, store: data.store };
      }
      return { valid: Boolean(data.valid) };
    }
  } catch {
    // offline fallback
  }
  const configured = getApiToken().trim().toUpperCase();
  return { valid: entered === configured };
}

export async function saveAdminPin(newPin: string): Promise<boolean> {
  const pin = (newPin || '').trim();
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ adminPin: pin }),
    });
    return res.ok;
  } catch (err) {
    console.error('Error saving admin PIN to database:', err);
    return false;
  }
}

export async function verifyAdminPin(pin: string): Promise<boolean> {
  const entered = (pin || '').trim();
  if (entered.length !== 6) return false;
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: entered }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.valid && data.adminSession) setAdminSession(data.adminSession);
      return Boolean(data.valid);
    }
  } catch {
    // serveur injoignable : l'accès administrateur exige le serveur
  }
  return false;
}

export function getStoreName(): string {
  if (typeof window === 'undefined') return DEFAULT_STORE_NAME;
  return localStorage.getItem(KEY_STORE_NAME) || DEFAULT_STORE_NAME;
}

export function getStoredCategories(): ShiftCategoryItem[] {
  if (typeof window === 'undefined') return DEFAULT_CATEGORIES;
  const cached = localStorage.getItem(KEY_CACHED_CATEGORIES);
  if (cached === null) return DEFAULT_CATEGORIES;
  try {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_CATEGORIES;
}

export function getStoredTableau2Shifts(): Tableau2ShiftOption[] {
  if (typeof window === 'undefined') return DEFAULT_TABLEAU2_SHIFTS;
  const cached = localStorage.getItem(KEY_CACHED_TABLEAU2);
  if (cached === null) return DEFAULT_TABLEAU2_SHIFTS;
  try {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_TABLEAU2_SHIFTS;
}

// ---------------------------------------------------------------------------
// SERVER-AUTHORITATIVE MUTATIONS (DIRECT TO DATABASE)
// ---------------------------------------------------------------------------

export async function fetchConfig(): Promise<ConfigData> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.config) {
        const config: ConfigData = {
          storeName: data.config.storeName || DEFAULT_STORE_NAME,
          apiToken: data.config.apiToken || getApiToken(),
          employees: ensureResponsableAdmin(data.config.employees || DEFAULT_EMPLOYEES),
          visibleMonths: data.config.visibleMonths || DEFAULT_VISIBLE_MONTHS,
          allMonths: data.config.allMonths || DEFAULT_ALL_MONTHS,
        };
        // Update display cache
        if (typeof window !== 'undefined') {
          localStorage.setItem(KEY_CACHED_CONFIG, JSON.stringify(config));
          if (data.config.storeName) {
            localStorage.setItem(KEY_STORE_NAME, data.config.storeName);
          }
          if (data.config.apiToken) {
            localStorage.setItem(KEY_API_TOKEN, data.config.apiToken);
          }
          if (data.config.tableau2Shifts) {
            localStorage.setItem(KEY_CACHED_TABLEAU2, JSON.stringify(data.config.tableau2Shifts));
          }
          if (data.config.categories) {
            localStorage.setItem(KEY_CACHED_CATEGORIES, JSON.stringify(data.config.categories));
          }
        }
        return config;
      }
    }
  } catch (err) {
    console.warn('Network error fetching config from database, using local display cache:', err);
  }

  // Fallback to local display cache if offline
  const cached = getCachedConfig();
  if (cached && cached.employees && cached.employees.length > 0) {
    return {
      ...cached,
      employees: ensureResponsableAdmin(cached.employees),
    };
  }

  return {
    storeName: getStoreName(),
    apiToken: getApiToken(),
    employees: ensureResponsableAdmin(DEFAULT_EMPLOYEES),
    visibleMonths: DEFAULT_VISIBLE_MONTHS,
    allMonths: DEFAULT_ALL_MONTHS,
  };
}

export async function saveStoreName(name: string): Promise<void> {
  const trimmed = (name || '').trim() || DEFAULT_STORE_NAME;
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY_STORE_NAME, trimmed);
  }
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ storeName: trimmed }),
    });
  } catch (err) {
    console.error('Error saving store name to database:', err);
  }
}

export async function saveVisibleMonths(months: string[]): Promise<boolean> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ visibleMonths: months }),
    });
    const data = await res.json();
    if (data.success) {
      const current = getCachedConfig() || {
        employees: DEFAULT_EMPLOYEES,
        visibleMonths: DEFAULT_VISIBLE_MONTHS,
        allMonths: DEFAULT_ALL_MONTHS,
      };
      current.visibleMonths = months;
      localStorage.setItem(KEY_CACHED_CONFIG, JSON.stringify(current));
      return true;
    }
  } catch (err) {
    console.error('Failed to save visible months to database:', err);
  }
  return false;
}

export async function saveAllMonths(months: MonthItem[]): Promise<boolean> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ allMonths: months }),
    });
    const data = await res.json();
    if (data.success) {
      const current = getCachedConfig() || {
        employees: DEFAULT_EMPLOYEES,
        visibleMonths: DEFAULT_VISIBLE_MONTHS,
        allMonths: DEFAULT_ALL_MONTHS,
      };
      current.allMonths = months;
      localStorage.setItem(KEY_CACHED_CONFIG, JSON.stringify(current));
      return true;
    }
  } catch (err) {
    console.error('Failed to save all months to database:', err);
  }
  return false;
}

export async function saveEmployees(employees: Employee[]): Promise<boolean> {
  const sanitized = ensureResponsableAdmin(employees);
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ employees: sanitized }),
    });
    const data = await res.json();
    if (data.success) {
      const current = getCachedConfig() || {
        employees: DEFAULT_EMPLOYEES,
        visibleMonths: DEFAULT_VISIBLE_MONTHS,
        allMonths: DEFAULT_ALL_MONTHS,
      };
      current.employees = sanitized;
      localStorage.setItem(KEY_CACHED_CONFIG, JSON.stringify(current));
      return true;
    }
  } catch (err) {
    console.error('Failed to save employees to database:', err);
  }
  return false;
}

export async function saveStoredCategories(categories: ShiftCategoryItem[]): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY_CACHED_CATEGORIES, JSON.stringify(categories));
  }
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ categories }),
    });
  } catch (err) {
    console.error('Failed to save categories to database:', err);
  }
}

export async function saveStoredTableau2Shifts(shifts: Tableau2ShiftOption[]): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY_CACHED_TABLEAU2, JSON.stringify(shifts));
  }
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ tableau2Shifts: shifts }),
    });
  } catch (err) {
    console.error('Failed to save Tableau 2 shifts to database:', err);
  }
}

export async function clearAllTableau2AndCategories(): Promise<{
  shifts: Tableau2ShiftOption[];
  categories: ShiftCategoryItem[];
}> {
  await saveStoredTableau2Shifts([]);
  await saveStoredCategories([]);
  return { shifts: [], categories: [] };
}

export async function restoreExampleTableau2AndCategories(): Promise<{
  shifts: Tableau2ShiftOption[];
  categories: ShiftCategoryItem[];
}> {
  await saveStoredTableau2Shifts(DEFAULT_TABLEAU2_SHIFTS);
  await saveStoredCategories(DEFAULT_CATEGORIES);
  return { shifts: DEFAULT_TABLEAU2_SHIFTS, categories: DEFAULT_CATEGORIES };
}

// ---------------------------------------------------------------------------
// DAY NOTES API (DIRECT TO DATABASE)
// ---------------------------------------------------------------------------
export async function saveStoredDayNotes(
  monthKey: string,
  notes: Record<string, string>
): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${KEY_DAY_NOTES_PREFIX}${monthKey}`, JSON.stringify(notes));
  }
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/notes/${monthKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ notes }),
    });
  } catch (err) {
    console.error('Failed to save day notes to database:', err);
  }
}

export function updateDayNoteInStore(monthKey: string, dateKey: string, noteText: string): void {
  const current = getStoredDayNotes(monthKey);
  const trimmed = (noteText || '').trim();
  if (trimmed) {
    current[dateKey] = trimmed;
  } else {
    delete current[dateKey];
  }
  saveStoredDayNotes(monthKey, current);
}

// ---------------------------------------------------------------------------
// TEAM & EMPLOYEE SCHEDULES (DIRECT TO DATABASE)
// ---------------------------------------------------------------------------
export function getCalendarDaysForMonth(monthKey: string): string[] {
  const [yearStr, monthStr] = (monthKey || '').split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = String(d).padStart(2, '0');
    const mStr = String(month).padStart(2, '0');
    days.push(`${year}-${mStr}-${dStr}`);
  }
  return days;
}

export function ensureMonthCalendarDays(
  schedule: EmployeeMonthSchedule,
  monthKey: string
): EmployeeMonthSchedule {
  const calendarDays = getCalendarDaysForMonth(monthKey);
  const currentDays = schedule.days || {};
  const filledDays: Record<string, DayShift> = {};
  const dayNotes = getStoredDayNotes(monthKey);

  for (const dateKey of calendarDays) {
    const existing = currentDays[dateKey] || { shift: '', hours: '' };
    const note = dayNotes[dateKey];
    filledDays[dateKey] = {
      ...existing,
      ...(note ? { info: note } : {}),
    };
    if (!note) {
      delete filledDays[dateKey].info;
    }
  }

  return {
    ...schedule,
    month: monthKey,
    days: filledDays,
  };
}

export async function fetchEmployeeSchedule(
  employeeName: string,
  monthKey: string
): Promise<{ schedule: EmployeeMonthSchedule; isOffline: boolean }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/schedules/${monthKey}`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.schedules && data.schedules[employeeName]) {
        const fullSched = ensureMonthCalendarDays(data.schedules[employeeName], monthKey);
        if (typeof window !== 'undefined') {
          localStorage.setItem(
            `${CACHE_PREFIX_SCHEDULE}${employeeName}_${monthKey}`,
            JSON.stringify(fullSched)
          );
        }
        return { schedule: fullSched, isOffline: false };
      }
    }
  } catch {
    // Network failure
  }

  // Display cache fallback
  const cached = getCachedEmployeeSchedule(employeeName, monthKey);
  if (cached) {
    return { schedule: ensureMonthCalendarDays(cached, monthKey), isOffline: false };
  }

  const calendarDays = getCalendarDaysForMonth(monthKey);
  const initialDays: Record<string, DayShift> = {};
  for (const d of calendarDays) {
    initialDays[d] = { shift: '', hours: '' };
  }

  const newSchedule: EmployeeMonthSchedule = {
    employee: employeeName,
    month: monthKey,
    days: initialDays,
    totalHours: 0,
  };

  return { schedule: newSchedule, isOffline: false };
}

export async function fetchTeamPlanning(
  monthKey: string,
  employees: Employee[]
): Promise<{
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  updatedEmployees?: Employee[];
  isOffline: boolean;
}> {
  let dbSchedules: Record<string, EmployeeMonthSchedule> | null = null;

  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/schedules/${monthKey}`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.schedules) {
        dbSchedules = data.schedules;
      }
    }
  } catch (err) {
    console.warn('Network error fetching team planning from database:', err);
  }

  // Also fetch latest day notes
  try {
    const notesRes = await authFetch(`${import.meta.env.BASE_URL}api/notes/${monthKey}`, {
      headers: getStoreHeaders(),
    });
    if (notesRes.ok) {
      const notesData = await notesRes.json();
      if (notesData.success && notesData.notes) {
        localStorage.setItem(`${KEY_DAY_NOTES_PREFIX}${monthKey}`, JSON.stringify(notesData.notes));
      }
    }
  } catch {
    // ignore
  }

  const rawSchedules = dbSchedules || getCachedTeamPlanning(monthKey) || {};
  const calendarDays = getCalendarDaysForMonth(monthKey);
  const initialDays: Record<string, DayShift> = {};
  for (const d of calendarDays) {
    initialDays[d] = { shift: '', hours: '' };
  }

  const result: Record<string, EmployeeMonthSchedule> = {};
  for (const emp of employees) {
    const empSched = rawSchedules[emp.name] || {
      employee: emp.name,
      month: monthKey,
      days: { ...initialDays },
      totalHours: 0,
    };
    result[emp.name] = ensureMonthCalendarDays(empSched, monthKey);
  }

  // Update display cache
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${CACHE_PREFIX_TEAM}${monthKey}`, JSON.stringify(result));
    localStorage.setItem(`planning_cached_team_${monthKey}`, JSON.stringify(result));
    for (const [empName, sched] of Object.entries(result)) {
      localStorage.setItem(`${CACHE_PREFIX_SCHEDULE}${empName}_${monthKey}`, JSON.stringify(sched));
      localStorage.setItem(`planning_cached_sched_${empName}_${monthKey}`, JSON.stringify(sched));
    }
  }

  return { teamSchedules: result, isOffline: false };
}

export async function fetchAllSchedules(): Promise<Record<string, Record<string, EmployeeMonthSchedule>> | null> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/schedules`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.schedules) {
        if (typeof window !== 'undefined') {
          for (const [mKey, teamMap] of Object.entries(data.schedules as Record<string, Record<string, any>>)) {
            localStorage.setItem(`${CACHE_PREFIX_TEAM}${mKey}`, JSON.stringify(teamMap));
            localStorage.setItem(`planning_cached_team_${mKey}`, JSON.stringify(teamMap));
            for (const [empName, empSched] of Object.entries(teamMap)) {
              localStorage.setItem(`${CACHE_PREFIX_SCHEDULE}${empName}_${mKey}`, JSON.stringify(empSched));
              localStorage.setItem(`planning_cached_sched_${empName}_${mKey}`, JSON.stringify(empSched));
            }
          }
        }
        return data.schedules;
      }
    }
  } catch (err) {
    console.warn('Network error fetching all schedules:', err);
  }
  return null;
}

export async function updateShiftInSheet(
  monthKey: string,
  employeeName: string,
  dateKey: string,
  shift: string,
  hours: string,
  info?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/schedules/${monthKey}/shift`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({
        employeeName,
        dateKey,
        shift,
        hours,
        info,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur lors de la sauvegarde sur la base de données');
    }

    if (data.schedule && typeof window !== 'undefined') {
      const teamCacheKey = `${CACHE_PREFIX_TEAM}${monthKey}`;
      const rawTeam = localStorage.getItem(teamCacheKey);
      let teamObj = rawTeam ? JSON.parse(rawTeam) : {};
      teamObj[employeeName] = data.schedule;
      localStorage.setItem(teamCacheKey, JSON.stringify(teamObj));
      localStorage.setItem(
        `${CACHE_PREFIX_SCHEDULE}${employeeName}_${monthKey}`,
        JSON.stringify(data.schedule)
      );
    }

    return {
      success: true,
      message: `Horaire enregistré sur la base de données pour ${employeeName} le ${dateKey} !`,
    };
  } catch (err: any) {
    console.error('Error saving shift to database:', err);
    return {
      success: false,
      message: `Erreur base de données : ${err.message || 'Impossible de joindre le serveur'}`,
    };
  }
}

export async function saveLocalTeamPlanning(
  monthKey: string,
  teamSchedules: Record<string, EmployeeMonthSchedule>,
  updatedEmployees?: Employee[]
): Promise<void> {
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/schedules/${monthKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders(),
      },
      body: JSON.stringify({ teamSchedules }),
    });

    if (updatedEmployees && updatedEmployees.length > 0) {
      await saveEmployees(updatedEmployees);
    }
  } catch (err) {
    console.error('Failed to save team planning to database:', err);
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(`${CACHE_PREFIX_TEAM}${monthKey}`, JSON.stringify(teamSchedules));
    for (const [empName, sched] of Object.entries(teamSchedules)) {
      localStorage.setItem(`${CACHE_PREFIX_SCHEDULE}${empName}_${monthKey}`, JSON.stringify(sched));
    }
  }
}

export async function deleteMonthData(monthKey: string): Promise<void> {
  try {
    await authFetch(`${import.meta.env.BASE_URL}api/months/${monthKey}`, {
      method: 'DELETE',
      headers: getStoreHeaders(),
    });
  } catch (err) {
    console.error('Error deleting month from database:', err);
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`${CACHE_PREFIX_TEAM}${monthKey}`);
    localStorage.removeItem(`${KEY_DAY_NOTES_PREFIX}${monthKey}`);
  }
}

// ---------------------------------------------------------------------------
// CHANGES & HISTORY (DIRECT TO DATABASE)
// ---------------------------------------------------------------------------
export async function fetchChanges(employeeName: string): Promise<ChangeEntry[]> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/changes/${encodeURIComponent(employeeName)}`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.changes) {
        return data.changes;
      }
    }
  } catch {
    // fallback
  }
  return [];
}

export async function clearChanges(employeeName: string): Promise<boolean> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/changes/${encodeURIComponent(employeeName)}/clear`, {
      method: 'POST',
      headers: getStoreHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchHistory(employeeName: string): Promise<HistoryEntry[]> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/history/${encodeURIComponent(employeeName)}`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.history) {
        return data.history;
      }
    }
  } catch {
    // fallback
  }
  return [];
}

export async function fetchAllHistory(): Promise<{
  records: HistoryEntry[];
  count: number;
  byEmployee: Record<string, number>;
}> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/history`, {
      headers: getStoreHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        return {
          records: data.records || [],
          count: data.count || 0,
          byEmployee: data.byEmployee || {},
        };
      }
    }
  } catch (err) {
    console.error('Error fetching all history:', err);
  }
  return { records: [], count: 0, byEmployee: {} };
}

export async function deleteAllHistory(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/history`, {
      method: 'DELETE',
      headers: getStoreHeaders(),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, count: data.deletedCount || 0 };
    }
    return { success: false, count: 0, error: data.error || 'Erreur lors de la suppression' };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

export async function deleteEmployeeHistory(employeeName: string): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/history/${encodeURIComponent(employeeName)}`, {
      method: 'DELETE',
      headers: getStoreHeaders(),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, count: data.deletedCount || 0 };
    }
    return { success: false, count: 0, error: data.error || 'Erreur lors de la suppression' };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

export async function fetchAvailableShifts(): Promise<Tableau2ShiftOption[]> {
  return getStoredTableau2Shifts();
}

export function renameEmployeeData(oldName: string, newName: string): void {
  if (typeof window === 'undefined' || !oldName || !newName || oldName === newName) return;
  try {
    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${CACHE_PREFIX_SCHEDULE}${oldName}_`)) {
        keysToMigrate.push(key);
      }
    }
    for (const oldKey of keysToMigrate) {
      const raw = localStorage.getItem(oldKey);
      if (raw) {
        const monthKey = oldKey.replace(`${CACHE_PREFIX_SCHEDULE}${oldName}_`, '');
        const newKey = `${CACHE_PREFIX_SCHEDULE}${newName}_${monthKey}`;
        try {
          const sched = JSON.parse(raw);
          sched.employee = newName;
          localStorage.setItem(newKey, JSON.stringify(sched));
        } catch {
          localStorage.setItem(newKey, raw);
        }
        localStorage.removeItem(oldKey);
      }
    }
  } catch (err) {
    console.error('Failed to migrate employee schedule data:', err);
  }
}

export function ensureResponsableAdmin(employeesList: Employee[]): Employee[] {
  if (!employeesList || employeesList.length === 0) {
    return DEFAULT_EMPLOYEES;
  }

  let hasResponsable = false;

  const sanitized = employeesList.map((emp) => {
    const trimmedName = emp.name.trim().toLowerCase();
    const isNamedResp = trimmedName === 'responsable';
    const isRespRole = Boolean(emp.role && emp.role.trim().toLowerCase().includes('responsable'));

    if (isNamedResp || isRespRole) {
      hasResponsable = true;
      return {
        ...emp,
        role: 'Responsable',
        isAdmin: true,
      };
    }

    return emp;
  });

  if (!hasResponsable) {
    sanitized.unshift({
      name: 'Responsable',
      color: '#1a6b2a',
      role: 'Responsable',
      isAdmin: true,
    });
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// SUPER-ADMIN / GESTIONNAIRE CLIENT API
// ---------------------------------------------------------------------------
export async function superAdminLogin(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      superSession = data.token || '';
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SUPERADMIN_SESSION, 'authorized');
      }
      return { success: true };
    }
    return { success: false, error: data.error || 'Mot de passe incorrect.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function superAdminGetStores(): Promise<{
  success: boolean;
  stores: Array<{
    id: string;
    name: string;
    token: string;
    adminPin: string;
    createdAt: string;
    dataFile: string;
    stats?: {
      totalEmployees: number;
      totalMonths: number;
      totalChanges: number;
      lastSavedAt: string | null;
    };
  }>;
  error?: string;
}> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores`);
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, stores: data.stores };
    }
    return { success: false, stores: [], error: data.error };
  } catch (err: any) {
    return { success: false, stores: [], error: err.message };
  }
}

export async function superAdminCreateStore(
  name: string,
  token: string,
  adminPin?: string
): Promise<{ success: boolean; store?: any; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, token, adminPin }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, store: data.store };
    }
    return { success: false, error: data.error || 'Erreur lors de la création du magasin.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function superAdminUpdateStore(
  storeId: string,
  updates: { name?: string; token?: string; adminPin?: string; features?: { aiPlanning?: boolean; aiModels?: string[] } }
): Promise<{ success: boolean; store?: any; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores/${storeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, store: data.store };
    }
    return { success: false, error: data.error || 'Erreur lors de la mise à jour.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function superAdminDeleteStore(storeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores/${storeId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Erreur lors de la suppression.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function superAdminRestoreStore(
  storeId: string,
  backupData: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores/${storeId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Erreur lors de la restauration.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function superAdminResetStore(storeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/superadmin/stores/${storeId}/reset`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Erreur lors de la réinitialisation.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// ---------------------------------------------------------------------------
// Options du magasin et réglages de la génération de planning par IA
// ---------------------------------------------------------------------------
export interface StoreFeatures {
  aiPlanning: boolean;
}

/** Options activées par le gestionnaire pour ce magasin (tout désactivé en cas d'erreur). */
export async function fetchStoreFeatures(): Promise<StoreFeatures> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/features`);
    if (!res.ok) return { aiPlanning: false };
    const data = await res.json();
    return { aiPlanning: data?.features?.aiPlanning === true };
  } catch {
    return { aiPlanning: false };
  }
}

export async function fetchAiPlanningSettings(): Promise<{ success: boolean; settings?: AiPlanningSettings; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/ai-planning/settings`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, settings: data.settings };
    return { success: false, error: data.error || 'Impossible de charger les réglages.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function saveAiPlanningSettings(
  settings: AiPlanningSettings
): Promise<{ success: boolean; settings?: AiPlanningSettings; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/ai-planning/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, settings: data.settings };
    return { success: false, error: data.error || "Impossible d'enregistrer les réglages." };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// ---------------------------------------------------------------------------
// Génération du planning par IA : état, brouillon, application
// ---------------------------------------------------------------------------
export interface AiModelInfo { provider: 'gemini' | 'anthropic'; label: string; model: string; configured: boolean }
export interface AiStatus { configured: boolean; provider: 'gemini' | 'anthropic'; model: string; allowed: AiModelInfo[]; limitPerHour: number; remaining: number; retryAfterMinutes: number }
export interface AiDraftStat { employee: string; targetHours: number; plannedHours: number; delta: number; workingDays: number; changes: number }
export interface AiDraftView {
  draftId: string; monthKey: string; provider: string; model: string; repaired: boolean; comment: string;
  stats: AiDraftStat[]; warnings: string[]; warningsTotal: number;
  ignored: { employee: string; date: string; reason: string }[]; ignoredTotal: number; missing: number; changes: number; autoRest: number;
  grid: { dates: string[]; open: Record<string, boolean>; employees: string[]; cells: Record<string, Record<string, { shift: string; changed: boolean; locked: boolean }>> };
}
export interface AiGenerateRequest {
  monthKey: string; instructions: string; // tous les autres paramètres sont les réglages ENREGISTRÉS du magasin
}

export async function fetchAiStatus(): Promise<{ success: boolean; status?: AiStatus; error?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/ai-planning/status`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, status: data as AiStatus };
    return { success: false, error: data.error || "Impossible de lire l'état de l'IA." };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function generateAiDraft(req: AiGenerateRequest): Promise<{ success: boolean; draft?: AiDraftView; remaining?: number; error?: string; code?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/ai-planning/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, draft: data.draft, remaining: data.remaining };
    return { success: false, error: data.error || 'La génération a échoué.', code: data.code };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function applyAiDraft(draftId: string): Promise<{ success: boolean; applied?: number; unchanged?: number; skipped?: { employee: string; date: string; reason: string }[]; error?: string; code?: string }> {
  try {
    const res = await authFetch(`${import.meta.env.BASE_URL}api/ai-planning/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, applied: data.applied, unchanged: data.unchanged, skipped: data.skipped };
    return { success: false, error: data.error || "L'application a échoué.", code: data.code };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}
