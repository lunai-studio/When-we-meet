import type { Calendar, DayMark, Member, Plan, PlanOption, Slot, TimeSlot } from './types';
import { addDays, iso, isWeekend, parseIso, todayIso } from './dates';

/** Which half-day(s) a slot touches. Custom ranges count for AM if they start before 12:00, PM if they end after. */
const touches = (t: TimeSlot, half: 'am' | 'pm') => {
  if (t.slot === 'all') return true;
  if (t.slot === 'custom') return half === 'am' ? (t.time_from ?? '00:00') < '12:00' : (t.time_to ?? '24:00') > '12:00';
  return t.slot === half;
};

export const freeIn = (m: DayMark | undefined, slot: Slot) =>
  !!m && m.status === 'free' && (slot === 'all' || slot === 'custom' || touches(m, slot));

export const slotText = (t: TimeSlot, labels: { all: string; am: string; pm: string }) =>
  t.slot === 'custom' ? `${t.time_from}–${t.time_to}` : t.slot === 'all' ? labels.all : labels[t.slot];

export const shortSlot = (t: TimeSlot) =>
  t.slot === 'custom' ? `${t.time_from?.replace(':00', '')}–${t.time_to?.replace(':00', '')}` : t.slot.toUpperCase();

export const sameMark = (a?: DayMark | null, b?: DayMark | null) =>
  (!a && !b) ||
  (!!a && !!b && a.status === b.status && a.slot === b.slot && (a.slot !== 'custom' || (a.time_from === b.time_from && a.time_to === b.time_to)));

// ---------- Plans

export const fixedOption = (p: Plan): PlanOption | undefined =>
  p.chosen_option_id ? p.options.find((o) => o.id === p.chosen_option_id) : p.options.length === 1 ? p.options[0] : undefined;

export type Phase = 'voting' | 'answering' | 'on';
export const phaseOf = (p: Plan): Phase => (p.status === 'confirmed' ? 'on' : fixedOption(p) ? 'answering' : 'voting');

export const planDate = (p: Plan) => fixedOption(p)?.date ?? p.options[0]?.date ?? '';
export const isPast = (p: Plan) => {
  const last = fixedOption(p)?.date ?? p.options[p.options.length - 1]?.date ?? '';
  return last < todayIso();
};

export const needsMyAnswer = (p: Plan, me: string) => {
  if (!p.invites.includes(me) || isPast(p)) return false;
  return phaseOf(p) === 'voting' ? !p.votes[me] : !p.responses[me];
};

export const voteTally = (p: Plan) =>
  p.options
    .map((o) => ({ o, voters: Object.entries(p.votes).filter(([, v]) => v.option_ids.includes(o.id)).map(([u]) => u) }))
    .sort((a, b) => b.voters.length - a.voters.length || a.o.date.localeCompare(b.o.date));

export const mapsUrl = (placeText?: string | null, url?: string | null) => {
  if (url) return url;
  const s = (placeText ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s)}`;
};

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
