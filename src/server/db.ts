import fs from 'fs';
import path from 'path';
import {
  DEFAULT_STORE_NAME,
  DEFAULT_EMPLOYEES,
  DEFAULT_VISIBLE_MONTHS,
  DEFAULT_ALL_MONTHS,
  DEFAULT_TABLEAU2_SHIFTS,
  DEFAULT_CATEGORIES,
  DEFAULT_API_TOKEN,
  DEFAULT_ADMIN_PIN,
} from '../config/constants.ts';
import { coreShiftHours, getMonthDateKeys, generateDefaultDay, buildMonthItem, getExerciseMonthKeys, getExerciseStartYear } from '../shared/planning.ts';
import { ensureCoreConfig } from '../shared/coreConfig.ts';

export interface StoreInfo {
  id: string;
  name: string;
  token: string;
  adminPin: string;
  createdAt: string;
  dataFile: string;
}

export interface ServerConfig {
  storeName: string;
  apiToken: string;
  adminPin: string;
  employees: any[];
  visibleMonths: string[];
  allMonths: any[];
  tableau2Shifts: any[];
  categories: any[];
}

export interface DayShiftData {
  shift: string;
  hours: string;
  info?: string;
}

export interface EmployeeScheduleData {
  employee: string;
  month: string;
  days: Record<string, DayShiftData>;
  totalHours: number;
}

export interface ChangeRecord {
  id: string;
  employeeName: string;
  date: string;
  previousShift?: string;
  newShift: string;
  previousHours?: string;
  newHours?: string;
  timestamp: string;
}

export interface HistoryRecord {
  id: string;
  employee: string;
  date: string;
  change: string;
  timestamp: string;
}

export interface DatabaseState {
  config: ServerConfig;
  schedules: Record<string, Record<string, EmployeeScheduleData>>; // monthKey -> employeeName -> Schedule
  dayNotes: Record<string, Record<string, string>>; // monthKey -> { dateKey: note }
  changes: Record<string, ChangeRecord[]>; // employeeName.toLowerCase() -> ChangeRecord[]
  history: Record<string, HistoryRecord[]>; // employeeName.toLowerCase() -> HistoryRecord[]
}

// ---------------------------------------------------------------------------
// PATHS & STORAGE CONFIGURATION
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORES_DIR = path.join(DATA_DIR, 'stores');
const STORES_JSON_PATH = path.join(DATA_DIR, 'stores.json');
const LEGACY_DB_JSON_PATH = path.join(DATA_DIR, 'planning_db.json');

// In-memory cache for maximum performance
let storesRegistry: StoreInfo[] = [];
const storeDatabases = new Map<string, DatabaseState>();
const storeLastSavedAt = new Map<string, string>();

function createDefaultState(storeName = DEFAULT_STORE_NAME, apiToken = DEFAULT_API_TOKEN, adminPin = DEFAULT_ADMIN_PIN): DatabaseState {
  return {
    config: {
      storeName,
      apiToken,
      adminPin,
      employees: DEFAULT_EMPLOYEES,
      visibleMonths: DEFAULT_VISIBLE_MONTHS,
      allMonths: DEFAULT_ALL_MONTHS,
      tableau2Shifts: DEFAULT_TABLEAU2_SHIFTS,
      categories: DEFAULT_CATEGORIES,
    },
    schedules: {},
    dayNotes: {},
    changes: {},
    history: {},
  };
}

// Save stores registry file
function saveStoresRegistryFile(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${STORES_JSON_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(storesRegistry, null, 2), 'utf-8');
    fs.renameSync(tmp, STORES_JSON_PATH);
  } catch (err) {
    console.error('Error saving stores registry file:', err);
  }
}

