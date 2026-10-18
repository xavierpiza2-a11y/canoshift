import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Employee, EmployeeMonthSchedule } from '../types/planning';
import { categorizeShift } from '../config/constants';
import { calculateHours } from './excelService';
import { getCategoryDetails } from '../config/categoryStyles';
import { getStoredTableau2Shifts, getStoredDayNotes, getStoreName } from './api';

interface ExportTeamPdfOptions {
  monthKey: string;
  monthLabel: string;
  employees: Employee[];
  teamSchedules: Record<string, EmployeeMonthSchedule>;
  storeName?: string;
}

/**
 * Format shift cell for PDF: strictly category and time range (plage horaire)
 */
function formatShiftCell(shiftText: string, hoursText: string, category: string): string {
  const cleanShift = (shiftText || '').trim();
  const cleanHours = (hoursText || '').trim();

  if (!cleanShift && !cleanHours) return '—';

  let catDisplay = (category || 'AUTRE').trim().toUpperCase();
  if (catDisplay === 'JOURNEE') catDisplay = 'JOURNÉE';
  else if (catDisplay === 'CONGES') catDisplay = 'CONGÉS';

  // Strictly: Catégorie + Plage horaire
  if (cleanHours) {
    return `${catDisplay}\n${cleanHours}`;
  }

  return catDisplay;
}

/**
 * Load /logo-full-light.svg and convert to PNG data URL for jsPDF embedding
 */
async function getLogoFullLightDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  try {
    const res = await fetch('/logo-full-light.svg');
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 480;
          canvas.height = 120;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 480, 120);
            const dataUrl = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);
            resolve(dataUrl);
            return;
          }
        } catch {
          // ignore
        }
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}

/**
 * Generate a pristine, single-page Landscape A4 PDF of the team planning
 * with DATES IN ROWS and EMPLOYEES IN COLUMNS (inverted as requested),
 * strictly guaranteeing that the month banner, all dates, and footer fit on 1 SINGLE PAGE.
 */
