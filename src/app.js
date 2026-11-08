/* WhenWeMeet: the app itself (groups, calendar, plans).
   Ported from the WhenWeMeet artifact. Differences:
   - data lives in Firebase, private per group (see firestore.rules)
   - groups are invite-only: you join through a link, nobody browses a list of groups
   - plans happen at a specific time (or all day), with "add to calendar" */
import { t, LANG, setLang, cap } from './i18n.js';
import * as B from './backend.js';
import { THEMES, THEME, setTheme, themeName, swatchHTML } from './theme.js';

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dparse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TODAY, TK;
function setToday() { TODAY = new Date(); TODAY.setHours(0, 0, 0, 0); TK = dkey(TODAY); }
setToday();
const wdIdx = (d) => (d.getDay() + 6) % 7;
const monthName = (d) => cap(d.toLocaleDateString(LANG, { month: 'long' }));
const wdShort = (i) => cap(new Date(2024, 0, 1 + i).toLocaleDateString(LANG, { weekday: 'short' }).replace('.', '')).slice(0, 2);
const wdLong = (i) => new Date(2024, 0, 1 + i).toLocaleDateString(LANG, { weekday: 'long' });
const fmtDay = (k) => cap(dparse(k).toLocaleDateString(LANG, { weekday: 'short', day: 'numeric', month: 'short' }));
const SLOTS = ['all', 'am', 'pm', 'custom'];
const SK = (v) => ({ morning: 'am', afternoon: 'pm', evening: 'pm' }[v] || v || 'all');
const slotName = (s) => ({ all: t('All day'), am: 'AM', pm: 'PM', custom: t('Between') }[SK(s)]);
const slotLabel = (e) => (e.t === 'custom' ? `${e.from || '?'}–${e.to || '?'}` : slotName(e.t));
const slotShort = (e) => (e.t === 'custom' ? `${(e.from || '').slice(0, 2)}–${(e.to || '').slice(0, 2)}` : { all: t('ALL DAY'), am: 'AM', pm: 'PM' }[SK(e.t)]);
const TYPES = ['Dinner', 'Drinks', 'Party', 'Trip', 'Gym', 'Movie', 'Coffee', 'Date night', 'Club', 'Other'];
const PALETTE = ['#C084FC', '#3DDC97', '#F2C14E', '#60A5FA', '#F472B6', '#FB923C', '#A3E635', '#22D3EE', '#E879F9', '#FCA5A5'];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const colorOf = (id) => PALETTE[hash(id) % PALETTE.length];
export const EMOJIS = ['🦊', '🐼', '🐙', '🦄', '🐸', '🐯', '🐨', '🦉', '🐝', '🐻', '🐶', '🐱', '🌵', '🌻', '🍉', '🍕', '🚀', '⚡', '🎸', '🌙', '🔥', '🍀', '🎨', '🙋'];
const GROUP_EMOJIS = ['🍻', '💑', '📚', '🏃', '🎲', '🍽️', '⚽', '🎉', '👨‍👩‍👧', '💼', '🎸', '🧘'];
const defEmoji = (id) => EMOJIS[hash(id + 'e') % (EMOJIS.length - 1)];
const initials = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function norm(e) { if (!e) return null; return e.s === 'free' || e.s === 'away' || e.s === 'busy' ? e : null; }
const markedCount = (days, prefix) => Object.entries(days || {}).filter(([k, e]) => k >= TK && (!prefix || k.startsWith(prefix)) && norm(e)).length;
function covers(e, slot) {
  if (!e) return false; const ty = SK(e.t); if (ty === 'all' || ty === slot) return true;
  if (ty === 'custom') { const f = parseInt(e.from || '0', 10), to = parseInt(e.to || '24', 10) || 24; const r = { am: [6, 12], pm: [12, 24] }[slot]; return f < r[1] && to > r[0]; }
  return false;
}
const randCode = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

/* ---------- plan times ----------
   An option is {date, allDay, time:'19:30', end:'22:00'|''}. */
const DEFAULT_TIME = { am: '10:00', pm: '19:00', all: '19:00', custom: '19:00' };
const addHours = (hm, h) => { const [a, b] = (hm || '19:00').split(':').map(Number); return `${pad(Math.min(23, a + h))}:${pad(b)}`; };
const optSlot = (o) => (o.allDay ? 'all' : parseInt(o.time || '19', 10) < 12 ? 'am' : 'pm');
const timeLabel = (o) => (o.allDay ? t('All day') : `${o.time || '?'}${o.end ? '–' + o.end : ''}`);
const optLabel = (o) => `${fmtDay(o.date)} · ${timeLabel(o)}`;
function optFromSlot(date, slot) { return slot === 'all' ? { date, allDay: true, time: '', end: '' } : { date, allDay: false, time: DEFAULT_TIME[slot] || '19:00', end: '' }; }
function freeAt(o) { return dayPeople(o.date).free.filter((x) => o.allDay || covers(x.e, optSlot(o))); }

/* ---------- state ---------- */
const S = {
  mode: 'off', me: null, user: null, profile: null, groups: {}, gid: null, gAvail: {}, plans: {}, comments: {},
  tab: 'home', calView: 'mine', brush: { s: 'free', t: 'all', from: '18:00', to: '22:00' }, open: null, sheet: null, draft: null,
  gotProfile: false, gotGroups: false, pendingInvite: null, preferGid: null,
};
try {
  S.tab = localStorage.getItem('wwm.tab') || 'home'; S.calView = localStorage.getItem('wwm.calView') || 'mine'; S.gid = localStorage.getItem('wwm.group') || null;
  const o = JSON.parse(localStorage.getItem('wwm.open') || 'null'); if (o && o.at === TK.slice(0, 7)) S.open = new Set(o.keys);
} catch (e) {}
function rememberUI() {
  if (S.mode !== 'live') return;
  try {
    localStorage.setItem('wwm.tab', S.tab); localStorage.setItem('wwm.calView', S.calView);
    if (S.gid) localStorage.setItem('wwm.group', S.gid); if (S.open) localStorage.setItem('wwm.open', JSON.stringify({ at: TK.slice(0, 7), keys: [...S.open] }));
  } catch (e) {}
}
let SEEN = 0; try { SEEN = +localStorage.getItem('wwm.seen') || 0; localStorage.setItem('wwm.seen', String(Date.now())); } catch (e) {}
const isNew = (at, by) => SEEN && at > SEEN && by !== S.me;

const G = () => S.groups[S.gid];
const inGroup = (g, id) => !!(g && g.members && g.members[id]);
const myGroups = () => Object.entries(S.groups).filter(([, g]) => inGroup(g, S.me)).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
const memberIds = (g = G()) => (g ? Object.keys(g.members || {}).sort((a, b) => (g.members[a].joinedAt || 0) - (g.members[b].joinedAt || 0)) : []);
const myName = () => S.profile?.name || '';
const rawName = (id) => (id === S.me ? myName() : G()?.members?.[id]?.name || '');
const nameOf = (id) => (id === S.me ? t('You') : rawName(id) || t('Someone'));
/* every person = an emoji on their own color, the same in every view */
function person(id, g = G()) {
  const m = id === S.me ? { name: myName(), emoji: S.profile?.emoji, color: S.profile?.color } : g?.members?.[id] || {};
  return { name: m.name || '', emoji: m.emoji || defEmoji(id), color: m.color || colorOf(id) };
}
const gEmoji = (g) => (g?.emoji ? g.emoji + ' ' : '');
const modeOf = (id, g = G()) => (g?.members?.[id]?.availMode === 'own' ? 'own' : 'main');
const daysOf = (id) => (id === S.me && modeOf(id) === 'main' ? S.profile?.mainDays || {} : S.gAvail[id]?.days || {});
const myDays = () => (S.me ? daysOf(S.me) : {});
const mainUsers = (id) => myGroups().filter(([, g]) => modeOf(id, g) === 'main').length;
const isGroupOwner = () => G()?.createdBy === S.me;
const need = () => { const g = G(), n = memberIds().length; return Math.max(2, Math.min(g?.minPeople || 3, n || 2)); };
function faceHTML(id, g) { const p = person(id, g); return `<span class="avatar emo" style="background:${p.color}" title="${esc(p.name)}">${p.emoji}</span>`; }
const chipHTML = (id) => `<span class="pchip" style="--pc:${person(id).color}">${faceHTML(id)}${esc(nameOf(id))}</span>`;
const commentsFor = (pid) => Object.entries(S.comments).map(([id, c]) => ({ id, ...c })).filter((c) => c.planId === pid).sort((a, b) => a.at - b.at);
const live = () => S.mode === 'live';
const gp = (p) => `groups/${S.gid}/${p}`;
const inviteUrl = (code) => `${location.origin}${location.pathname}#/join/${code}`;

/* ---------- writes ---------- */
const timers = {}, inflight = {};
function setSaving() { const el = $('#saving'); if (el) el.hidden = !(Object.keys(timers).length || Object.values(inflight).some(Boolean)); }
const busyKey = (k) => !!timers[k] || !!inflight[k];
/* debounced write: the latest fn for a key wins */
function later(key, fn, delay = 600) {
  if (!live()) return; clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => { delete timers[key]; inflight[key] = true; setSaving(); try { await fn(); } catch (e) { writeError(e); } inflight[key] = false; setSaving(); }, delay);
  setSaving();
}
async function W(fn) { if (!live()) return; try { await fn(); } catch (e) { writeError(e); } }
function writeError(e) {
  const c = e && e.code; console.error(e);
  if (c === 'permission-denied') toast(t("You don't have access to that. Ask the group for a new invite link."));
  else toast(t('Not saved. Check your connection and try again.'));
}
let toastT, undoFn = null;
function toast(m, undo) {
  const el = $('#toast'); el.textContent = m; undoFn = undo || null;
  if (undo) { const b = document.createElement('button'); b.textContent = t('Undo'); b.dataset.act = 'undo'; el.appendChild(b); }
  el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; undoFn = null; }, undo ? 6000 : 2800);
}
const editable = () => S.mode === 'demo' || (live() && S.me && myName());
const newId = (col) => (live() ? B.newId(col) : 'x' + Date.now() + Math.floor(Math.random() * 1000));

/* main calendar = users/{me}.mainDays, mirrored into groups/{gid}/avail/{me} for every group that uses it,
   so other members only ever read group data. */
function saveMain(days) {
  later('main', () => {
    const now = Date.now(), ops = [['update', 'users/' + S.me, { mainDays: days, updatedAt: now }]];
    for (const [gid, g] of myGroups()) if (modeOf(S.me, g) === 'main') ops.push(['set', `groups/${gid}/avail/${S.me}`, { days, updatedAt: now }]);
    return B.batch(ops);
  });
}
function saveOwn(gid, days) { later('own:' + gid, () => B.set(`groups/${gid}/avail/${S.me}`, { days, updatedAt: Date.now() })); }

/* ---------- derived ---------- */
function dayPeople(k) { const out = { free: [], busy: [], away: [], none: [] }; for (const id of memberIds()) { const e = norm(daysOf(id)[k]); out[e ? e.s : 'none'].push({ id, e }); } return out; }
function planDates(p) { if (p.status === 'confirmed' && p.options?.[p.chosen ?? 0]) return [p.options[p.chosen ?? 0].date]; return (p.options || []).map((o) => o.date); }
function planSlot(p) { if (!p || !p.options) return null; if (p.status !== 'confirmed' && p.options.length > 1) return null; return p.options[p.chosen ?? 0]; }
function planWhen(p) { const o = planSlot(p); return o ? optLabel(o) : t('{n} date options', { n: p.options.length }); }
const invitedIds = (p) => (p.invited && p.invited.length ? p.invited.filter((id) => memberIds().includes(id)) : memberIds());
const isInvited = (p) => invitedIds(p).includes(S.me);
function needsMe(p) { if (!S.me || p.createdBy === S.me || !isInvited(p)) return false; const multi = p.status !== 'confirmed' && (p.options || []).length > 1; return multi ? !(p.votes && p.votes[S.me]) : !(p.rsvp && p.rsvp[S.me]); }
const plansSorted = () => Object.entries(S.plans).map(([id, p]) => ({ id, ...p })).filter((p) => planDates(p).some((d) => d >= TK))
  .sort((a, b) => { const ka = (planSlot(a) ? planSlot(a).date + (planSlot(a).time || '') : planDates(a).sort()[0]) || ''; const kb = (planSlot(b) ? planSlot(b).date + (planSlot(b).time || '') : planDates(b).sort()[0]) || ''; return ka.localeCompare(kb); });