// Save individual store file
function saveStoreDataFile(storeId: string): void {
  try {
    const store = storesRegistry.find((s) => s.id === storeId);
    if (!store) return;
    const db = storeDatabases.get(storeId);
    if (!db) return;

    if (!fs.existsSync(STORES_DIR)) {
      fs.mkdirSync(STORES_DIR, { recursive: true });
    }

    const filePath = path.join(STORES_DIR, store.dataFile);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
    storeLastSavedAt.set(storeId, new Date().toISOString());
  } catch (err) {
    console.error(`Error saving store data file for store ${storeId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// DATABASE INITIALIZATION & MIGRATION
// ---------------------------------------------------------------------------
export async function initDatabase(): Promise<{
  type: 'local';
  connected: boolean;
  totalStores: number;
  storageLocation: string;
}> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORES_DIR)) {
      fs.mkdirSync(STORES_DIR, { recursive: true });
    }

    if (fs.existsSync(STORES_JSON_PATH)) {
      try {
        const raw = fs.readFileSync(STORES_JSON_PATH, 'utf-8');
        storesRegistry = JSON.parse(raw);
        if (!Array.isArray(storesRegistry)) {
          storesRegistry = [];
        }
      } catch {
        storesRegistry = [];
      }
    } else {
      storesRegistry = [];
    }

    // Auto-discover any existing store files in data/stores
    const existingStoreFiles = fs.existsSync(STORES_DIR)
      ? fs.readdirSync(STORES_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      : [];

    for (const file of existingStoreFiles) {
      const alreadyRegistered = storesRegistry.some((s) => s.dataFile === file);
      if (!alreadyRegistered) {
        try {
          const filePath = path.join(STORES_DIR, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed && parsed.config) {
            const storeId = file.replace('.json', '');
            const discoveredStore: StoreInfo = {
              id: storeId,
              name: parsed.config.storeName || storeId,
              token: (parsed.config.apiToken || DEFAULT_API_TOKEN).trim().toUpperCase(),
              adminPin: parsed.config.adminPin || DEFAULT_ADMIN_PIN,
              createdAt: new Date().toISOString(),
              dataFile: file,
            };
            storesRegistry.push(discoveredStore);
          }
        } catch {
          // ignore invalid file
        }
      }
    }

    // Auto-migrate from legacy single store or create initial store if registry is still empty
    if (storesRegistry.length === 0) {
      let initialData: DatabaseState | null = null;
      let initialName = DEFAULT_STORE_NAME;
      let initialToken = DEFAULT_API_TOKEN;
      let initialPin = DEFAULT_ADMIN_PIN;

      const mainStorePath = path.join(STORES_DIR, 'store_main.json');
      if (fs.existsSync(mainStorePath)) {
        try {
          const content = fs.readFileSync(mainStorePath, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed && parsed.config) {
            initialData = parsed;
            initialName = parsed.config.storeName || DEFAULT_STORE_NAME;
            initialToken = (parsed.config.apiToken || DEFAULT_API_TOKEN).trim().toUpperCase();
            initialPin = parsed.config.adminPin || DEFAULT_ADMIN_PIN;
          }
        } catch {
          // ignore
        }
      } else if (fs.existsSync(LEGACY_DB_JSON_PATH)) {
        try {
          const content = fs.readFileSync(LEGACY_DB_JSON_PATH, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed && parsed.config) {
            initialData = parsed;
            initialName = parsed.config.storeName || DEFAULT_STORE_NAME;
            initialToken = (parsed.config.apiToken || DEFAULT_API_TOKEN).trim().toUpperCase();
            initialPin = parsed.config.adminPin || DEFAULT_ADMIN_PIN;
          }
        } catch {
          // ignore
        }
      }

      const defaultStore: StoreInfo = {
        id: 'store_main',
        name: initialName,
        token: initialToken,
        adminPin: initialPin,
        createdAt: new Date().toISOString(),
        dataFile: 'store_main.json',
      };

      storesRegistry = [defaultStore];
      saveStoresRegistryFile();

      const storeFilePath = path.join(STORES_DIR, defaultStore.dataFile);
      if (!fs.existsSync(storeFilePath) || initialData) {
        const dataToSave = initialData || createDefaultState(initialName, initialToken, initialPin);
        fs.writeFileSync(storeFilePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
        storeDatabases.set(defaultStore.id, dataToSave);
        storeLastSavedAt.set(defaultStore.id, new Date().toISOString());
      }
    } else {
      saveStoresRegistryFile();
    }

    // Load all registered store files into memory
    for (const store of storesRegistry) {
      const filePath = path.join(STORES_DIR, store.dataFile);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed) {
            storeDatabases.set(store.id, {
              config: {
                ...createDefaultState(store.name, store.token, store.adminPin).config,
                ...(parsed.config || {}),
                storeName: store.name,
                apiToken: store.token,
                adminPin: store.adminPin || parsed.config?.adminPin || DEFAULT_ADMIN_PIN,
              },
              schedules: parsed.schedules || {},
              dayNotes: parsed.dayNotes || {},
              changes: parsed.changes || {},
              history: parsed.history || {},
            });
            storeLastSavedAt.set(store.id, new Date().toISOString());
          }
        } catch (err) {
          console.error(`Error loading store file ${store.dataFile}:`, err);
        }
      } else {
        // Create initial file if missing
        const defaultState = createDefaultState(store.name, store.token, store.adminPin);
        fs.writeFileSync(filePath, JSON.stringify(defaultState, null, 2), 'utf-8');
        storeDatabases.set(store.id, defaultState);
        storeLastSavedAt.set(store.id, new Date().toISOString());
      }
    }

    // Migration : les 6 catégories de base sont ajoutées/verrouillées sans toucher aux personnalisées ni aux journées
    for (const store of storesRegistry) {
      const loaded = storeDatabases.get(store.id);
      if (loaded && applyCoreConfig(loaded)) {
        saveStoreDataFile(store.id);
      }
    }

    console.log(`Autonomous multi-store database initialized. Loaded ${storesRegistry.length} store(s).`);
    return {
      type: 'local',
      connected: true,
      totalStores: storesRegistry.length,
      storageLocation: STORES_DIR,
    };
  } catch (err) {
    console.error('Fatal database initialization error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// STORES REGISTRY MANAGEMENT (SUPER-ADMIN)
// ---------------------------------------------------------------------------
export function dbGetStores(): StoreInfo[] {
  return [...storesRegistry];
}

export function dbGetStoreById(storeId?: string): StoreInfo | undefined {
  if (!storeId) return storesRegistry[0];
  return storesRegistry.find((s) => s.id === storeId) || storesRegistry[0];
}

export function dbGetStoreByToken(token: string): StoreInfo | undefined {
  const clean = (token || '').trim().toUpperCase();
  if (!clean) return undefined;
  return storesRegistry.find((s) => (s.token || '').trim().toUpperCase() === clean);
}

export async function dbCreateStore(name: string, token: string, adminPin = DEFAULT_ADMIN_PIN): Promise<StoreInfo> {
  const cleanName = (name || '').trim();
  const cleanToken = (token || '').trim().toUpperCase();
  const cleanPin = (adminPin || DEFAULT_ADMIN_PIN).trim();

  if (!cleanName) throw new Error('Le nom du magasin est requis.');
  if (!cleanToken) throw new Error("La clé d'accès est requise.");

  const exists = storesRegistry.some((s) => s.token.trim().toUpperCase() === cleanToken);
  if (exists) {
    throw new Error(`La clé d'accès « ${cleanToken} » est déjà utilisée par un autre magasin.`);
  }

  const storeId = `store_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const dataFile = `${storeId}.json`;

  const newStore: StoreInfo = {
    id: storeId,
    name: cleanName,
    token: cleanToken,
    adminPin: cleanPin,
    createdAt: new Date().toISOString(),
    dataFile,
  };

  const newState = createDefaultState(cleanName, cleanToken, cleanPin);
  storeDatabases.set(storeId, newState);
  storesRegistry.push(newStore);

  // Planning initial du/des salarié(s) de départ pour tous les mois de l'exercice
  const initialEmployees = (newState.config.employees || []).map((e) => e.name);
  for (const m of (newState.config.allMonths || []).map((x) => x.key)) {
    generateMonthDays(newState, m, initialEmployees);
  }

  saveStoresRegistryFile();
  saveStoreDataFile(storeId);

  return newStore;
}

export async function dbUpdateStore(
  storeId: string,
  updates: Partial<Pick<StoreInfo, 'name' | 'token' | 'adminPin'>>
): Promise<StoreInfo> {
  const store = storesRegistry.find((s) => s.id === storeId);
  if (!store) throw new Error(`Magasin ${storeId} introuvable.`);

  if (updates.name !== undefined) {
    store.name = updates.name.trim();
  }
  if (updates.token !== undefined) {
    const nextToken = updates.token.trim().toUpperCase();
    if (!nextToken) throw new Error("La clé d'accès ne peut pas être vide.");
    const duplicate = storesRegistry.some((s) => s.id !== storeId && s.token.trim().toUpperCase() === nextToken);
    if (duplicate) {
      throw new Error(`La clé d'accès « ${nextToken} » est déjà attribuée à un autre magasin.`);
    }
    store.token = nextToken;
  }
  if (updates.adminPin !== undefined) {
    store.adminPin = updates.adminPin.trim();
  }

  // Update in-memory state config
  const db = storeDatabases.get(storeId);
  if (db) {
    db.config.storeName = store.name;
    db.config.apiToken = store.token;
    db.config.adminPin = store.adminPin;
  }

  saveStoresRegistryFile();
  saveStoreDataFile(storeId);

  return store;
}

