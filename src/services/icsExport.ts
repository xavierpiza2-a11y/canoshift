import { EmployeeMonthSchedule } from '../types/planning';
import { getStoreName } from './api';

function formatICSDate(dateStr: string, timeStr: string): string {
  // dateStr is "YYYY-MM-DD", timeStr is "HH:MM"
  const cleanDate = dateStr.replace(/-/g, '');
  const [h, m] = timeStr.split(':');
  const padH = (h || '00').padStart(2, '0');
  const padM = (m || '00').padStart(2, '0');
  return `${cleanDate}T${padH}${padM}00`;
}

function parseHourParts(hoursText?: string): Array<{ start: string; end: string }> {
  if (!hoursText || !hoursText.trim()) return [];

  // Common patterns: "9h/12h30--14h/19h" or "10h-12h30 · 14h30-19h" or "9h/17h"
  const segments = hoursText.split(/--|·|\n/);
  const slots: Array<{ start: string; end: string }> = [];

  for (const seg of segments) {
    const parts = seg.trim().split(/\/|-/);
    if (parts.length >= 2) {
      const s = normalizeTime(parts[0]);
      const e = normalizeTime(parts[1]);
      if (s && e) {
        slots.push({ start: s, end: e });
      }
    }
  }

  return slots;
}

function normalizeTime(t: string): string | null {
  const match = t.trim().toLowerCase().match(/(\d{1,2})(?:h|:)?(\d{2})?/);
  if (!match) return null;
  const hours = match[1].padStart(2, '0');
  const minutes = (match[2] || '00').padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function exportScheduleToICS(schedule: EmployeeMonthSchedule, employeeName: string) {
  const events: string[] = [];
  const days = schedule.days || {};
  const effectiveStore = getStoreName();
  const cleanStoreDomain = effectiveStore.toLowerCase().replace(/[^a-z0-9]/g, '-');

  for (const [dateStr, dayShift] of Object.entries(days)) {
    const shift = (dayShift.shift || '').toUpperCase();
    if (shift === 'REPOS' || shift === 'CONGES' || shift === 'RTT' || shift === 'RECUP') {
      continue;
    }

    const timeSlots = parseHourParts(dayShift.hours);
    const summary = `${effectiveStore} - ${dayShift.shift}${dayShift.hours ? ` (${dayShift.hours})` : ''}`;
    const desc = `${dayShift.info ? `Note: ${dayShift.info}\\n` : ''}Poste: ${dayShift.shift}\\nEmployé: ${employeeName}`;

    if (timeSlots.length > 0) {
      timeSlots.forEach((slot, idx) => {
        const dtStart = formatICSDate(dateStr, slot.start);
        const dtEnd = formatICSDate(dateStr, slot.end);
        const uid = `gv-${employeeName}-${dateStr}-${idx}@${cleanStoreDomain}`;

        events.push([
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${formatICSDate(new Date().toISOString().split('T')[0], '12:00')}`,
          `DTSTART:${dtStart}`,
          `DTEND:${dtEnd}`,
          `SUMMARY:${summary} [Partie ${idx + 1}]`,
          `DESCRIPTION:${desc}`,
          `LOCATION:${effectiveStore}`,
          'STATUS:CONFIRMED',
          'END:VEVENT',
        ].join('\r\n'));
      });
    } else {
      // Default full day or standard shift slot 09:00 - 18:00
      const dtStart = formatICSDate(dateStr, '09:00');
      const dtEnd = formatICSDate(dateStr, '18:00');
      const uid = `gv-${employeeName}-${dateStr}@${cleanStoreDomain}`;

      events.push([
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatICSDate(new Date().toISOString().split('T')[0], '12:00')}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${desc}`,
        `LOCATION:${effectiveStore}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
      ].join('\r\n'));
    }
  }

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${effectiveStore}//Planning Equipe//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Planning ${effectiveStore} - ${employeeName}`,
    'X-WR-TIMEZONE:Europe/Paris',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  // Trigger download
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planning_${employeeName}_${schedule.month}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
