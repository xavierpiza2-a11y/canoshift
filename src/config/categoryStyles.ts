import {
  Sun,
  Sunset,
  Briefcase,
  Home,
  Palmtree,
  Sparkles,
  GraduationCap,
  Clock,
  Coffee,
  Shield,
  Zap,
  Wrench,
  Heart,
  Star,
  Tag,
  Calendar,
  Truck,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  LucideIcon,
} from 'lucide-react';
import { ShiftCategoryItem } from '../types/planning';
import { getStoredCategories } from '../services/api';

export interface CategoryColorOption {
  id: string;
  label: string;
  dot: string;       // Tailwind class for pastille dot
  badgeBg: string;   // Tailwind class for badge background
  badgeText: string; // Tailwind class for badge text
  badgeBorder: string; // Tailwind class for badge border
  rgb: [number, number, number];
  textRgb: [number, number, number];
}

export const CATEGORY_COLORS: CategoryColorOption[] = [
  {
    id: 'emerald',
    label: 'Émeraude',
    dot: 'bg-emerald-500',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-950',
    badgeBorder: 'border-emerald-200',
    rgb: [220, 252, 231],
    textRgb: [21, 128, 61],
  },
  {
    id: 'sky',
    label: 'Bleu ciel',
    dot: 'bg-sky-500',
    badgeBg: 'bg-sky-50',
    badgeText: 'text-sky-950',
    badgeBorder: 'border-sky-200',
    rgb: [224, 242, 254],
    textRgb: [3, 105, 161],
  },
  {
    id: 'amber',
    label: 'Ambre',
    dot: 'bg-amber-500',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-950',
    badgeBorder: 'border-amber-200',
    rgb: [254, 243, 199],
    textRgb: [180, 83, 9],
  },
  {
    id: 'slate',
    label: 'Ardoise',
    dot: 'bg-slate-400',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    badgeBorder: 'border-slate-200',
    rgb: [241, 245, 249],
    textRgb: [100, 116, 139],
  },
  {
    id: 'orange',
    label: 'Orange',
    dot: 'bg-orange-500',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-950',
    badgeBorder: 'border-orange-200',
    rgb: [255, 237, 213],
    textRgb: [194, 65, 12],
  },
  {
    id: 'teal',
    label: 'Sarcelle',
    dot: 'bg-teal-500',
    badgeBg: 'bg-teal-50',
    badgeText: 'text-teal-950',
    badgeBorder: 'border-teal-200',
    rgb: [204, 251, 241],
    textRgb: [15, 118, 110],
  },
  {
    id: 'purple',
    label: 'Violet',
    dot: 'bg-purple-500',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-950',
    badgeBorder: 'border-purple-200',
    rgb: [243, 232, 255],
    textRgb: [109, 40, 217],
  },
  {
    id: 'indigo',
    label: 'Indigo',
    dot: 'bg-indigo-500',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-950',
    badgeBorder: 'border-indigo-200',
    rgb: [224, 231, 255],
    textRgb: [67, 56, 202],
  },
  {
    id: 'rose',
    label: 'Rose',
    dot: 'bg-rose-500',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-950',
    badgeBorder: 'border-rose-200',
    rgb: [255, 228, 230],
    textRgb: [190, 18, 60],
  },
  {
    id: 'zinc',
    label: 'Gris clair',
    dot: 'bg-zinc-400',
    badgeBg: 'bg-zinc-100',
    badgeText: 'text-zinc-800',
    badgeBorder: 'border-zinc-200',
    rgb: [244, 244, 245],
    textRgb: [82, 82, 91],
  },
  {
    id: 'blue',
    label: 'Bleu royal',
    dot: 'bg-blue-500',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-950',
    badgeBorder: 'border-blue-200',
    rgb: [219, 234, 254],
    textRgb: [29, 78, 216],
  },
  {
    id: 'red',
    label: 'Rouge vif',
    dot: 'bg-red-500',
    badgeBg: 'bg-red-50',
    badgeText: 'text-red-950',
    badgeBorder: 'border-red-200',
    rgb: [254, 226, 226],
    textRgb: [185, 28, 28],
  },
  {
    id: 'dark-gray',
    label: 'Gris très foncé',
    dot: 'bg-zinc-400',
    badgeBg: 'bg-zinc-800',
    badgeText: 'text-zinc-100',
    badgeBorder: 'border-zinc-700',
    rgb: [39, 39, 42],
    textRgb: [244, 244, 245],
  },
  {
    id: 'black',
    label: 'Noir',
    dot: 'bg-white',
    badgeBg: 'bg-black',
    badgeText: 'text-white',
    badgeBorder: 'border-zinc-800',
    rgb: [0, 0, 0],
    textRgb: [255, 255, 255],
  },
  {
    id: 'anthracite',
    label: 'Anthracite',
    dot: 'bg-slate-300',
    badgeBg: 'bg-slate-900',
    badgeText: 'text-slate-100',
    badgeBorder: 'border-slate-800',
    rgb: [15, 23, 42],
    textRgb: [241, 245, 249],
  },
  {
    id: 'midnight-blue',
    label: 'Bleu nuit',
    dot: 'bg-blue-400',
    badgeBg: 'bg-blue-950',
    badgeText: 'text-blue-100',
    badgeBorder: 'border-blue-900',
    rgb: [23, 37, 84],
    textRgb: [239, 246, 255],
  },
  {
    id: 'bordeaux',
    label: 'Bordeaux',
    dot: 'bg-rose-400',
    badgeBg: 'bg-rose-950',
    badgeText: 'text-rose-100',
    badgeBorder: 'border-rose-900',
    rgb: [76, 5, 25],
    textRgb: [255, 228, 230],
  },
  {
    id: 'forest',
    label: 'Vert forêt',
    dot: 'bg-emerald-400',
    badgeBg: 'bg-emerald-950',
    badgeText: 'text-emerald-100',
    badgeBorder: 'border-emerald-900',
    rgb: [2, 44, 34],
    textRgb: [209, 250, 229],
  },
];

