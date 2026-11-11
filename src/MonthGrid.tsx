import { useEffect, useRef, useState } from 'react';
import type { Calendar, Lang, Member } from './types';
import { monthCells, monthName, todayIso, weekdayShort } from './dates';
import { bestSlot, statusColor } from './logic';
import type { T } from './i18n';

interface Props {
  y: number;
  m: number;
  open: boolean;
  onToggle: () => void;
  lang: Lang;
  t: T;
  mode: 'mine' | 'everyone';
  mine?: Calendar;
  members?: Member[];
  avail?: Record<string, Calendar>;
  minPeople?: number;
  /** mine: commit a tap (1 date) or a drag (many dates) */
  onMark?: (dates: string[], isDrag: boolean) => void;
  /** everyone: open the day sheet */
  onOpenDay?: (date: string) => void;
}

const HOLD_MS = 250;

export function MonthGrid(p: Props) {
  const today = todayIso();
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragSet, setDragSet] = useState<string[]>([]);
  const drag = useRef<{ active: boolean; dates: string[]; timer?: number; x: number; y: number; mouse: boolean }>({
    active: false,
    dates: [],
    x: 0,
    y: 0,
    mouse: false,
  });
  const suppressClick = useRef(0);
  const editable = p.mode === 'mine';

  const dateAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-date]') as HTMLElement | null;
    const d = el?.dataset.date;
    return d && d >= today ? d : null;
  };
  const add = (d: string | null) => {
    if (!d || drag.current.dates.includes(d)) return;
    drag.current.dates.push(d);
    setDragSet([...drag.current.dates]);
  };
  const finish = () => {
    const st = drag.current;
    clearTimeout(st.timer);
    if (st.active && st.dates.length) {
      suppressClick.current = Date.now();
      p.onMark?.([...st.dates], st.dates.length > 1);
    }
    st.active = false;
    st.mouse = false;
    st.dates = [];
    setDragSet([]);
  };

  // Touch: hold ~0.25s then drag; a quick swipe still scrolls.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !editable) return;
    const onStart = (e: TouchEvent) => {
      const d = (e.target as HTMLElement).closest('[data-date]') as HTMLElement | null;
      if (!d || !d.dataset.date || d.dataset.date < today || e.touches.length > 1) return;
      const st = drag.current;
      st.x = e.touches[0].clientX;
      st.y = e.touches[0].clientY;
      st.dates = [];
      clearTimeout(st.timer);
      st.timer = window.setTimeout(() => {
        st.active = true;
        add(d.dataset.date!);
        navigator.vibrate?.(8);
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      const st = drag.current;
      const t0 = e.touches[0];
      if (!st.active) {
        if (Math.hypot(t0.clientX - st.x, t0.clientY - st.y) > 8) clearTimeout(st.timer);
        return;
      }
      e.preventDefault();
      add(dateAt(t0.clientX, t0.clientY));
    };
    const onEnd = () => {
      if (drag.current.active) finish();
      else clearTimeout(drag.current.timer);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  });

  // Mouse: press and drag.
  useEffect(() => {
    const up = () => drag.current.mouse && finish();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  const cells = monthCells(p.y, p.m);
  const total = p.members?.length ?? 0;

  return (
    <section className="month">
      <button className="month-head" onClick={p.onToggle} aria-expanded={p.open}>
        <span>{monthName(p.y, p.m, p.lang)}</span>
        <span className="chev">{p.open ? '▾' : '▸'}</span>
      </button>
      {p.open && (
        <div className="grid" ref={gridRef} style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}>
          {weekdayShort(p.lang).map((w, i) => (
            <div key={i} className="wd label">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="pad" />;
            const past = d < today;
            const num = Number(d.slice(8));
            const cls = ['day'];
            if (past) cls.push('past');
            if (d === today) cls.push('today');
            if (dragSet.includes(d)) cls.push('drag');

            if (p.mode === 'mine') {
              const mk = p.mine?.[d];
              if (mk) cls.push(mk.status);
              return (
                <button
                  key={d}
                  data-date={d}
                  className={cls.join(' ')}
                  disabled={past}
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'mouse' || past) return;
                    drag.current = { active: true, mouse: true, dates: [], x: 0, y: 0 };
                    add(d);
                  }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse' && drag.current.mouse) add(d >= today ? d : null);
                  }}
                  onClick={() => {
                    if (Date.now() - suppressClick.current < 500) return;
                    p.onMark?.([d], false);
                  }}
                >
                  {num}
                  {mk && mk.slot !== 'all' && <span className="slot">{mk.slot.toUpperCase()}</span>}
                </button>
              );
            }

            const best = bestSlot(d, p.members!, p.avail!);
            const n = best.free.length;
            if (!past && n >= (p.minPeople ?? 2)) cls.push('met');
            return (
              <button key={d} data-date={d} className={cls.join(' ')} onClick={() => p.onOpenDay?.(d)}>
                {num}
                {total > 0 && !past && <span className="cnt">{n}</span>}
                {!past && (
                  <span className="bars">
                    {p.members!.map((mm) => {
                      const s = p.avail![mm.user_id]?.[d]?.status;
                      return <i key={mm.user_id} style={s ? { background: statusColor[s] } : undefined} />;
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
