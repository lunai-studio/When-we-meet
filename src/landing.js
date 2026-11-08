/* Public pages: the animated home page and the sign-in screen. */
import { t, LANG } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- demo animation data ---------- */
const PEOPLE = [
  { n: 'Ana', c: '#C084FC', days: [1, 3, 4, 5, 8, 10, 11, 12] },
  { n: 'Luis', c: '#3DDC97', days: [0, 2, 4, 5, 6, 9, 11, 13] },
  { n: 'You', c: '#F2C14E', days: [2, 4, 5, 7, 9, 11, 12] },
];
const ALL = [4, 5, 11]; // days everyone marked
const PICK = 4; // the one we propose
function startMonday() { const d = new Date(); d.setHours(0, 0, 0, 0); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd + 7); return d; }

const STEPS = [
  ['Mark your days', 'Everyone taps the days they’re free, busy or out of town. Once. It works for every group you’re in.'],
  ['See the overlap', 'WhenWeMeet lines up everyone’s calendar and points at the days that actually work.'],
  ['Propose a time', 'Pick a day and an exact time, or let the group vote between a few options.'],
  ['It’s on', 'Lock it in. Everyone sees who’s going and adds it to Google, Apple or Outlook calendar in one tap.'],
];

let token = 0;
export function stopLanding() { token++; io?.disconnect(); io = null; }
let io = null;

