import { useEffect, useState } from 'react';
import { api } from './api';
import type { Comment, Lang, Member, Plan, PlanInput, PlanType, Rsvp, Slot, TimeSlot } from './types';
import { PLAN_TYPES } from './types';
import type { T } from './i18n';
import { prettyDate, todayIso } from './dates';
import { fixedOption, isPast, mapsUrl, needsMyAnswer, phaseOf, planDate, slotText, voteTally } from './logic';
import { Avatar, Sheet } from './ui';

type Opt = TimeSlot & { date: string };

export interface PlanDraft {
  options: Opt[];
  title?: string;
}

const labels = (t: T) => ({ all: t.allDay, am: t.am, pm: t.pm });
const whenText = (o: Opt, t: T, lang: Lang) => `${prettyDate(o.date, lang)} · ${slotText(o, labels(t))}`;

// ============================================================ List

export function PlansTab(p: {
  t: T;
  lang: Lang;
  me: string;
  plans: Plan[];
  members: Member[];
  seenAt: string;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, me } = p;
  const waiting = p.plans.filter((x) => needsMyAnswer(x, me));
  const rest = p.plans.filter((x) => !needsMyAnswer(x, me));
  const upcoming = rest.filter((x) => !isPast(x)).sort((a, b) => planDate(a).localeCompare(planDate(b)));
  const past = rest.filter(isPast).sort((a, b) => planDate(b).localeCompare(planDate(a)));

  const section = (title: string, list: Plan[]) =>
    list.length > 0 && (
      <>
        <div className="label" style={{ margin: '18px 2px 8px' }}>
          {title}
        </div>
        {list.map((x) => (
          <PlanCard key={x.id} {...p} plan={x} />
        ))}
      </>
    );

  return (
    <div style={{ marginTop: 6 }}>
      <button className="btn primary block" onClick={p.onNew}>
        {t.newPlan}
      </button>
      {p.plans.length === 0 && (
        <p className="muted" style={{ marginTop: 20 }}>
          {t.noPlans}
        </p>
      )}
      {section(t.waitingForYou, waiting)}
      {section(t.upcoming, upcoming)}
      {section(t.pastPlans, past)}
      <div style={{ height: 8 }} />
    </div>
  );
}

function PlanCard({ t, lang, me, plan, members, seenAt, onOpen }: { t: T; lang: Lang; me: string; plan: Plan; members: Member[]; seenAt: string; onOpen: (id: string) => void }) {
  const phase = phaseOf(plan);
  const fixed = fixedOption(plan);
  const isNew = plan.created_at > seenAt && plan.created_by !== me;
  const newComments = plan.comments.filter((c) => c.created_at > seenAt && c.user_id !== me).length;
  const yes = Object.values(plan.responses).filter((r) => r === 'yes').length;
  const creator = members.find((m) => m.user_id === plan.created_by)?.profile;
  return (
    <button className="card plan-card" onClick={() => onOpen(plan.id)}>
      <div className="row between">
        <span className="label">{t.types[plan.type]}</span>
        <span className="row" style={{ gap: 6 }}>
          {isNew && <span className="pill new">{t.newBadge}</span>}
          <PhasePill t={t} phase={phase} />
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, marginTop: 6 }}>{plan.title}</div>
      <div className="muted small" style={{ marginTop: 4 }}>
        {fixed ? whenText(fixed, t, lang) : plan.options.map((o) => prettyDate(o.date, lang)).join(' · ')}
      </div>
      <div className="row between small" style={{ marginTop: 8 }}>
        <span className="muted">
          {phase === 'voting' ? t.votes(Object.keys(plan.votes).length) : `${yes} ${t.imIn.toLowerCase()}`}
          {creator ? ` · ${t.byName(creator.display_name)}` : ''}
        </span>
        <span className={newComments ? 'new-text' : 'muted'}>
          {plan.comments.length > 0 && `${plan.comments.length} ${t.comments.toLowerCase()}`}
          {newComments > 0 && ` · ${newComments} ${t.newBadge.toLowerCase()}`}
        </span>
      </div>
    </button>
  );
}

function PhasePill({ t, phase }: { t: T; phase: ReturnType<typeof phaseOf> }) {
  if (phase === 'on') return <span className="pill on">{t.itsOn}</span>;
  if (phase === 'voting') return <span className="pill maybe">{t.voting}</span>;
  return <span className="pill">{t.waiting}</span>;
}

// ============================================================ Detail