export async function exportTeamPlanningToPDF({
  monthKey,
  monthLabel,
  employees,
  teamSchedules,
  storeName,
}: ExportTeamPdfOptions) {
  const effectiveStore = (storeName || getStoreName()).trim();
  const logoDataUrl = await getLogoFullLightDataUrl();
  // A4 Landscape: 297mm x 210mm
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 4.5;
  const contentWidth = pageWidth - margin * 2; // 288mm

  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Days metadata (1 to daysInMonth)
  const daysInfo: Array<{
    dayNum: number;
    dateKey: string;
    dStr: string;
    dayNameShort: string;
    isWeekend: boolean;
    isSunday: boolean;
  }> = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay(); // 0 is Sunday, 6 is Saturday
    const dStr = d < 10 ? `0${d}` : `${d}`;
    const dayNameShort = dateObj.toLocaleDateString('fr-FR', { weekday: 'short' });
    const capitalizedDay = dayNameShort.charAt(0).toUpperCase() + dayNameShort.slice(1).replace('.', '');
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${dStr}`;

    daysInfo.push({
      dayNum: d,
      dStr,
      dateKey,
      dayNameShort: capitalizedDay,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isSunday: dayOfWeek === 0,
    });
  }

  // --- HEADER BANNER (GARANTI SUR LA MÊME PAGE) ---
  const bannerY = margin;
  const bannerHeight = 8.5; // Compact to ensure strict 1-page fit
  doc.setFillColor(22, 101, 52); // Dark Emerald #166534
  doc.rect(margin, bannerY, contentWidth, bannerHeight, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(
    `${effectiveStore.toUpperCase()} · PLANNING GÉNÉRAL - ${monthLabel.toUpperCase()}`,
    margin + 3.5,
    bannerY + 5.5
  );

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${employees.length} SALARIÉS · MOIS DE ${daysInMonth} JOURS`,
    pageWidth - margin - 3.5,
    bannerY + 5.5,
    { align: 'right' }
  );

  // --- COLUMN WIDTHS (Employees in columns + Rightmost Informations column) ---
  const dateColWidth = 12; // mm
  const dayColWidth = 15;  // mm
  const infoColWidth = 36; // mm
  const fixedColsWidth = dateColWidth + dayColWidth + infoColWidth; // 63mm
  const availableForEmployees = contentWidth - fixedColsWidth; // 225mm (~37.5mm per emp for 6 emps)
  const employeeColWidth = availableForEmployees / Math.max(1, employees.length);

  // --- TABLE HEADERS ---
  const headRow: any[] = [
    { content: 'Date', styles: { halign: 'center', valign: 'middle', fontStyle: 'bold' } },
    { content: 'Jour', styles: { halign: 'center', valign: 'middle', fontStyle: 'bold' } },
  ];

  employees.forEach((emp) => {
    headRow.push({
      content: `${emp.name}${emp.role ? `\n(${emp.role})` : ''}`,
      styles: {
        halign: 'center',
        valign: 'middle',
        fontStyle: 'bold',
        fontSize: 6.8,
      },
    });
  });

  // Rightmost column for Day Information
  headRow.push({
    content: 'Informations / Notes',
    styles: {
      halign: 'center',
      valign: 'middle',
      fontStyle: 'bold',
      fontSize: 6.8,
    },
  });

  // --- TABLE BODY ROWS (Dates in rows from 01 to 31) ---
  const bodyRows: any[] = [];
  const employeeWorkedTotals: Record<string, number> = {};
  employees.forEach((emp) => {
    employeeWorkedTotals[emp.name] = 0;
  });

  const getSchedule = (name: string): EmployeeMonthSchedule | null => {
    const direct = teamSchedules[name];
    if (direct) return direct;
    const lower = teamSchedules[name.toLowerCase()];
    if (lower) return lower;
    const found = Object.entries(teamSchedules).find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  };

  const dayNotes = getStoredDayNotes(monthKey);

  daysInfo.forEach((d) => {
    const row: any[] = [
      {
        content: `${d.dStr}/${String(month).padStart(2, '0')}`,
        styles: {
          halign: 'center',
          valign: 'middle',
          fontStyle: 'bold',
          textColor: d.isSunday ? [185, 28, 28] : d.isWeekend ? [71, 85, 105] : [15, 23, 42],
          fillColor: d.isSunday ? [254, 226, 226] : d.isWeekend ? [241, 245, 249] : [255, 255, 255],
        },
      },
      {
        content: `${d.dayNameShort} ${d.dStr}`,
        styles: {
          halign: 'center',
          valign: 'middle',
          fontStyle: d.isWeekend ? 'bold' : 'normal',
          textColor: d.isSunday ? [185, 28, 28] : d.isWeekend ? [71, 85, 105] : [51, 65, 85],
          fillColor: d.isSunday ? [254, 226, 226] : d.isWeekend ? [241, 245, 249] : [255, 255, 255],
        },
      },
    ];

    const storedCreneaux = getStoredTableau2Shifts();

    employees.forEach((emp) => {
      const sched = getSchedule(emp.name);
      const dayData = sched?.days ? sched.days[d.dateKey] : undefined;
      const shiftText = (dayData?.shift || '').trim();
      const hoursText = (dayData?.hours || '').trim();

      // Check if shift matches a known Créneau in stored tableau 2
      const matchingCreneau = storedCreneaux.find(
        (o) => o.label === shiftText || o.shift === shiftText || (o.shift === shiftText && o.hours === hoursText)
      );
      const cat = matchingCreneau?.category || categorizeShift(shiftText, hoursText);
      const catDetails = getCategoryDetails(cat, matchingCreneau?.color);

      const hoursVal = calculateHours(shiftText, hoursText);
      employeeWorkedTotals[emp.name] += hoursVal;

      const cellText = formatShiftCell(shiftText, hoursText, cat);
      const isBlank = !shiftText && !hoursText;
      const bg = isBlank
        ? (d.isWeekend ? [248, 250, 252] : [255, 255, 255])
        : catDetails.rgb;
      const fg = isBlank
        ? [148, 163, 184]
        : catDetails.textRgb;

      row.push({
        content: cellText,
        styles: {
          halign: 'center',
          valign: 'middle',
          fillColor: bg,
          textColor: fg,
          fontSize: 6,
          fontStyle: cat === 'REPOS' || cat === 'CONGES' || cat === 'RTT' ? 'bold' : 'normal',
        },
      });
    });

    // Rightmost column: Information / Événement du jour
    let note = dayNotes[d.dateKey] || '';
    if (!note) {
      for (const emp of employees) {
        const s = getSchedule(emp.name);
        if (s?.days?.[d.dateKey]?.info) {
          note = s.days[d.dateKey].info || '';
          break;
        }
      }
    }

    row.push({
      content: note || '',
      styles: {
        halign: 'left',
        valign: 'middle',
        fontSize: 5.2,
        textColor: note ? [15, 23, 42] : [148, 163, 184],
        fillColor: note
          ? [254, 252, 232]
          : d.isWeekend
          ? [248, 250, 252]
          : [255, 255, 255],
        fontStyle: note ? 'bold' : 'normal',
      },
    });

    bodyRows.push(row);
  });

  // --- FOOTER ROW: TOTAL HEURES / MOIS ---
  const totalRow: any[] = [
    {
      content: 'TOTAL',
      styles: {
        halign: 'center',
        valign: 'middle',
        fontStyle: 'bold',
        fillColor: [22, 101, 52],
        textColor: [255, 255, 255],
        fontSize: 7,
      },
    },
    {
      content: 'Heures',
      styles: {
        halign: 'center',
        valign: 'middle',
        fontStyle: 'bold',
        fillColor: [22, 101, 52],
        textColor: [255, 255, 255],
        fontSize: 6.5,
      },
    },
  ];

  employees.forEach((emp) => {
    const sched = getSchedule(emp.name);
    const tot =
      sched?.totalHours && sched.totalHours > 0
        ? sched.totalHours
        : Math.round(employeeWorkedTotals[emp.name] * 10) / 10;

    totalRow.push({
      content: `${tot}h`,
      styles: {
        halign: 'center',
        valign: 'middle',
        fontStyle: 'bold',
        fillColor: [220, 252, 231],
        textColor: [22, 101, 52],
        fontSize: 7.5,
      },
    });
  });

  // Empty cell for the rightmost Informations column in footer
  totalRow.push({
    content: '',
    styles: {
      fillColor: [22, 101, 52],
    },
  });

  bodyRows.push(totalRow);

  // Column styles mapping
  const columnStyles: Record<number, any> = {
    0: { cellWidth: dateColWidth },
    1: { cellWidth: dayColWidth },
  };
  employees.forEach((_, idx) => {
    columnStyles[idx + 2] = { cellWidth: employeeColWidth };
  });
  // Rightmost Informations column
  columnStyles[2 + employees.length] = { cellWidth: infoColWidth };

  // --- AUTOTABLE GENERATION (Strict 1-page fit) ---
  const startTableY = bannerY + bannerHeight + 1.5; // Y = 14.5mm
  const targetCellHeight = daysInMonth === 31 ? 4.85 : 5.0;

  autoTable(doc, {
    startY: startTableY,
    head: [headRow],
    body: bodyRows,
    theme: 'grid',
    styles: {
      fontSize: 6,
      cellPadding: 0.35,
      minCellHeight: targetCellHeight,
      lineColor: [203, 213, 225],
      lineWidth: 0.12,
      overflow: 'ellipsize',
    },
    headStyles: {
      fillColor: [22, 101, 52],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      fontSize: 6.8,
      minCellHeight: 6,
    },
    columnStyles,
    margin: { left: margin, right: margin },
    tableWidth: contentWidth,
    pageBreak: 'avoid', // STRICT SINGLE PAGE GUARANTEE
  });

  // --- FOOTER SECTION (Bottom of the same page) ---
  const now = new Date();
  const exportTimestamp = now.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const footerY = pageHeight - margin + 1.5;

  // Thin separator line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY - 3.5, pageWidth - margin, footerY - 3.5);

  // Bottom Left: Logo logo-full-light.svg 
  let leftTextX = margin;
  if (logoDataUrl) {
    try {
      const logoWidth = 18; // 18mm x 4.5mm (4:1 aspect ratio matching 480x120)
      const logoHeight = 4.5;
      doc.addImage(logoDataUrl, 'PNG', margin, footerY - 3.2, logoWidth, logoHeight);
      leftTextX = margin + logoWidth + 2;
    } catch {
      leftTextX = margin;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(22, 101, 52); // Vert forêt / sapin officiel
  doc.text('By NEVO', leftTextX, footerY - 0.2);

  // Bottom Right: Export date & time
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 101, 52);
  doc.text(`Document exporté le ${exportTimestamp} · ${effectiveStore}`, pageWidth - margin, footerY, {
    align: 'right',
  });

  // Save the PDF file
  const cleanStore = effectiveStore.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanMonth = monthLabel.replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`Planning_${cleanStore}_${cleanMonth}.pdf`);
}
