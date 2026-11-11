import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CalMode,
  Calendar,
  Comment,
  DayMark,
  Group,
  Member,
  NotifyKind,
  Plan,
  PlanInput,
  PlanOption,
  Profile,
  Rsvp,
} from './types';
import { addDays, iso, isWeekend } from './dates';

/** calId: null = my main calendar, otherwise a group id */
export interface Api {
  demo: boolean;
  currentUserId(): Promise<string | null>;
  onAuthChange(cb: () => void): void;
  /** Subscribe to changes in a group; returns unsubscribe */
  watchGroup(groupId: string, cb: () => void): () => void;
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
  groupAvailability(groupId: string, members: Member[]): Promise<Record<string, Calendar>>;
  myCalendar(calId: string | null): Promise<Calendar>;
  setDays(calId: string | null, changes: Record<string, DayMark | null>): Promise<void>;
  replaceCalendar(calId: string | null, cal: Calendar): Promise<void>;
  // Plans
  plans(groupId: string): Promise<Plan[]>;
  savePlan(input: PlanInput, id?: string): Promise<string>;
  deletePlan(id: string): Promise<void>;
  setPlanState(id: string, patch: { status?: 'open' | 'confirmed'; chosen_option_id?: string | null }): Promise<void>;
  respond(planId: string, rsvp: Rsvp | null): Promise<void>;
  vote(planId: string, optionIds: string[], noneWork: boolean): Promise<void>;
  comments(planId: string): Promise<Comment[]>;
  addComment(planId: string, text: string): Promise<void>;
  notify(kind: NotifyKind, planId: string): Promise<void>;
}

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const wantDemo = new URLSearchParams(location.search).has('demo');

export const api: Api = !URL_ || !KEY || wantDemo ? makeDemoApi() : makeSupabaseApi(createClient(URL_, KEY));

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : null);
const markOf = (r: { status: DayMark['status']; slot: DayMark['slot']; time_from?: string | null; time_to?: string | null; plan_id?: string | null }): DayMark => ({
  status: r.status,
  slot: r.slot,
  time_from: hhmm(r.time_from),
  time_to: hhmm(r.time_to),
  plan_id: r.plan_id ?? null,
});

// ---------------------------------------------------------------- Supabase

type Row = Record<string, unknown>;

