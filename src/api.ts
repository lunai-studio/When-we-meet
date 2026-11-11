import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityRow, CalMode, Calendar, DayMark, Group, Member, Profile } from './types';
import { addDays, iso, isWeekend } from './dates';

/** calId: null = my main calendar, otherwise a group id */
export interface Api {
  demo: boolean;
  currentUserId(): Promise<string | null>;
  onAuthChange(cb: () => void): void;
  signInEmail(email: string): Promise<void>;
  signInGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getProfile(uid: string): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;
  myGroups(): Promise<(Group & { calendar_mode: CalMode })[]>;
  createGroup(name: string): Promise<Group>;
  joinGroup(code: string): Promise<Group>;
  leaveGroup(groupId: string): Promise<void>;
  updateGroup(groupId: string, patch: Partial<Group>): Promise<void>;
  members(groupId: string): Promise<Member[]>;
  setCalendarMode(groupId: string, mode: CalMode): Promise<void>;
  /** Availability of every member as the group sees it (main or own calendar) */
  groupAvailability(groupId: string, members: Member[]): Promise<Record<string, Calendar>>;
  myCalendar(calId: string | null): Promise<Calendar>;
  /** Set (mark) or clear (null) a batch of days */
  setDays(calId: string | null, changes: Record<string, DayMark | null>): Promise<void>;
  /** Exact replace of target calendar with `cal` */
  replaceCalendar(calId: string | null, cal: Calendar): Promise<void>;
}

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const wantDemo = new URLSearchParams(location.search).has('demo');

export const api: Api = !URL_ || !KEY || wantDemo ? makeDemoApi() : makeSupabaseApi(createClient(URL_, KEY));

// ---------------------------------------------------------------- Supabase