export async function dbDeleteStore(storeId: string): Promise<boolean> {
  if (storesRegistry.length <= 1) {
    throw new Error('Impossible de supprimer le dernier magasin restant.');
  }

  const index = storesRegistry.findIndex((s) => s.id === storeId);
  if (index === -1) throw new Error(`Magasin ${storeId} introuvable.`);

  const store = storesRegistry[index];
  storesRegistry.splice(index, 1);
  storeDatabases.delete(storeId);
  storeLastSavedAt.delete(storeId);

  saveStoresRegistryFile();

  // Remove JSON file
  try {
    const filePath = path.join(STORES_DIR, store.dataFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Error deleting file for store ${storeId}:`, err);
  }

  return true;
}

export function dbGetStoreStats(storeId: string) {
  const db = storeDatabases.get(storeId);
  const store = storesRegistry.find((s) => s.id === storeId);
  if (!db || !store) return null;

  const totalEmployees = db.config.employees ? db.config.employees.length : 0;
  const totalMonths = Object.keys(db.schedules || {}).length;
  let totalChanges = 0;
  for (const c of Object.values(db.changes || {})) {
    totalChanges += (c || []).length;
  }

  return {
    id: store.id,
    name: store.name,
    token: store.token,
    adminPin: store.adminPin,
    totalEmployees,
    totalMonths,
    totalChanges,
    lastSavedAt: storeLastSavedAt.get(storeId) || null,
  };
}

// ---------------------------------------------------------------------------
// STORE-SCOPED DATA ACCESSORS
// ---------------------------------------------------------------------------
function getStoreDb(storeId?: string): DatabaseState {
  const resolved = dbGetStoreById(storeId);
  const id = resolved ? resolved.id : (storesRegistry[0]?.id || 'store_main');
  let db = storeDatabases.get(id);
  if (!db) {
    db = createDefaultState(resolved?.name, resolved?.token, resolved?.adminPin);
    storeDatabases.set(id, db);
  }
  return db;
}

export function getDatabaseStatus(storeId?: string) {
  const resolved = dbGetStoreById(storeId);
  const id = resolved ? resolved.id : (storesRegistry[0]?.id || 'store_main');
  const db = getStoreDb(id);

  const totalMonths = Object.keys(db.schedules || {}).length;
  let totalChanges = 0;
  for (const c of Object.values(db.changes || {})) {
    totalChanges += (c || []).length;
  }
  let totalHistory = 0;
  for (const h of Object.values(db.history || {})) {
    totalHistory += (h || []).length;
  }

  return {
    type: 'local',
    connected: true,
    storeId: id,
    storeName: resolved?.name || DEFAULT_STORE_NAME,
    totalStores: storesRegistry.length,
    storageLocation: STORES_DIR,
    totalMonths,
    totalChanges,
    totalHistory,
    lastSavedAt: storeLastSavedAt.get(id) || null,
  };
}

export async function dbGetConfig(storeId?: string): Promise<ServerConfig> {
  const db = getStoreDb(storeId);
  return db.config;
}

export async function dbSaveConfig(storeId: string, partialConfig: Partial<ServerConfig>): Promise<ServerConfig> {
  const db = getStoreDb(storeId);
  db.config = {
    ...db.config,
    ...partialConfig,
  };

  // Les 6 catégories de base sont verrouillées : leur définition officielle est toujours rétablie,
  // les catégories personnalisées sont conservées.
  applyCoreConfig(db);

  // Les mois sont gérés par EXERCICE COMPLET (1er juin -> 31 mai) : jamais de mois isolé.
  normalizeExercises(db);

  // Sync token or adminPin with store registry if changed
  const store = storesRegistry.find((s) => s.id === storeId);
  if (store) {
    if (partialConfig.storeName) store.name = partialConfig.storeName;
    if (partialConfig.apiToken) store.token = partialConfig.apiToken.trim().toUpperCase();
    if (partialConfig.adminPin) store.adminPin = partialConfig.adminPin.trim();
    saveStoresRegistryFile();
  }

  saveStoreDataFile(storeId);
  return db.config;
}

export interface GenerationSummary {
  createdDays: number;
  months: string[];
  employees: string[];
}

/**
 * Enregistre la config puis génère les journées manquantes pour :
 *  - les NOUVEAUX salariés, sur TOUS les mois configurés (exercice complet) ;
 *  - les NOUVEAUX mois, pour tous les salariés.
 * Ne remplace jamais une journée existante.
 */
export async function dbSaveConfigAndGenerate(
  storeId: string,
  partialConfig: Partial<ServerConfig>
): Promise<{ config: ServerConfig; generation: GenerationSummary }> {
  const db = getStoreDb(storeId);
  const prevEmployees = new Set((db.config.employees || []).map((e) => e.name));
  const prevMonths = new Set((db.config.allMonths || []).map((m) => m.key));

  const config = await dbSaveConfig(storeId, partialConfig);

  const allEmployees = (config.employees || []).map((e) => e.name);
  const allMonthKeys = (config.allMonths || []).map((m) => m.key);
  const newEmployees = allEmployees.filter((n) => !prevEmployees.has(n));
  const newMonths = allMonthKeys.filter((k) => !prevMonths.has(k));

  const summary: GenerationSummary = { createdDays: 0, months: [], employees: [] };
  const touchedMonths = new Set<string>();
  const touchedEmployees = new Set<string>();

  if (newEmployees.length > 0) {
    // Exercice complet : tous les mois configurés, passés et futurs (BASE/REPOS/FERIE = heures neutres pour les soldes)
    for (const m of allMonthKeys) {
      const n = generateMonthDays(db, m, newEmployees);
      if (n > 0) {
        summary.createdDays += n;
        touchedMonths.add(m);
        newEmployees.forEach((e) => touchedEmployees.add(e));
      }
    }
  }
  if (newMonths.length > 0) {
    for (const m of newMonths) {
      const n = generateMonthDays(db, m, allEmployees);
      if (n > 0) {
        summary.createdDays += n;
        touchedMonths.add(m);
        allEmployees.forEach((e) => touchedEmployees.add(e));
      }
    }
  }

  if (summary.createdDays > 0) saveStoreDataFile(storeId);
  summary.months = [...touchedMonths].sort();
  summary.employees = [...touchedEmployees];
  return { config, generation: summary };
}

/** Génération explicite (reprise après incident) : ne crée que les journées absentes. */
export async function dbEnsureSchedules(
  storeId: string,
  options: { monthKeys?: string[]; employeeNames?: string[] } = {}
): Promise<GenerationSummary> {
  const db = getStoreDb(storeId);
  const allEmployees = (db.config.employees || []).map((e) => e.name);
  const employees = (options.employeeNames?.length ? options.employeeNames : allEmployees).filter((n) =>
    allEmployees.includes(n)
  );
  // Par défaut : tous les mois configurés (exercice complet)
  const months = options.monthKeys?.length
    ? options.monthKeys.filter((k) => /^\d{4}-(0[1-9]|1[0-2])$/.test(k))
    : (db.config.allMonths || []).map((m) => m.key);

  const summary: GenerationSummary = { createdDays: 0, months: [], employees: [] };
  const touchedEmployees = new Set<string>();
  for (const m of months) {
    const n = generateMonthDays(db, m, employees);
    if (n > 0) {
      summary.createdDays += n;
      summary.months.push(m);
      employees.forEach((e) => touchedEmployees.add(e));
    }
  }
  if (summary.createdDays > 0) saveStoreDataFile(storeId);
  summary.employees = [...touchedEmployees];
  return summary;
}

/**
 * Crée les journées ABSENTES d'un mois pour les salariés donnés
 * (férié -> FERIE, week-end -> REPOS, sinon BASE). Idempotent, synchrone (pas de doublon possible),
 * ne modifie jamais une journée déjà présente. Retourne le nombre de journées créées.
 */
function generateMonthDays(db: DatabaseState, monthKey: string, employeeNames: string[]): number {
  const dateKeys = getMonthDateKeys(monthKey);
  if (dateKeys.length === 0) return 0;
  if (!db.schedules[monthKey]) db.schedules[monthKey] = {};

  let created = 0;
  for (const name of employeeNames) {
    let sched = db.schedules[monthKey][name];
    if (!sched) {
      sched = { employee: name, month: monthKey, days: {}, totalHours: 0 };
    }
    if (!sched.days) sched.days = {};

    let added = 0;
    for (const dk of dateKeys) {
      if (!Object.prototype.hasOwnProperty.call(sched.days, dk)) {
        sched.days[dk] = generateDefaultDay(dk);
        added++;
      }
    }
    if (added > 0 || !db.schedules[monthKey][name]) {
      let total = 0;
      for (const day of Object.values(sched.days)) {
        total += calculateShiftDurationHours(day.shift, day.hours, db.config.tableau2Shifts);
      }
      sched.totalHours = Math.round(total * 100) / 100;
      db.schedules[monthKey][name] = sched;
    }
    created += added;
  }
  return created;
}

/**
 * Garantit que chaque exercice présent dans la liste des mois est complet (12 mois, triés),
 * et que les mois visibles existent. Les mois déjà présents (libellés, réglages) ne sont jamais modifiés.
 */
function normalizeExercises(db: DatabaseState): void {
  const months = db.config.allMonths;
  if (!Array.isArray(months) || months.length === 0) return;
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const year of new Set(months.map((m) => getExerciseStartYear(m.key)))) {
    for (const key of getExerciseMonthKeys(year)) {
      if (!byKey.has(key)) byKey.set(key, buildMonthItem(key));
    }
  }
  const all = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  db.config.allMonths = all;
  if (Array.isArray(db.config.visibleMonths)) {
    db.config.visibleMonths = db.config.visibleMonths.filter((k) => byKey.has(k));
  }
}

/** Applique la définition officielle des catégories de base. Retourne true si la config a changé. */
function applyCoreConfig(db: DatabaseState): boolean {
  const result = ensureCoreConfig(db.config);
  if (result.changed) {
    db.config.categories = result.categories;
    db.config.tableau2Shifts = result.tableau2Shifts;
  }
  return result.changed;
}

export async function dbGetMonthSchedules(
  storeId: string,
  monthKey: string
): Promise<Record<string, EmployeeScheduleData>> {
  const db = getStoreDb(storeId);
  return db.schedules[monthKey] || {};
}

export function calculateShiftDurationHours(
  shiftText: string,
  hoursText?: string,
  tableau2Options: any[] = []
): number {
  if (!shiftText && !hoursText) return 0;

  // Catégories de base : BASE = 7 h ; REPOS, RTT, FERIE, CFA, CONGES = 0 h (règle partagée avec le client)
  const coreHours = coreShiftHours(shiftText);
  if (coreHours !== null) return coreHours;

  const s = (shiftText || '').trim().toUpperCase();
  const h = (hoursText || '').trim();

  // Absences and rests = 0h (AT and MALADIE are excluded here because they count 7h)
  if (
    s.includes('REPOS') ||
    s.includes('CONGES') ||
    s.includes('CONGÉS') ||
    s.includes('RTT') ||
    s === 'ABSENT'
  ) {
    return 0;
  }

  // AT (Accident du Travail) & Maladie : comptabilisé 7h
  if (s === 'AT' || /\bAT\b/i.test(s) || s.includes('MALADIE') || s.includes('ACCIDENT')) {
    return 7;
  }

  // 1. Cross-reference against Tableau 2 options
  if (Array.isArray(tableau2Options) && tableau2Options.length > 0) {
    for (const opt of tableau2Options) {
      if (opt.shift && opt.shift.toUpperCase() === s) {
        const optH = (opt.hours || '').replace(/\s+/g, '');
        const currentH = h.replace(/\s+/g, '');
        if (optH === currentH || (!optH && !currentH)) {
          if (opt.hoursDecimal !== undefined && opt.hoursDecimal !== null && opt.hoursDecimal >= 0) {
            return opt.hoursDecimal;
          }
        }
      }
    }
  }

  // 2. Direct single numeric value like "7", "7h", "7.5", "8h"
  const singleNumMatch = h.match(/^(\d+(?:[.,]\d+)?)\s*h?$/i);
  if (singleNumMatch) {
    const val = parseFloat(singleNumMatch[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val <= 16) return val;
  }

  // 3. Direct format like "7h30" or "8h15"
  const singleHoursMinsMatch = h.match(/^(\d{1,2})\s*h\s*(\d{2})$/i);
  if (singleHoursMinsMatch) {
    const hours = parseInt(singleHoursMinsMatch[1], 10);
    const mins = parseInt(singleHoursMinsMatch[2], 10);
    return Math.round((hours + mins / 60) * 100) / 100;
  }

  // 4. Time ranges like "08:30-12:30 , 14:00-18:00" or "9h-12h30 14h-19h"
  const rangeRegex = /(\d{1,2})(?:[h:](\d{2}))?\s*(?:[-/–—]|à)\s*(\d{1,2})(?:[h:](\d{2}))?/gi;
  let totalRangeHours = 0;
  let matchesFound = 0;
  let match: RegExpExecArray | null;

  while ((match = rangeRegex.exec(h)) !== null) {
    matchesFound++;
    const startH = parseInt(match[1], 10);
    const startM = match[2] ? parseInt(match[2], 10) : 0;
    const endH = parseInt(match[3], 10);
    const endM = match[4] ? parseInt(match[4], 10) : 0;

    const startDec = startH + startM / 60;
    let endDec = endH + endM / 60;
    if (endDec < startDec) endDec += 24;
    const diff = endDec - startDec;
    if (diff > 0 && diff <= 16) {
      totalRangeHours += diff;
    }
  }

  if (matchesFound > 0 && totalRangeHours > 0) {
    return Math.round(totalRangeHours * 100) / 100;
  }

  // 5. Fallback defaults by shift code
  if (s === 'AT' || /\bAT\b/i.test(s) || s.includes('MALADIE') || s.includes('ACCIDENT')) return 7;
  if (s.includes('MATIN') || s.includes('SOIR')) return 7;
  if (s.includes('JOURNEE') || s.includes('JOURNÉE')) return 7.5;
  if (s.includes('FORMATION')) return 7;

  return 0;
}

export async function dbGetAllSchedules(storeId: string): Promise<Record<string, Record<string, EmployeeScheduleData>>> {
  const db = getStoreDb(storeId);
  return db.schedules || {};
}

export async function dbSaveMonthSchedules(
  storeId: string,
  monthKey: string,
  teamSchedules: Record<string, EmployeeScheduleData>
): Promise<void> {
  const db = getStoreDb(storeId);
  for (const sched of Object.values(teamSchedules)) {
    // Le serveur est la référence : le total est recalculé à chaque enregistrement
    // (un planning sans journées, issu d'un import, conserve le total fourni).
    if (sched.days && Object.keys(sched.days).length > 0) {
      let tot = 0;
      for (const day of Object.values(sched.days)) {
        tot += calculateShiftDurationHours(day.shift, day.hours, db.config.tableau2Shifts);
      }
      sched.totalHours = Math.round(tot * 100) / 100;
    }
  }

  // Ne jamais perdre le planning d'un salarié encore actif absent de l'envoi
  // (ex. appareil pas encore synchronisé après un ajout/génération).
  const existing = db.schedules[monthKey] || {};
  const activeNames = new Set((db.config.employees || []).map((e) => e.name));
  for (const [name, sched] of Object.entries(existing)) {
    if (!teamSchedules[name] && activeNames.has(name)) {
      teamSchedules[name] = sched;
    }
  }

  db.schedules[monthKey] = teamSchedules;
  saveStoreDataFile(storeId);
}

export async function dbUpdateShift(
  storeId: string,
  monthKey: string,
  employeeName: string,
  dateKey: string,
  newShift: string,
  newHours: string,
  info?: string,
  previousShift?: string,
  previousHours?: string
): Promise<{ success: boolean; schedule: EmployeeScheduleData }> {
  const db = getStoreDb(storeId);

  if (!db.schedules[monthKey]) {
    db.schedules[monthKey] = {};
  }
  if (!db.schedules[monthKey][employeeName]) {
    db.schedules[monthKey][employeeName] = {
      employee: employeeName,
      month: monthKey,
      days: {},
      totalHours: 0,
    };
  }

  const empSched = db.schedules[monthKey][employeeName];
  if (newShift === 'EMPTY') {
    delete empSched.days[dateKey];
  } else {
    empSched.days[dateKey] = {
      shift: newShift,
      hours: newHours || '',
      info: info || '',
    };
  }

  let total = 0;
  for (const dayData of Object.values(empSched.days)) {
    total += calculateShiftDurationHours(dayData.shift, dayData.hours, db.config.tableau2Shifts);
  }
  empSched.totalHours = Math.round(total * 100) / 100;

  await dbRecordChange(storeId, employeeName, dateKey, newShift, newHours, previousShift, previousHours);
  await dbRecordHistory(
    storeId,
    employeeName,
    dateKey,
    `Modification horaire: ${previousShift || 'Vide'} -> ${newShift} (${newHours || ''})`
  );

  saveStoreDataFile(storeId);

  return { success: true, schedule: empSched };
}

export async function dbGetDayNotes(storeId: string, monthKey: string): Promise<Record<string, string>> {
  const db = getStoreDb(storeId);
  return db.dayNotes[monthKey] || {};
}

export async function dbSaveDayNotes(storeId: string, monthKey: string, notes: Record<string, string>): Promise<void> {
  const db = getStoreDb(storeId);
  db.dayNotes[monthKey] = notes;
  saveStoreDataFile(storeId);
}

export async function dbDeleteMonth(storeId: string, monthKey: string): Promise<void> {
  const db = getStoreDb(storeId);
  delete db.schedules[monthKey];
  delete db.dayNotes[monthKey];
  saveStoreDataFile(storeId);
}

export async function dbGetChanges(storeId: string, employeeName: string): Promise<ChangeRecord[]> {
  const db = getStoreDb(storeId);
  const key = (employeeName || '').toLowerCase();
  return db.changes[key] || [];
}

export async function dbClearChanges(storeId: string, employeeName: string): Promise<void> {
  const db = getStoreDb(storeId);
  const key = (employeeName || '').toLowerCase();
  delete db.changes[key];
  saveStoreDataFile(storeId);
}

async function dbRecordChange(
  storeId: string,
  employeeName: string,
  dateKey: string,
  newShift: string,
  newHours?: string,
  previousShift?: string,
  previousHours?: string
): Promise<void> {
  const db = getStoreDb(storeId);
  const key = (employeeName || '').toLowerCase();
  if (!db.changes[key]) {
    db.changes[key] = [];
  }

  const record: ChangeRecord = {
    id: `${dateKey}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    employeeName,
    date: dateKey,
    previousShift,
    newShift,
    previousHours,
    newHours,
    timestamp: new Date().toISOString(),
  };

  db.changes[key].unshift(record);
  if (db.changes[key].length > 50) {
    db.changes[key] = db.changes[key].slice(0, 50);
  }
}

export async function dbGetHistory(storeId: string, employeeName: string): Promise<HistoryRecord[]> {
  const db = getStoreDb(storeId);
  const key = (employeeName || '').toLowerCase();
  return db.history[key] || [];
}

export async function dbGetAllHistory(storeId: string): Promise<{
  records: HistoryRecord[];
  count: number;
  byEmployee: Record<string, number>;
}> {
  const db = getStoreDb(storeId);
  const records: HistoryRecord[] = [];
  const byEmployee: Record<string, number> = {};

  for (const [empKey, list] of Object.entries(db.history || {})) {
    if (Array.isArray(list) && list.length > 0) {
      records.push(...list);
      const empDisplayName = list[0]?.employee || empKey;
      byEmployee[empDisplayName] = (byEmployee[empDisplayName] || 0) + list.length;
    }
  }

  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return {
    records,
    count: records.length,
    byEmployee,
  };
}

export async function dbClearEmployeeHistory(storeId: string, employeeName: string): Promise<number> {
  const db = getStoreDb(storeId);
  const targetKey = (employeeName || '').toLowerCase().trim();
  let deletedCount = 0;

  for (const k of Object.keys(db.history || {})) {
    if (k.toLowerCase().trim() === targetKey) {
      deletedCount += (db.history[k] || []).length;
      delete db.history[k];
    }
  }

  saveStoreDataFile(storeId);
  return deletedCount;
}

export async function dbClearAllHistory(storeId: string): Promise<number> {
  const db = getStoreDb(storeId);
  let deletedCount = 0;

  for (const list of Object.values(db.history || {})) {
    if (Array.isArray(list)) {
      deletedCount += list.length;
    }
  }

  db.history = {};
  saveStoreDataFile(storeId);
  return deletedCount;
}

async function dbRecordHistory(
  storeId: string,
  employee: string,
  date: string,
  change: string
): Promise<void> {
  const db = getStoreDb(storeId);
  const key = (employee || '').toLowerCase();
  if (!db.history[key]) {
    db.history[key] = [];
  }

  const record: HistoryRecord = {
    id: `hist_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    employee,
    date,
    change,
    timestamp: new Date().toISOString(),
  };

  db.history[key].unshift(record);
  if (db.history[key].length > 100) {
    db.history[key] = db.history[key].slice(0, 100);
  }
}

export async function dbResetToCleanStore(storeId: string): Promise<ServerConfig> {
  const store = storesRegistry.find((s) => s.id === storeId);
  const storeName = store ? store.name : DEFAULT_STORE_NAME;
  const token = store ? store.token : DEFAULT_API_TOKEN;
  const adminPin = store ? store.adminPin : DEFAULT_ADMIN_PIN;

  const freshState = createDefaultState(storeName, token, adminPin);
  const freshEmployees = (freshState.config.employees || []).map((e) => e.name);
  for (const m of (freshState.config.allMonths || []).map((x) => x.key)) {
    generateMonthDays(freshState, m, freshEmployees);
  }
  storeDatabases.set(storeId, freshState);
  saveStoreDataFile(storeId);

  return freshState.config;
}

export async function dbGetFullBackup(storeId: string): Promise<DatabaseState> {
  const db = getStoreDb(storeId);
  return JSON.parse(JSON.stringify(db));
}

export async function dbRestoreBackup(storeId: string, backup: Partial<DatabaseState>): Promise<ServerConfig> {
  const store = storesRegistry.find((s) => s.id === storeId);
  if (backup && typeof backup === 'object') {
    const updatedState: DatabaseState = {
      config: {
        ...createDefaultState(store?.name, store?.token, store?.adminPin).config,
        ...(backup.config || {}),
        storeName: store?.name || backup.config?.storeName || DEFAULT_STORE_NAME,
        apiToken: store?.token || backup.config?.apiToken || DEFAULT_API_TOKEN,
        adminPin: store?.adminPin || backup.config?.adminPin || DEFAULT_ADMIN_PIN,
      },
      schedules: backup.schedules || {},
      dayNotes: backup.dayNotes || {},
      changes: backup.changes || {},
      history: backup.history || {},
    };

    applyCoreConfig(updatedState);
    storeDatabases.set(storeId, updatedState);
    saveStoreDataFile(storeId);
    return updatedState.config;
  }
  return getStoreDb(storeId).config;
}

export async function dbGetAllStoresBackup(): Promise<{
  exportDate: string;
  stores: StoreInfo[];
  databases: Record<string, DatabaseState>;
}> {
  const databases: Record<string, DatabaseState> = {};
  for (const store of storesRegistry) {
    databases[store.id] = getStoreDb(store.id);
  }
  return {
    exportDate: new Date().toISOString(),
    stores: storesRegistry,
    databases,
  };
}