function makeSupabaseApi(sb: SupabaseClient): Api {
  let me: string | null = null;
  const uid = async () => (me = (await sb.auth.getSession()).data.session?.user.id ?? null);
  const must = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const AV = 'owner_id, group_id, date, status, slot, time_from, time_to, plan_id';
  const toCal = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.date as string, markOf(r as never)])) as Calendar;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calFilter = (q: any, calId: string | null) => (calId === null ? q.is('group_id', null) : q.eq('group_id', calId));
  const redirect = () => location.origin + location.pathname;

  const toPlan = (r: Row): Plan => ({
    ...(r as unknown as Plan),
    options: ((r.plan_options as Row[]) ?? [])
      .map((o) => ({ id: o.id, date: o.date, slot: o.slot, time_from: hhmm(o.time_from as string), time_to: hhmm(o.time_to as string) }) as PlanOption)
      .sort((a, b) => a.date.localeCompare(b.date)),
    invites: ((r.plan_invites as Row[]) ?? []).map((i) => i.user_id as string),
    responses: Object.fromEntries(((r.plan_responses as Row[]) ?? []).map((x) => [x.user_id, x.rsvp])),
    votes: Object.fromEntries(((r.plan_votes as Row[]) ?? []).map((x) => [x.user_id, { option_ids: x.option_ids, none_work: x.none_work }])),
    comments: ((r.comments as Row[]) ?? []) as Plan['comments'],
  });

  return {
    demo: false,
    currentUserId: uid,
    onAuthChange: (cb) => {
      sb.auth.onAuthStateChange(() => cb());
    },
    watchGroup: (gid, cb) => {
      let t: number | undefined;
      const fire = () => {
        clearTimeout(t);
        t = window.setTimeout(cb, 400);
      };
      const ch = sb
        .channel('g-' + gid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plans', filter: `group_id=eq.${gid}` }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_responses' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_votes' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${gid}` }, fire)
        .subscribe();
      return () => {
        clearTimeout(t);
        sb.removeChannel(ch);
      };
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
      await uid();
      const rows = must(
        await sb.from('group_members').select('calendar_mode, groups(*)').eq('user_id', me!).order('joined_at'),
      ) as unknown as { calendar_mode: CalMode; groups: Group }[];
      return rows.filter((r) => r.groups).map((r) => ({ ...r.groups, calendar_mode: r.calendar_mode }));
    },
    createGroup: async (name) => must(await sb.rpc('create_group', { p_name: name })) as Group,
    joinGroup: async (code) => must(await sb.rpc('join_group', { p_code: code })) as Group,
    leaveGroup: async (gid) => {
      await uid();
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
      const profs = must(await sb.from('profiles').select('*').in('id', mem.map((m) => m.user_id))) as Profile[];
      return mem.map((m) => ({
        ...m,
        profile: profs.find((p) => p.id === m.user_id) ?? { id: m.user_id, display_name: '?', language: 'en', color: '#9C9AB0' },
      }));
    },
    setCalendarMode: async (gid, mode) => {
      await uid();
      must(await sb.from('group_members').update({ calendar_mode: mode }).eq('group_id', gid).eq('user_id', me!));
    },
    groupAvailability: async (gid, members) => {
      const rows = must(
        await sb
          .from('availability')
          .select(AV)
          .in('owner_id', members.map((m) => m.user_id))
          .or(`group_id.eq.${gid},group_id.is.null`)
          .gte('date', iso(addDays(new Date(), -40))),
      ) as Row[];
      const out: Record<string, Calendar> = {};
      for (const m of members) {
        const want = m.calendar_mode === 'own' ? gid : null;
        out[m.user_id] = toCal(rows.filter((r) => r.owner_id === m.user_id && r.group_id === want));
      }
      return out;
    },
    myCalendar: async (calId) => {
      await uid();
      return toCal(must(await calFilter(sb.from('availability').select(AV).eq('owner_id', me!), calId)) as Row[]);
    },
    setDays: async (calId, changes) => {
      await uid();
      const del = Object.keys(changes).filter((d) => !changes[d]);
      const up = Object.entries(changes)
        .filter(([, v]) => v)
        .map(([date, v]) => ({
          owner_id: me!,
          group_id: calId,
          date,
          status: v!.status,
          slot: v!.slot,
          time_from: v!.slot === 'custom' ? v!.time_from : null,
          time_to: v!.slot === 'custom' ? v!.time_to : null,
          plan_id: null,
          updated_at: new Date().toISOString(),
        }));
      if (del.length) must(await calFilter(sb.from('availability').delete().eq('owner_id', me!).in('date', del), calId));
      if (up.length) must(await sb.from('availability').upsert(up, { onConflict: 'owner_id,group_id,date' }));
    },
    replaceCalendar: async (calId, cal) => {
      await uid();
      must(await calFilter(sb.from('availability').delete().eq('owner_id', me!), calId));
      const rows = Object.entries(cal).map(([date, v]) => ({
        owner_id: me!,
        group_id: calId,
        date,
        status: v.status,
        slot: v.slot,
        time_from: v.time_from ?? null,
        time_to: v.time_to ?? null,
        plan_id: v.plan_id ?? null,
      }));
      if (rows.length) must(await sb.from('availability').insert(rows));
    },

    plans: async (gid) => {
      const rows = must(
        await sb
          .from('plans')
          .select('*, plan_options(*), plan_invites(user_id), plan_responses(user_id, rsvp), plan_votes(user_id, option_ids, none_work), comments(user_id, created_at)')
          .eq('group_id', gid)
          .order('created_at', { ascending: false }),
      ) as Row[];
      return rows.map(toPlan);
    },
    savePlan: async (input, id) => {
      await uid();
      const fields = {
        group_id: input.group_id,
        type: input.type,
        title: input.title,
        place_text: input.place_text,
        place_maps_url: input.place_maps_url,
        note: input.note,
      };
      let planId = id;
      if (!planId) {
        planId = (must(await sb.from('plans').insert({ ...fields, created_by: me! }).select('id').single()) as { id: string }).id;
      } else {
        must(await sb.from('plans').update(fields).eq('id', planId));
      }
      // Options: keep matching ones (so votes survive), replace the rest.
      const existing = must(await sb.from('plan_options').select('*').eq('plan_id', planId)) as Row[];
      const key = (o: { date: string; slot: string; time_from?: string | null; time_to?: string | null }) =>
        `${o.date}|${o.slot}|${hhmm(o.time_from) ?? ''}|${hhmm(o.time_to) ?? ''}`;
      const wanted = new Set(input.options.map(key));
      const have = new Set(existing.map((o) => key(o as never)));
      const drop = existing.filter((o) => !wanted.has(key(o as never))).map((o) => o.id as string);
      if (drop.length) must(await sb.from('plan_options').delete().in('id', drop));
      const add = input.options
        .filter((o) => !have.has(key(o)))
        .map((o) => ({
          plan_id: planId,
          date: o.date,
          slot: o.slot,
          time_from: o.slot === 'custom' ? o.time_from : null,
          time_to: o.slot === 'custom' ? o.time_to : null,
        }));
      if (add.length) must(await sb.from('plan_options').insert(add));
      // Invites: exact replace.
      must(await sb.from('plan_invites').delete().eq('plan_id', planId));
      if (input.invites.length) must(await sb.from('plan_invites').insert(input.invites.map((u) => ({ plan_id: planId, user_id: u }))));
      return planId;
    },
    deletePlan: async (id) => {
      must(await sb.from('plans').delete().eq('id', id));
    },
    setPlanState: async (id, patch) => {
      must(await sb.from('plans').update(patch).eq('id', id));
    },
    respond: async (planId, rsvp) => {
      await uid();
      if (!rsvp) must(await sb.from('plan_responses').delete().eq('plan_id', planId).eq('user_id', me!));
      else must(await sb.from('plan_responses').upsert({ plan_id: planId, user_id: me!, rsvp, updated_at: new Date().toISOString() }));
    },
    vote: async (planId, optionIds, noneWork) => {
      await uid();
      must(
        await sb.from('plan_votes').upsert({ plan_id: planId, user_id: me!, option_ids: noneWork ? [] : optionIds, none_work: noneWork, updated_at: new Date().toISOString() }),
      );
    },
    comments: async (planId) =>
      must(await sb.from('comments').select('*').eq('plan_id', planId).order('created_at')) as Comment[],
    addComment: async (planId, text) => {
      await uid();
      must(await sb.from('comments').insert({ plan_id: planId, user_id: me!, text }));
    },
    notify: async (kind, planId) => {
      // Best effort: emails are optional and must never block the app.
      try {
        await sb.functions.invoke('notify', { body: { kind, plan_id: planId, app_url: redirect() } });
      } catch {
        /* function not deployed */
      }
    },
  };
}

