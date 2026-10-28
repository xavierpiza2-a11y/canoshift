import { coreShiftHours } from '../shared/planning';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  Employee,
  EmployeeMonthSchedule,
  Tableau2ShiftOption,
  ShiftCategory
} from '../types/planning';
import { categorizeShift, DEFAULT_TABLEAU2_SHIFTS } from '../config/constants';
import { getStoreName } from './api';

export interface ParsedExcelPlanning {
  monthKey: string;
  detectedEmployees: string[];
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  dayNotes: Record<string, string>;
  stats: {
    totalDays: number;
    totalShifts: number;
    employeeHours: Record<string, number>;
  };
  customShifts?: Tableau2ShiftOption[];
}

/**
 * Calculates hours worked from a shift and optional hours string,
 * cross-referencing against the defined Créneaux / Tableau 2 shifts.
 */
export function calculateHours(
  shiftText: string,
  hoursText?: string,
  tableau2Options: Tableau2ShiftOption[] = DEFAULT_TABLEAU2_SHIFTS
): number {
  if (!shiftText && !hoursText) return 0;
  const coreHours = coreShiftHours(shiftText);
  if (coreHours !== null) return coreHours;

  const s = (shiftText || '').trim().toUpperCase();
  const h = (hoursText || '').trim();

  // Check category
  const cat = categorizeShift(s, h);
  if (cat === 'REPOS' || cat === 'CONGES' || cat === 'RTT' || cat === 'FERIE' || cat === 'CFA') {
    return 0;
  }

  // AT (Accident du Travail) & Maladie : comptabilisé 7h
  if (
    cat === 'AT' ||
    s === 'AT' ||
    /\bAT\b/i.test(s) ||
    s.includes('MALADIE') ||
    s.includes('ACCIDENT')
  ) {
    return 7;
  }

  // 1. Cross-reference with defined Créneaux options
  for (const opt of tableau2Options) {
    if (opt.shift.toUpperCase() === s) {
      const optH = (opt.hours || '').replace(/\s+/g, '');
      const currentH = h.replace(/\s+/g, '');
      if (optH === currentH || (!optH && !currentH)) {
        if (opt.hoursDecimal !== undefined && opt.hoursDecimal !== null && opt.hoursDecimal >= 0) {
          return opt.hoursDecimal;
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

  // 4. Time ranges like "9h-12h30 14h-19h" or "8h30/12h30 - 14h/18h"
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

  // 5. Default fallbacks based on category
  switch (cat) {
    case 'AT':
      return 7;
    case 'MATIN':
      return 7;
    case 'SOIR':
      return 7;
    case 'JOURNEE':
      return 7.5;
    case 'FORMATION':
      return 7;
    default:
      return s === 'AT' || /\bAT\b/i.test(s) ? 7 : 0;
  }
}

/**
 * Normalizes an input cell text from Excel into { shift, hours, hoursDecimal }.
 */
export function resolveShiftFromCell(
  cellValue: string | number | null | undefined,
  tableau2Options: Tableau2ShiftOption[] = DEFAULT_TABLEAU2_SHIFTS
): { shift: string; hours: string; hoursDecimal: number } {
  if (cellValue === null || cellValue === undefined) {
    return { shift: '', hours: '', hoursDecimal: 0 };
  }

  const text = String(cellValue).trim();
  if (!text) {
    return { shift: '', hours: '', hoursDecimal: 0 };
  }

  const cleanText = text.replace(/\s+/g, ' ');

  // 1. Direct match with a Créneau option
  for (const opt of tableau2Options) {
    // Exact label match (e.g. from Excel dropdown list!)
    if (opt.label.toLowerCase() === cleanText.toLowerCase()) {
      return {
        shift: opt.shift,
        hours: opt.hours,
        hoursDecimal: opt.hoursDecimal ?? calculateHours(opt.shift, opt.hours, tableau2Options),
      };
    }
    // Match shift code if label isn't used
    if (opt.shift.toLowerCase() === cleanText.toLowerCase() && !opt.hours) {
      return {
        shift: opt.shift,
        hours: opt.hours,
        hoursDecimal: opt.hoursDecimal ?? calculateHours(opt.shift, opt.hours, tableau2Options),
      };
    }
  }

  // 2. Format "SHIFT · HOURS" or "SHIFT - HOURS"
  const dotSplit = cleanText.split(/[·•|]/);
  if (dotSplit.length >= 2) {
    const s = dotSplit[0].trim();
    const h = dotSplit.slice(1).join('·').trim();
    const dec = calculateHours(s, h, tableau2Options);
    return { shift: s, hours: h, hoursDecimal: dec };
  }

  // 3. Fallback: single word or hours text
  const cat = categorizeShift(cleanText, '');
  if (cat === 'REPOS' || cat === 'CONGES' || cat === 'RTT') {
    return { shift: cleanText.toUpperCase(), hours: '', hoursDecimal: 0 };
  }

  // If looks like time range "9h-12h"
  if (cleanText.includes('h') || cleanText.includes(':')) {
    const dec = calculateHours('HORAIRE', cleanText, tableau2Options);
    return { shift: 'HORAIRE', hours: cleanText, hoursDecimal: dec };
  }

  const dec = calculateHours(cleanText, '', tableau2Options);
  return { shift: cleanText, hours: '', hoursDecimal: dec };
}

/**
 * Generate a complete, ready-to-use template Excel workbook (.xlsx)
 * with employees in columns, Créneaux in a dedicated sheet, and interactive dropdowns in all employee cells.
 */
export async function generatePlanningTemplateXLSX(
  monthKey: string,
  employees: Employee[],
  tableau2Options: Tableau2ShiftOption[] = DEFAULT_TABLEAU2_SHIFTS,
  existingSchedules?: Record<string, EmployeeMonthSchedule>,
  existingDayNotes?: Record<string, string>,
  storeName?: string
): Promise<Uint8Array> {
  const effectiveStore = (storeName || getStoreName()).trim();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = effectiveStore;
  workbook.lastModifiedBy = `${effectiveStore} Planning`;
  workbook.created = new Date();
  workbook.modified = new Date();

  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthDate = new Date(year, month - 1, 1);
  const monthLabel = monthDate.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  const monthLabelUpper = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // --- SHEET 1: PLANNING (Employees in columns) ---
  const wsPlanning = workbook.addWorksheet('Planning');
  wsPlanning.views = [{ showGridLines: true }];

  // --- SHEET 2: CRÉNEAUX (Référentiel des horaires pour alimenter la liste déroulante) ---
  const wsCreneaux = workbook.addWorksheet('Créneaux');
  wsCreneaux.views = [{ showGridLines: true }];

  // ----- Préparation : libellés uniques + texte exact de chaque case -----------------------------------
  // (une formule SUMIF additionne tous les doublons : chaque libellé ne doit apparaître qu'une fois)
  const sheetOptions: Tableau2ShiftOption[] = [];
  const seenLabels = new Set<string>();
  for (const opt of tableau2Options) {
    if (seenLabels.has(opt.label)) continue;
    seenLabels.add(opt.label);
    sheetOptions.push(opt);
  }
  const dropdownCount = sheetOptions.length;

  // Créneaux réellement utilisés mais absents de la liste (horaires particuliers) : ajoutés à la fin de la
  // feuille Créneaux, pour que le total reste exact et que rien ne soit perdu à la réimportation.
  const extraRows: { text: string; shift: string; hours: string; dec: number }[] = [];
  const resolveCellText = (item: { shift?: string; hours?: string }): string => {
    const sh = (item.shift || '').trim();
    const hr = (item.hours || '').trim();
    if (!sh && !hr) return '';
    const exact = sheetOptions.find((o) => o.shift === sh && (o.hours || '') === hr);
    if (exact) return exact.label;
    if (sh && coreShiftHours(sh) !== null) {
      const core = sheetOptions.find((o) => o.shift === sh);
      if (core) return core.label;
    }
    if (sh && !hr) {
      const byShift = sheetOptions.find((o) => o.label === sh || o.shift === sh);
      if (byShift) return byShift.label;
    }
    const text = sh && hr ? `${sh} · ${hr}` : sh || hr;
    if (!extraRows.some((x) => x.text === text) && !seenLabels.has(text)) {
      extraRows.push({ text, shift: sh, hours: hr, dec: calculateHours(sh || 'HORAIRE', hr, tableau2Options) });
    }
    return text;
  };

  const cellTexts: Record<string, Record<string, string>> = {};
  if (existingSchedules) {
    for (const emp of employees) {
      const days = existingSchedules[emp.name]?.days;
      if (!days) continue;
      cellTexts[emp.name] = {};
      for (const [dk, item] of Object.entries(days)) {
        cellTexts[emp.name][dk] = resolveCellText(item as any);
      }
    }
  }
  const labelHours = new Map<string, number>();
  sheetOptions.forEach((o) => labelHours.set(o.label, o.hoursDecimal ?? calculateHours(o.shift, o.hours, tableau2Options)));
  extraRows.forEach((x) => labelHours.set(x.text, x.dec));

  // Populate Créneaux sheet
  const titleRowCreneaux = wsCreneaux.addRow([
    `CRÉNEAUX & HORAIRES POSSIBLES (${effectiveStore.toUpperCase()})`,
  ]);
  titleRowCreneaux.font = { bold: true, size: 12, color: { argb: 'FF166534' } };

  const subRowCreneaux = wsCreneaux.addRow([
    'Ces créneaux alimentent dynamiquement les menus déroulants de la feuille Planning.',
  ]);
  subRowCreneaux.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };

  const creneauxHeader = wsCreneaux.addRow([
    'Code Shift',
    'Plage Horaire',
    'Durée Heures (décimal)',
    'Catégorie',
    'Libellé Recommandé',
    'Description',
  ]);
  creneauxHeader.font = { bold: true, color: { argb: 'FF0F172A' } };
  creneauxHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };

  sheetOptions.forEach((opt) => {
    const hoursDec =
      opt.hoursDecimal ?? calculateHours(opt.shift, opt.hours, tableau2Options);
    wsCreneaux.addRow([
      opt.shift,
      opt.hours || '—',
      hoursDec,
      opt.category,
      opt.label,
      opt.description || '',
    ]);
  });
  extraRows.forEach((x) => {
    wsCreneaux.addRow([x.shift || '—', x.hours || '—', x.dec, 'PARTICULIER', x.text, 'Horaire particulier utilisé dans ce planning']);
  });

  wsCreneaux.getColumn(1).width = 16;
  wsCreneaux.getColumn(2).width = 28;
  wsCreneaux.getColumn(3).width = 22;
  wsCreneaux.getColumn(4).width = 16;
  wsCreneaux.getColumn(5).width = 40;
  wsCreneaux.getColumn(6).width = 36;

  // Title row for Planning
  const titleRow = wsPlanning.addRow([
    `${effectiveStore.toUpperCase()} - PLANNING ${monthLabelUpper.toUpperCase()}`,
    ...employees.map(() => ''),
    '',
  ]);
  titleRow.font = { bold: true, size: 12, color: { argb: 'FF166534' } };

  // Subtitle / Headers row
  const headerRow = wsPlanning.addRow([
    'Date (AAAA-MM-JJ)',
    'Jour',
    ...employees.map((e) => `${e.name} (${e.role || 'Équipe'})`),
    'Informations / Événements',
  ]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF166534' },
  };

  // Liste déroulante : créneaux définis ; formules de total : créneaux définis + horaires particuliers
  const validationFormula = `'Créneaux'!$E$4:$E$${3 + dropdownCount}`;
  const lookupLast = 3 + dropdownCount + extraRows.length;
  const labelRange = `'Créneaux'!$E$4:$E$${lookupLast}`;
  const hoursRange = `'Créneaux'!$C$4:$C$${lookupLast}`;

  // Add rows for each day of the month
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = d < 10 ? `0${d}` : `${d}`;
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${dStr}`;
    const dObj = new Date(year, month - 1, d);
    const dayName = dObj.toLocaleDateString('fr-FR', { weekday: 'long' });
    const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;

    const rowValues: any[] = [dateKey, `${capitalizedDay} ${dStr}`];

    // For each employee column
    for (const emp of employees) {
      rowValues.push(cellTexts[emp.name]?.[dateKey] ?? '');
    }

    // Rightmost column: Information / Événement for this day
    let dayInfo = existingDayNotes?.[dateKey] || '';
    if (!dayInfo && existingSchedules) {
      for (const sched of Object.values(existingSchedules)) {
        if (sched.days?.[dateKey]?.info) {
          dayInfo = sched.days[dateKey].info || '';
          break;
        }
      }
    }
    rowValues.push(dayInfo);

    const row = wsPlanning.addRow(rowValues);
    if (isWeekend) {
      row.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      row.getCell(2).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
    }

    // Assign interactive list data validation (dropdown menu) to each employee cell
    for (let c = 3; c <= 2 + employees.length; c++) {
      const cell = row.getCell(c);
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [validationFormula],
        showErrorMessage: false,
        promptTitle: 'Créneaux disponibles',
        prompt: 'Sélectionnez un créneau dans la liste déroulante',
      };
    }
  }

  // Summary Row: Total Hours — formules Excel (recalculées à chaque changement de créneau) avec valeur déjà calculée
  const firstDayRow = 3; // ligne 1 : titre, ligne 2 : en-têtes
  const lastDayRow = 2 + daysInMonth;
  const totalRow = wsPlanning.addRow(['TOTAL HEURES', 'Total calculé du mois']);
  employees.forEach((emp, idx) => {
    const colLetter = wsPlanning.getColumn(3 + idx).letter;
    let cached = 0;
    for (const txt of Object.values(cellTexts[emp.name] || {})) cached += labelHours.get(txt) ?? 0;
    const cell = totalRow.getCell(3 + idx);
    cell.value = {
      formula: `SUMPRODUCT(SUMIF(${labelRange},${colLetter}${firstDayRow}:${colLetter}${lastDayRow},${hoursRange}))`,
      result: Math.round(cached * 100) / 100,
    };
    cell.numFmt = '0.##"h"';
    cell.alignment = { horizontal: 'center' };
  });
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDCFCE7' },
  };

  // Set column widths
  wsPlanning.getColumn(1).width = 16;
  wsPlanning.getColumn(2).width = 18;
  for (let c = 3; c <= 2 + employees.length; c++) {
    wsPlanning.getColumn(c).width = 36;
  }
  // Informations column on the right
  const infoColNumber = 3 + employees.length;
  wsPlanning.getColumn(infoColNumber).width = 40;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/**
 * Trigger download of an Excel file in the browser
 */
export function downloadExcelFile(data: Uint8Array, fileName: string) {
  const blob = new Blob([data as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parses an Excel file (.xlsx) uploaded by the user.
 * Expects employees in columns and dates in rows.
 */
export async function parsePlanningFromXLSX(
  file: File | ArrayBuffer,
  _knownEmployees: Employee[],
  tableau2Options: Tableau2ShiftOption[] = DEFAULT_TABLEAU2_SHIFTS
): Promise<ParsedExcelPlanning> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  // 1. Check for custom "Créneaux" or "Horaires Possibles" sheet if present
  let activeTableau2 = [...tableau2Options];
  const shiftsSheetName = wb.SheetNames.find(
    (n) =>
      n.toLowerCase().includes('créneau') ||
      n.toLowerCase().includes('creneau') ||
      n.toLowerCase().includes('horaire') ||
      n.toLowerCase().includes('tableau2') ||
      n.toLowerCase().includes('tableau 2')
  );

  if (shiftsSheetName) {
    const wsShifts = wb.Sheets[shiftsSheetName];
    const rawShifts: any[][] = XLSX.utils.sheet_to_json(wsShifts, { header: 1 });
    const extractedShifts: Tableau2ShiftOption[] = [];

    // Search header row with "Code Shift" or "Shift"
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(rawShifts.length, 10); r++) {
      const row = rawShifts[r] || [];
      if (
        row.some(
          (c: any) =>
            typeof c === 'string' &&
            (c.toLowerCase().includes('shift') || c.toLowerCase().includes('horaire'))
        )
      ) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx !== -1) {
      for (let r = headerRowIdx + 1; r < rawShifts.length; r++) {
        const row = rawShifts[r];
        if (!row || row.length === 0) continue;
        const shiftCode = String(row[0] || '').trim();
        const hoursStr = String(row[1] || '').trim();
        const decVal = parseFloat(String(row[2] || '').replace(',', '.'));
        const catStr = String(row[3] || '').trim().toUpperCase() as ShiftCategory;
        const labelStr = String(row[4] || '').trim();
        const descStr = String(row[5] || '').trim();

        if (shiftCode) {
          extractedShifts.push({
            id: `custom_${r}_${shiftCode.toLowerCase()}`,
            shift: shiftCode,
            hours: hoursStr === '—' ? '' : hoursStr,
            category: (catStr as ShiftCategory) || categorizeShift(shiftCode, hoursStr),
            label: labelStr || `${shiftCode} · ${hoursStr}`,
            description: descStr,
            hoursDecimal: !isNaN(decVal) ? decVal : undefined,
          });
        }
      }

      if (extractedShifts.length > 0) {
        activeTableau2 = extractedShifts;
      }
    }
  }

  // 2. Find the planning worksheet
  const planningSheetName =
    wb.SheetNames.find(
      (n) =>
        n.toLowerCase().includes('planning') ||
        n.toLowerCase().includes('feuille') ||
        n.toLowerCase().includes('sheet')
    ) || wb.SheetNames[0];

  const wsPlanning = wb.Sheets[planningSheetName];
  if (!wsPlanning) {
    throw new Error('Feuille de planning introuvable dans le fichier.');
  }

  const rawRows: any[][] = XLSX.utils.sheet_to_json(wsPlanning, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rawRows.length < 3) {
    throw new Error('Le fichier ne contient pas assez de lignes de données.');
  }

  // 3. Locate header row containing employee names and information column
  let headerRowIndex = -1;
  let employeeCols: Array<{ colIndex: number; name: string }> = [];
  let infoColIndex = -1;

  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r] || [];
    const detected: Array<{ colIndex: number; name: string }> = [];

    row.forEach((cellVal: any, colIdx: number) => {
      if (colIdx < 2) return; // Skip Date and Day columns
      const cellText = String(cellVal || '').trim();
      if (!cellText) return;

      const lower = cellText.toLowerCase();
      const isInfoCol =
        lower.includes('info') ||
        lower.includes('note') ||
        lower.includes('évènement') ||
        lower.includes('événement') ||
        lower.includes('evenement') ||
        lower.includes('rdv') ||
        lower.includes('réunion') ||
        lower.includes('reunion');

      if (isInfoCol) {
        infoColIndex = colIdx;
        return;
      }

      const cleanedName = cellText
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

      if (cleanedName.length >= 2) {
        detected.push({ colIndex: colIdx, name: cleanedName });
      }
    });

    if (detected.length >= 1) {
      headerRowIndex = r;
      employeeCols = detected;
      break;
    }
  }

  if (headerRowIndex === -1 || employeeCols.length === 0) {
    throw new Error(
      "Impossible d'identifier la ligne d'en-tête avec les noms des salariés."
    );
  }

  // If info column was not explicitly identified by keyword, check if there is a column after the last employee
  if (infoColIndex === -1 && headerRowIndex !== -1) {
    const maxEmpCol = Math.max(...employeeCols.map((c) => c.colIndex));
    const headerRow = rawRows[headerRowIndex] || [];
    if (headerRow.length > maxEmpCol + 1) {
      infoColIndex = maxEmpCol + 1;
    }
  }

  // 4. Parse day rows
  const teamSchedules: Record<string, EmployeeMonthSchedule> = {};
  const extractedDayNotes: Record<string, string> = {};

  employeeCols.forEach(({ name }) => {
    teamSchedules[name] = {
      employee: name,
      month: '',
      days: {},
      totalHours: 0,
    };
  });

  let detectedMonthKey = '';
  let totalShiftsCount = 0;
  let totalDaysCount = 0;

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] || '').trim();
    if (firstCell.toUpperCase().includes('TOTAL')) {
      continue;
    }

    // Match YYYY-MM-DD
    const dateMatch = firstCell.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!dateMatch) {
      continue;
    }

    const y = dateMatch[1];
    const m = dateMatch[2].padStart(2, '0');
    const d = dateMatch[3].padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    const rowMonthKey = `${y}-${m}`;

    if (!detectedMonthKey) {
      detectedMonthKey = rowMonthKey;
      Object.values(teamSchedules).forEach((s) => (s.month = detectedMonthKey));
    }

    totalDaysCount++;

    // Extract day information if present in info column
    let dayInfo = '';
    if (infoColIndex !== -1 && row[infoColIndex] !== undefined && row[infoColIndex] !== null) {
      dayInfo = String(row[infoColIndex]).trim();
      if (dayInfo) {
        extractedDayNotes[dateKey] = dayInfo;
      }
    }

    // Extract each employee cell
    employeeCols.forEach(({ colIndex, name }) => {
      const cellVal = row[colIndex];
      const { shift, hours } = resolveShiftFromCell(cellVal, activeTableau2);

      if (shift || hours || dayInfo) {
        if (shift || hours) totalShiftsCount++;
        teamSchedules[name].days[dateKey] = {
          shift,
          hours,
          ...(dayInfo ? { info: dayInfo } : {}),
        };
      }
    });
  }

  // 5. Calculate total hours for each employee
  const employeeHours: Record<string, number> = {};
  for (const [name, schedule] of Object.entries(teamSchedules)) {
    let tot = 0;
    for (const day of Object.values(schedule.days)) {
      tot += calculateHours(day.shift, day.hours, activeTableau2);
    }
    const rounded = Math.round(tot * 10) / 10;
    schedule.totalHours = rounded;
    employeeHours[name] = rounded;
  }

  return {
    monthKey: detectedMonthKey,
    detectedEmployees: employeeCols.map((c) => c.name),
    teamSchedules,
    dayNotes: extractedDayNotes,
    stats: {
      totalDays: totalDaysCount,
      totalShifts: totalShiftsCount,
      employeeHours,
    },
    customShifts: activeTableau2,
  };
}
