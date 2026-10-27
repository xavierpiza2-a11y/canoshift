import { DEFAULT_CATEGORIES, DEFAULT_TABLEAU2_SHIFTS } from '../config/constants';
import type { ShiftCategoryItem, Tableau2ShiftOption } from '../types/planning';

/**
 * Fusionne la liste existante avec les définitions officielles de base :
 *  - une entrée de base déjà présente garde SA POSITION (l'ordre choisi par l'administrateur est respecté)
 *    mais retrouve sa définition officielle (non modifiable) ;
 *  - les entrées personnalisées sont conservées telles quelles, à leur place ;
 *  - les entrées de base manquantes sont ajoutées en tête, dans l'ordre officiel ;
 *  - les doublons d'une entrée de base sont supprimés.
 */
function mergeKeepingOrder<T>(existing: T[], defaults: T[], keyOf: (item: T) => string | undefined): T[] {
  const norm = (k: string | undefined) => (k || '').trim().toUpperCase();
  const defByKey = new Map(defaults.map((d) => [norm(keyOf(d)), d]));
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of existing) {
    const k = norm(keyOf(item));
    const def = defByKey.get(k);
    if (def) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...def });
    } else {
      out.push(item);
    }
  }
  const missing = defaults.filter((d) => !seen.has(norm(keyOf(d)))).map((d) => ({ ...d }));
  return [...missing, ...out];
}

/**
 * Garantit que les 6 catégories de base existent, verrouillées et avec leur définition officielle,
 * SANS supprimer les catégories/créneaux personnalisés ou historiques et SANS imposer leur ordre.
 * Idempotent : appliquer deux fois donne le même résultat.
 * Retourne `changed` pour savoir s'il faut enregistrer.
 */
export function ensureCoreConfig(config: {
  categories?: ShiftCategoryItem[];
  tableau2Shifts?: Tableau2ShiftOption[];
}): { categories: ShiftCategoryItem[]; tableau2Shifts: Tableau2ShiftOption[]; changed: boolean } {
  const cats = config.categories ?? [];
  const shifts = config.tableau2Shifts ?? [];

  const nextCats = mergeKeepingOrder(cats, DEFAULT_CATEGORIES, (c) => c.name);
  const nextShifts = mergeKeepingOrder(shifts, DEFAULT_TABLEAU2_SHIFTS, (o) => o.shift);

  const changed = JSON.stringify(cats) !== JSON.stringify(nextCats) || JSON.stringify(shifts) !== JSON.stringify(nextShifts);
  return { categories: nextCats, tableau2Shifts: nextShifts, changed };
}
