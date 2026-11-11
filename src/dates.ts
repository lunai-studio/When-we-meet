import type { Lang } from './types';

export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayIso = () => iso(new Date());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

const locale = (lang: Lang) => (lang === 'es' ? 'es-ES' : 'en-GB');

export const monthName = (y: number, m: number, lang: Lang) => {
  const s = new Date(y, m, 1).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Monday-first weekday initials */
export const weekdayShort = (lang: Lang) =>
  [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale(lang), { weekday: 'short' }).replace('.', '').slice(0, 2),
  );

export const weekdayLong = (lang: Lang) =>
  [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(lang), { weekday: 'long' }));

export const prettyDate = (s: string, lang: Lang) => {
  const out = parseIso(s).toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' });
  return out.charAt(0).toUpperCase() + out.slice(1);
};

/** The 6 months starting at the current one: [{y, m}] */
export const sixMonths = () => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
};

/** Grid cells for a month, Monday-first; null = padding */
export const monthCells = (y: number, m: number): (string | null)[] => {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(new Date(y, m, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
};

/** Start/end (inclusive ISO) of the current week (Mon-Sun) or month */
export const periodRange = (period: 'week' | 'month'): [string, string] => {
  const now = new Date();
  if (period === 'week') {
    const mon = addDays(now, -((now.getDay() + 6) % 7));
    return [iso(mon), iso(addDays(mon, 6))];
  }
  return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
};