function makeSupabaseApi(sb: SupabaseClient): Api {
  const uid = async () => (await sb.auth.getSession()).data.session?.user.id ?? null;
  const must = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const toCal = (rows: AvailabilityRow[]) =>
    Object.fromEntries(rows.map((r) => [r.date, { status: r.status, slot: r.slot }])) as Calendar;
  const calFilter = <Q extends { is: Function; eq: Function }>(q: Q, calId: string | null) =>
    calId === null ? q.is('group_id', null) : q.eq('group_id', calId);
  const redirect = () => location.origin + location.pathname;

  return {
    demo: false,
    currentUserId: uid,
    onAuthChange: (cb) => {
      sb.auth.onAuthStateChange(() => cb());
    },
    signInEmail: async (email) => {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
      if (error) throw new Error(error.message);
    },
    signInGoogle: async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } });
      if (error) throw new Error(error.message);
    },
    signOut: async () => {
      await sb.auth.signOut();
    },
    getProfile: async (id) => must(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as Profile | null,
    saveProfile: async (p) => {
      must(await sb.from('profiles').upsert(p));
    },
    myGroups: async () => {
      const me = await uid();
      const rows = must(
        await sb.from('group_members').select('calendar_mode, groups(*)').eq('user_id', me!).order('joined_at'),
      ) as unknown as { calendar_mode: CalMode; groups: Group }[];
      return rows.filter((r) => r.groups).map((r) => ({ ...r.groups, calendar_mode: r.calendar_mode }));
    },
    createGroup: async (name) => must(await sb.rpc('create_group', { p_name: name })) as Group,
    joinGroup: async (code) => must(await sb.rpc('join_group', { p_code: code })) as Group,
    leaveGroup: async (gid) => {
      const me = await uid();
      must(await sb.from('group_members').delete().eq('group_id', gid).eq('user_id', me!));
      must(await sb.from('availability').delete().eq('group_id', gid).eq('owner_id', me!));
    },
    updateGroup: async (gid, patch) => {
      must(await sb.from('groups').update(patch).eq('id', gid));
    },
    members: async (gid) => {
      const mem = must(
        await sb.from('group_members').select('user_id, calendar_mode').eq('group_id', gid).order('joined_at'),
      ) as { user_id: string; calendar_mode: CalMode }[];
      const ids = mem.map((m) => m.user_id);
      const profs = must(await sb.from('profiles').select('*').in('id', ids)) as Profile[];
      return mem.map((m) => ({
        ...m,
        profile: profs.find((p) => p.id === m.user_id) ?? { id: m.user_id, display_name: '?', language: 'en', color: '#9C9AB0' },
      }));
    },
    setCalendarMode: async (gid, mode) => {
      const me = await uid();
      must(await sb.from('group_members').update({ calendar_mode: mode }).eq('group_id', gid).eq('user_id', me!));
    },
    groupAvailability: async (gid, members) => {
      const ids = members.map((m) => m.user_id);
      const rows = must(
        await sb
          .from('availability')
          .select('owner_id, group_id, date, status, slot')
          .in('owner_id', ids)
          .or(`group_id.eq.${gid},group_id.is.null`)
          .gte('date', iso(addDays(new Date(), -40))),
      ) as AvailabilityRow[];
      const out: Record<string, Calendar> = {};
      for (const m of members) {
        const want = m.calendar_mode === 'own' ? gid : null;
        out[m.user_id] = toCal(rows.filter((r) => r.owner_id === m.user_id && r.group_id === want));
      }
      return out;
    },
    myCalendar: async (calId) => {
      const me = await uid();
      const q = sb.from('availability').select('owner_id, group_id, date, status, slot').eq('owner_id', me!);
      return toCal(must(await calFilter(q, calId)) as AvailabilityRow[]);
    },
    setDays: async (calId, changes) => {
      const me = await uid();
      const del = Object.keys(changes).filter((d) => !changes[d]);
      const up = Object.entries(changes)
        .filter(([, v]) => v)
        .map(([date, v]) => ({ owner_id: me!, group_id: calId, date, status: v!.status, slot: v!.slot, updated_at: new Date().toISOString() }));
      if (del.length) {
        const q = sb.from('availability').delete().eq('owner_id', me!).in('date', del);
        must(await calFilter(q, calId));
      }
      if (up.length) must(await sb.from('availability').upsert(up, { onConflict: 'owner_id,group_id,date' }));
    },
    replaceCalendar: async (calId, cal) => {
      const me = await uid();
      must(await calFilter(sb.from('availability').delete().eq('owner_id', me!), calId));
      const rows = Object.entries(cal).map(([date, v]) => ({ owner_id: me!, group_id: calId, date, ...v }));
      if (rows.length) must(await sb.from('availability').insert(rows));
    },
  };
}

// ---------------------------------------------------------------- Demo (in memory, no backend)

