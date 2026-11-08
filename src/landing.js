/* Public pages: the home page (with the animated "video" walkthrough) and the sign-in screen. */
import { t, LANG } from './i18n.js';
import { THEMES, THEME, setTheme, themeName, swatchHTML } from './theme.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the cast ---------- */
const PEOPLE = () => [
  { n: 'Ana', e: '🦊', c: '#C084FC', days: [1, 3, 4, 5, 8, 10, 11, 12] },
  { n: 'Luis', e: '🐼', c: '#3DDC97', days: [0, 2, 4, 5, 6, 9, 11, 13] },
  { n: t('You'), e: '🙋', c: '#F2C14E', days: [2, 4, 5, 7, 9, 11, 12] },
];
const ALL = [4, 5, 11]; // days everyone marked
const PICK = 4; // the one we propose
function startMonday() { const d = new Date(); d.setHours(0, 0, 0, 0); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd + 7); return d; }
const face = (p, cls = '') => `<span class="avatar emo ${cls}" style="background:${p.c}">${p.e}</span>`;
const chip = (p, i) => `<span class="pchip" data-p="${i}" style="--pc:${p.c}">${face(p)}${esc(p.n)}</span>`;

const STEPS = [
  ['Mark your days', 'Everyone taps the days they’re free, busy or out of town. Once. It works for every group you’re in.'],
  ['See the overlap', 'WhenWeMeet lines up everyone’s calendar and points at the days that actually work.'],
  ['Propose a time and place', 'Pick a day, an exact time and a spot on Google Maps, or let the group vote between a few options.'],
  ['It’s on', 'Lock it in. Everyone sees who’s going, opens the place in Maps and adds it to their calendar in one tap.'],
];

/* ---------- map illustration (stylized, not a real map) ---------- */
const mapSVG = () => `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="320" height="180" class="m-bg"/>
  <rect x="18" y="16" width="78" height="46" rx="10" class="m-park"/><rect x="250" y="120" width="60" height="50" rx="10" class="m-park"/>
  <path d="M-10 132 C 60 112, 120 162, 200 128 S 300 96, 330 116" class="m-water"/>
  <path d="M0 78 H320 M0 30 H320 M132 0 V180 M228 0 V180 M60 0 V180" class="m-road"/>
  <path d="M0 180 L132 78 M228 78 L320 10" class="m-road thin"/>
</svg>`;

let io = null;
const V = { token: 0, paused: false, visible: true, instant: false, scene: 0, elapsed: 0, root: null };
const STOP = Symbol('stop');
export function stopLanding() { V.token++; io?.disconnect(); io = null; vio?.disconnect(); vio = null; }
let vio = null;

