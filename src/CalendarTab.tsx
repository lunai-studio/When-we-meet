import { useEffect, useState } from 'react';
import type { CalMode, Calendar, DayMark, Group, Lang, Member, Status, TimeSlot } from './types';
import { MonthGrid } from './MonthGrid';
import { prettyDate, sixMonths, todayIso, weekdayLong } from './dates';
import { sameMark as same, shortSlot, statusColor } from './logic';
import { SlotPicker } from './Plans';
import type { T } from './i18n';
import { Avatar, Sheet } from './ui';

type Tool = Status | 'erase';

interface Props {
  t: T;
  lang: Lang;
  me: string;
  group: Group & { calendar_mode: CalMode };
  otherMainGroups: number;
  members: Member[];
  avail: Record<string, Calendar>;
  mine: Calendar;
  mainCal: () => Promise<Calendar>;
  setDays: (changes: Record<string, DayMark | null>, msg: string) => void;
  setMode: (mode: CalMode) => Promise<void>;
  sync: (dir: 'toGroup' | 'toMain') => Promise<void>;
}

const diffCount = (a: Calendar, b: Calendar) => new Set([...Object.keys(a), ...Object.keys(b)].filter((d) => !same(a[d], b[d]))).size;

export function CalendarTab(p: Props) {
  const { t, lang } = p;
  const [view, setView] = useState<'mine' | 'everyone'>('mine');
  const months = sixMonths();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(months.map((x, i) => [`${x.y}-${x.m}`, i < 2])),
  );
  const [tool, setTool] = useState<Tool>('free');
  const [slot, setSlot] = useState<TimeSlot>({ slot: 'all' });
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [confirm, setConfirm] = useState<null | { dir: 'toGroup' | 'toMain'; n: number }>(null);

  useEffect(() => {
    if (!clearArmed) return;
    const id = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(id);
  }, [clearArmed]);

  const markFor = (): DayMark | null =>
    tool === 'erase' ? null : tool === 'away' ? { status: 'away', slot: 'all' } : { status: tool, ...slot, time_from: slot.slot === 'custom' ? slot.time_from : null, time_to: slot.slot === 'custom' ? slot.time_to : null };

  const onMark = (dates: string[], isDrag: boolean) => {
    const target = markFor();
    // Tapping/dragging from a day that already has this mark erases instead.
    const erase = target !== null && same(p.mine[dates[0]], target);
    const changes: Record<string, DayMark | null> = {};
    for (const d of dates) changes[d] = erase ? null : target;
    const n = dates.length;
    p.setDays(changes, isDrag || n > 1 ? (erase || !target ? t.cleared(n) : t.marked(n)) : '');
  };

  const repeat = (weekday: number) => {
    const target = markFor();
    const today = todayIso();
    const changes: Record<string, DayMark | null> = {};
    for (const { y, m } of months) {
      if (!open[`${y}-${m}`]) continue;
      const days = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dt = new Date(y, m, d);
        const s = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if ((dt.getDay() + 6) % 7 === weekday && s >= today) changes[s] = target;
      }
    }
    setRepeatOpen(false);
    const n = Object.keys(changes).length;
    p.setDays(changes, target ? t.marked(n) : t.cleared(n));
  };

  const clearAll = () => {
    if (!clearArmed) return setClearArmed(true);
    setClearArmed(false);
    const changes = Object.fromEntries(Object.keys(p.mine).map((d) => [d, null]));
    p.setDays(changes, t.cleared(Object.keys(changes).length));
  };

  const askSync = async (dir: 'toGroup' | 'toMain') => {
    const main = await p.mainCal();
    setConfirm({ dir, n: diffCount(main, p.mine) });
  };

  const tools: { k: Tool; label: string; color?: string }[] = [
    { k: 'free', label: t.free, color: statusColor.free },
    { k: 'busy', label: t.busy, color: statusColor.busy },
    { k: 'away', label: t.away, color: statusColor.away },
    { k: 'erase', label: t.erase },
  ];

  return (
    <div>
      <div className="seg" style={{ marginTop: 6 }}>
        <button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>
          {t.myDays}
        </button>
        <button className={view === 'everyone' ? 'on' : ''} onClick={() => setView('everyone')}>
          {t.everyone}
        </button>
      </div>

      {view === 'mine' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="label">{t.myCalendarHere}</div>
          <div className="seg" style={{ marginTop: 8 }}>
            <button className={p.group.calendar_mode === 'main' ? 'on' : ''} onClick={() => p.setMode('main')}>
              {t.mainCal}
            </button>
            <button className={p.group.calendar_mode === 'own' ? 'on' : ''} onClick={() => p.setMode('own')}>
              {t.ownCal}
            </button>
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {p.group.calendar_mode === 'main' ? t.mainHint : t.ownHint}
          </p>
          {p.group.calendar_mode === 'own' && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn grow small" onClick={() => askSync('toGroup')}>
                {t.syncMainToGroup}
              </button>
              <button className="btn grow small" onClick={() => askSync('toMain')}>
                {t.syncGroupToMain}
              </button>
            </div>
          )}
        </div>
      )}

      {view === 'mine' && <p className="muted small" style={{ margin: '12px 2px 0' }}>{t.dragHint}</p>}

      {months.map(({ y, m }) => {
        const k = `${y}-${m}`;
        return (
          <MonthGrid
            key={k}
            y={y}
            m={m}
            open={!!open[k]}
            onToggle={() => setOpen({ ...open, [k]: !open[k] })}
            lang={lang}
            t={t}
            mode={view}
            mine={p.mine}
            members={p.members}
            avail={p.avail}
            minPeople={p.group.min_people}
            onMark={onMark}
            onOpenDay={setDaySheet}
          />
        );
      })}

      {view === 'mine' && (
        <div className="row between" style={{ marginTop: 16 }}>
          <button className="link" onClick={() => setRepeatOpen(true)}>
            {t.repeatWeekly}
          </button>
          <button className="link" style={clearArmed ? { color: 'var(--busy)' } : undefined} onClick={clearAll}>
            {clearArmed ? t.clearConfirm : t.clearAll}
          </button>
        </div>
      )}

      {view === 'mine' && (
        <div className="toolbar">
          <div className="toolbar-inner">
            <div className="tools">
              {tools.map((x) => (
                <button key={x.k} className={'tool' + (tool === x.k ? ' on' : '')} onClick={() => setTool(x.k)}>
                  <span className="dot" style={{ background: x.color ?? 'transparent', border: x.color ? 0 : '1px solid var(--muted)' }} />
                  {x.label}
                </button>
              ))}
            </div>
            {(tool === 'free' || tool === 'busy') && <SlotPicker t={t} value={slot} onChange={setSlot} compact />}
          </div>
        </div>
      )}

      {daySheet && (
        <Sheet onClose={() => setDaySheet(null)}>
          <div className="big">{prettyDate(daySheet, lang)}</div>
          {(() => {
            const order = { free: 0, busy: 1, away: 2, none: 3 } as const;
            const rows = p.members
              .map((m) => ({ m, mk: p.avail[m.user_id]?.[daySheet] }))
              .sort((a, b) => order[a.mk?.status ?? 'none'] - order[b.mk?.status ?? 'none']);
            return (
              <div style={{ marginTop: 8 }}>
                {rows.map(({ m, mk }) => (
                  <div className="list-item" key={m.user_id}>
                    <Avatar p={m.profile} />
                    <span className="grow">
                      {m.profile.display_name}
                      {m.user_id === p.me && <span className="muted"> ({t.you})</span>}
                    </span>
                    <span className={'pill ' + (mk?.status ?? '')}>
                      {mk ? (mk.status === 'free' ? t.free : mk.status === 'busy' ? t.busy : t.away) : t.notMarked}
                      {mk && mk.slot !== 'all' ? ' · ' + shortSlot(mk) : ''}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </Sheet>
      )}

      {repeatOpen && (
        <Sheet onClose={() => setRepeatOpen(false)}>
          <div className="big">{t.repeatWeekly.replace('…', '')}</div>
          <p className="muted small">
            {t.repeatHint}:{' '}
            <b style={{ color: tool === 'erase' ? 'var(--text)' : statusColor[tool] }}>
              {tools.find((x) => x.k === tool)!.label}
              {(tool === 'free' || tool === 'busy') && slot.slot !== 'all' ? ' · ' + shortSlot(slot) : ''}
            </b>
          </p>
          {weekdayLong(lang).map((w, i) => (
            <button key={i} className="list-item" onClick={() => repeat(i)}>
              <span className="grow" style={{ textTransform: 'capitalize' }}>{w}</span>
              <span className="chev">›</span>
            </button>
          ))}
        </Sheet>
      )}

      {confirm && (
        <Sheet onClose={() => setConfirm(null)}>
          <div className="big">{t.areYouSure}</div>
          <p className="muted">
            {confirm.dir === 'toGroup' ? t.syncBody1(confirm.n) : t.syncBody2(confirm.n, p.otherMainGroups)}
          </p>
          <div className="row">
            <button className="btn grow" onClick={() => setConfirm(null)}>
              {t.cancel}
            </button>
            <button
              className="btn primary grow"
              onClick={async () => {
                const dir = confirm.dir;
                setConfirm(null);
                await p.sync(dir);
              }}
            >
              {t.yesReplace}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