function suggestions(max = 3) {
  const ids = memberIds(); if (ids.length < 2) return []; const n = need(), out = [];
  const confirmedDays = new Set(Object.values(S.plans).filter((p) => p.status === 'confirmed').flatMap(planDates));
  for (let i = 0; i < 60; i++) {
    const d = new Date(TODAY); d.setDate(d.getDate() + i); const k = dkey(d); if (confirmedDays.has(k)) continue;
    const we = wdIdx(d) >= 5; let best = null;
    for (const slot of we ? ['pm', 'am'] : ['pm']) {
      const free = []; let away = 0;
      for (const id of ids) { const e = norm(daysOf(id)[k]); if (!e) continue; if (e.s === 'away' || (e.s === 'busy' && covers(e, slot))) away++; else if (e.s === 'free' && covers(e, slot)) free.push(id); }
      const score = free.length * 10 - away * 3 + (slot === 'pm' ? 1 : 0);
      if (free.length >= n && (!best || score > best.score)) best = { k, slot, free, score };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score || a.k.localeCompare(b.k)).slice(0, max).sort((a, b) => a.k.localeCompare(b.k));
}
function goalStatus() {
  const g = G(), per = g.goalPer || 'month', count = +g.goalCount || 1, n = need(); let start, end, label;
  if (per === 'week') { start = new Date(TODAY); start.setDate(start.getDate() - wdIdx(start)); end = new Date(start); end.setDate(end.getDate() + 6); label = t('this week'); }
  else { start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); end = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0); label = t('in {m}', { m: monthName(TODAY) }); }
  const s = dkey(start), e = dkey(end);
  const done = Object.values(S.plans).filter((p) => p.status === 'confirmed' && invitedIds(p).length >= n).flatMap(planDates).filter((d) => d >= s && d <= e).length;
  return { count, done, label, per };
}