export function renderLanding(root, { signedIn }) {
  stopLanding();
  V.root = root;
  const P = PEOPLE();
  const mon = startMonday();
  const cells = Array.from({ length: 14 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
  const dayLbl = (d) => cap(d.toLocaleDateString(LANG, { weekday: 'short', day: 'numeric' })).replace('.', '');
  const wd = (i) => cap(new Date(2024, 0, 1 + i).toLocaleDateString(LANG, { weekday: 'short' }).replace('.', '')).slice(0, 2);
  const go = signedIn ? '#/app' : '#/login';
  const goTxt = signedIn ? t('Open your groups') : t('Create your group, free');
  const me = P[2];

  root.innerHTML = `
  <header class="lnav"><div class="lwrap lnav-in">
    <a class="logo" href="#/"><span>WhenWeMeet</span><span class="flow"></span></a>
    <div class="row" style="flex-wrap:nowrap">
      ${themeMenu()}
      <div class="seg lang" role="group" aria-label="Language"><button data-l="lang" data-v="en" aria-pressed="${LANG === 'en'}">EN</button><button data-l="lang" data-v="es" aria-pressed="${LANG === 'es'}">ES</button></div>
      <a class="btn sm" href="${go}">${signedIn ? t('Open app') : t('Sign in')}</a>
    </div></div></header>

  <section class="hero lwrap">
    <div class="hero-txt reveal">
      <span class="mono eyebrow">${t('Group plans, minus the group-chat chaos')}</span>
      <h1>${t('Stop asking <em>“when works for everyone?”</em>')}</h1>
      <p class="lead">${t('Everyone marks their free days once. WhenWeMeet finds the overlap, you propose a plan at an exact time and place, and the group says yes. No endless thread.')}</p>
      <div class="ctas"><a class="btn go lg" href="${go}">${goTxt}</a><a class="btn lg" href="#/demo">${t('Try the demo')}</a></div>
      <p class="micro">${t('Private groups · Google Maps built in · English & Español')}</p>
    </div>

    <div class="vp reveal" id="vp">
      <div class="vp-stage" id="vpStage"></div>
      <div class="vp-bar">
        <button class="vp-play" data-l="play" aria-label="${t('Pause')}"><span class="ic-pause"></span></button>
        <div class="vp-segs">${SCENES.map((s, i) => `<button class="vp-seg" data-l="seek" data-v="${i}" aria-label="${esc(t(s.cap))}"><i></i></button>`).join('')}</div>
        <span class="vp-n mono"><b id="vpN">1</b>/${SCENES.length}</span>
      </div>
    </div>
  </section>

  <section class="lsec lwrap" id="how">
    <span class="mono eyebrow">${t('How it works')}</span>
    <h2>${t('Four steps. About two minutes of effort, total.')}</h2>
    <div class="how">${STEPS.map(([h, p], i) => `<div class="how-card reveal" data-s="${i}" style="--d:${i * 80}ms"><span class="how-n">${i + 1}</span><h3>${t(h)}</h3><p>${t(p)}</p></div>`).join('')}</div>
  </section>

  <section class="lsec lwrap split" id="groups">
    <div class="reveal">
      <span class="mono eyebrow">${t('One person, many groups')}</span>
      <h2>${t('Your partner, your friends, your club. One calendar.')}</h2>
      <p class="lead">${t('You don’t live in one group, so neither does WhenWeMeet. Mark your days once and every group you’re in sees them. Switch groups with one tap.')}</p>
      <ul class="ticks"><li>${t('Join as many groups as you want, each with its own plans and goals')}</li><li>${t('Your days count everywhere, or give one group its own calendar')}</li><li>${t('Accept a plan in one group and you show up as busy in the others')}</li></ul>
    </div>
    <div class="mg reveal" aria-hidden="true">
      <div class="mg-me">${face(me, 'big')}<b>${esc(me.n)}</b><span class="meta">${t('marks days once')}</span></div>
      <svg class="mg-lines" viewBox="0 0 300 70" preserveAspectRatio="none"><path d="M150 0 C150 40, 50 30, 50 70"/><path d="M150 0 V70"/><path d="M150 0 C150 40, 250 30, 250 70"/></svg>
      <div class="mg-groups">
        ${[['💑', t('Us two'), ['🙋', '🐻'], t('Tue · 20:00')], ['🍽️', t('Dinner crew'), ['🙋', '🦊', '🐼'], `${dayLbl(cells[PICK])} · 19:30`], ['📚', t('Book club'), ['🙋', '🦊', '🦉', '🎸'], t('Vote open')]]
          .map(([e, n, ppl, next], i) => `<div class="mg-g" style="--i:${i}"><span class="mg-e">${e}</span><b>${esc(n)}</b><span class="faces">${ppl.map((x) => `<span class="avatar emo" style="background:${x === '🙋' ? me.c : 'var(--surface2)'}">${x}</span>`).join('')}</span><span class="meta">${esc(next)}</span></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="lsec lwrap split rev" id="maps">
    <div class="maps-ill reveal" aria-hidden="true">
      <div class="vmap big">${mapSVG()}<span class="pin"></span><span class="mlabel">🌮 Las Adelitas · 19:30</span></div>
      <div class="maps-btns"><span class="btn sm">📍 ${t('Open in Google Maps')}</span><span class="btn sm">🧭 ${t('Directions')}</span></div>
    </div>
    <div class="reveal">
      <span class="mono eyebrow">📍 ${t('Google Maps built in')}</span>
      <h2>${t('No more “wait, where was it?”')}</h2>
      <p class="lead">${t('Type the restaurant or paste a Google Maps link. Every plan shows the map, opens in Google Maps and gives directions in one tap. The WhatsApp message includes the link too.')}</p>
      <div class="row" style="margin-top:18px"><span class="chip">${t('Map preview in every plan')}</span><span class="chip">${t('Directions in one tap')}</span><span class="chip">${t('Any Google Maps link')}</span></div>
    </div>
  </section>

  <section class="lsec lwrap" id="uses">
    <span class="mono eyebrow">${t('Made for')}</span>
    <h2>${t('Any group that keeps saying “we should meet up”')}</h2>
    <div class="uses">
      <article class="use reveal" style="--d:0ms">
        <div class="ill ill-couple">${Array.from({ length: 7 }, (_, i) => `<span class="${[1, 4, 5].includes(i) ? 'both' : [0, 2, 6].includes(i) ? 'one' : ''}" style="--i:${i}"><b>${wd(i)}</b><i></i><i></i></span>`).join('')}</div>
        <span class="mono tagline">💑 ${t('Couples')}</span>
        <h3>${t('Date night, actually scheduled.')}</h3>
        <p>${t('Shifts, travel, gym, in-laws. Set a goal like “once a week”, both of you mark your days, and the app shows the evenings you’re both free.')}</p>
        <span class="chip">${t('2 people · goal 1× per week')}</span>
      </article>
      <article class="use reveal" style="--d:90ms">
        <div class="ill ill-friends">${[[4, 4], [5, 3], [6, 1]].map(([i, n], j) => `<div class="vbar" style="--w:${n * 20}%;--i:${j}"><span>${dayLbl(cells[i])}</span><i></i><b>${n}</b></div>`).join('')}</div>
        <span class="mono tagline">🍻 ${t('Friends')}</span>
        <h3>${t('The group chat that finally decides.')}</h3>
        <p>${t('Propose three dates, everyone votes, the winner gets locked in with a time and a place. One link to send in WhatsApp instead of 140 messages.')}</p>
        <span class="chip">${t('5 people · vote on dates')}</span>
      </article>
      <article class="use reveal" style="--d:180ms">
        <div class="ill ill-club"><div class="pips">${[0, 1].map((i) => `<span class="pip" style="--i:${i}"></span>`).join('')}</div><div class="club-rsvp"><span class="mono">RSVP</span><b class="ticker">12</b><span class="muted">${t('going')}</span></div></div>
        <span class="mono tagline">📚 ${t('Clubs')}</span>
        <h3>${t('Book club, running club, board-game night.')}</h3>
        <p>${t('Recurring meetups with a monthly goal, RSVPs for a specific time, comments for who brings what, and a place everyone can open in Maps.')}</p>
        <span class="chip">${t('12 people · goal 2× per month')}</span>
      </article>
    </div>
  </section>

  <section class="lsec lwrap" id="themes">
    <span class="mono eyebrow">${t('Make it yours')}</span>
    <h2>${t('Four looks. Pick the one that feels like your group.')}</h2>
    <div class="tcards">${THEMES.map((th, i) => `<button class="tcard reveal ${THEME === th.id ? 'on' : ''}" data-theme="${th.id}" data-l="theme" data-v="${th.id}" style="--d:${i * 70}ms">
      <div class="tmock"><div class="tm-h"><b>🍽️ ${t('Dinner crew')}</b><span class="tm-flow"></span></div>
        <div class="tm-grid">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<span class="${[2, 4, 5].includes(d) ? 'g' : ''}">${cells[d].getDate()}${[2, 4, 5].includes(d) ? '<i></i>' : ''}</span>`).join('')}</div>
        <div class="tm-plan"><span>🌮 ${t('Tacos')} · 19:30</span><span class="tm-go">${t('It’s on')}</span></div></div>
      <div class="tc-foot"><b>${themeName(th, LANG)}</b><span>${t(TDESC[th.id])}</span></div>
    </button>`).join('')}</div>
  </section>

  <section class="lsec lwrap privacy reveal">
    <div><span class="mono eyebrow">${t('Private by default')}</span>
      <h2>${t('Your groups are invite-only.')}</h2>
      <p class="lead">${t('Nobody can browse groups. Only people with your invite link can join, and only members see the group, its plans and who’s free. Sign in with Google or a one-time email link, no passwords.')}</p></div>
    <ul class="ticks"><li>${t('Invite link per group, which you can reset anytime')}</li><li>${t('Members only see the groups they belong to')}</li><li>${t('Your main calendar stays yours: groups get a copy, or a separate one')}</li></ul>
  </section>

  <section class="lsec lwrap final reveal">
    <h2>${t('Next time someone says “we should hang out”, send a link.')}</h2>
    <div class="ctas" style="justify-content:center"><a class="btn go lg" href="${go}">${goTxt}</a><a class="btn lg" href="#/demo">${t('Try the demo')}</a></div>
  </section>
  <footer class="lwrap lfoot"><span class="mono muted">WhenWeMeet</span><span class="muted">${t('Made in Prague')}</span></footer>`;

  CTX = { P, cells, dayLbl, wd };
  const els = root.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduced()) {
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io && io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    vio = new IntersectionObserver((es) => { V.visible = es[0].isIntersecting; }, { threshold: 0.2 });
    vio.observe(root.querySelector('#vp'));
  } else els.forEach((el) => el.classList.add('in'));
  V.paused = reduced(); V.visible = true;
  if (V.paused) seek(4); else seek(0);
  setPlayIcon();
}
const TDESC = { midnight: 'Deep violet with a warm spark. Made for night plans.', blossom: 'Soft pink and lavender, light and happy.', slate: 'Charcoal, steel blue and amber. Calm and solid.', paper: 'Clean, light and minimal. Just the essentials.' };
function themeMenu() {
  const cur = THEMES.find((x) => x.id === THEME);
  return `<details class="tpick"><summary aria-label="${t('Theme')}">${swatchHTML(cur)}</summary><div class="tpick-menu">${THEMES.map((th) => `<button class="tbtn" data-l="theme" data-v="${th.id}" aria-pressed="${THEME === th.id}">${swatchHTML(th)}${themeName(th, LANG)}</button>`).join('')}</div></details>`;
}

/* ---------- the "video": scenes played on a timeline ---------- */
let CTX = null;
const $ = (s) => V.root.querySelector(s), $$ = (s) => [...V.root.querySelectorAll(s)];
async function sleep(ms) {
  const my = V.token; if (V.instant) { if (my !== V.token) throw STOP; return; }
  let left = ms;
  while (left > 0) {
    if (my !== V.token || !V.root?.isConnected) throw STOP;
    if (V.paused || !V.visible) { await wait(120); continue; }
    const st = Math.min(50, left); await wait(st); left -= st; V.elapsed += st; bar();
  }
}
function bar() {
  const sc = SCENES[V.scene]; if (!sc) return;
  $$('.vp-seg i').forEach((el, i) => { el.style.width = i < V.scene ? '100%' : i > V.scene ? '0%' : Math.min(100, (V.elapsed / sc.dur) * 100) + '%'; });
}
function cursorTo(el, dx = 0.5, dy = 0.5) {
  if (V.instant || !el) return; const st = $('#vpStage'), c = $('.vcur'); if (!st || !c) return;
  const a = st.getBoundingClientRect(), b = el.getBoundingClientRect();
  c.style.transform = `translate(${b.left - a.left + b.width * dx - 14}px,${b.top - a.top + b.height * dy - 14}px)`; c.classList.add('show');
}
async function tap() { if (V.instant) return; const c = $('.vcur'); c.classList.remove('tap'); void c.offsetWidth; c.classList.add('tap'); await sleep(180); }
async function type(el, text, speed = 55) { el.textContent = ''; for (const ch of text) { el.textContent += ch; await sleep(speed); } }
const hideCursor = () => $('.vcur')?.classList.remove('show');

function stageHTML() {
  const { P, cells, dayLbl, wd } = CTX, me = P[2];
  return `
  <div class="vp-cap"><span class="vp-num">1</span><span class="vp-txt"></span></div>
  <div class="sc" data-sc="cal">
    <div class="vlegend">${P.map(chip).join('')}</div>
    <div class="vgrid">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="vwd ${i >= 5 ? 'we' : ''}">${wd(i)}</span>`).join('')}
      ${cells.map((d, i) => `<div class="vc ${(i % 7) >= 5 ? 'we' : ''}" data-i="${i}"><span class="n">${d.getDate()}</span><span class="vcnt">3/3</span><span class="vdots">${P.map(() => '<i></i>').join('')}</span></div>`).join('')}</div>
    <div class="vnote">${t('3 days work for all of you')}</div>
  </div>
  <div class="sc" data-sc="form"><div class="vcard">
    <span class="mono muted">${t('New plan')} · 🍽️ ${t('Dinner')}</span>
    <div class="vfield"><label>${t('Name it')}</label><div class="vinput"><span class="ty ty1"></span><span class="caret"></span></div></div>
    <div class="vrow2"><div class="vfield"><label>${t('Date')}</label><div class="vinput">📅 ${dayLbl(cells[PICK])}</div></div><div class="vfield"><label>${t('Starts at')}</label><div class="vinput">🕢 <span class="ty ty2"></span></div></div></div>
    <div class="vfield"><label>📍 ${t('Where (optional)')}</label><div class="vinput"><span class="ty ty3"></span></div><div class="vmap mini">${mapSVG()}<span class="pin"></span></div></div>
    <span class="btn primary full vsend">${t('Propose it')}</span>
  </div></div>
  <div class="sc" data-sc="rsvp"><div class="vcard">
    <div class="plan-row"><div><span class="mono muted">${t('Dinner')} · ${t('by {n}', { n: esc(me.n) })}</span><h3>${t('Tacos at Las Adelitas')}</h3></div><span class="chip vgoing">0/3</span></div>
    <span class="meta">${dayLbl(cells[PICK])} · 19:30 · 📍 Las Adelitas</span>
    <div class="who">${P.map((p, i) => `<div class="who-row" data-r="${i}">${face(p)}<span class="nm">${esc(p.n)}</span><span class="st none">${t('No answer')}</span></div>`).join('')}</div>
    <div class="rsvp"><span class="pill free vin">${t("I'm in")}</span><span class="pill maybe">${t('Maybe')}</span><span class="pill busy">${t("Can't")}</span></div>
  </div></div>
  <div class="sc" data-sc="map"><div class="vcard">
    <div class="plan-row"><div><span class="mono muted">${dayLbl(cells[PICK])} · 19:30</span><h3>${t('Tacos at Las Adelitas')}</h3></div><span class="chip on von">${t('It’s on')}</span></div>
    <div class="vmap">${mapSVG()}<span class="pin"></span><span class="mlabel">🌮 Las Adelitas</span></div>
    <div class="row"><span class="btn sm vmaps">📍 ${t('Open in Google Maps')}</span><span class="btn sm">🧭 ${t('Directions')}</span><span class="btn sm vcal">📅 ${t('Calendar')}</span></div>
    <div class="faces">${P.map((p) => face(p)).join('')}<span class="meta" style="margin-left:8px">${t('3 going')}</span></div>
  </div></div>
  <div class="sc" data-sc="groups">
    <div class="vme">${face(me, 'big')}<div><b>${esc(me.n)}</b><span class="meta">${t('Your groups')}</span></div></div>
    <div class="vgroups">
      ${[['💑', t('Us two'), ['🙋', '🐻'], t('Tue · 20:00 · Date night')], ['🍽️', t('Dinner crew'), ['🙋', '🦊', '🐼'], `${dayLbl(cells[PICK])} · 19:30 · ${t('It’s on')}`], ['📚', t('Book club'), ['🙋', '🦊', '🦉', '🎸', '🐝'], t('Vote open · 3 dates')]]
        .map(([e, n, ppl, next], i) => `<div class="vg" data-g="${i}"><span class="mg-e">${e}</span><div class="grow"><b>${esc(n)}</b><span class="meta">${esc(next)}</span></div><span class="faces">${ppl.map((x) => `<span class="avatar emo ${x === '🙋' ? 'me' : ''}" style="background:${x === '🙋' ? me.c : 'var(--surface2)'}">${x}</span>`).join('')}</span></div>`).join('')}
    </div>
  </div>
  <span class="vcur" aria-hidden="true"></span>`;
}

const SCENES = [
  { sc: 'cal', step: 0, dur: 7000, cap: '🦊 Ana, 🐼 Luis and 🙋 you mark your free days', async run() {
    const { P } = CTX;
    for (let pi = 0; pi < P.length; pi++) {
      $$('.vlegend .pchip').forEach((c, j) => c.classList.toggle('active', j === pi));
      for (const i of P[pi].days) {
        const c = $(`.vc[data-i="${i}"]`); cursorTo(c, 0.5, 0.45); await sleep(V.instant ? 0 : 130); await tap();
        const dot = c.querySelectorAll('.vdots i')[pi]; dot.style.background = P[pi].c; dot.textContent = P[pi].e; dot.classList.add('on');
        c.style.setProperty('--fc', P[pi].c); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
      }
      await sleep(250);
    }
    $$('.vlegend .pchip').forEach((c) => c.classList.remove('active')); hideCursor();
  } },
  { sc: 'cal', step: 1, dur: 3600, cap: 'WhenWeMeet shows when you all overlap', async run() {
    $('[data-sc="cal"]').classList.add('zoom'); await sleep(300);
    $$('.vc').forEach((c) => { if (!ALL.includes(+c.dataset.i)) c.classList.add('dim'); });
    for (const i of ALL) { $(`.vc[data-i="${i}"]`).classList.add('good'); await sleep(320); }
    $('.vnote').classList.add('show'); await sleep(1400);
    $(`.vc[data-i="${PICK}"]`).classList.add('pick'); cursorTo($(`.vc[data-i="${PICK}"]`)); await sleep(500); await tap(); await sleep(400); hideCursor();
  } },
  { sc: 'form', step: 2, dur: 6200, cap: 'Propose a plan at an exact time and place', async run() {
    await sleep(400);
    cursorTo($('.ty1').parentElement, 0.2); await tap(); await type($('.ty1'), t('Tacos at Las Adelitas'), 45);
    cursorTo($('.ty2').parentElement, 0.4); await tap(); await type($('.ty2'), '19:30', 110);
    cursorTo($('.ty3').parentElement, 0.3); await tap(); await type($('.ty3'), 'Las Adelitas, Vinohrady', 40);
    $('[data-sc="form"] .vmap').classList.add('show'); await sleep(900);
    cursorTo($('.vsend')); await sleep(450); await tap(); $('.vsend').classList.add('pressed'); await sleep(500); hideCursor();
  } },
  { sc: 'rsvp', step: 3, dur: 4200, cap: 'Everyone answers in one tap', async run() {
    await sleep(500);
    const rows = $$('[data-sc="rsvp"] .who-row');
    for (let i = 0; i < rows.length; i++) {
      if (i === 2) { cursorTo($('.vin')); await sleep(400); await tap(); }
      const st = rows[i].querySelector('.st'); st.className = 'st free pop'; st.textContent = t('In') + ' ✓';
      $('.vgoing').textContent = `${i + 1}/3`; await sleep(650);
    }
    $('.vgoing').classList.add('on'); hideCursor(); await sleep(700);
  } },
  { sc: 'map', step: 3, dur: 4600, cap: 'It’s on, with the place on Google Maps', async run() {
    await sleep(300); $('[data-sc="map"] .vmap').classList.add('show'); await sleep(900);
    $('.von').classList.add('pop'); await sleep(600);
    cursorTo($('.vmaps')); await sleep(500); await tap(); $('.vmaps').classList.add('pressed'); await sleep(700);
    cursorTo($('.vcal')); await sleep(450); await tap(); $('.vcal').classList.add('pressed'); await sleep(700); hideCursor();
  } },
  { sc: 'groups', step: null, dur: 4800, cap: 'One you, many groups', async run() {
    const gs = $$('.vg');
    for (const g of gs) { g.classList.add('in'); await sleep(380); }
    await sleep(300);
    for (const g of gs) { const me = g.querySelector('.avatar.me'); me.classList.remove('pulse'); void me.offsetWidth; me.classList.add('pulse'); await sleep(260); }
    await sleep(500);
    cursorTo(gs[1]); await sleep(500); await tap(); gs.forEach((g, i) => g.classList.toggle('on', i === 1)); await sleep(900);
    cursorTo(gs[2]); await sleep(500); await tap(); gs.forEach((g, i) => g.classList.toggle('on', i === 2)); await sleep(800); hideCursor();
  } },
];

function showScene(i) {
  const s = SCENES[i]; V.scene = i; V.elapsed = 0;
  $$('.sc').forEach((el) => {
    const on = el.dataset.sc === s.sc;
    if (!on && el.classList.contains('active')) { el.classList.remove('active'); el.classList.add('out'); setTimeout(() => el.classList.remove('out'), 600); }
    if (on) el.classList.add('active');
  });
  $('.vp-num').textContent = i + 1; $('#vpN').textContent = i + 1;
  const tx = $('.vp-txt'); tx.textContent = t(s.cap); tx.classList.remove('swap'); void tx.offsetWidth; tx.classList.add('swap');
  $$('.how-card').forEach((c) => c.classList.toggle('active', s.step !== null && +c.dataset.s === s.step));
  bar();
}
async function play(from) {
  const my = V.token; lastTokenPlaying = my;
  try {
    for (let i = from; ; i++) {
      if (i >= SCENES.length) { await sleep(800); resetStage(); i = 0; }
      showScene(i); await SCENES[i].run(); V.elapsed = SCENES[i].dur; bar(); await sleep(250);
      if (my !== V.token) return;
    }
  } catch (e) { if (e !== STOP) console.error(e); }
}
function resetStage() { $('#vpStage').innerHTML = stageHTML(); }
/* jump to a scene: replay the earlier ones instantly so the state adds up, then play from there */
async function seek(i) {
  V.token++; resetStage(); V.instant = true; $('#vpStage').classList.add('instant');
  try { for (let j = 0; j < i; j++) { showScene(j); await SCENES[j].run(); } } catch (e) { if (e !== STOP) console.error(e); }
  V.instant = false; void $('#vpStage').offsetWidth; $('#vpStage').classList.remove('instant'); hideCursor();
  if (V.paused) { // show the scene's end state
    V.instant = true; $('#vpStage').classList.add('instant'); showScene(i); try { await SCENES[i].run(); } catch (e) {} V.instant = false; V.elapsed = SCENES[i].dur; bar(); hideCursor();
    requestAnimationFrame(() => $('#vpStage')?.classList.remove('instant'));
    return;
  }
  play(i);
}
function setPlayIcon() { const b = $('.vp-play'); if (!b) return; b.innerHTML = V.paused ? '<span class="ic-play"></span>' : '<span class="ic-pause"></span>'; b.setAttribute('aria-label', V.paused ? t('Play') : t('Pause')); }

/* clicks on the public pages that main.js doesn't handle */
export function landingAction(a, el) {
  if (a === 'theme') {
    setTheme(el.dataset.v);
    $$('.tcard').forEach((c) => c.classList.toggle('on', c.dataset.v === el.dataset.v));
    const m = V.root?.querySelector('.tpick'); if (m) { m.outerHTML = themeMenu(); }
    return true;
  }
  if (a === 'play') { V.paused = !V.paused; setPlayIcon(); if (!V.paused && V.instant === false && !playingAlive()) seek(V.scene); return true; }
  if (a === 'seek') { seek(+el.dataset.v); return true; }
  return false;
}
let lastTokenPlaying = -1;
function playingAlive() { return lastTokenPlaying === V.token; }

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
        <div class="banner"><span class="mono tag">${t('Sent')}</span><div>${t('Check your inbox: we sent a sign-in link to <b>{e}</b>. Open it on this device.', { e: esc(sent) })}</div></div>
        <button class="link" data-l="resend">${t('Use another email')}</button>` : `
        <button class="btn primary full gbtn" data-l="google" ${busy ? 'disabled' : ''}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>${t('Continue with Google')}</button>
        <div class="or"><span>${t('or')}</span></div>
        <div class="field"><label for="email">${t('Email')}</label><input class="input" id="email" type="email" autocomplete="email" placeholder="${t('you@example.com')}"></div>
        <button class="btn full" data-l="magic" ${busy ? 'disabled' : ''}>${t('Email me a sign-in link')}</button>`}
      ${error ? `<p class="danger" style="margin:0;font-size:13.5px">${esc(error)}</p>` : ''}
      <a class="link" href="#/" style="text-align:center">← ${t('Back to the home page')}</a>
    </div>
  </main>`;
}