export interface CategoryIconOption {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export const CATEGORY_ICONS: CategoryIconOption[] = [
  { id: 'sun', label: 'Soleil (Matin)', Icon: Sun },
  { id: 'sunset', label: 'Coucher de soleil (Soir)', Icon: Sunset },
  { id: 'briefcase', label: 'Sacoche (Journée / Travail)', Icon: Briefcase },
  { id: 'home', label: 'Maison (Repos)', Icon: Home },
  { id: 'palmtree', label: 'Palmier (Congés)', Icon: Palmtree },
  { id: 'sparkles', label: 'Étoiles (RTT / Récup)', Icon: Sparkles },
  { id: 'graduation-cap', label: 'Chapeau (Formation)', Icon: GraduationCap },
  { id: 'clock', label: 'Horloge (Horaire)', Icon: Clock },
  { id: 'coffee', label: 'Café (Détente / Pause)', Icon: Coffee },
  { id: 'shield', label: 'Bouclier (Sécurité / Garde)', Icon: Shield },
  { id: 'zap', label: 'Éclair (Astreinte / Urgence)', Icon: Zap },
  { id: 'wrench', label: 'Clé (Technique / Entretien)', Icon: Wrench },
  { id: 'heart', label: 'Cœur (Santé / Médical)', Icon: Heart },
  { id: 'star', label: 'Étoile (Prioritaire)', Icon: Star },
  { id: 'tag', label: 'Étiquette (Général)', Icon: Tag },
  { id: 'calendar', label: 'Calendrier', Icon: Calendar },
  { id: 'truck', label: 'Camion (Logistique / Livraison)', Icon: Truck },
  { id: 'shopping-bag', label: 'Sac (Vente / Caisse)', Icon: ShoppingBag },
  { id: 'check-circle', label: 'Coche (Validé)', Icon: CheckCircle2 },
  { id: 'alert-circle', label: 'Alerte (Exceptionnel)', Icon: AlertCircle },
];

export interface CategoryDetailResolved {
  id: string;
  name: string;
  colorId: string;
  dot: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  iconId: string;
  Icon: LucideIcon;
  rgb: [number, number, number];
  textRgb: [number, number, number];
}

/**
 * Returns full styling, pastille dot, icon, and colors for a given category.
 * Also supports direct color override (e.g. 'black', 'emerald', 'dark-gray', etc.)
 */
export function getCategoryDetails(
  categoryName?: string,
  categoriesListOrColor?: ShiftCategoryItem[] | string,
  explicitColorId?: string
): CategoryDetailResolved {
  const cleanCat = (categoryName || '').trim().toUpperCase();
  
  let cats: ShiftCategoryItem[] = [];
  let directColor: string | undefined = explicitColorId;

  if (typeof categoriesListOrColor === 'string') {
    directColor = categoriesListOrColor;
  } else if (Array.isArray(categoriesListOrColor)) {
    cats = categoriesListOrColor;
  } else if (typeof window !== 'undefined') {
    cats = getStoredCategories();
  }

  const found = Array.isArray(cats)
    ? cats.find((c) => {
        if (!c) return false;
        const nameVal = c.name || (c as any).label || (c as any).id || '';
        return typeof nameVal === 'string' && nameVal.trim().toUpperCase() === cleanCat;
      })
    : undefined;

  // Fallback defaults for standard categories if not explicitly found in stored list
  let defaultColorId = 'slate';
  let defaultIconId = 'tag';

  if (cleanCat === 'MATIN') {
    defaultColorId = 'sky';
    defaultIconId = 'sun';
  } else if (cleanCat === 'SOIR') {
    defaultColorId = 'orange';
    defaultIconId = 'sunset';
  } else if (cleanCat === 'JOURNEE' || cleanCat === 'JOURNÉE') {
    defaultColorId = 'emerald';
    defaultIconId = 'briefcase';
  } else if (cleanCat === 'REPOS') {
    defaultColorId = 'slate';
    defaultIconId = 'home';
  } else if (cleanCat === 'CONGES' || cleanCat === 'CONGÉS' || cleanCat === 'CP') {
    defaultColorId = 'amber';
    defaultIconId = 'palmtree';
  } else if (cleanCat === 'RTT') {
    defaultColorId = 'teal';
    defaultIconId = 'sparkles';
  } else if (cleanCat === 'FORMATION') {
    defaultColorId = 'purple';
    defaultIconId = 'graduation-cap';
  } else if (cleanCat === 'FERIE' || cleanCat === 'FÉRIÉ') {
    defaultColorId = 'purple';
    defaultIconId = 'calendar';
  } else if (cleanCat === 'AT' || cleanCat === 'MALADIE') {
    defaultColorId = 'rose';
    defaultIconId = 'heart';
  } else if (cleanCat === 'HORAIRE') {
    defaultColorId = 'indigo';
    defaultIconId = 'clock';
  } else if (cleanCat === 'BASE') {
    defaultColorId = 'emerald';
    defaultIconId = 'briefcase';
  } else if (cleanCat === 'CFA') {
    defaultColorId = 'indigo';
    defaultIconId = 'graduation-cap';
  }

  const chosenColorId = directColor || found?.color || defaultColorId;
  const chosenIconId = found?.icon || defaultIconId;

  const colorConfig =
    CATEGORY_COLORS.find((col) => col.id === chosenColorId) || CATEGORY_COLORS[0];
  const iconConfig =
    CATEGORY_ICONS.find((ic) => ic.id === chosenIconId) ||
    CATEGORY_ICONS.find((ic) => ic.id === defaultIconId) ||
    CATEGORY_ICONS[0];

  return {
    id: found?.id || `cat_${cleanCat}`,
    name: found?.name || cleanCat || 'AUTRE',
    colorId: colorConfig.id,
    dot: colorConfig.dot,
    badgeBg: colorConfig.badgeBg,
    badgeText: colorConfig.badgeText,
    badgeBorder: colorConfig.badgeBorder,
    iconId: iconConfig.id,
    Icon: iconConfig.Icon,
    rgb: colorConfig.rgb,
    textRgb: colorConfig.textRgb,
  };
}