function makeDemoApi(): Api {
  const me = 'demo-me';
  let signedIn = true;
  const profiles: Record<string, Profile> = {
    [me]: { id: me, display_name: 'Cecilia', language: 'es', color: '#FF8FB1' },
    mich: { id: 'mich', display_name: 'Mich', language: 'es', color: '#60A5FA' },
    ana: { id: 'ana', display_name: 'Ana', language: 'en', color: '#F2C14E' },
    tomas: { id: 'tomas', display_name: 'Tomáš', language: 'en', color: '#3DDC97' },
    lea: { id: 'lea', display_name: 'Lea', language: 'en', color: '#C084FC' },
  };
  const groups: Group[] = [
    { id: 'g1', name: 'M&C', goal_count: 2, goal_period: 'month', min_people: 3, invite_code: 'demo01', created_by: me },
    { id: 'g2', name: 'Lunai', goal_count: 1, goal_period: 'week', min_people: 2, invite_code: 'demo02', created_by: 'mich' },
  ];
  const membership: { group_id: string; user_id: string; calendar_mode: CalMode }[] = [
    ...[me, 'mich', 'ana', 'tomas', 'lea'].map((u) => ({ group_id: 'g1', user_id: u, calendar_mode: 'main' as CalMode })),
    ...[me, 'mich'].map((u) => ({ group_id: 'g2', user_id: u, calendar_mode: 'main' as CalMode })),
  ];
  // key: `${owner}|${calId ?? 'main'}`
  const cals: Record<string, Calendar> = {};
  const key = (o: string, c: string | null) => `${o}|${c ?? 'main'}`;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const u of Object.keys(profiles)) {
    const cal: Calendar = {};
    for (let i = 0; i < 55; i++) {
      const d = addDays(new Date(), i);
      const r = rnd();
      if (u === me && i > 20) continue;
      if (r < 0.42) cal[iso(d)] = { status: 'free', slot: isWeekend(d) ? 'all' : 'pm' };
      else if (r < 0.58) cal[iso(d)] = { status: 'busy', slot: r < 0.5 ? 'all' : 'am' };
      else if (r < 0.63) cal[iso(d)] = { status: 'away', slot: 'all' };
    }
    cals[key(u, null)] = cal;
  }
  const wait = () => new Promise((r) => setTimeout(r, 60));
  const listeners: (() => void)[] = [];

  return {
    demo: true,
    currentUserId: async () => (signedIn ? me : null),
    onAuthChange: (cb) => listeners.push(cb),
    signInEmail: async () => {
      signedIn = true;
      listeners.forEach((l) => l());
    },
    signInGoogle: async () => {
      signedIn = true;
      listeners.forEach((l) => l());
    },
    signOut: async () => {
      signedIn = false;
      listeners.forEach((l) => l());
    },
    getProfile: async (id) => profiles[id] ?? null,
    saveProfile: async (p) => {
      profiles[p.id] = { ...p };
    },
    myGroups: async () => {
      await wait();
      return membership
        .filter((m) => m.user_id === me)
        .map((m) => ({ ...groups.find((g) => g.id === m.group_id)!, calendar_mode: m.calendar_mode }));
    },
    createGroup: async (name) => {
      const g: Group = { id: 'g' + Date.now(), name, goal_count: 2, goal_period: 'month', min_people: 2, invite_code: Math.random().toString(16).slice(2, 14), created_by: me };
      groups.push(g);
      membership.push({ group_id: g.id, user_id: me, calendar_mode: 'main' });
      return g;
    },
    joinGroup: async (code) => {
      const g = groups.find((x) => x.invite_code === code.trim().toLowerCase());
      if (!g) throw new Error('invalid invite');
      if (!membership.some((m) => m.group_id === g.id && m.user_id === me))
        membership.push({ group_id: g.id, user_id: me, calendar_mode: 'main' });
      return g;
    },
    leaveGroup: async (gid) => {
      const i = membership.findIndex((m) => m.group_id === gid && m.user_id === me);
      if (i >= 0) membership.splice(i, 1);
    },
    updateGroup: async (gid, patch) => {
      Object.assign(groups.find((g) => g.id === gid)!, patch);
    },
    members: async (gid) =>
      membership.filter((m) => m.group_id === gid).map((m) => ({ user_id: m.user_id, calendar_mode: m.calendar_mode, profile: profiles[m.user_id] })),
    setCalendarMode: async (gid, mode) => {
      membership.find((m) => m.group_id === gid && m.user_id === me)!.calendar_mode = mode;
    },
    groupAvailability: async (gid, members) => {
      await wait();
      return Object.fromEntries(members.map((m) => [m.user_id, { ...(cals[key(m.user_id, m.calendar_mode === 'own' ? gid : null)] ?? {}) }]));
    },
    myCalendar: async (calId) => ({ ...(cals[key(me, calId)] ?? {}) }),
    setDays: async (calId, changes) => {
      const c = (cals[key(me, calId)] ??= {});
      for (const [d, v] of Object.entries(changes)) {
        if (v) c[d] = v;
        else delete c[d];
      }
    },
    replaceCalendar: async (calId, cal) => {
      cals[key(me, calId)] = { ...cal };
    },
  };
}