export function renderLanding(root, { signedIn }) {
  stopLanding();
  const mon = startMonday();
  const cells = Array.from({ length: 14 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
  const pickDay = cap(cells[PICK].toLocaleDateString(LANG, { weekday: 'short', day: 'numeric', month: 'short' })).replace('.', '');
  const wd = (i) => cap(new Date(2024, 0, 1 + i).toLocaleDateString(LANG, { weekday: 'short' }).replace('.', '')).slice(0, 2);
  const face = (p, extra = '') => `<span class="avatar ${extra}" style="background:${p.c}">${p.n === 'You' ? (LANG === 'es' ? 'YO' : 'ME') : p.n[0]}</span>`;

  root.innerHTML = `
  <header class="lnav"><div class="lwrap lnav-in">
    <a class="logo" href="#/"><span>WhenWeMeet</span><span class="flow"></span></a>
    <div class="row" style="flex-wrap:nowrap">
      <div class="seg lang" role="group" aria-label="Language"><button data-l="lang" data-v="en" aria-pressed="${LANG === 'en'}">EN</button><button data-l="lang" data-v="es" aria-pressed="${LANG === 'es'}">ES</button></div>
      <a class="btn sm" href="${signedIn ? '#/app' : '#/login'}">${signedIn ? t('Open app') : t('Sign in')}</a>
    </div></div></header>

  <section class="hero lwrap">
    <div class="hero-txt reveal">
      <span class="mono eyebrow">${t('Group plans, minus the group-chat chaos')}</span>
      <h1>${t('Stop asking <em>“when works for everyone?”</em>')}</h1>
      <p class="lead">${t('Everyone marks their free days once. WhenWeMeet finds the overlap, you propose a plan at an exact time, and the group says yes. No endless thread.')}</p>
      <div class="ctas"><a class="btn go lg" href="${signedIn ? '#/app' : '#/login'}">${signedIn ? t('Open your groups') : t('Create your group, free')}</a><a class="btn lg" href="#/demo">${t('Try the demo')}</a></div>
      <p class="micro">${t('Private groups · English & Español · Works on any phone')}</p>
    </div>

    <div class="dp reveal" aria-hidden="true">
      <div class="dp-head"><div><span class="mono muted">${t('Group')}</span><b>${t('Dinner crew')}</b></div>
        <div class="faces">${PEOPLE.map((p, i) => face(p, 'dp-face" data-p="' + i)).join('')}</div></div>
      <div class="dp-cap"><span class="dp-num">1</span><span class="dp-txt">${t(STEPS[0][0])}</span></div>
      <div class="dp-grid">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="dp-wd ${i >= 5 ? 'we' : ''}">${wd(i)}</span>`).join('')}
        ${cells.map((d, i) => `<div class="lc ${(i % 7) >= 5 ? 'we' : ''}" data-i="${i}"><span class="n">${d.getDate()}</span><span class="lcnt">3/3</span><span class="lbars">${PEOPLE.map(() => '<i></i>').join('')}</span></div>`).join('')}</div>
      <div class="dp-plan">
        <div class="plan-row"><div><span class="mono muted">${t('Dinner')}</span><h3>${t('Tacos in Vinohrady')}</h3></div><span class="chip dp-chip">${t('Proposed')}</span></div>
        <div class="meta">${pickDay} · 19:30</div>
        <div class="plan-row" style="align-items:center"><div class="faces dp-yes">${PEOPLE.map((p) => face(p)).join('')}</div><span class="dp-cal mono">+ ${t('Calendar')}</span></div>
      </div>
      <div class="dp-dots">${STEPS.map((_, i) => `<span data-s="${i}"></span>`).join('')}</div>
    </div>
  </section>

  <section class="lsec lwrap" id="how">
    <span class="mono eyebrow">${t('How it works')}</span>
    <h2>${t('Four steps. About two minutes of effort, total.')}</h2>
    <div class="how">${STEPS.map(([h, p], i) => `<div class="how-card reveal" data-s="${i}" style="--d:${i * 80}ms"><span class="how-n">${i + 1}</span><h3>${t(h)}</h3><p>${t(p)}</p></div>`).join('')}</div>
  </section>

  <section class="lsec lwrap" id="uses">
    <span class="mono eyebrow">${t('Made for')}</span>
    <h2>${t('Any group that keeps saying “we should meet up”')}</h2>
    <div class="uses">
      <article class="use reveal" style="--d:0ms">
        <div class="ill ill-couple">${Array.from({ length: 7 }, (_, i) => `<span class="${[1, 4, 5].includes(i) ? 'both' : [0, 2, 6].includes(i) ? 'one' : ''}" style="--i:${i}"><b>${wd(i)}</b><i></i><i></i></span>`).join('')}</div>
        <span class="mono tagline">${t('Couples')}</span>
        <h3>${t('Date night, actually scheduled.')}</h3>
        <p>${t('Shifts, travel, gym, in-laws. Set a goal like “once a week”, both of you mark your days, and the app shows the evenings you’re both free.')}</p>
        <span class="chip">${t('2 people · goal 1× per week')}</span>
      </article>
      <article class="use reveal" style="--d:90ms">
        <div class="ill ill-friends">${[[4, 4], [5, 3], [6, 1]].map(([i, n]) => [cap(cells[i].toLocaleDateString(LANG, { weekday: 'short', day: 'numeric' })).replace('.', ''), n]).map(([d, n], i) => `<div class="vbar" style="--w:${n * 20}%;--i:${i}"><span>${d}</span><i></i><b>${n}</b></div>`).join('')}</div>
        <span class="mono tagline">${t('Friends')}</span>
        <h3>${t('The group chat that finally decides.')}</h3>
        <p>${t('Propose three dates, everyone votes, the winner gets locked in with a time and a place. One link to send in WhatsApp instead of 140 messages.')}</p>
        <span class="chip">${t('5 people · vote on dates')}</span>
      </article>
      <article class="use reveal" style="--d:180ms">
        <div class="ill ill-club"><div class="pips">${[0, 1].map((i) => `<span class="pip" style="--i:${i}"></span>`).join('')}</div><div class="club-rsvp"><span class="mono">RSVP</span><b class="ticker">12</b><span class="muted">${t('going')}</span></div></div>
        <span class="mono tagline">${t('Clubs')}</span>
        <h3>${t('Book club, running club, board-game night.')}</h3>
        <p>${t('Recurring meetups with a monthly goal, RSVPs for a specific time, comments for who brings what, and a place everyone can open in Maps.')}</p>
        <span class="chip">${t('12 people · goal 2× per month')}</span>
      </article>
    </div>
  </section>

  <section class="lsec lwrap privacy reveal">
    <div><span class="mono eyebrow">${t('Private by default')}</span>
      <h2>${t('Your groups are invite-only.')}</h2>
      <p class="lead">${t('Nobody can browse groups. Only people with your invite link can join, and only members see the group, its plans and who’s free. Sign in with Google or a one-time email link, no passwords.')}</p></div>
    <ul class="ticks"><li>${t('Invite link per group, which you can reset anytime')}</li><li>${t('Members only see the groups they belong to')}</li><li>${t('Your main calendar stays yours: groups get a copy, or a separate one')}</li></ul>
  </section>

  <section class="lsec lwrap final reveal">
    <h2>${t('Next time someone says “we should hang out”, send a link.')}</h2>
    <div class="ctas" style="justify-content:center"><a class="btn go lg" href="${signedIn ? '#/app' : '#/login'}">${signedIn ? t('Open your groups') : t('Create your group, free')}</a><a class="btn lg" href="#/demo">${t('Try the demo')}</a></div>
  </section>
  <footer class="lwrap lfoot"><span class="mono muted">WhenWeMeet</span><span class="muted">${t('Made in Prague')}</span></footer>`;

  // reveal on scroll
  const els = root.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduced()) {
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io && io.unobserve(e.target); } }), { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
  } else els.forEach((el) => el.classList.add('in'));
  runDemo(root);
}

/* ---------- the animated walkthrough ---------- */
function runDemo(root) {
  const my = ++token;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = () => my === token && root.isConnected;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const cell = (i) => $(`.lc[data-i="${i}"]`);
  function setStep(i) {
    $('.dp-num').textContent = i + 1;
    const txt = $('.dp-txt'); txt.classList.remove('swap'); void txt.offsetWidth; txt.textContent = t(STEPS[i][0]); txt.classList.add('swap');
    $$('.dp-dots span').forEach((d, j) => d.classList.toggle('on', j <= i));
    $$('.how-card').forEach((c) => c.classList.toggle('active', +c.dataset.s === i));
  }
  function reset() {
    $$('.lc').forEach((c) => { c.className = c.className.replace(/\b(good|pick|flash)\b/g, '').trim(); c.querySelectorAll('i').forEach((b) => (b.style.background = '')); });
    $('.dp').classList.remove('st-plan', 'st-on'); $$('.dp-yes .avatar').forEach((a) => a.classList.remove('on'));
    $('.dp-chip').textContent = t('Proposed'); $('.dp-chip').classList.remove('on'); $$('.dp-face').forEach((f) => f.classList.remove('active'));
  }
  function finalState() {
    PEOPLE.forEach((p, pi) => p.days.forEach((i) => (cell(i).querySelectorAll('i')[pi].style.background = p.c)));
    ALL.forEach((i) => cell(i).classList.add('good')); cell(PICK).classList.add('pick');
    $('.dp').classList.add('st-plan', 'st-on'); $$('.dp-yes .avatar').forEach((a) => a.classList.add('on'));
    $('.dp-chip').textContent = t('It’s on'); $('.dp-chip').classList.add('on'); setStep(3);
  }
  if (reduced()) { finalState(); return; }
  (async () => {
    while (alive()) {
      reset(); setStep(0); await sleep(500);
      for (let pi = 0; pi < PEOPLE.length && alive(); pi++) {
        const p = PEOPLE[pi]; $$('.dp-face').forEach((f, j) => f.classList.toggle('active', j === pi));
        for (const i of p.days) { if (!alive()) return; const c = cell(i); c.querySelectorAll('i')[pi].style.background = p.c; c.style.setProperty('--fc', p.c); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); await sleep(85); }
        await sleep(200);
      }
      $$('.dp-face').forEach((f) => f.classList.remove('active'));
      if (!alive()) return; setStep(1); await sleep(400);
      for (const i of ALL) { if (!alive()) return; cell(i).classList.add('good'); await sleep(260); }
      await sleep(1100); if (!alive()) return;
      setStep(2); cell(PICK).classList.add('pick'); await sleep(450); $('.dp').classList.add('st-plan'); await sleep(700);
      for (const a of $$('.dp-yes .avatar')) { if (!alive()) return; a.classList.add('on'); await sleep(380); }
      await sleep(400); if (!alive()) return;
      setStep(3); $('.dp').classList.add('st-on'); $('.dp-chip').textContent = t('It’s on'); $('.dp-chip').classList.add('on');
      await sleep(3200);
    }
  })();
}

/* ---------- sign in ---------- */
export function renderLogin(root, { hasBackend, invited, sent, error, busy }) {
  stopLanding();
  root.innerHTML = `
  <header class="lnav"><div class="lwrap lnav-in">
    <a class="logo" href="#/"><span>WhenWeMeet</span><span class="flow"></span></a>
    <div class="seg lang" role="group" aria-label="Language"><button data-l="lang" data-v="en" aria-pressed="${LANG === 'en'}">EN</button><button data-l="lang" data-v="es" aria-pressed="${LANG === 'es'}">ES</button></div>
  </div></header>
  <main class="lwrap login">
    <div class="card stack login-card">
      <div><span class="mono muted">${invited ? t('You’re invited') : t('Welcome')}</span>
        <h1>${invited ? t('Sign in to join the group') : t('Sign in to WhenWeMeet')}</h1>
        <p class="muted" style="margin:6px 0 0">${t('Your groups are private. Signing in is how we know which ones are yours.')}</p></div>
      ${!hasBackend ? `<div class="banner"><span class="mono tag">${t('Setup')}</span><div>${t('Accounts aren’t configured on this deployment yet (missing Firebase settings). You can still try the demo.')}</div></div>
        <a class="btn primary full" href="#/demo">${t('Try the demo')}</a>` : sent ? `
        <div class="banner"><span class="mono tag">${t('Sent')}</span><div>${t('Check your inbox: we sent a sign-in link to <b>{e}</b>. Open it on this device.', { e: escapeHtml(sent) })}</div></div>
        <button class="link" data-l="resend">${t('Use another email')}</button>` : `
        <button class="btn primary full gbtn" data-l="google" ${busy ? 'disabled' : ''}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>${t('Continue with Google')}</button>
        <div class="or"><span>${t('or')}</span></div>
        <div class="field"><label for="email">${t('Email')}</label><input class="input" id="email" type="email" autocomplete="email" placeholder="${t('you@example.com')}"></div>
        <button class="btn full" data-l="magic" ${busy ? 'disabled' : ''}>${t('Email me a sign-in link')}</button>`}
      ${error ? `<p class="danger" style="margin:0;font-size:13.5px">${escapeHtml(error)}</p>` : ''}
      <a class="link" href="#/" style="text-align:center">← ${t('Back to the home page')}</a>
    </div>
  </main>`;
}
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
void pad;