// ---------------------------------------------------------------- Demo (in memory, no backend)

function makeDemoApi(): Api {
  const me = 'demo-me';
  let signedIn = true;
  const profiles: Record<string, Profile> = {
    [me]: { id: me, display_name: 'Cecilia', language: 'es', color: '#FF8FB1', email_opt_in: true },
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
  const cals: Record<string, Calendar> = {};
  const key = (o: string, c: string | null) => `${o}|${c ?? 'main'}`;
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
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

  let nid = 1;
  const newId = () => 'x' + nid++;
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const d = (n: number) => iso(addDays(new Date(), n));
  const plans: Plan[] = [
    {
      id: 'p1', group_id: 'g1', created_by: 'mich', type: 'dinner', title: 'Tacos night', place_text: 'Las Adelitas, Prague',
      place_maps_url: null, note: 'Bring cash', status: 'open', chosen_option_id: null, created_at: ago(30),
      options: [{ id: 'o1', date: d(9), slot: 'pm' }], invites: [me, 'mich', 'ana', 'lea'],
      responses: { mich: 'yes', ana: 'maybe' }, votes: {}, comments: [{ user_id: 'ana', created_at: ago(10) }],
    },
    {
      id: 'p2', group_id: 'g1', created_by: 'ana', type: 'trip', title: 'Český ráj hike', place_text: 'Hrubá Skála',
      place_maps_url: null, note: null, status: 'open', chosen_option_id: null, created_at: ago(60 * 26),
      options: [{ id: 'o2', date: d(17), slot: 'all' }, { id: 'o3', date: d(24), slot: 'all' }, { id: 'o4', date: d(31), slot: 'all' }],
      invites: [me, 'mich', 'ana', 'tomas', 'lea'], responses: {},
      votes: { ana: { option_ids: ['o2', 'o3'], none_work: false }, tomas: { option_ids: ['o3'], none_work: false } }, comments: [],
    },
    {
      id: 'p3', group_id: 'g1', created_by: me, type: 'drinks', title: 'Rooftop drinks', place_text: 'https://maps.app.goo.gl/example',
      place_maps_url: 'https://maps.app.goo.gl/example', note: null, status: 'confirmed', chosen_option_id: null, created_at: ago(60 * 72),
      options: [{ id: 'o5', date: d(2), slot: 'custom', time_from: '19:00', time_to: '22:00' }], invites: [me, 'mich', 'tomas'],
      responses: { [me]: 'yes', mich: 'yes', tomas: 'yes' }, votes: {}, comments: [],
    },
  ];
  const comments: Comment[] = [{ id: 'c1', plan_id: 'p1', user_id: 'ana', text: 'I might be late, start without me', created_at: ago(10) }];

  const fixedOption = (p: Plan) => (p.chosen_option_id ? p.options.find((o) => o.id === p.chosen_option_id) : p.options.length === 1 ? p.options[0] : undefined);
  const refreshBusy = (p: Plan | undefined, pid: string) => {
    for (const c of Object.keys(cals)) {
      if (!c.startsWith(me + '|')) continue;
      for (const [dt, m] of Object.entries(cals[c])) if (m.plan_id === pid) delete cals[c][dt];
    }
    if (!p || p.responses[me] !== 'yes') return;
    const o = fixedOption(p);
    if (!o) return;
    const calIds = [null, ...membership.filter((m) => m.user_id === me && m.calendar_mode === 'own').map((m) => m.group_id)];
    for (const cid of calIds) {
      const c = (cals[key(me, cid)] ??= {});
      if (c[o.date]?.status === 'away') continue;
      c[o.date] = { status: 'busy', slot: o.slot, time_from: o.time_from, time_to: o.time_to, plan_id: p.id };
    }
  };
  refreshBusy(plans[2], 'p3');

  const wait = () => new Promise((r) => setTimeout(r, 60));
  const listeners: (() => void)[] = [];
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

  return {
    demo: true,
    currentUserId: async () => (signedIn ? me : null),
    onAuthChange: (cb) => listeners.push(cb),
    watchGroup: () => () => {},
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
      return membership.filter((m) => m.user_id === me).map((m) => ({ ...groups.find((g) => g.id === m.group_id)!, calendar_mode: m.calendar_mode }));
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
      if (!membership.some((m) => m.group_id === g.id && m.user_id === me)) membership.push({ group_id: g.id, user_id: me, calendar_mode: 'main' });
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
      return Object.fromEntries(members.map((m) => [m.user_id, clone(cals[key(m.user_id, m.calendar_mode === 'own' ? gid : null)] ?? {})]));
    },
    myCalendar: async (calId) => clone(cals[key(me, calId)] ?? {}),
    setDays: async (calId, changes) => {
      const c = (cals[key(me, calId)] ??= {});
      for (const [dt, v] of Object.entries(changes)) {
        if (v) c[dt] = { ...v, plan_id: null };
        else delete c[dt];
      }
    },
    replaceCalendar: async (calId, cal) => {
      cals[key(me, calId)] = clone(cal);
    },
    plans: async (gid) => {
      await wait();
      return clone(plans.filter((p) => p.group_id === gid));
    },
    savePlan: async (input, id) => {
      const opts = input.options.map((o) => ({ ...o, id: newId() }));
      if (id) {
        const p = plans.find((x) => x.id === id)!;
        const same = (a: PlanOption, b: PlanOption) =>
          a.date === b.date && a.slot === b.slot && (a.time_from ?? null) === (b.time_from ?? null) && (a.time_to ?? null) === (b.time_to ?? null);
        const kept = opts.map((n) => p.options.find((o) => same(o, n)) ?? n);
        Object.assign(p, { ...input, options: kept });
        if (p.chosen_option_id && !p.options.some((o) => o.id === p.chosen_option_id)) p.chosen_option_id = null;
        refreshBusy(p, p.id);
        return id;
      }
      const p: Plan = { ...input, id: newId(), created_by: me, status: 'open', chosen_option_id: null, created_at: new Date().toISOString(), options: opts, responses: {}, votes: {}, comments: [] };
      plans.unshift(p);
      return p.id;
    },
    deletePlan: async (id) => {
      plans.splice(plans.findIndex((p) => p.id === id), 1);
      refreshBusy(undefined, id);
    },
    setPlanState: async (id, patch) => {
      const p = plans.find((x) => x.id === id)!;
      Object.assign(p, patch);
      refreshBusy(p, id);
    },
    respond: async (planId, rsvp) => {
      const p = plans.find((x) => x.id === planId)!;
      if (rsvp) p.responses[me] = rsvp;
      else delete p.responses[me];
      refreshBusy(p, planId);
    },
    vote: async (planId, optionIds, noneWork) => {
      plans.find((x) => x.id === planId)!.votes[me] = { option_ids: noneWork ? [] : optionIds, none_work: noneWork };
    },
    comments: async (planId) => clone(comments.filter((c) => c.plan_id === planId)),
    addComment: async (planId, text) => {
      const c = { id: newId(), plan_id: planId, user_id: me, text, created_at: new Date().toISOString() };
      comments.push(c);
      plans.find((x) => x.id === planId)!.comments.push({ user_id: me, created_at: c.created_at });
    },
    notify: async () => {},
  };
}