export function PlanSheet(p: {
  t: T;
  lang: Lang;
  me: string;
  plan: Plan;
  members: Member[];
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  toast: (msg: string) => void;
  fail: (e: unknown) => void;
}) {
  const { t, lang, me, plan, members } = p;
  const phase = phaseOf(plan);
  const fixed = fixedOption(plan);
  const mine = plan.created_by === me;
  const invited = plan.invites.includes(me);
  const prof = (id: string) => members.find((m) => m.user_id === id)?.profile ?? { display_name: '?', color: '#9C9AB0' };
  const maps = mapsUrl(plan.place_text, plan.place_maps_url);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [delArmed, setDelArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const myVote = plan.votes[me];
  const [picked, setPicked] = useState<string[]>(myVote?.option_ids ?? []);

  useEffect(() => {
    api.comments(plan.id).then(setComments).catch(p.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.comments.length]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await p.onChanged();
    } catch (e) {
      p.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const whatsapp = () => {
    const lines = [
      `${plan.title} (${t.types[plan.type]})`,
      fixed ? whenText(fixed, t, lang) : plan.options.map((o) => whenText(o, t, lang)).join(' / '),
      plan.place_text && !/^https?:/i.test(plan.place_text) ? plan.place_text : null,
      maps,
      plan.note,
      '',
      `${t.answerIn}: ${location.origin}${import.meta.env.BASE_URL}`,
    ].filter((x) => x !== null && x !== undefined) as string[];
    navigator.clipboard?.writeText(lines.join('\n'));
    p.toast(t.copied);
  };

  // Keep options in date order so they don't jump around while people vote; highlight the leader.
  const sorted = voteTally(plan);
  const top = sorted[0]?.voters.length ?? 0;
  const tally = [...sorted].sort((a, b) => a.o.date.localeCompare(b.o.date));

  return (
    <Sheet onClose={p.onClose}>
      <div className="row between">
        <span className="label">{t.types[plan.type]}</span>
        <PhasePill t={t} phase={phase} />
      </div>
      <div className="big" style={{ marginTop: 6 }}>
        {plan.title}
      </div>
      {fixed && <div className={phase === 'on' ? 'on-text' : 'muted'} style={{ marginTop: 4, fontWeight: 600 }}>{whenText(fixed, t, lang)}</div>}
      {plan.place_text && !/^https?:/i.test(plan.place_text) && <div style={{ marginTop: 10 }}>{plan.place_text}</div>}
      {maps && (
        <a className="btn block maps" href={maps} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
          {t.openMaps}
        </a>
      )}
      {plan.note && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{plan.note}</p>}

      {/* Voting */}
      {phase === 'voting' && (
        <div style={{ marginTop: 16 }}>
          <div className="label">{t.dateOptions}</div>
          {invited && <p className="muted small">{t.voteHint}</p>}
          {tally.map(({ o, voters }) => {
            const on = picked.includes(o.id);
            return (
              <div key={o.id} className="vote-row">
                <button
                  className={'check' + (on ? ' on' : '')}
                  disabled={!invited || busy}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== o.id) : [...picked, o.id])}
                  aria-pressed={on}
                >
                  {on ? '✓' : ''}
                </button>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{whenText(o, t, lang)}</div>
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <span className={'small ' + (voters.length && voters.length === top ? 'good' : 'muted')}>{t.votes(voters.length)}</span>
                    <span className="avatars">
                      {voters.map((u) => (
                        <Avatar key={u} p={prof(u)} sm />
                      ))}
                    </span>
                  </div>
                </div>
                {mine && (
                  <button className="btn orange small" disabled={busy} onClick={() => run(async () => {
                    await api.setPlanState(plan.id, { chosen_option_id: o.id });
                    api.notify('locked', plan.id);
                  })}>
                    {t.lockIn}
                  </button>
                )}
              </div>
            );
          })}
          {invited && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className={'btn grow' + (myVote?.none_work ? ' sel' : '')} disabled={busy} onClick={() => run(() => api.vote(plan.id, [], true).then(() => setPicked([])))}>
                {t.noneWork}
              </button>
              <button className="btn primary grow" disabled={busy || !picked.length} onClick={() => run(() => api.vote(plan.id, picked, false))}>
                {t.save}
              </button>
            </div>
          )}
          {Object.entries(plan.votes).some(([, v]) => v.none_work) && (
            <div className="row small muted" style={{ marginTop: 8, gap: 6 }}>
              {t.noneWork}:
              {Object.entries(plan.votes)
                .filter(([, v]) => v.none_work)
                .map(([u]) => (
                  <Avatar key={u} p={prof(u)} sm />
                ))}
            </div>
          )}
        </div>
      )}

      {/* Answers */}
      {phase !== 'voting' && (
        <div style={{ marginTop: 16 }}>
          {invited ? (
            <div className="rsvp">
              {(['yes', 'maybe', 'no'] as Rsvp[]).map((r) => (
                <button
                  key={r}
                  disabled={busy}
                  className={'btn grow rsvp-' + r + (plan.responses[me] === r ? ' sel' : '')}
                  onClick={() => run(() => api.respond(plan.id, plan.responses[me] === r ? null : r))}
                >
                  {r === 'yes' ? t.imIn : r === 'maybe' ? t.maybe : t.cant}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">{t.onlyInvited}</p>
          )}
          <div style={{ marginTop: 10 }}>
            {plan.invites.map((u) => {
              const r = plan.responses[u];
              return (
                <div className="list-item" key={u}>
                  <Avatar p={prof(u)} sm />
                  <span className="grow">
                    {prof(u).display_name}
                    {u === me && <span className="muted"> ({t.you})</span>}
                  </span>
                  <span className={'pill ' + (r === 'yes' ? 'free' : r === 'maybe' ? 'maybe' : r === 'no' ? 'busy' : '')}>
                    {r === 'yes' ? t.imIn : r === 'maybe' ? t.maybe : r === 'no' ? t.cant : t.noAnswer}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Creator actions */}
      {mine && (
        <div className="row wrap" style={{ marginTop: 14 }}>
          <button className="btn grow" onClick={p.onEdit}>
            {t.edit}
          </button>
          {phase === 'answering' && (
            <button className="btn orange grow" disabled={busy} onClick={() => run(async () => {
              await api.setPlanState(plan.id, { status: 'confirmed' });
              api.notify('confirmed', plan.id);
            })}>
              {t.confirm}
            </button>
          )}
          {(phase === 'on' || (phase === 'answering' && plan.options.length > 1)) && (
            <button
              className="btn grow"
              disabled={busy}
              onClick={() => run(() => api.setPlanState(plan.id, phase === 'on' ? { status: 'open' } : { chosen_option_id: null }))}
            >
              {t.reopen}
            </button>
          )}
        </div>
      )}

      <button className="btn block" style={{ marginTop: 10 }} onClick={whatsapp}>
        {t.copyWhatsApp}
      </button>

      {/* Comments */}
      <div className="label" style={{ marginTop: 20 }}>
        {t.comments}
      </div>
      {comments?.map((c) => (
        <div key={c.id} className="comment">
          <Avatar p={prof(c.user_id)} sm />
          <div className="grow">
            <div className="small">
              <b>{prof(c.user_id).display_name}</b>{' '}
              <span className="muted">
                {new Date(c.created_at).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.text}</div>
          </div>
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          if (!v) return;
          setText('');
          run(() => api.addComment(plan.id, v));
        }}
      >
        <input className="input" placeholder={t.writeComment} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!text.trim()}>
          {t.send}
        </button>
      </form>

      {mine && (
        <button
          className="btn danger block"
          style={{ marginTop: 20 }}
          onClick={() => (delArmed ? run(async () => { await api.deletePlan(plan.id); p.onClose(); }) : setDelArmed(true))}
        >
          {delArmed ? t.deleteConfirm : t.deletePlan}
        </button>
      )}
    </Sheet>
  );
}

// ============================================================ Create / edit

const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function PlanForm(p: {
  t: T;
  lang: Lang;
  me: string;
  groupId: string;
  members: Member[];
  plan?: Plan;
  draft?: PlanDraft;
  onClose: () => void;
  onSaved: (id: string, created: boolean, multi: boolean) => void;
  fail: (e: unknown) => void;
}) {
  const { t, plan } = p;
  const [type, setType] = useState<PlanType>(plan?.type ?? 'dinner');
  const [title, setTitle] = useState(plan?.title ?? p.draft?.title ?? '');
  const [place, setPlace] = useState(plan?.place_text ?? '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [opts, setOpts] = useState<Opt[]>(
    plan?.options.map(({ date, slot, time_from, time_to }) => ({ date, slot, time_from, time_to })) ??
      p.draft?.options ?? [{ date: nextFriday(), slot: 'pm' }],
  );
  const allIds = p.members.map((m) => m.user_id);
  const [invites, setInvites] = useState<string[]>(plan?.invites ?? allIds);
  const [saving, setSaving] = useState(false);
  const maps = mapsUrl(place);
  const everyone = allIds.every((u) => invites.includes(u));

  const setOpt = (i: number, patch: Partial<Opt>) => setOpts(opts.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const valid =
    title.trim() &&
    opts.length > 0 &&
    opts.every((o) => o.date && (o.slot !== 'custom' || (o.time_from && o.time_to && o.time_to > o.time_from))) &&
    invites.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const isUrl = /^https?:\/\//i.test(place.trim());
      const input: PlanInput = {
        group_id: p.groupId,
        type,
        title: title.trim(),
        place_text: place.trim() || null,
        place_maps_url: isUrl ? place.trim() : null,
        note: note.trim() || null,
        options: opts.map((o) => (o.slot === 'custom' ? o : { date: o.date, slot: o.slot, time_from: null, time_to: null })),
        invites: invites.includes(p.me) ? invites : [p.me, ...invites],
      };
      const id = await api.savePlan(input, plan?.id);
      p.onSaved(id, !plan, opts.length > 1);
    } catch (e) {
      p.fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet onClose={p.onClose}>
      <div className="big">{plan ? t.editPlan : t.newPlan}</div>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="chips">
          {PLAN_TYPES.map((x) => (
            <button key={x} className={'chip' + (type === x ? ' on' : '')} onClick={() => setType(x)}>
              {t.types[x]}
            </button>
          ))}
        </div>
        <input className="input" placeholder={t.title} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div>
          <input className="input" placeholder={t.placeHint} value={place} onChange={(e) => setPlace(e.target.value)} />
          {maps && (
            <a className="link" href={maps} target="_blank" rel="noreferrer">
              {t.checkMaps} ↗
            </a>
          )}
        </div>
        <textarea className="input" rows={2} placeholder={t.note} value={note} onChange={(e) => setNote(e.target.value)} />

        <div>
          <div className="label">{t.dateOptions}</div>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>
            {t.oneDateHint}
          </p>
          {opts.map((o, i) => (
            <div key={i} className="opt-row">
              <div className="row">
                <input className="input" type="date" min={todayIso()} value={o.date} onChange={(e) => setOpt(i, { date: e.target.value })} />
                {opts.length > 1 && (
                  <button className="btn" aria-label="remove" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
              <SlotPicker t={t} value={o} onChange={(v) => setOpt(i, v)} />
            </div>
          ))}
          <button className="link" onClick={() => setOpts([...opts, { ...opts[opts.length - 1] }])}>
            + {t.addDate}
          </button>
        </div>

        <div>
          <div className="row between">
            <span className="label">{t.whoInvited}</span>
            <button className="link" style={{ padding: 0 }} onClick={() => setInvites(everyone ? [p.me] : allIds)}>
              {t.everyoneBtn}
            </button>
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {p.members.map((m) => {
              const on = invites.includes(m.user_id);
              return (
                <button
                  key={m.user_id}
                  className={'chip person' + (on ? ' on' : '')}
                  disabled={m.user_id === p.me}
                  onClick={() => setInvites(on ? invites.filter((u) => u !== m.user_id) : [...invites, m.user_id])}
                >
                  <Avatar p={m.profile} sm /> {m.profile.display_name}
                </button>
              );
            })}
          </div>
        </div>

        <button className="btn primary block" disabled={!valid || saving} onClick={save}>
          {plan ? t.saveChanges : t.createPlan}
        </button>
      </div>
    </Sheet>
  );
}

export function SlotPicker({ t, value, onChange, compact }: { t: T; value: TimeSlot; onChange: (v: TimeSlot) => void; compact?: boolean }) {
  return (
    <div>
      <div className={'seg' + (compact ? ' slots' : '')} style={compact ? undefined : { marginTop: 6 }}>
        {(['all', 'am', 'pm', 'custom'] as Slot[]).map((s) => (
          <button
            key={s}
            className={value.slot === s ? 'on' : ''}
            onClick={() =>
              onChange(s === 'custom' ? { slot: s, time_from: value.time_from ?? '18:00', time_to: value.time_to ?? '21:00' } : { slot: s, time_from: null, time_to: null })
            }
          >
            {s === 'all' ? t.allDay : s === 'am' ? t.am : s === 'pm' ? t.pm : t.custom}
          </button>
        ))}
      </div>
      {value.slot === 'custom' && (
        <div className="row" style={{ marginTop: 6 }}>
          <label className="row grow small muted" style={{ gap: 6 }}>
            {t.from}
            <input className="input time" type="time" value={value.time_from ?? ''} onChange={(e) => onChange({ ...value, time_from: e.target.value })} />
          </label>
          <label className="row grow small muted" style={{ gap: 6 }}>
            {t.to}
            <input className="input time" type="time" value={value.time_to ?? ''} onChange={(e) => onChange({ ...value, time_to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