/* ---------- add to calendar ---------- */
function planTimes(p) {
  const o = planSlot(p); if (!o) return null; const d = dparse(o.date);
  if (o.allDay) { const e = new Date(d); e.setDate(e.getDate() + 1); return { allDay: true, start: d, end: e }; }
  const [h, m] = (o.time || '19:00').split(':').map(Number), start = new Date(d); start.setHours(h, m);
  let end; if (o.end) { const [h2, m2] = o.end.split(':').map(Number); end = new Date(d); end.setHours(h2, m2); if (end <= start) end.setDate(end.getDate() + 1); }
  else end = new Date(start.getTime() + 2 * 3600e3);
  return { allDay: false, start, end };
}
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function gcalUrl(p) {
  const tm = planTimes(p); if (!tm) return '';
  const dates = tm.allDay ? `${icsDate(tm.start)}/${icsDate(tm.end)}` : `${icsUtc(tm.start)}/${icsUtc(tm.end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: p.title || '', dates, details: p.note || '', location: p.place || '' });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
function downloadIcs(p, id) {
  const tm = planTimes(p); if (!tm) return;
  const icsEsc = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WhenWeMeet//EN', 'BEGIN:VEVENT', `UID:${id}@whenwemeet`, `DTSTAMP:${icsUtc(new Date())}`,
    tm.allDay ? `DTSTART;VALUE=DATE:${icsDate(tm.start)}` : `DTSTART:${icsUtc(tm.start)}`,
    tm.allDay ? `DTEND;VALUE=DATE:${icsDate(tm.end)}` : `DTEND:${icsUtc(tm.end)}`,
    `SUMMARY:${icsEsc(p.title)}`];
  if (p.place) lines.push(`LOCATION:${icsEsc(p.place)}`); if (p.note) lines.push(`DESCRIPTION:${icsEsc(p.note)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = (p.title || 'plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- render ---------- */
function ready() { return S.mode === 'demo' || (live() && S.gotProfile && S.gotGroups); }
export function render() {
  if (S.mode === 'off') return;
  document.documentElement.lang = LANG;
  const app = $('#app'), rdy = ready(), needName = live() && rdy && !myName();
  const inG = rdy && !needName && G() && inGroup(G(), S.me);
  const needCount = inG ? plansSorted().filter(needsMe).length : 0;
  $('#nav').parentElement.hidden = !inG;
  $('#nav').innerHTML = [['home', t('Home')], ['cal', t('Calendar')], ['plans', t('Plans')]].map(([k, l]) =>
    `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}><span class="bar"></span><span>${l}${k === 'plans' && needCount ? `<span class="badge">${needCount}</span>` : ''}</span></button>`).join('');
  let h = header(inG) + banners();
  if (!rdy) h += `<div class="empty">${t('Loading…')}</div>`;
  else if (needName) h += joinCard();
  else if (!inG) h += groupsView(true);
  else h += S.tab === 'home' ? homeView() : S.tab === 'cal' ? calView() : plansView();
  app.innerHTML = h;
  const showBrush = inG && S.tab === 'cal' && S.calView === 'mine' && editable();
  $('#brush').hidden = !showBrush; if (showBrush) $('#brush').innerHTML = brushHTML();
  $('#fab').hidden = !(inG && S.tab === 'plans' && editable()); $('#fab').textContent = t('+ New plan');
  app.style.paddingBottom = showBrush ? '230px' : '';
  if (S.sheet) renderSheet();
  const on = app.querySelector('.gchip.on'); if (on) { const row = on.parentElement; row.scrollLeft = on.offsetLeft - row.offsetLeft - 8; }
}
function header(inG) {
  const g = G();
  return `<div class="top">
    <button class="grpbtn" data-act="groups" ${!ready() ? 'disabled' : ''}><span class="mono muted">WhenWeMeet</span>
      <span class="grpname"><h1>${inG ? gEmoji(g) + esc(g.name) : t('Your groups')}</h1>${ready() ? '<span class="chev"></span>' : ''}</span><span class="flow"></span></button>
    <div class="row" style="flex-wrap:nowrap">
      <div class="seg lang" role="group" aria-label="Language"><button data-act="lang" data-v="en" aria-pressed="${LANG === 'en'}">EN</button><button data-act="lang" data-v="es" aria-pressed="${LANG === 'es'}">ES</button></div>
      ${S.me && (myName() || S.mode === 'demo') ? `<button class="iconbtn" data-act="profile" aria-label="${esc(t('Your profile'))}">${faceHTML(S.me)}<span class="nm-short">${esc(myName())}</span></button>` : ''}
    </div></div>`;
}
function banners() {
  if (isGuest() && myName() && myGroups().length) return saveAccountCard(t('You’re in as a guest on this device. Save your account with Google or your email to keep your groups if you change phone or clear the browser.'));
  if (S.mode === 'demo') return `<div class="banner"><span class="mono tag">${t('Demo')}</span><div>${t('Sample groups with example friends. <b>Nothing is saved</b> in this view.')} <a class="maplink" href="#/login">${t('Create your own group')}</a></div></div>`;
  return '';
}
const isGuest = () => live() && !!S.user?.isAnonymous;
function joinCard() {
  const inv = S.inviteInfo, emo = S.joinEmoji || (S.joinEmoji = S.profile?.emoji || defEmoji(S.me));
  return `<div class="card stack">
  ${inv ? `<div class="invite-hero"><span class="invite-emo">${esc(inv.emoji || '🎉')}</span><div><span class="mono muted">${t('You’re invited to')}</span><h2 style="font-size:22px;margin-top:4px">${esc(inv.groupName || '')}</h2></div></div>` : `<div><span class="mono muted">${t('Welcome')}</span></div>`}
  <div><h2 style="font-size:${inv ? 18 : 22}px">${t('What should your friends call you?')}</h2>
  <p class="muted" style="margin:6px 0 0">${inv ? t('No account needed. We’ll remember you on this device.') : t('Then create a group and invite your people.')}</p></div>
  <div class="field"><label for="joinName">${t('Your name')}</label><input class="input" id="joinName" maxlength="24" value="${esc(S.user?.displayName?.split(' ')[0] || '')}" placeholder="${esc(t('e.g. Michelle'))}" autocomplete="given-name"></div>
  <div class="field"><span class="lbl">${t('Your emoji')}</span><div class="row emorow">${EMOJIS.map((e) => `<button class="emo-btn" data-act="joinEmoji" data-v="${e}" aria-pressed="${emo === e}">${e}</button>`).join('')}</div></div>
  <button class="btn primary full" data-act="join">${inv ? t('Join {g}', { g: esc(inv.groupName || '') }) : t('Continue')}</button>
  ${isGuest() ? `<p class="meta" style="margin:0;text-align:center">${t('Already use WhenWeMeet?')} <a class="maplink" href="#/login">${t('Sign in to keep everything in one place')}</a></p>` : ''}</div>`;
}
function saveAccountCard(why) {
  return `<div class="banner guest"><span class="mono tag">${t('Guest')}</span><div>${why}
    <div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/login">${t('Save your account')}</a></div></div></div>`;
}
function groupsView(page) {
  const mine = myGroups(), can = editable();
  let h = page ? `<div class="sec-h" style="margin-top:4px"><h2>${t('Your groups')}</h2></div>` : `<h2>${t('Your groups')}</h2>`;
  h += mine.length ? `<div class="stack" style="gap:8px">${mine.map(([id, g]) => `<button class="plan grp ${id === S.gid ? 'confirmed' : ''}" data-act="switchGroup" data-v="${id}">
      <div class="plan-row" style="align-items:center"><h3>${gEmoji(g)}${esc(g.name)}</h3>${id === S.gid ? `<span class="chip on">${t('Open')}</span>` : ''}</div>
      <div class="plan-row" style="align-items:center"><div class="faces">${memberIds(g).slice(0, 8).map((m) => faceHTML(m, g)).join('')}</div>
      <span class="meta">${t('{n} people', { n: memberIds(g).length })} · ${modeOf(S.me, g) === 'own' ? t('Own calendar') : t('Main calendar')}</span></div></button>`).join('')}</div>`
    : `<div class="empty">${t("You're not in any group yet.")}</div>`;
  if (can && isGuest()) h += `<div class="sec-h"><h2>${t('Create a group')}</h2></div>` + saveAccountCard(t('Organizers need a saved account, so your group never gets lost. It takes 10 seconds with Google.'));
  if (can && !isGuest()) {
    h += `<div class="sec-h"><h2>${t('Create a group')}</h2></div><div class="card stack" style="gap:10px">
      <div class="field"><label for="newGroup">${t('Group name')}</label><input class="input" id="newGroup" maxlength="40" placeholder="${esc(t('e.g. Dinner crew, Book club, Us two'))}"></div>
      <div class="field"><span class="lbl">${t('Icon')}</span><div class="row emorow">${GROUP_EMOJIS.map((e) => `<button class="emo-btn" data-act="newGEmoji" data-v="${e}" aria-pressed="${(S.newGEmoji || '🍻') === e}">${e}</button>`).join('')}</div></div>
      <button class="btn primary full" data-act="createGroup">${t('Create group')}</button>
      <p class="meta" style="margin:0">${t('Groups are private. Only people you send the invite link to can join and see it.')} ${t('You can be in as many groups as you like: your partner, your friends, your club.')}</p></div>`;
  }
  if (can) {
    h += `<div class="sec-h"><h2>${t('Got an invite?')}</h2></div><div class="card stack" style="gap:10px">
      <div class="field"><label for="inviteIn">${t('Invite link')}</label><input class="input" id="inviteIn" placeholder="https://…/#/join/…" autocomplete="off"></div>
      <button class="btn full" data-act="joinLink">${t('Join group')}</button></div>`;
  }
  return h;
}
function groupChips() {
  return `<div class="gchips" aria-label="${esc(t('Your groups'))}">${myGroups().map(([id, g]) => `<button class="gchip ${id === S.gid ? 'on' : ''}" data-act="switchGroup" data-v="${id}">${gEmoji(g)}${esc(g.name)}</button>`).join('')}<button class="gchip add" data-act="groups">+ ${t('New group')}</button></div>`;
}
function inviteCard() {
  const g = G();
  return `<div class="card stack" style="gap:10px"><div><span class="mono muted">${t('Invite')}</span><h3 style="margin-top:6px;font-size:17px">${t('Bring your people in')}</h3>
    <p class="meta" style="margin:4px 0 0">${t('Anyone with this link can join {g} after signing in. Nobody else can see it.', { g: esc(g.name) })}</p></div>
    ${inviteRow()}</div>`;
}
function inviteRow() {
  const g = G(), url = S.mode === 'demo' ? inviteUrl('demo-link') : g.inviteCode ? inviteUrl(g.inviteCode) : '';
  return `<input class="input" id="inviteBox" readonly value="${esc(url)}" style="font-size:13px">
    <div class="row"><button class="btn primary" data-act="copyInvite">${t('Copy link')}</button>${navigator.share ? `<button class="btn" data-act="shareInvite">${t('Share')}</button>` : ''}</div>`;
}
function homeView() {
  const g = G(), gs = goalStatus(), sug = suggestions(3), plans = plansSorted();
  const toAnswer = plans.filter(needsMe), upcoming = plans.filter((p) => p.status === 'confirmed').slice(0, 3);
  const myCount = markedCount(myDays()), ids = memberIds(), notMarked = ids.filter((id) => !markedCount(daysOf(id))), goalDone = gs.done >= gs.count;
  const perTxt = gs.per === 'week' ? t('week') : t('month');
  let h = groupChips() + `<div class="card goal"><div class="goal-top"><div><span class="mono muted">${t('Goal')} · ${gs.count}× ${t('per')} ${perTxt}</span>
    <h3 style="margin-top:6px">${goalDone ? `${t('Done {label}.', { label: esc(gs.label) })} <span class="done">${t('See you there.')}</span>` : t('{d} of {c} meetups planned {label}', { d: gs.done, c: gs.count, label: esc(gs.label) })}</h3></div>
    <button class="link" data-act="gsettings">${t('Edit')}</button></div>
    <div class="pips">${Array.from({ length: gs.count }, (_, i) => `<span class="pip ${i < gs.done ? 'on' : ''}"></span>`).join('')}</div>
    ${!goalDone && sug[0] ? `<p class="meta" style="margin:0">${t('Best bet:')} <b style="color:var(--ink)">${fmtDay(sug[0].k)}, ${slotName(sug[0].slot)}</b>. ${t('{n} free', { n: sug[0].free.length })}.</p>` : ''}</div>`;
  if (ids.length < 2 && editable()) h += `<div class="sec-h"><h2>${t('Start here')}</h2></div>` + inviteCard();
  if (editable() && myCount === 0) h += `<div class="sec-h"><h2>${ids.length < 2 ? t('Then') : t('Start here')}</h2></div><button class="plan" data-act="tab" data-v="cal"><h3>${t("Mark the days you're free")}</h3><span class="meta">${t('Takes a minute. Tap days, pick AM, PM or all day.')}</span></button>`;
  if (toAnswer.length) h += `<div class="sec-h"><h2>${t('Waiting for your answer')}</h2></div><div class="stack">${toAnswer.map(planCard).join('')}</div>`;
  h += `<div class="sec-h"><h2>${t('Suggested dates')}</h2><span class="mono muted">${t('{n}+ people', { n: need() })}</span></div>`;
  if (sug.length) h += `<div class="card">${sug.map((s) => { const d = dparse(s.k); return `<div class="sugg">
      <div class="datebox"><div class="w">${wdShort(wdIdx(d))}</div><div class="d">${d.getDate()}</div><div class="w">${esc(d.toLocaleDateString(LANG, { month: 'short' }).replace('.', ''))}</div></div>
      <div class="sugg-mid"><div class="t">${slotName(s.slot)}</div><div class="meta">${t('{n} free', { n: s.free.length })}</div><div class="faces">${s.free.map(faceHTML).join('')}</div></div>
      ${editable() ? `<button class="btn" data-act="propose" data-k="${s.k}" data-slot="${s.slot}">${t('Propose')}</button>` : ''}</div>`; }).join('')}
      ${editable() && sug.length > 1 ? `<button class="btn full" style="margin-top:12px" data-act="pollSugg">${t('Let the group vote on these')}</button>` : ''}</div>`;
  else h += `<div class="empty">${ids.length < 2 ? t('Suggestions appear once at least two people have joined.') : t('No day has {n} people free yet. The more days everyone marks, the better this gets.', { n: need() })}</div>`;
  if (upcoming.length) h += `<div class="sec-h"><h2>${t('Coming up')}</h2><button class="link" data-act="tab" data-v="plans">${t('All plans')}</button></div><div class="stack">${upcoming.map(planCard).join('')}</div>`;
  h += `<div class="sec-h"><h2>${t('The group')}</h2><span class="mono muted">${t('{n} people', { n: ids.length })}</span></div><div class="card who">${ids.map((id) => { const c = markedCount(daysOf(id));
    return `<div class="who-row">${faceHTML(id)}<span class="nm">${esc(nameOf(id))}</span><span class="meta">${c ? t('{n} days marked', { n: c }) : t('No days yet')}</span></div>`; }).join('')}
    ${notMarked.length && ids.length > 1 ? `<p class="meta" style="margin:10px 0 0">${t('Waiting on:')} ${notMarked.map((id) => esc(nameOf(id))).join(', ')}</p>` : ''}
    ${ids.length >= 2 && editable() ? `<button class="link" data-act="gsettings" style="margin-top:6px">${t('+ Invite more people')}</button>` : ''}</div>`;
  return h;
}
function planCard(p) {
  const ids = invitedIds(p), multi = p.status !== 'confirmed' && (p.options || []).length > 1;
  const yes = ids.filter((id) => p.rsvp?.[id] === 'yes').length, voted = ids.filter((id) => p.votes?.[id]).length;
  const cm = commentsFor(p.id), newC = cm.filter((c) => isNew(c.at, c.by)).length;
  const tag = isNew(p.createdAt, p.createdBy) ? `<span class="chip on">${t('New')}</span>` : p.status === 'confirmed' ? `<span class="chip on">${t("It's on")}</span>` : needsMe(p) ? `<span class="chip need">${multi ? t('Vote') : t('Answer')}</span>` : `<span class="chip">${multi ? t('Voting') : t('Proposed')}</span>`;
  return `<button class="plan ${p.status === 'confirmed' ? 'confirmed' : ''}" data-act="openPlan" data-id="${p.id}">
    <div class="plan-row"><div style="min-width:0"><span class="mono muted">${esc(t(p.type || 'Other'))}</span><h3 style="margin-top:3px">${esc(p.title || t(p.type))}</h3></div>${tag}</div>
    <div class="meta">${esc(planWhen(p))}${p.place ? ` · 📍 ${esc(placeText(p.place))}` : ''}</div>
    <div class="plan-row" style="align-items:center"><div class="faces">${ids.slice(0, 8).map(faceHTML).join('')}</div>
    <span class="meta">${cm.length ? `${newC ? `<b style="color:var(--decision)">${t('{n} new', { n: newC })}</b> · ` : ''}${t('{n} comments', { n: cm.length })} · ` : ''}${multi ? t('{a}/{b} voted', { a: voted, b: ids.length }) : t('{a}/{b} going', { a: yes, b: ids.length })}</span></div></button>`;
}
function plansView() {
  const all = plansSorted(), open = all.filter((p) => p.status !== 'confirmed'), on = all.filter((p) => p.status === 'confirmed');
  return `<div class="sec-h" style="margin-top:4px"><h2>${t('Open proposals')}</h2></div>` +
    (open.length ? `<div class="stack">${open.map(planCard).join('')}</div>` : `<div class="empty">${t('No open proposals. Propose a dinner, a trip, a party, anything.')}</div>`) +
    `<div class="sec-h"><h2>${t('Confirmed')}</h2></div>` +
    (on.length ? `<div class="stack">${on.map(planCard).join('')}</div>` : `<div class="empty">${t('Nothing confirmed yet.')}</div>`);
}
function monthsList() { return Array.from({ length: 6 }, (_, i) => new Date(TODAY.getFullYear(), TODAY.getMonth() + i, 1)); }
function calView() {
  if (!S.open) S.open = new Set(monthsList().slice(0, 2).map((d) => dkey(d).slice(0, 7)));
  const mine = S.calView === 'mine' && editable(), mode = modeOf(S.me);
  let h = `<div class="cal-head"><div class="seg" role="group" aria-label="${esc(t('Calendar view'))}">
    <button data-act="calView" data-v="mine" aria-pressed="${S.calView === 'mine'}">${t('My days')}</button>
    <button data-act="calView" data-v="everyone" aria-pressed="${S.calView === 'everyone'}">${t('Everyone')}</button></div></div>`;
  if (S.calView === 'mine') {
    if (mine) h += `<div class="calsrc"><span class="meta">${t('Calendar for this group:')}</span><div class="seg sm" role="group" aria-label="${esc(t('Calendar for this group:'))}">
      <button data-act="calMode" data-v="main" aria-pressed="${mode === 'main'}">${t('Main')}</button><button data-act="calMode" data-v="own" aria-pressed="${mode === 'own'}">${t('Only this group')}</button></div>
      <p class="hint" style="margin:0;flex-basis:100%">${mode === 'main' ? t('Your main calendar is shared with every group that uses it ({n}).', { n: mainUsers(S.me) }) : t('Changes here only affect {g}.', { g: esc(G().name) })}</p>
      ${mode === 'own' ? `<div class="row" style="flex-basis:100%"><button class="btn sm" data-act="syncAsk" data-v="toGroup">${t('Main → this group')}</button><button class="btn sm" data-act="syncAsk" data-v="toMain">${t('This group → main')}</button></div>` : ''}</div>`;
    h += `<div class="legend"><span><i style="background:var(--free)"></i>${t('Free')}</span><span><i style="background:var(--busy)"></i>${t('Busy')}</span><span><i style="background:var(--away)"></i>${t('Out of the city')}</span><span>${t('Blank = not marked')}</span></div>
      ${mine && markedCount(myDays()) ? `<button class="link danger" data-act="clearAll">${S.confirmClear ? t('Tap again to clear all your days') : t('Clear all my days')}</button>` : ''}`;
  } else h += `<div class="plegend">${memberIds().slice(0, 6).map(chipHTML).join('')}</div><p class="hint" style="margin:0 0 4px">${t('Each bar in a day is one person, in this order. Their color = free, red = busy, blue = out of the city.')}</p><div class="legend"><span><i style="background:var(--free-bg);border:1px solid var(--free)"></i>${t('{n}+ free', { n: need() })}</span><span><i style="background:var(--decision);border-radius:50%"></i>${t('Plan on')}</span><span><i style="border:1.5px solid var(--lilac);border-radius:50%"></i>${t('Proposed')}</span><span>${t('Tap a day for details')}</span></div>`;
  const planMarks = {};
  for (const p of Object.values(S.plans)) for (const d of planDates(p)) { const on = p.status === 'confirmed'; if (!planMarks[d] || on) planMarks[d] = on ? 'on' : 'open'; }
  for (const m of monthsList()) {
    const mk = dkey(m).slice(0, 7), isOpen = S.open.has(mk), last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(); let sum;
    if (S.calView === 'mine') { const c = markedCount(myDays(), mk); sum = c ? t('{n} marked', { n: c }) : t('Nothing marked'); }
    else { let gd = 0; for (let d = 1; d <= last; d++) { const k = `${mk}-${pad(d)}`; if (k >= TK && dayPeople(k).free.length >= need()) gd++; } sum = gd ? t('{n} good days', { n: gd }) : t('No good days yet'); }
    h += `<section class="month ${isOpen ? 'open' : ''}"><button class="month-h" data-act="toggleMonth" data-v="${mk}" aria-expanded="${isOpen}"><h2>${monthName(m)}${m.getFullYear() !== TODAY.getFullYear() ? ' ' + m.getFullYear() : ''}</h2><span class="sum">${sum}</span><span class="chev"></span></button>`;
    if (isOpen) {
      h += `<div class="grid">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="wd ${i >= 5 ? 'we' : ''}">${wdShort(i)}</span>`).join('')}`;
      for (let i = 0; i < wdIdx(m); i++) h += `<span></span>`;
      for (let d = 1; d <= last; d++) {
        const k = `${mk}-${pad(d)}`, past = k < TK, we = wdIdx(dparse(k)) >= 5; let cls = `day ${we ? 'we' : ''} ${past ? 'past' : ''} ${k === TK ? 'today' : ''}`, inner = '';
        if (S.calView === 'mine') { const e = norm(myDays()[k]); if (e) { cls += ` s-${e.s}`; inner = `<span class="lab">${cellLabel(e)}</span>`; } }
        else { const p = dayPeople(k), ids = memberIds(); if (p.free.length >= need() && !past) cls += ' good';
          inner = `${p.free.length ? `<span class="cnt">${p.free.length}/${ids.length}</span>` : ''}<span class="bars">${ids.slice(0, 6).map((id) => { const e = norm(daysOf(id)[k]); return `<span class="${e ? e.s[0] : ''}" ${e && e.s === 'free' ? `style="background:${person(id).color}"` : ''}></span>`; }).join('')}</span>`; }
        const pm = planMarks[k];
        h += `<button class="${cls}" data-act="day" data-k="${k}" aria-label="${esc(fmtDay(k))}"><span class="n">${d}</span>${inner}${pm ? `<span class="mark ${pm}"></span>` : ''}</button>`;
      }
      h += `</div>`;
    }
    h += `</section>`;
  }
  return h;
}
function brushHTML() {
  const b = S.brush;
  return `<div class="brush-in"><div class="row" role="group" aria-label="${esc(t('What to mark'))}">
    <button class="pill free" data-act="brushS" data-v="free" aria-pressed="${b.s === 'free'}">${t('Free')}</button>
    <button class="pill busy" data-act="brushS" data-v="busy" aria-pressed="${b.s === 'busy'}">${t('Busy')}</button>
    <button class="pill away" data-act="brushS" data-v="away" aria-pressed="${b.s === 'away'}">${t('Out of the city')}</button>
    <button class="pill" data-act="brushS" data-v="clear" aria-pressed="${b.s === 'clear'}">${t('Erase')}</button></div>
    ${b.s === 'free' || b.s === 'busy' ? `<div class="row" role="group" aria-label="${esc(t('When'))}">${SLOTS.map((s) => `<button class="pill sm" data-act="brushT" data-v="${s}" aria-pressed="${b.t === s}">${slotName(s)}</button>`).join('')}
    ${b.t === 'custom' ? `<input type="time" class="timein" id="bFrom" value="${b.from}" aria-label="${esc(t('From'))}"><span class="muted">${t('to')}</span><input type="time" class="timein" id="bTo" value="${b.to}" aria-label="${esc(t('To'))}">` : ''}</div>` : ''}
    ${S.repeatOpen ? `<div class="row" role="group"><span class="hint">${t('Every')}</span>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<button class="pill sm" data-act="paintWeekday" data-v="${i}">${wdShort(i)}</button>`).join('')}</div>` : ''}
    <div class="hint">${t('Tap a day, or hold and drag across several. Tap a marked day again to erase it.')} <button class="link" data-act="repeatToggle" style="font-size:11.5px;padding:0">${S.repeatOpen ? t('Hide repeat') : t('Repeat weekly…')}</button></div></div>`;
}

/* ---------- sheets ---------- */
function openSheet(kind, arg) { S.sheet = { kind, arg }; renderSheet(); $('#sheet').hidden = false; $('#scrim').hidden = false; }
function closeSheet() { S.sheet = null; S.draft = null; S.gDraft = null; S.pDraft = null; $('#sheet').hidden = true; $('#scrim').hidden = true; }
function renderSheet() {
  const { kind, arg } = S.sheet; let h = '<div class="grab"></div>';
  h += kind === 'sync' ? syncSheet(arg) : kind === 'day' ? daySheet(arg) : kind === 'plan' ? planSheet(arg) : kind === 'form' ? formSheet() : kind === 'gsettings' ? gSettingsSheet() : kind === 'profile' ? profileSheet() : groupsView(false);
  $('#sheetIn').innerHTML = h;
}
function daySheet(k) {
  const p = dayPeople(k), dayPlans = plansSorted().filter((pl) => planDates(pl).includes(k));
  const row = (x, s) => `<div class="who-row">${faceHTML(x.id)}<span class="nm">${esc(nameOf(x.id))}</span><span class="st ${s}">${s === 'none' ? t('Not marked') : s === 'away' ? t('Out of the city') : `${s === 'busy' ? t('Busy') : t('Free')}${x.e && (x.e.t || 'all') !== 'all' ? ' · ' + esc(slotLabel(x.e)) : ''}${s === 'busy' && x.e.title && x.id === S.me ? ' · ' + esc(x.e.title) : ''}`}</span></div>`;
  return `<div><span class="mono muted">${t('{a} of {b} free', { a: p.free.length, b: memberIds().length })}</span><h2 style="margin-top:4px">${esc(fmtDay(k))}</h2></div>
    <div class="who">${[...p.free.map((x) => row(x, 'free')), ...p.busy.map((x) => row(x, 'busy')), ...p.away.map((x) => row(x, 'away')), ...p.none.map((x) => row(x, 'none'))].join('')}</div>
    ${dayPlans.length ? `<div class="stack">${dayPlans.map(planCard).join('')}</div>` : ''}
    ${editable() && k >= TK ? `<button class="btn primary full" data-act="propose" data-k="${k}" data-slot="pm">${t('Propose a plan on this day')}</button>` : ''}`;
}
function planSheet(id) {
  if (!S.plans[id]) return `<h2>${t('This plan was deleted.')}</h2>`;
  const p = { id, ...S.plans[id] }, ids = invitedIds(p), multi = p.status !== 'confirmed' && p.options.length > 1, mine = p.createdBy === S.me, inv = isInvited(p), can = editable(), boss = mine || isGroupOwner();
  let h = `<div><span class="mono muted">${esc(t(p.type || 'Other'))} · ${t('by {n}', { n: esc(nameOf(p.createdBy)) })}</span><h2 style="margin-top:4px">${esc(p.title || t(p.type))}</h2>
    <p class="meta" style="margin:6px 0 0">${esc(planWhen(p))}${p.place ? ` · ${esc(placeText(p.place))}` : ''}</p>${p.place ? mapBlock(p.place) : ''}${p.note ? `<p style="margin:8px 0 0">${esc(p.note)}</p>` : ''}</div>`;
  if (multi) {
    const counts = p.options.map((_, i) => ids.filter((m) => (p.votes?.[m] || []).includes(i))), top = Math.max(...counts.map((c) => c.length)), myV = p.votes?.[S.me] || [];
    h += `<div class="field"><span class="lbl">${t('Which dates work for you? Pick all that do.')}</span><div class="stack" style="gap:8px">${p.options.map((o, i) => `<button class="vote ${top > 0 && counts[i].length === top ? 'win' : ''}" data-act="vote" data-id="${id}" data-i="${i}" aria-pressed="${myV.includes(i)}" ${can && inv ? '' : 'disabled'}>
        <span class="grow"><b>${esc(fmtDay(o.date))}</b> · ${esc(timeLabel(o))}<br><span class="meta">${t('{n} marked free then', { n: freeAt(o).length })}</span></span>
        <span class="faces">${counts[i].map(faceHTML).join('')}</span><span class="count">${counts[i].length}</span></button>`).join('')}</div></div>
      <p class="meta" style="margin:0">${t('{a} of {b} voted.', { a: ids.filter((m) => p.votes?.[m]).length, b: ids.length })}${p.votes?.[S.me] && !myV.length ? ' ' + t('You said none work.') : ''}</p>
      ${can && inv && !p.votes?.[S.me] ? `<button class="btn full" data-act="voteNone" data-id="${id}">${t('None of these work for me')}</button>` : ''}`;
    if (can && boss && top > 0) { const w = counts.findIndex((c) => c.length === top); h += `<button class="btn go full" data-act="confirm" data-id="${id}" data-i="${w}">${t('Lock in {d}', { d: esc(optLabel(p.options[w])) })}</button>`; }
  } else {
    const r = p.rsvp?.[S.me];
    if (can && inv) h += `<div class="field"><span class="lbl">${t('Are you in?')}</span><div class="rsvp">${[['yes', t("I'm in"), 'free'], ['maybe', t('Maybe'), 'maybe'], ['no', t("Can't"), 'busy']].map(([v, l, c]) => `<button class="pill ${c}" data-act="rsvp" data-id="${id}" data-v="${v}" aria-pressed="${r === v}">${l}</button>`).join('')}</div></div>`;
    if (can && boss && p.status !== 'confirmed') h += `<button class="btn go full" data-act="confirm" data-id="${id}" data-i="0">${t("It's on. Confirm the plan")}</button>`;
    h += `<div class="field"><span class="lbl">${t('Add to your calendar')}</span><div class="row"><a class="btn" href="${esc(gcalUrl(p))}" target="_blank" rel="noopener noreferrer">Google Calendar ↗</a><button class="btn" data-act="ics" data-id="${id}">${t('Apple / Outlook (.ics)')}</button></div></div>`;
  }
  h += `<div class="field"><span class="lbl">${t('Invited · {n}', { n: ids.length })}</span><div class="who">${ids.map((m) => { const v = multi ? (p.votes?.[m] ? (p.votes[m].length ? 'voted' : 'none') : '') : p.rsvp?.[m] || '';
    const cls = { yes: 'free', maybe: 'maybe', no: 'busy', voted: 'free', none: 'busy' }[v] || 'none';
    const lab = { yes: t('In'), maybe: t('Maybe'), no: t("Can't"), voted: t('Voted'), none: t('None work') }[v] || t('No answer');
    return `<div class="who-row">${faceHTML(m)}<span class="nm">${esc(nameOf(m))}</span><span class="st ${cls}">${lab}</span></div>`; }).join('')}</div></div>`;
  const cm = commentsFor(id);
  h += `<div class="field"><span class="lbl">${t('Comments · {n}', { n: cm.length })}</span><div class="who">${cm.map((c) => `<div class="who-row" style="align-items:flex-start">${faceHTML(c.by)}
    <div style="flex:1;min-width:0"><div class="meta"><b style="color:var(--ink)">${esc(nameOf(c.by))}</b> · ${esc(new Date(c.at).toLocaleString(LANG, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${isNew(c.at, c.by) ? ` · <span style="color:var(--decision)">${t('new')}</span>` : ''}</div>
    <div style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(c.text)}</div></div></div>`).join('') || `<div class="meta">${t('No comments yet. Ask about the place, the budget, who brings what.')}</div>`}</div>
    ${can && inv ? `<div class="row" style="flex-wrap:nowrap"><input class="input" id="cText" maxlength="500" placeholder="${esc(t('Write a comment…'))}" style="flex:1"><button class="btn primary" data-act="comment" data-id="${id}">${t('Send')}</button></div>` : ''}</div>`;
  h += `<button class="btn full" data-act="copyMsg" data-id="${id}">${t('Copy message for WhatsApp')}</button><textarea class="input" id="copyBox" hidden readonly></textarea>`;
  if (can && boss) h += `<div class="row"><button class="btn" data-act="editPlan" data-id="${id}">${t('Edit')}</button>${p.status === 'confirmed' ? `<button class="btn" data-act="reopen" data-id="${id}">${t('Reopen')}</button>` : ''}<button class="btn danger" data-act="delPlan" data-id="${id}" style="margin-left:auto">${S.confirmDel === id ? t('Tap again to delete') : t('Delete')}</button></div>`;
  return h;
}
function formSheet() {
  const d = S.draft, ids = memberIds();
  return `<h2>${d.id ? t('Edit plan') : t('New plan')}</h2>
  <div class="field"><span class="lbl">${t('What')}</span><div class="row">${TYPES.map((ty) => `<button class="pill sm" data-act="fType" data-v="${ty}" aria-pressed="${d.type === ty}">${t(ty)}</button>`).join('')}</div></div>
  <div class="field"><label for="fTitle">${t('Name it')}</label><input class="input" id="fTitle" maxlength="60" value="${esc(d.title)}" placeholder="${esc(d.type === 'Trip' ? t('Weekend in Český Krumlov') : d.type === 'Party' ? t('Bad-taste party at ours') : t('{t} with the group', { t: t(d.type) }))}"></div>
  <div class="field"><span class="lbl">${t('When')}${d.options.length > 1 ? ' · ' + t('the group votes') : ''}</span><div class="stack" style="gap:10px">${d.options.map((o, i) => `<div class="opt2">
    <input type="date" class="input" data-opt="${i}" data-f="date" value="${o.date}" min="${TK}" aria-label="${esc(t('Date'))} ${i + 1}">
    ${o.allDay ? `<span class="meta allday">${t('All day')}</span>` : `<input type="time" class="input" data-opt="${i}" data-f="time" value="${o.time || '19:00'}" aria-label="${esc(t('Starts at'))} ${i + 1}" required>
    <input type="time" class="input" data-opt="${i}" data-f="end" value="${o.end || ''}" aria-label="${esc(t('Ends at (optional)'))} ${i + 1}">`}
    ${d.options.length > 1 ? `<button class="x" data-act="fDelOpt" data-i="${i}" aria-label="${esc(t('Remove date'))}">✕</button>` : ''}
    <div class="row opt-sub"><button class="pill sm" data-act="fAllDay" data-i="${i}" aria-pressed="${!!o.allDay}">${t('All day')}</button>${o.allDay ? '' : `<span class="hint">${t('Start')} · ${t('end (optional)')}</span>`}</div></div>`).join('')}
    ${d.options.length < 5 ? `<button class="btn" data-act="fAddOpt" style="align-self:flex-start">${t('+ Add another date to vote on')}</button>` : ''}</div></div>
  <div class="field"><label for="fPlace">📍 ${t('Where (optional)')}</label><input class="input" id="fPlace" maxlength="400" value="${esc(d.place)}" placeholder="${esc(t('Restaurant name, address or Google Maps link'))}" autocomplete="off"><span class="hint" id="fPlaceLink">${d.place ? mapsLink(d.place) + ' · ' + t('check it finds the right place') : t('Type a place or paste a link from Google Maps. Everyone gets a button to open it.')}</span><div id="fMap">${d.place ? mapFrame(d.place) : ''}</div></div>
  <div class="field"><label for="fNote">${t('Note (optional)')}</label><textarea class="input" id="fNote" maxlength="300" placeholder="${esc(t('Bring something, budget, dress code…'))}">${esc(d.note)}</textarea></div>
  <div class="field"><span class="lbl">${t("Who's invited · {n}", { n: d.invited.length || ids.length })}</span><div class="row">
    <button class="pill sm" data-act="fInvAll" aria-pressed="${!d.invited.length}">${t('Everyone')}</button>
    ${ids.map((id) => `<button class="pill sm" data-act="fInv" data-v="${id}" aria-pressed="${!d.invited.length || d.invited.includes(id)}">${esc(nameOf(id))}</button>`).join('')}</div></div>
  <button class="btn primary full" data-act="fSave">${d.id ? t('Save changes') : d.options.length > 1 ? t('Send to the group to vote') : t('Propose it')}</button>`;
}
function gSettingsSheet() {
  const g = G(), d = S.gDraft || (S.gDraft = { name: g.name, emoji: g.emoji || '', goalCount: g.goalCount || 1, goalPer: g.goalPer || 'month', minPeople: g.minPeople || 3 }), can = editable(), mode = modeOf(S.me), owner = isGroupOwner();
  return `<h2>${t('Group settings')}</h2>
  <div class="field"><span class="lbl">${t('Invite link')}</span>${inviteRow()}
    <p class="hint" style="margin:0">${t('Anyone with this link can join {g} after signing in. Nobody else can see it.', { g: esc(g.name) })}</p>
    ${owner ? `<button class="link danger" data-act="resetInvite" style="align-self:flex-start">${S.confirmReset ? t('Tap again: the old link stops working') : t('Reset link')}</button>` : ''}</div>
  <div class="field"><label for="gName">${t('Group name')}</label><input class="input" id="gName" maxlength="40" value="${esc(d.name)}"></div>
  <div class="field"><span class="lbl">${t('Icon')}</span><div class="row emorow">${GROUP_EMOJIS.map((e) => `<button class="emo-btn" data-act="gEmoji" data-v="${e}" aria-pressed="${d.emoji === e}">${e}</button>`).join('')}</div></div>
  <div class="field"><span class="lbl">${t('We want to meet at least')}</span><div class="row">
    ${[1, 2, 3, 4].map((n) => `<button class="pill sm" data-act="gCount" data-v="${n}" aria-pressed="${+d.goalCount === n}">${n}×</button>`).join('')}
    <span class="muted">${t('per')}</span>${['week', 'month'].map((p) => `<button class="pill sm" data-act="gPer" data-v="${p}" aria-pressed="${d.goalPer === p}">${t(p)}</button>`).join('')}</div></div>
  <div class="field"><span class="lbl">${t('A day counts as good when at least')}</span><div class="row">
    ${[2, 3, 4, 5, 6].map((n) => `<button class="pill sm" data-act="gMin" data-v="${n}" aria-pressed="${+d.minPeople === n}">${n}</button>`).join('')}<span class="muted">${t('people are free')}</span></div></div>
  ${can ? `<button class="btn primary full" data-act="gSave">${t('Save')}</button>` : ''}
  <div class="field"><span class="lbl">${t('Members · {n}', { n: memberIds().length })}</span><div class="who">${memberIds().map((m) => `<div class="who-row">${faceHTML(m)}<span class="nm">${esc(nameOf(m))}${g.createdBy === m ? ` <span class="mono muted" style="font-size:10px">${t('admin')}</span>` : ''}</span>
    ${owner && m !== S.me ? `<button class="btn sm danger" data-act="kick" data-v="${m}">${S.confirmKick === m ? t('Tap again') : t('Remove')}</button>` : ''}</div>`).join('')}</div></div>
  ${can ? `<div class="field"><span class="lbl">${t('Your calendar in this group')}</span><div class="seg sm" role="group"><button data-act="calMode" data-v="main" aria-pressed="${mode === 'main'}">${t('Main')}</button><button data-act="calMode" data-v="own" aria-pressed="${mode === 'own'}">${t('Only this group')}</button></div>
  <p class="hint" style="margin:0">${t('Main: the same days in every group that uses it. Only this group: a separate calendar, starting from a copy of your main one.')}</p></div>
  <button class="btn danger" data-act="leaveGroup" style="align-self:flex-start">${S.confirmLeave ? t('Tap again to leave') : t('Leave this group')}</button>` : ''}`;
}
function syncSheet(dir) {
  const main = S.profile?.mainDays || {}, own = S.gAvail[S.me]?.days || {}, g = esc(G().name);
  const from = dir === 'toGroup' ? main : own, to = dir === 'toGroup' ? own : main;
  const keys = new Set([...Object.keys(from), ...Object.keys(to)].filter((k) => k >= TK));
  const changes = [...keys].filter((k) => JSON.stringify(norm(from[k])) !== JSON.stringify(norm(to[k]))).length;
  const others = Math.max(0, mainUsers(S.me));
  return `<div><span class="mono muted">${t('Sync calendars')}</span><h2 style="margin-top:4px">${dir === 'toGroup' ? t('Copy your main calendar into {g}?', { g }) : t('Copy {g} into your main calendar?', { g })}</h2></div>
    <p style="margin:0">${dir === 'toGroup' ? t("{g}'s calendar will become an exact copy of your main one. Days you marked only for this group will be replaced.", { g }) : t("Your main calendar will become an exact copy of this group's days. Days marked only in your main calendar will be replaced.")}</p>
    ${dir === 'toMain' && others ? `<p class="meta" style="margin:0">${t('Your main calendar is used in {n} other groups. They will see these changes too.', { n: others })}</p>` : ''}
    <div class="card" style="padding:12px 14px"><b>${changes ? t('{n} days will change', { n: changes }) : t('Both calendars already match.')}</b></div>
    ${changes ? `<div class="row"><button class="btn" data-act="closeSheet">${t('Cancel')}</button><button class="btn go" data-act="syncDo" data-v="${dir}" style="margin-left:auto">${t('Yes, replace')}</button></div>` : `<button class="btn full" data-act="closeSheet">${t('Close')}</button>`}
    <p class="hint" style="margin:0">${t('You can undo right after.')}</p>`;
}
function profileSheet() {
  const d = S.pDraft || (S.pDraft = { emoji: person(S.me).emoji, color: person(S.me).color });
  return `<h2>${t('Your profile')}</h2>
  <div class="ppreview"><span class="avatar emo big" style="background:${d.color}">${d.emoji}</span><span class="meta">${t('This is how your friends see you in calendars and plans.')}</span></div>
  ${S.user?.email ? `<p class="meta" style="margin:0">${t('Signed in as {e}', { e: esc(S.user.email) })}</p>` : ''}
  ${isGuest() ? saveAccountCard(t('You’re a guest on this device. Save your account to use WhenWeMeet on your other devices too.')) : ''}
  <div class="field"><label for="pName">${t('Your name')}</label><input class="input" id="pName" maxlength="24" value="${esc(myName())}"></div>
  <div class="field"><span class="lbl">${t('Your emoji')}</span><div class="row emorow">${EMOJIS.map((e) => `<button class="emo-btn" data-act="pEmoji" data-v="${e}" aria-pressed="${d.emoji === e}">${e}</button>`).join('')}</div></div>
  <div class="field"><span class="lbl">${t('Your color')}</span><div class="row">${PALETTE.map((c) => `<button class="cdot" data-act="pColor" data-v="${c}" style="background:${c}" aria-pressed="${d.color === c}" aria-label="${c}"></button>`).join('')}</div></div>
  <div class="field"><span class="lbl">${t('Theme')}</span><div class="themes">${THEMES.map((th) => `<button class="tbtn" data-act="theme" data-v="${th.id}" aria-pressed="${THEME === th.id}">${swatchHTML(th)}${themeName(th, LANG)}</button>`).join('')}</div></div>
  <div class="field"><span class="lbl">${t('Language')}</span><div class="seg" role="group"><button data-act="lang" data-v="en" aria-pressed="${LANG === 'en'}">English</button><button data-act="lang" data-v="es" aria-pressed="${LANG === 'es'}">Español</button></div></div>
  <p class="meta" style="margin:0">${t('Your main calendar is used in {n} of your {m} groups.', { n: mainUsers(S.me), m: myGroups().length })}</p>
  ${editable() ? `<button class="btn primary full" data-act="pSave">${t('Save')}</button>` : ''}
  <div class="row"><a class="btn" href="#/">${t('How it works')}</a><button class="btn danger" data-act="signOut" style="margin-left:auto">${S.mode === 'demo' ? t('Exit demo') : isGuest() ? t('Leave (as a guest you lose access)') : t('Sign out')}</button></div>`;
}

/* ---------- actions ---------- */
function setMainDays(days) { S.profile = { ...(S.profile || {}), mainDays: days }; saveMain(days); }
function setMyDays(days) {
  const cutoff = dkey(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1)); for (const x of Object.keys(days)) if (x < cutoff) delete days[x];
  if (modeOf(S.me) === 'own') { S.gAvail[S.me] = { ...(S.gAvail[S.me] || {}), days }; saveOwn(S.gid, days); }
  else setMainDays(days);
}
function setMyDay(k, entry) { const days = { ...myDays() }; if (entry) days[k] = entry; else delete days[k]; setMyDays(days); }
function brushEntry() { const b = S.brush; if (b.s === 'clear') return null; if (b.s === 'away') return { s: 'away', t: 'all' }; const e = { s: b.s, t: b.t }; if (b.t === 'custom') { e.from = b.from; e.to = b.to; } return e; }
const sameEntry = (a, b) => a && b && a.s === b.s && SK(a.t) === SK(b.t) && (a.t !== 'custom' || (a.from === b.from && a.to === b.to));
/* accepting a plan marks you busy at that time, in your main calendar and in any group with its own calendar */
function busyEntry(o, pid, title) { return o.allDay ? { s: 'busy', t: 'all', plan: pid, title: title || '' } : { s: 'busy', t: 'custom', from: o.time || '19:00', to: o.end || addHours(o.time, 2), plan: pid, title: title || '' }; }
function markPlanBusy(pid, on) {
  const p = S.plans[pid], o = planSlot(p); if ((on && !o) || !p || !S.me) return;
  const entry = on ? busyEntry(o, pid, p.title) : null;
  const apply = (days) => { if (on) { const cur = days[o.date]; if (cur && cur.s === 'away') return false; days[o.date] = entry; return true; }
    let changed = false; for (const k of Object.keys(days)) if (days[k] && days[k].plan === pid) { delete days[k]; changed = true; } return changed; };
  const main = { ...(S.profile?.mainDays || {}) }; if (apply(main)) setMainDays(main);
  if (modeOf(S.me) === 'own') { const own = { ...(S.gAvail[S.me]?.days || {}) }; if (apply(own)) { S.gAvail[S.me] = { ...(S.gAvail[S.me] || {}), days: own }; saveOwn(S.gid, own); } }
  if (on && live()) for (const [gid, g] of myGroups()) if (gid !== S.gid && modeOf(S.me, g) === 'own') B.update(`groups/${gid}/avail/${S.me}`, { ['days.' + o.date]: entry }).catch(() => {});
}
/* place: plain text (restaurant, address) or a pasted Google Maps link */
const isUrl = (v) => /^https?:\/\//i.test((v || '').trim());
const mapsUrl = (v) => { v = (v || '').trim(); if (!v) return ''; return isUrl(v) ? v : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`; };
const placeText = (v) => (isUrl(v) ? t('Location on Google Maps') : v);
function mapQuery(v) {
  v = (v || '').trim(); if (!isUrl(v)) return v;
  try { const u = new URL(v), q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination'); if (q) return q;
    const pl = u.pathname.match(/\/place\/([^/]+)/); if (pl) return decodeURIComponent(pl[1].replace(/\+/g, ' '));
    const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if (at) return at[1] + ',' + at[2]; } catch (e) {}
  return ''; // short links (maps.app.goo.gl) can't be previewed, the button still opens them
}
const embedUrl = (v) => { const q = mapQuery(v); return q ? `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed` : ''; };
const dirUrl = (v) => { const q = mapQuery(v); return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : mapsUrl(v); };
const mapFrame = (v) => { const e = embedUrl(v); return e ? `<iframe class="mapframe" src="${esc(e)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(t('Map'))}"></iframe>` : ''; };
function mapBlock(v) {
  return `<div class="mapbox">${mapFrame(v)}<div class="row"><a class="btn sm" href="${esc(mapsUrl(v))}" target="_blank" rel="noopener noreferrer">📍 ${t('Open in Google Maps')}</a><a class="btn sm" href="${esc(dirUrl(v))}" target="_blank" rel="noopener noreferrer">🧭 ${t('Directions')}</a></div></div>`;
}
const mapsLink = (v) => (v ? `<a class="maplink" href="${esc(mapsUrl(v))}" target="_blank" rel="noopener noreferrer">${t('Open in Google Maps')} ↗</a>` : '');
const newDraft = (opts) => ({ type: 'Dinner', title: '', options: opts || [optFromSlot(TK, 'pm')], place: '', note: '', invited: [] });
function readForm() { const d = S.draft; if (!d) return; const a = $('#fTitle'); if (a) d.title = a.value; const b = $('#fPlace'); if (b) d.place = b.value; const c = $('#fNote'); if (c) d.note = c.value; }
function setGroupLocal(patch) { S.groups[S.gid] = { ...G(), ...patch }; }
function setMemberLocal(id, patch) { const g = G(); g.members = { ...g.members, [id]: { ...(g.members[id] || {}), ...patch } }; }

function savePlan() {
  const d = S.draft; readForm();
  if (d.options.some((o) => !o.date || o.date < TK)) { toast(t('Pick dates from today on.')); return; }
  if (d.options.some((o) => !o.allDay && !o.time)) { toast(t('Pick a start time, or mark it as all day.')); return; }
  const body = { title: d.title.trim() || t(d.type), type: d.type, options: d.options.map((o) => (o.allDay ? { date: o.date, allDay: true, time: '', end: '' } : { date: o.date, allDay: false, time: o.time, end: o.end || '' })),
    place: d.place.trim(), note: d.note.trim(), invited: d.invited, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
  if (d.id) {
    const old = S.plans[d.id], merged = { ...old, ...body };
    if (body.options.length !== old.options.length) { merged.votes = {}; merged.status = 'open'; merged.chosen = 0; }
    const wasBusy = old.rsvp?.[S.me] === 'yes' || old.createdBy === S.me;
    S.plans[d.id] = merged; W(() => B.set(gp('plans/' + d.id), merged));
    if (wasBusy) { markPlanBusy(d.id, false); markPlanBusy(d.id, true); }
    toast(t('Plan updated'));
  } else {
    const p = { ...body, status: 'open', chosen: 0, votes: body.options.length > 1 ? { [S.me]: [] } : {}, rsvp: { [S.me]: 'yes' }, createdBy: S.me, createdAt: Date.now() };
    const id = newId(gp('plans')); S.plans[id] = p; W(() => B.set(gp('plans/' + id), p)); if (p.options.length === 1) markPlanBusy(id, true);
    toast(p.options.length > 1 ? t('Sent. The group can vote now.') : t('Proposed. Friends can answer now.'));
  }
  closeSheet(); S.tab = 'plans'; rememberUI(); render();
}
function switchGroup(id) {
  if (S.gid === id && S.mode !== 'off') { closeSheet(); render(); return; }
  S.gid = id; S.plans = {}; S.comments = {}; S.gAvail = S.mode === 'demo' ? DEMO.avail[id] || {} : {};
  if (S.mode === 'demo') { S.plans = DEMO.plans[id] || {}; S.comments = DEMO.comments[id] || {}; }
  rememberUI(); closeSheet(); subscribeGroup(); render();
}
function parseInvite(v) { v = (v || '').trim(); const m = v.match(/join\/([a-z0-9]+)/i); return m ? m[1] : /^[a-z0-9]{8,}$/i.test(v) ? v : null; }
async function joinByCode(code) {
  if (S.pendingInvite === code) { S.pendingInvite = null; S.inviteInfo = null; } try { localStorage.removeItem('wwm.invite'); } catch (e) {}
  if (S.mode === 'demo') { toast(t('Invites work in your real account, not in the demo.')); return; }
  let inv = null; try { inv = await B.get('invites/' + code); } catch (e) {}
  if (!inv) { toast(t('This invite link is not valid anymore. Ask for a new one.')); render(); return; }
  if (S.groups[inv.gid]) { S.tab = 'home'; switchGroup(inv.gid); maybeJoin(); return; }
  try {
    const me = { ...myLook(), joinedAt: Date.now(), availMode: 'main' };
    await B.update('groups/' + inv.gid, { memberIds: B.arrayUnion(S.me), ['members.' + S.me]: me, joinCode: code });
    await B.set(`groups/${inv.gid}/avail/${S.me}`, { days: S.profile?.mainDays || {}, updatedAt: Date.now() });
    if (isGuest()) B.rememberGuestJoin(code);
    S.preferGid = inv.gid; S.tab = 'home';
    if (S.groups[inv.gid]) switchGroup(inv.gid); else { S.gid = inv.gid; rememberUI(); }
    toast(t('You joined {g}.', { g: inv.groupName || '' }));
  } catch (e) { writeError(e); }
  render();
}
function maybeJoin() {
  if (!(live() && S.gotProfile && S.gotGroups && myName()) || S.joining) return;
  const code = S.pendingInvite || S.inviteQueue?.shift(); if (!code) return;
  S.joining = true; joinByCode(code).finally(() => { S.joining = false; maybeJoin(); });
}
async function loadInviteInfo(code) { try { S.inviteInfo = await B.get('invites/' + code); } catch (e) { S.inviteInfo = null; } render(); }
export function setPendingInvite(code) { S.pendingInvite = code; try { localStorage.setItem('wwm.invite', code); } catch (e) {} if (live()) loadInviteInfo(code); maybeJoin(); }

let onExit = () => {};
document.addEventListener('input', (e) => {
  if (S.mode === 'off') return;
  const el = e.target;
  if (el.dataset.opt != null && S.draft) { S.draft.options[+el.dataset.opt][el.dataset.f] = el.value; }
  if (el.id === 'bFrom') S.brush.from = el.value; if (el.id === 'bTo') S.brush.to = el.value; if (el.id === 'gName' && S.gDraft) S.gDraft.name = el.value;
  if (el.id === 'fPlace' && S.draft) { S.draft.place = el.value; clearTimeout(S.mapT); S.mapT = setTimeout(() => { const m = $('#fMap'); if (m && S.draft) m.innerHTML = S.draft.place.trim() ? mapFrame(S.draft.place) : ''; }, 700); const h = $('#fPlaceLink'); if (h) h.innerHTML = el.value.trim() ? mapsLink(el.value) + ' · ' + t('check it finds the right place') : t('Type a place or paste a link from Google Maps. Everyone gets a button to open it.'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
document.addEventListener('click', (e) => {
  if (S.mode === 'off') return;
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const a = el.dataset.act, v = el.dataset.v;
  if (a !== 'delPlan') S.confirmDel = null; if (a !== 'leaveGroup') S.confirmLeave = false; if (a !== 'kick') S.confirmKick = null; if (a !== 'resetInvite') S.confirmReset = false;
  switch (a) {
    case 'lang': setLang(v); if (live() && S.profile) W(() => B.update('users/' + S.me, { lang: v })); render(); break;
    case 'tab': S.tab = v; closeSheet(); rememberUI(); render(); scrollTo(0, 0); break;
    case 'calView': S.calView = v; rememberUI(); render(); break;
    case 'toggleMonth': S.open.has(v) ? S.open.delete(v) : S.open.add(v); rememberUI(); render(); break;
    case 'brushS': S.brush.s = v; render(); break;
    case 'brushT': S.brush.t = v; render(); break;
    case 'repeatToggle': S.repeatOpen = !S.repeatOpen; render(); break;
    case 'day': { const k = el.dataset.k; if (DRAG.justDragged) break; if (S.calView === 'mine' && editable()) { const cur = norm(myDays()[k]), nb = brushEntry(); setMyDay(k, sameEntry(cur, nb) ? null : nb); render(); } else openSheet('day', k); break; }
    case 'paintWeekday': { const nb = brushEntry(), before = { ...myDays() }, days = { ...before }; let c = 0;
      for (const mk of S.open || []) { const [y, m] = mk.split('-').map(Number), last = new Date(y, m, 0).getDate();
        for (let d = 1; d <= last; d++) { const k = `${mk}-${pad(d)}`; if (k >= TK && wdIdx(dparse(k)) === +v) { if (nb) days[k] = nb; else delete days[k]; c++; } } }
      setMyDays(days); render(); toast(nb ? t('Marked {n} × {d} in the open months', { n: c, d: wdLong(+v) }) : t('Erased {n} × {d}', { n: c, d: wdLong(+v) }), () => { setMyDays(before); render(); }); break; }
    case 'clearAll': { if (!S.confirmClear) { S.confirmClear = true; render(); setTimeout(() => { S.confirmClear = false; render(); }, 4000); break; }
      S.confirmClear = false; const before = { ...myDays() }; setMyDays({}); render(); toast(t('All your days are cleared'), () => { setMyDays(before); render(); }); break; }
    case 'undo': if (undoFn) { undoFn(); undoFn = null; $('#toast').hidden = true; toast(t('Restored')); } break;
    case 'syncAsk': openSheet('sync', v); break;
    case 'syncDo': { const main = { ...(S.profile?.mainDays || {}) }, own = { ...(S.gAvail[S.me]?.days || {}) };
      if (v === 'toGroup') { S.gAvail[S.me] = { ...(S.gAvail[S.me] || {}), days: { ...main } }; saveOwn(S.gid, { ...main });
        closeSheet(); render(); toast(t('{g} now matches your main calendar.', { g: G().name }), () => { S.gAvail[S.me] = { ...(S.gAvail[S.me] || {}), days: own }; saveOwn(S.gid, own); render(); }); }
      else { setMainDays({ ...own }); closeSheet(); render(); toast(t('Your main calendar now matches {g}.', { g: G().name }), () => { setMainDays(main); render(); }); }
      break; }
    case 'calMode': { if (modeOf(S.me) === v) break;
      const main = S.profile?.mainDays || {};
      if (v === 'own') { const days = markedCount(S.gAvail[S.me]?.days) ? S.gAvail[S.me].days : { ...main }; S.gAvail[S.me] = { days }; saveOwn(S.gid, days); }
      else { S.gAvail[S.me] = { days: { ...main } }; saveOwn(S.gid, { ...main }); }
      setMemberLocal(S.me, { availMode: v }); W(() => B.update('groups/' + S.gid, { ['members.' + S.me + '.availMode']: v }));
      toast(v === 'own' ? t('This group now has its own calendar, copied from your main one.') : t('This group now uses your main calendar.')); render(); break; }
    case 'propose': S.draft = newDraft([optFromSlot(el.dataset.k, el.dataset.slot || 'pm')]); openSheet('form'); break;
    case 'pollSugg': S.draft = newDraft(suggestions(3).map((s) => optFromSlot(s.k, s.slot))); openSheet('form'); break;
    case 'newPlan': S.draft = newDraft(); openSheet('form'); break;
    case 'editPlan': { const p = S.plans[el.dataset.id]; S.draft = { id: el.dataset.id, type: p.type, title: p.title, options: p.options.map((o) => ({ ...o })), place: p.place || '', note: p.note || '', invited: [...(p.invited || [])] }; openSheet('form'); break; }
    case 'fType': readForm(); S.draft.type = v; renderSheet(); break;
    case 'fAllDay': { readForm(); const o = S.draft.options[+el.dataset.i]; o.allDay = !o.allDay; if (!o.allDay && !o.time) o.time = '19:00'; renderSheet(); break; }
    case 'fAddOpt': { readForm(); const lo = S.draft.options[S.draft.options.length - 1], nd = dparse(lo.date || TK); nd.setDate(nd.getDate() + 1); S.draft.options.push({ ...lo, date: dkey(nd) }); renderSheet(); break; }
    case 'fDelOpt': readForm(); S.draft.options.splice(+el.dataset.i, 1); renderSheet(); break;
    case 'fInvAll': readForm(); S.draft.invited = []; renderSheet(); break;
    case 'fInv': { readForm(); const ids = memberIds(); let inv = S.draft.invited.length ? [...S.draft.invited] : [...ids];
      inv = inv.includes(v) ? inv.filter((x) => x !== v) : [...inv, v]; if (S.me && !inv.includes(S.me)) inv.push(S.me); S.draft.invited = inv.length >= ids.length ? [] : inv; renderSheet(); break; }
    case 'fSave': savePlan(); break;
    case 'openPlan': openSheet('plan', el.dataset.id); break;
    case 'ics': downloadIcs(S.plans[el.dataset.id], el.dataset.id); break;
    case 'rsvp': { const id = el.dataset.id; S.plans[id] = { ...S.plans[id], rsvp: { ...(S.plans[id].rsvp || {}), [S.me]: v } }; W(() => B.update(gp('plans/' + id), { ['rsvp.' + S.me]: v })); markPlanBusy(id, v === 'yes'); render(); toast(v === 'yes' ? t("You're in. Marked as busy in your calendar.") : t('Answer saved')); break; }
    case 'vote': { const id = el.dataset.id, i = +el.dataset.i, cur = [...(S.plans[id].votes?.[S.me] || [])], nv = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
      S.plans[id] = { ...S.plans[id], votes: { ...(S.plans[id].votes || {}), [S.me]: nv } }; W(() => B.update(gp('plans/' + id), { ['votes.' + S.me]: nv })); render(); break; }
    case 'voteNone': { const id = el.dataset.id; S.plans[id] = { ...S.plans[id], votes: { ...(S.plans[id].votes || {}), [S.me]: [] } }; W(() => B.update(gp('plans/' + id), { ['votes.' + S.me]: [] })); render(); break; }
    case 'confirm': { const id = el.dataset.id, i = +el.dataset.i; S.plans[id] = { ...S.plans[id], status: 'confirmed', chosen: i }; W(() => B.update(gp('plans/' + id), { status: 'confirmed', chosen: i })); if (S.plans[id].rsvp?.[S.me] === 'yes' || S.plans[id].createdBy === S.me || (S.plans[id].votes?.[S.me] || []).includes(i)) markPlanBusy(id, true); toast(t("Confirmed. It's on.")); render(); break; }
    case 'reopen': { const id = el.dataset.id; if (S.plans[id].options.length > 1) markPlanBusy(id, false); S.plans[id] = { ...S.plans[id], status: 'open' }; W(() => B.update(gp('plans/' + id), { status: 'open' })); render(); break; }
    case 'delPlan': { const id = el.dataset.id; if (S.confirmDel !== id) { S.confirmDel = id; renderSheet(); break; } S.confirmDel = null; markPlanBusy(id, false); delete S.plans[id]; W(() => B.del(gp('plans/' + id))); closeSheet(); toast(t('Plan deleted')); render(); break; }
    case 'comment': { const id = el.dataset.id, txt = $('#cText').value.trim(); if (!txt) break; const c = { planId: id, by: S.me, text: txt, at: Date.now() }, cid = newId(gp('comments'));
      S.comments[cid] = c; W(() => B.set(gp('comments/' + cid), c)); renderSheet(); render(); break; }
    case 'copyMsg': { const p = S.plans[el.dataset.id], multi = p.status !== 'confirmed' && p.options.length > 1, who = p.createdBy === S.me ? myName() : nameOf(p.createdBy), where = p.place ? `, ${placeText(p.place)}` : '';
      let txt = multi ? t('New vote in WhenWeMeet: {t}. Options: {o}. Vote in the app.', { t: p.title, o: p.options.map(optLabel).join(', ') })
        : p.status === 'confirmed' ? t("It's on: {t}, {w}{p}. Details in WhenWeMeet.", { t: p.title, w: planWhen(p), p: where })
          : t('{n} proposed {t}, {w}{p}. Are you in? Answer in WhenWeMeet.', { n: who, t: p.title, w: planWhen(p), p: where });
      if (p.place) txt = `${txt}\n${t('Map')}: ${mapsUrl(p.place)}`;
      txt += `\n${location.origin}${location.pathname}#/app`;
      copyText(txt, t('Copied. Paste it in your group chat.')); break; }
    case 'copyInvite': copyText($('#inviteBox').value, t('Invite link copied. Send it to your people.')); break;
    case 'shareInvite': navigator.share({ title: 'WhenWeMeet', text: t('Join {g} on WhenWeMeet', { g: G().name }), url: $('#inviteBox').value }).catch(() => {}); break;
    case 'resetInvite': { if (!S.confirmReset) { S.confirmReset = true; renderSheet(); break; } S.confirmReset = false; resetInvite(); break; }
    case 'kick': { if (S.confirmKick !== v) { S.confirmKick = v; renderSheet(); break; } S.confirmKick = null; const g = G(); const mem = { ...g.members }; delete mem[v];
      S.groups[S.gid] = { ...g, members: mem, memberIds: (g.memberIds || []).filter((x) => x !== v) };
      W(() => B.update('groups/' + S.gid, { memberIds: B.arrayRemove(v), ['members.' + v]: B.deleteField() })); renderSheet(); render(); toast(t('Removed from the group.')); break; }
    case 'groups': openSheet('groups'); break;
    case 'switchGroup': S.preferGid = null; switchGroup(v); break;
    case 'createGroup': createGroup(); break;
    case 'joinLink': { const code = parseInvite($('#inviteIn').value); if (!code) { toast(t("That doesn't look like an invite link.")); break; } closeSheet(); joinByCode(code); break; }
    case 'leaveGroup': { if (!S.confirmLeave) { S.confirmLeave = true; renderSheet(); break; } S.confirmLeave = false; const gid = S.gid, g = G();
      W(() => B.update('groups/' + gid, { memberIds: B.arrayRemove(S.me), ['members.' + S.me]: B.deleteField() }));
      delete S.groups[gid]; void g; const next = myGroups()[0]; closeSheet();
      if (next) switchGroup(next[0]); else { S.gid = null; subscribeGroup(); render(); } toast(t('You left the group.')); break; }
    case 'gsettings': openSheet('gsettings'); break;
    case 'gCount': S.gDraft.goalCount = +v; renderSheet(); break;
    case 'gPer': S.gDraft.goalPer = v; renderSheet(); break;
    case 'gMin': S.gDraft.minPeople = +v; renderSheet(); break;
    case 'gSave': { const d = S.gDraft, patch = { name: (d.name || '').trim() || G().name, emoji: d.emoji || '', goalCount: d.goalCount, goalPer: d.goalPer, minPeople: d.minPeople };
      setGroupLocal(patch); W(() => B.update('groups/' + S.gid, patch)); closeSheet(); toast(t('Saved')); render(); break; }
    case 'profile': openSheet('profile'); break;
    case 'pSave': { const n = $('#pName').value.trim() || myName(); saveLook({ name: n, emoji: S.pDraft.emoji, color: S.pDraft.color }); S.pDraft = null; closeSheet(); toast(t('Saved')); render(); break; }
    case 'pEmoji': S.pDraft.emoji = v; S.pDraft.name = $('#pName').value; renderSheet(); $('#pName').value = S.pDraft.name; break;
    case 'pColor': S.pDraft.color = v; S.pDraft.name = $('#pName').value; renderSheet(); $('#pName').value = S.pDraft.name; break;
    case 'theme': setTheme(v); if (live() && S.profile) W(() => B.update('users/' + S.me, { theme: v })); if (S.sheet) { const nm = $('#pName')?.value; renderSheet(); if (nm != null && $('#pName')) $('#pName').value = nm; } break;
    case 'newGEmoji': { S.newGEmoji = v; const nm = $('#newGroup')?.value; render(); if (S.sheet) renderSheet(); if ($('#newGroup')) $('#newGroup').value = nm || ''; break; }
    case 'gEmoji': S.gDraft.emoji = v; renderSheet(); break;
    case 'join': { const n = $('#joinName').value.trim(); if (!n) { toast(t('Add a name first.')); $('#joinName').focus(); break; } saveLook({ name: n, emoji: S.joinEmoji || person(S.me).emoji }); render(); maybeJoin(); break; }
    case 'joinEmoji': { const nm = $('#joinName')?.value; S.joinEmoji = v; render(); if ($('#joinName')) $('#joinName').value = nm || ''; break; }
    case 'signOut': closeSheet(); onExit(); break;
    case 'closeSheet': closeSheet(); break;
  }
});
function copyText(txt, ok) {
  const fb = () => { const b = $('#copyBox') || $('#inviteBox'); if (b) { b.hidden = false; b.value = txt; b.select(); } toast(t('Select the text and copy it')); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(() => toast(ok), fb); else fb();
}
const myLook = () => { const p = person(S.me); return { name: myName(), emoji: p.emoji, color: p.color }; };
/* name, emoji and color live in your profile and are copied into each group you're in */
function saveLook(patch) {
  S.profile = { ...(S.profile || {}), ...patch };
  if (S.mode === 'demo') { for (const [, g] of myGroups()) if (g.members[S.me]) Object.assign(g.members[S.me], patch); return; }
  if (!live()) return;
  const look = myLook(), gpatch = {}; for (const k of ['name', 'emoji', 'color']) gpatch['members.' + S.me + '.' + k] = look[k];
  W(() => B.batch([['update', 'users/' + S.me, look], ...myGroups().map(([gid]) => ['update', 'groups/' + gid, gpatch])]));
}
async function createGroup() {
  const inp = $('#newGroup'), n = inp.value.trim(); if (!n) { toast(t('Give the group a name first.')); inp.focus(); return; }
  const now = Date.now(), code = randCode(), id = newId('groups');
  const g = { name: n, emoji: S.newGEmoji || '🍻', goalCount: 1, goalPer: 'month', minPeople: 3, createdBy: S.me, createdAt: now, inviteCode: code, memberIds: [S.me], members: { [S.me]: { ...myLook(), joinedAt: now, availMode: 'main' } } };
  S.groups[id] = g; S.preferGid = id; S.tab = 'home';
  if (S.mode === 'demo') { DEMO.avail[id] = {}; DEMO.plans[id] = {}; DEMO.comments[id] = {}; }
  switchGroup(id); toast(t('{g} is ready. Copy the invite link and send it to your people.', { g: n }));
  await W(async () => {
    await B.batch([['set', 'groups/' + id, g], ['set', 'invites/' + code, { gid: id, groupName: n, emoji: g.emoji, createdBy: S.me, createdAt: now }]]);
    await B.set(`groups/${id}/avail/${S.me}`, { days: S.profile?.mainDays || {}, updatedAt: now });
  });
}
async function resetInvite() {
  const g = G(), old = g.inviteCode, code = randCode();
  if (S.mode === 'demo') { toast(t('New link ready. The old one no longer works.')); return; }
  setGroupLocal({ inviteCode: code }); renderSheet();
  await W(() => B.batch([['set', 'invites/' + code, { gid: S.gid, groupName: g.name, emoji: g.emoji || '', createdBy: S.me, createdAt: Date.now() }], ['update', 'groups/' + S.gid, { inviteCode: code }], ...(old ? [['delete', 'invites/' + old]] : [])]));
  toast(t('New link ready. The old one no longer works.'));
}

/* ---------- drag to mark several days ---------- */
const DRAG = { on: false, timer: null, start: null, mode: null, entry: null, touched: new Set(), before: null, days: null, justDragged: false };
function cellLabel(e) { return e ? (e.s === 'away' ? t('AWAY') : e.s === 'busy' && SK(e.t) === 'all' ? t('BUSY') : esc(slotShort(e))) : ''; }
function paintCell(el) {
  const k = el.dataset.k; if (!k || k < TK || DRAG.touched.has(k)) return; DRAG.touched.add(k);
  if (DRAG.mode === 'erase') delete DRAG.days[k]; else DRAG.days[k] = DRAG.entry;
  const e = norm(DRAG.days[k]); el.classList.remove('s-free', 's-busy', 's-away');
  let lab = el.querySelector('.lab'); if (e) { el.classList.add('s-' + e.s); if (!lab) { lab = document.createElement('span'); lab.className = 'lab'; el.querySelector('.n').after(lab); } lab.innerHTML = cellLabel(e); } else if (lab) lab.remove();
  el.classList.add('dragged');
}
const canPaint = () => S.mode !== 'off' && S.tab === 'cal' && S.calView === 'mine' && editable() && !S.sheet;
function dragStart(el) {
  if (!canPaint()) return;
  const k = el.dataset.k, nb = brushEntry(); DRAG.before = { ...myDays() }; DRAG.days = { ...DRAG.before }; DRAG.touched = new Set();
  DRAG.entry = nb; DRAG.mode = !nb || sameEntry(norm(DRAG.before[k]), nb) ? 'erase' : 'paint'; DRAG.on = true;
  document.body.classList.add('dragging'); try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
  paintCell(el);
}
function dragOver(x, y) { if (!DRAG.on) return; const el = document.elementFromPoint(x, y)?.closest('.day'); if (el && !el.classList.contains('past')) paintCell(el); }
function dragEnd() {
  clearTimeout(DRAG.timer); DRAG.timer = null; DRAG.start = null; if (!DRAG.on) return;
  DRAG.on = false; document.body.classList.remove('dragging');
  const n = DRAG.touched.size, before = DRAG.before;
  DRAG.justDragged = true; setTimeout(() => (DRAG.justDragged = false), 400); setMyDays(DRAG.days); render();
  if (n > 1) toast(DRAG.mode === 'erase' ? t('Erased {n} days', { n }) : t('Marked {n} days', { n }), () => { setMyDays(before); render(); });
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return; const el = e.target.closest('#app .day'); if (!el || el.classList.contains('past') || !canPaint()) return;
  e.preventDefault(); dragStart(el);
});
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && DRAG.on) dragOver(e.clientX, e.clientY); });
document.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') dragEnd(); });
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest('#app .day'); if (!el || el.classList.contains('past') || e.touches.length > 1 || !canPaint()) return;
  const tc = e.touches[0]; DRAG.start = { x: tc.clientX, y: tc.clientY }; clearTimeout(DRAG.timer);
  DRAG.timer = setTimeout(() => { DRAG.timer = null; if (DRAG.start) dragStart(el); }, 250);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const tc = e.touches[0];
  if (DRAG.on) { e.preventDefault(); dragOver(tc.clientX, tc.clientY); return; }
  if (DRAG.start && Math.hypot(tc.clientX - DRAG.start.x, tc.clientY - DRAG.start.y) > 8) { clearTimeout(DRAG.timer); DRAG.timer = null; DRAG.start = null; }
}, { passive: false });
document.addEventListener('touchend', dragEnd);
document.addEventListener('touchcancel', dragEnd);
document.addEventListener('contextmenu', (e) => { if (DRAG.on || e.target.closest('#app .day')) e.preventDefault(); });

