import type { Calendar, DayMark, Member, Slot } from './types';
import { addDays, iso, isWeekend, parseIso } from './dates';

export const freeIn = (m: DayMark | undefined, slot: Slot) =>
  !!m && m.status === 'free' && (m.slot === 'all' || slot === 'all' || m.slot === slot);

/** Slots that count for suggestions: PM on weekdays, AM or PM on weekends */
export const candidateSlots = (date: string): Slot[] => (isWeekend(parseIso(date)) ? ['am', 'pm'] : ['pm']);

export interface Suggestion {
  date: string;
  slot: Slot;
  free: string[];
}

/** Best slot of a day (most people free) */
export const bestSlot = (date: string, members: Member[], avail: Record<string, Calendar>): Suggestion => {
  let best: Suggestion = { date, slot: 'pm', free: [] };
  for (const slot of candidateSlots(date)) {
    const free = members.filter((m) => freeIn(avail[m.user_id]?.[date], slot)).map((m) => m.user_id);
    if (free.length > best.free.length) best = { date, slot, free };
  }
  return best;
};

export const upcomingDays = (n: number) => Array.from({ length: n }, (_, i) => iso(addDays(new Date(), i)));

export const suggestions = (members: Member[], avail: Record<string, Calendar>, days = 120) =>
  upcomingDays(days)
    .map((d) => bestSlot(d, members, avail))
    .filter((s) => s.free.length > 0)
    .sort((a, b) => b.free.length - a.free.length || a.date.localeCompare(b.date));

export const statusColor = { free: '#3DDC97', busy: '#EF6B6B', away: '#60A5FA' } as const;

export const PALETTE = ['#3DDC97', '#60A5FA', '#F2C14E', '#FF8FB1', '#C084FC', '#5EEAD4', '#FDBA74', '#A3E635'];

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
