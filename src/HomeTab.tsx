import type { Calendar, Group, Lang, Member } from './types';
import { periodRange, prettyDate, todayIso } from './dates';
import { bestSlot, suggestions, upcomingDays } from './logic';
import type { T } from './i18n';
import { Avatar } from './ui';

interface Props {
  t: T;
  lang: Lang;
  group: Group;
  members: Member[];
  avail: Record<string, Calendar>;
  onEdit: () => void;
}

export function HomeTab({ t, lang, group, members, avail, onEdit }: Props) {
  const total = members.length;
  const min = group.min_people;
  const [, end] = periodRange(group.goal_period);
  const today = todayIso();
  const periodWord = group.goal_period === 'week' ? t.week : t.month;

  const goodLeft = upcomingDays(40).filter((d) => d >= today && d <= end && bestSlot(d, members, avail).free.length >= min).length;
  const all = suggestions(members, avail);
  const next = [...all].filter((s) => s.free.length >= min).sort((a, b) => a.date.localeCompare(b.date))[0];
  const top = all.slice(0, 3);
  const unmarked = members.filter((m) => !Object.keys(avail[m.user_id] ?? {}).some((d) => d >= today));
  const slotLabel = (s: string) => (s === 'am' ? t.am : s === 'pm' ? t.pm : t.allDay);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)!.profile;

  return (
    <div style={{ marginTop: 6 }}>
      <div className="card">
        <div className="row between">
          <span className="label">{t.goal}</span>
          <button className="link" style={{ padding: 0 }} onClick={onEdit}>
            {t.edit}
          </button>
        </div>
        <div style={{ fontWeight: 600, marginTop: 6 }}>{t.goalText(group.goal_count, periodWord)}</div>
        <div className={'small ' + (goodLeft >= group.goal_count ? 'good' : 'muted')} style={{ marginTop: 6 }}>
          {t.goodDaysLeft(goodLeft, periodWord)}
        </div>
      </div>

      <div className="card">
        <div className="label">{t.nextBest}</div>
        {next ? (
          <div className="row between" style={{ marginTop: 8 }}>
            <div>
              <div className="big good">{prettyDate(next.date, lang)}</div>
              <div className="muted small">
                {slotLabel(next.slot)} · {t.freeCount(next.free.length, total)}
              </div>
            </div>
            <div className="avatars">
              {next.free.map((id) => (
                <Avatar key={id} p={nameOf(id)} sm />
              ))}
            </div>
          </div>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {t.noneYet}
          </p>
        )}
      </div>

      {top.length > 0 && (
        <div className="card">
          <div className="label">{t.suggested}</div>
          {top.map((s, i) => (
            <div className="sugg" key={s.date}>
              <span className="rank">{i + 1}</span>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{prettyDate(s.date, lang)}</div>
                <div className={'small ' + (s.free.length >= min ? 'good' : 'muted')}>
                  {slotLabel(s.slot)} · {t.freeCount(s.free.length, total)}
                </div>
              </div>
              <div className="avatars">
                {s.free.map((id) => (
                  <Avatar key={id} p={nameOf(id)} sm />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="label">{t.notMarkedYet}</div>
        {unmarked.length ? (
          <div className="row wrap" style={{ marginTop: 10 }}>
            {unmarked.map((m) => (
              <span key={m.user_id} className="row" style={{ gap: 6 }}>
                <Avatar p={m.profile} sm />
                <span className="small">{m.profile.display_name}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {t.everybodyMarked}
          </p>
        )}
      </div>
    </div>
  );
}