/* ---------- live data ---------- */
let subs = [], groupSubs = [];
const unsub = (arr) => { arr.forEach((u) => u()); arr.length = 0; };
function subscribeGroup() {
  unsub(groupSubs); if (!live() || !S.gid || !S.groups[S.gid]) return; const gid = S.gid;
  groupSubs.push(B.listenCol(`groups/${gid}/avail`, (a) => { if (S.gid !== gid) return; if (S.me && busyKey('own:' + gid) && S.gAvail[S.me]) a[S.me] = S.gAvail[S.me]; S.gAvail = a; render(); }));
  groupSubs.push(B.listenCol(`groups/${gid}/plans`, (p) => { if (S.gid !== gid) return; S.plans = p; render(); }));
  groupSubs.push(B.listenCol(`groups/${gid}/comments`, (c) => { if (S.gid !== gid) return; S.comments = c; render(); }));
}
function pickGroup() {
  if (S.preferGid && S.groups[S.preferGid] && S.gid !== S.preferGid) { S.gid = S.preferGid; S.preferGid = null; S.plans = {}; S.comments = {}; S.gAvail = {}; return true; }
  if (S.gid && S.groups[S.gid]) return false;
  if (S.preferGid && S.gid === S.preferGid) return false; // just joined, waiting for the snapshot
  const next = myGroups()[0]?.[0] || null; if (next !== S.gid) { S.gid = next; S.plans = {}; S.comments = {}; S.gAvail = {}; return true; } return false;
}
export function startLive(user, exit) {
  stop(); onExit = exit || onExit; setToday();
  Object.assign(S, { mode: 'live', me: user.uid, user, profile: null, groups: {}, gAvail: {}, plans: {}, comments: {}, gotProfile: false, gotGroups: false });
  try { const c = localStorage.getItem('wwm.invite'); if (c && !S.pendingInvite) S.pendingInvite = c; } catch (e) {}
  S.inviteQueue = user.isAnonymous ? [] : B.takeGuestCodes(); // switched from a guest session to an existing account: re-join those groups
  if (S.pendingInvite) loadInviteInfo(S.pendingInvite);
  const uid = user.uid;
  subs.push(B.listenDoc('users/' + uid, (p) => {
    if (!p) {
      const first = { name: (user.displayName || '').split(' ')[0] || '', emoji: defEmoji(uid), color: colorOf(uid), lang: LANG, theme: THEME, mainDays: {}, createdAt: Date.now() };
      S.profile = first; B.set('users/' + uid, first).catch(writeError);
    } else {
      const keep = busyKey('main') && S.profile?.mainDays;
      const pendingName = S.profile?.name && !p.name ? S.profile.name : null;
      S.profile = { ...p, mainDays: keep ? S.profile.mainDays : p.mainDays || {}, ...(pendingName ? { name: pendingName } : {}) };
      if (!S.gotProfile && p.lang && p.lang !== LANG) setLang(p.lang);
      if (!S.gotProfile && p.theme && p.theme !== THEME) setTheme(p.theme);
    }
    S.gotProfile = true; maybeJoin(); render();
  }, (e) => { console.error(e); toast(t('Could not load your profile.')); }));
  subs.push(B.listenMyGroups(uid, (g) => {
    S.groups = g; S.gotGroups = true;
    if (pickGroup() || !groupSubs.length) subscribeGroup();
    rememberUI(); maybeJoin(); render();
  }, (e) => { console.error(e); toast(t('Could not load your groups.')); }));
  render();
}
export function stop() { unsub(subs); unsub(groupSubs); closeSheetSafe(); S.mode = 'off'; }
function closeSheetSafe() { if ($('#sheet')) closeSheet(); }

