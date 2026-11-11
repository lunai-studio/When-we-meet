import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { dict } from './i18n';
import type { CalMode, Calendar, DayMark, Group, Lang, Member, Profile } from './types';
import { PALETTE } from './logic';
import { Avatar, Sheet, Toast } from './ui';
import { HomeTab } from './HomeTab';
import { CalendarTab } from './CalendarTab';

type MyGroup = Group & { calendar_mode: CalMode };
const ACTIVE_KEY = 'wwm.activeGroup';
const JOIN_KEY = 'wwm.pendingJoin';

// Remember an invite (?join=CODE) across the sign-in redirect.
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) {
  localStorage.setItem(JOIN_KEY, joinParam);
  const u = new URL(location.href);
  u.searchParams.delete('join');
  history.replaceState(null, '', u.toString());
}

const browserLang = (): Lang => (navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en');
const inviteUrl = (code: string) => `${location.origin}${import.meta.env.BASE_URL}?join=${code}`;
const codeFrom = (s: string) => {
  const m = s.match(/join=([a-z0-9]+)/i);
  return (m ? m[1] : s).trim().toLowerCase();
};

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'onboard' | 'ready'>('loading');
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lang, setLang] = useState<Lang>(browserLang());
  const t = dict[lang];

  const boot = useCallback(async () => {
    const id = await api.currentUserId();
    setUid(id);
    if (!id) return setPhase('login');
    const p = await api.getProfile(id);
    setProfile(p);
    if (p) setLang(p.language);
    setPhase(p ? 'ready' : 'onboard');
  }, []);

  useEffect(() => {
    boot();
    api.onAuthChange(() => boot());
  }, [boot]);

  if (phase === 'loading') return <div className="app center muted">…</div>;
  if (phase === 'login') return <Login lang={lang} setLang={setLang} />;
  if (phase === 'onboard')
    return (
      <Onboard
        lang={lang}
        onDone={async (name, color) => {
          const p: Profile = { id: uid!, display_name: name, color, language: lang };
          await api.saveProfile(p);
          setProfile(p);
          setPhase('ready');
        }}
      />
    );
  return (
    <Main
      profile={profile!}
      lang={lang}
      setLang={async (l) => {
        setLang(l);
        const p = { ...profile!, language: l };
        setProfile(p);
        await api.saveProfile(p);
      }}
      t={t}
    />
  );
}

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang">
      {(['en', 'es'] as Lang[]).map((l) => (
        <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Login({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = dict[lang];
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="app">
      <div className="row between" style={{ paddingTop: 16 }}>
        <span />
        <LangSwitch lang={lang} setLang={setLang} />
      </div>
      <div className="center stack">
        <div className="logo">
          When<b>We</b>Meet
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          {t.tagline}
        </p>
        {sent ? (
          <div className="card">{t.linkSent}</div>
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              try {
                await api.signInEmail(email);
                setSent(true);
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <input className="input" type="email" required placeholder={t.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary block">{t.sendLink}</button>
            <div className="label" style={{ textAlign: 'center' }}>
              {t.or}
            </div>
            <button type="button" className="btn block" onClick={() => api.signInGoogle().catch((x) => setErr(x.message))}>
              {t.google}
            </button>
          </form>
        )}
        {err && <p style={{ color: 'var(--busy)' }}>{err}</p>}
      </div>
    </div>
  );
}

function Onboard({ lang, onDone }: { lang: Lang; onDone: (name: string, color: string) => void }) {
  const t = dict[lang];
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  return (
    <div className="app center stack">
      <div className="big">{t.whatName}</div>
      <input className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="label">{t.pickColor}</div>
      <div className="colors">
        {PALETTE.map((c) => (
          <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
      <div className="row">
        <Avatar p={{ display_name: name || '?', color }} />
        <span>{name}</span>
      </div>
      <button className="btn primary block" disabled={!name.trim()} onClick={() => onDone(name.trim(), color)}>
        {t.continue}
      </button>
    </div>
  );
}

function Main({ profile, lang, setLang, t }: { profile: Profile; lang: Lang; setLang: (l: Lang) => void; t: (typeof dict)['en'] }) {
  const me = profile.id;
  const [groups, setGroups] = useState<MyGroup[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(localStorage.getItem(ACTIVE_KEY));
  const [members, setMembers] = useState<Member[]>([]);
  const [avail, setAvail] = useState<Record<string, Calendar>>({});
  const [mine, setMine] = useState<Calendar>({});
  const [tab, setTab] = useState<'home' | 'calendar'>('home');
  const [sheet, setSheet] = useState<null | 'groups' | 'settings' | 'account'>(null);
  const [toast, setToast] = useState<null | { msg: string; undo?: () => void }>(null);
  const toastTimer = useRef<number>();

  const group = groups?.find((g) => g.id === activeId) ?? groups?.[0] ?? null;

  const showToast = (msg: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };
  const fail = (e: unknown) => showToast(`${t.error}: ${(e as Error).message}`);

  const loadGroups = useCallback(async () => {
    let pending = localStorage.getItem(JOIN_KEY);
    if (pending) {
      localStorage.removeItem(JOIN_KEY);
      try {
        const g = await api.joinGroup(pending);
        localStorage.setItem(ACTIVE_KEY, g.id);
        setActiveId(g.id);
      } catch (e) {
        fail(e);
      }
      pending = null;
    }
    setGroups(await api.myGroups());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGroupData = useCallback(async (g: MyGroup) => {
    const mem = await api.members(g.id);
    const [a, m] = await Promise.all([api.groupAvailability(g.id, mem), api.myCalendar(g.calendar_mode === 'own' ? g.id : null)]);
    setMembers(mem);
    setAvail(a);
    setMine(m);
  }, []);

  useEffect(() => {
    loadGroups().catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadGroups]);

  useEffect(() => {
    if (group) loadGroupData(group).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, group?.calendar_mode, loadGroupData]);

  // Refresh when coming back to the app.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && group && loadGroupData(group).catch(() => {});
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [group, loadGroupData]);

  const switchTo = (id: string) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveId(id);
    setSheet(null);
  };

  if (!groups) return <div className="app center muted">…</div>;

  const header = (
    <header className="header">
      <button className="group-btn grow" onClick={() => setSheet('groups')}>
        <span>{group?.name ?? 'WhenWeMeet'}</span>
        <span className="chev">▾</span>
      </button>
      <LangSwitch lang={lang} setLang={setLang} />
      <button style={{ background: 'none', border: 0, padding: 0 }} onClick={() => setSheet('account')} aria-label={profile.display_name}>
        <Avatar p={profile} />
      </button>
    </header>
  );

  const calId = group?.calendar_mode === 'own' ? group.id : null;

  const setDays = (changes: Record<string, DayMark | null>, msg: string) => {
    const prev: Record<string, DayMark | null> = Object.fromEntries(Object.keys(changes).map((d) => [d, mine[d] ?? null]));
    const apply = async (ch: Record<string, DayMark | null>) => {
      setMine((cur) => {
        const next = { ...cur };
        for (const [d, v] of Object.entries(ch)) v ? (next[d] = v) : delete next[d];
        return next;
      });
      setAvail((cur) => {
        const next = { ...(cur[me] ?? {}) };
        for (const [d, v] of Object.entries(ch)) v ? (next[d] = v) : delete next[d];
        return { ...cur, [me]: next };
      });
      try {
        await api.setDays(calId, ch);
      } catch (e) {
        fail(e);
        if (group) loadGroupData(group);
      }
    };
    apply(changes);
    if (msg) showToast(msg, () => {
      setToast(null);
      apply(prev);
    });
  };

  return (
    <div className="app">
      {header}
      {api.demo && <div className="banner">{t.demo}</div>}

      {!group ? (
        <NoGroups
          t={t}
          onCreate={async (n) => {
            const g = await api.createGroup(n);
            await loadGroups();
            switchTo(g.id);
          }}
          onJoin={async (c) => {
            const g = await api.joinGroup(codeFrom(c));
            await loadGroups();
            switchTo(g.id);
          }}
          fail={fail}
        />
      ) : tab === 'home' ? (
        <HomeTab t={t} lang={lang} group={group} members={members} avail={avail} onEdit={() => setSheet('settings')} />
      ) : (
        <CalendarTab
          t={t}
          lang={lang}
          me={me}
          group={group}
          otherMainGroups={groups.filter((g) => g.calendar_mode === 'main' && g.id !== group.id).length}
          members={members}
          avail={avail}
          mine={mine}
          mainCal={() => api.myCalendar(null)}
          setDays={setDays}
          setMode={async (mode) => {
            if (mode === group.calendar_mode) return;
            try {
              if (mode === 'own') {
                const own = await api.myCalendar(group.id);
                if (!Object.keys(own).length) await api.replaceCalendar(group.id, await api.myCalendar(null));
              }
              await api.setCalendarMode(group.id, mode);
              await loadGroups();
            } catch (e) {
              fail(e);
            }
          }}
          sync={async (dir) => {
            try {
              const main = await api.myCalendar(null);
              const own = await api.myCalendar(group.id);
              const [target, before, src] = dir === 'toGroup' ? [group.id, own, main] : [null, main, own];
              await api.replaceCalendar(target, src);
              await loadGroupData(group);
              showToast(t.replaced, async () => {
                setToast(null);
                await api.replaceCalendar(target, before);
                await loadGroupData(group);
              });
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}

      {group && (
        <nav className="tabs">
          <div className="tabs-inner">
            <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>
              {t.home}
            </button>
            <button className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}>
              {t.calendar}
            </button>
          </div>
        </nav>
      )}

      {toast && <Toast msg={toast.msg} onUndo={toast.undo} undoLabel={t.undo} />}

      {sheet === 'groups' && (
        <GroupsSheet
          t={t}
          groups={groups}
          activeId={group?.id ?? null}
          onClose={() => setSheet(null)}
          onSwitch={switchTo}
          onCreate={async (n) => {
            const g = await api.createGroup(n);
            await loadGroups();
            switchTo(g.id);
          }}
          onJoin={async (c) => {
            const g = await api.joinGroup(codeFrom(c));
            await loadGroups();
            switchTo(g.id);
          }}
          onLeave={async () => {
            if (!group) return;
            await api.leaveGroup(group.id);
            localStorage.removeItem(ACTIVE_KEY);
            setActiveId(null);
            setSheet(null);
            await loadGroups();
          }}
          fail={fail}
        />
      )}

      {sheet === 'settings' && group && (
        <SettingsSheet
          t={t}
          group={group}
          onClose={() => setSheet(null)}
          onSave={async (patch) => {
            try {
              await api.updateGroup(group.id, patch);
              await loadGroups();
              setSheet(null);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}

      {sheet === 'account' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="row">
            <Avatar p={profile} />
            <span className="big">{profile.display_name}</span>
          </div>
          <button className="btn block" style={{ marginTop: 16 }} onClick={() => api.signOut()}>
            {t.signOut}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function NoGroups({ t, onCreate, onJoin, fail }: { t: (typeof dict)['en']; onCreate: (n: string) => Promise<unknown>; onJoin: (c: string) => Promise<unknown>; fail: (e: unknown) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <div className="stack" style={{ marginTop: 24 }}>
      <div className="big">{t.noGroupsTitle}</div>
      <p className="muted">{t.noGroupsBody}</p>
      <div className="row">
        <input className="input" placeholder={t.groupName} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim()).catch(fail)}>
          {t.create}
        </button>
      </div>
      <div className="row">
        <input className="input" placeholder={t.inviteCode} value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={!code.trim()} onClick={() => onJoin(code).catch(fail)}>
          {t.join}
        </button>
      </div>
    </div>
  );
}

function GroupsSheet(p: {
  t: (typeof dict)['en'];
  groups: MyGroup[];
  activeId: string | null;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreate: (n: string) => Promise<void>;
  onJoin: (c: string) => Promise<void>;
  onLeave: () => Promise<void>;
  fail: (e: unknown) => void;
}) {
  const { t } = p;
  const [mode, setMode] = useState<'list' | 'new' | 'join'>('list');
  const [val, setVal] = useState('');
  const [leaveArmed, setLeaveArmed] = useState(false);
  return (
    <Sheet onClose={p.onClose}>
      <div className="label">{t.myGroups}</div>
      {p.groups.map((g) => (
        <button key={g.id} className="list-item" onClick={() => p.onSwitch(g.id)}>
          <span className="grow" style={{ fontWeight: g.id === p.activeId ? 700 : 400 }}>
            {g.name}
          </span>
          {g.id === p.activeId && <span className="pill free">●</span>}
        </button>
      ))}
      {mode === 'list' ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn grow" onClick={() => setMode('new')}>
            {t.newGroup}
          </button>
          <button className="btn grow" onClick={() => setMode('join')}>
            {t.joinGroup}
          </button>
        </div>
      ) : (
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            (mode === 'new' ? p.onCreate(val.trim()) : p.onJoin(val)).catch(p.fail);
          }}
        >
          <input className="input" autoFocus placeholder={mode === 'new' ? t.groupName : t.inviteCode} value={val} onChange={(e) => setVal(e.target.value)} />
          <button className="btn primary" disabled={!val.trim()}>
            {mode === 'new' ? t.create : t.join}
          </button>
        </form>
      )}
      {p.activeId && (
        <button
          className="btn danger block"
          style={{ marginTop: 16 }}
          onClick={() => (leaveArmed ? p.onLeave().catch(p.fail) : setLeaveArmed(true))}
        >
          {leaveArmed ? t.leaveConfirm : t.leaveGroup}
        </button>
      )}
    </Sheet>
  );
}

function SettingsSheet({ t, group, onClose, onSave }: { t: (typeof dict)['en']; group: Group; onClose: () => void; onSave: (p: Partial<Group>) => void }) {
  const [name, setName] = useState(group.name);
  const [count, setCount] = useState(group.goal_count);
  const [period, setPeriod] = useState(group.goal_period);
  const [min, setMin] = useState(group.min_people);
  const [copied, setCopied] = useState(false);
  const link = inviteUrl(group.invite_code);
  return (
    <Sheet onClose={onClose}>
      <div className="big">{t.settings}</div>
      <div className="stack" style={{ marginTop: 12 }}>
        <div>
          <div className="label">{t.groupName}</div>
          <input className="input" style={{ marginTop: 6 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row wrap">
          <span>{t.goalPer}</span>
          <input className="input num" type="number" min={1} max={31} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          <span>{t.timesPer}</span>
          <div className="seg">
            {(['week', 'month'] as const).map((x) => (
              <button key={x} className={period === x ? 'on' : ''} onClick={() => setPeriod(x)}>
                {x === 'week' ? t.week : t.month}
              </button>
            ))}
          </div>
        </div>
        <div className="row wrap">
          <span>{t.goodDay}</span>
          <input className="input num" type="number" min={1} max={100} value={min} onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))} />
          <span>{t.peopleFree}</span>
        </div>
        <div>
          <div className="label">{t.inviteLink}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </div>
        <button className="btn primary block" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), goal_count: count, goal_period: period, min_people: min })}>
          {t.save}
        </button>
      </div>
    </Sheet>
  );
}