/* ---------- demo ---------- */
const DEMO = { avail: {}, plans: {}, comments: {} };
export function startDemo(exit) {
  stop(); onExit = exit || onExit; setToday();
  Object.assign(S, { mode: 'demo', me: 'd1', user: null, groups: {}, gAvail: {}, plans: {}, comments: {}, tab: 'home', profile: { name: t('You'), emoji: '🙋', color: '#F2C14E', mainDays: {} } });
  const LOOK = { d1: ['🙋', '#F2C14E'], d2: ['🦊', '#C084FC'], d3: ['🐼', '#3DDC97'], d4: ['🦄', '#F472B6'], d5: ['🐻', '#60A5FA'], d6: ['🦉', '#FB923C'], d7: ['🎸', '#22D3EE'] };
  const names = [['d1', t('You')], ['d2', 'Ana'], ['d3', 'Luis'], ['d4', 'Sofía'], ['d5', 'Tomáš'], ['d6', 'Marta'], ['d7', 'Jan']];
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const daysFor = () => { const days = {}; for (let i = 0; i < 45; i++) { const d = new Date(TODAY); d.setDate(d.getDate() + i); const we = wdIdx(d) >= 5, r = rnd();
    if (r < (we ? 0.55 : 0.4)) days[dkey(d)] = { s: 'free', t: we ? 'all' : 'pm' }; else if (r < 0.5) days[dkey(d)] = { s: 'away', t: 'all' }; } return days; };
  const mainOf = {}; for (const [id] of names) if (id !== 'd1') mainOf[id] = daysFor();
  const mem = (ids) => Object.fromEntries(ids.map((id, i) => [id, { name: names.find((n) => n[0] === id)[1], emoji: LOOK[id][0], color: LOOK[id][1], joinedAt: i, availMode: 'main' }]));
  S.groups = {
    g1: { name: t('Dinner crew (example)'), emoji: '🍽️', goalCount: 1, goalPer: 'month', minPeople: 3, createdBy: 'd1', createdAt: 1, members: mem(['d1', 'd2', 'd3', 'd4']) },
    g2: { name: t('Us two (example)'), emoji: '💑', goalCount: 1, goalPer: 'week', minPeople: 2, createdBy: 'd1', createdAt: 2, members: mem(['d1', 'd5']) },
    g3: { name: t('Book club (example)'), emoji: '📚', goalCount: 2, goalPer: 'month', minPeople: 3, createdBy: 'd6', createdAt: 3, members: mem(['d1', 'd2', 'd6', 'd7']) },
  };
  for (const gid of Object.keys(S.groups)) { DEMO.avail[gid] = {}; for (const id of Object.keys(S.groups[gid].members)) if (id !== 'd1') DEMO.avail[gid][id] = { days: mainOf[id] }; DEMO.plans[gid] = {}; DEMO.comments[gid] = {}; }
  S.gid = 'g1'; S.gAvail = DEMO.avail.g1; S.plans = DEMO.plans.g1; S.comments = DEMO.comments.g1;
  const s = suggestions(3);
  if (s.length) S.plans.demo1 = { title: 'Tacos at Las Adelitas', type: 'Dinner', options: [{ date: s[0].k, allDay: false, time: '19:30', end: '' }], invited: [], rsvp: { d2: 'yes', d3: 'maybe' }, votes: {}, status: 'open', chosen: 0, place: 'Las Adelitas, Vinohrady, Praha', note: '', createdBy: 'd2', createdAt: 1 };
  if (s.length > 1) S.plans.demo2 = { title: 'Weekend in Český Krumlov', type: 'Trip', options: s.slice(0, 3).map((x) => ({ date: x.k, allDay: true, time: '', end: '' })), invited: [], votes: { d3: [0, 1], d4: [1] }, rsvp: {}, status: 'open', chosen: 0, place: '', note: '', createdBy: 'd3', createdAt: 2 };
  S.comments.c1 = { planId: 'demo1', by: 'd3', text: 'Can we book for 8? I finish work late.', at: 2 };
  render();
}
