/* Router + auth glue.
   #/          home page (animated explainer, use cases)
   #/login     sign in (Google or email link)
   #/app       your groups (needs sign-in)
   #/join/CODE accept an invite (signs you in first if needed)
   #/demo      the app with sample data, nothing saved */
import './styles.css';
import { t, setLang, LANG } from './i18n.js';
import * as B from './backend.js';
import * as App from './app.js';
import { renderLanding, renderLogin, stopLanding } from './landing.js';

const pub = document.getElementById('public');
const shell = document.getElementById('shell');
let user; // undefined = still checking, null = signed out
let view = null;
const login = { sent: null, error: null, busy: false };

function parse() { const [r, arg] = location.hash.replace(/^#\/?/, '').split('/'); return { r: r || '', arg }; }
function show(which) { pub.hidden = which !== 'public'; shell.hidden = which !== 'shell'; }

function route() {
  document.documentElement.lang = LANG;
  const { r, arg } = parse();
  if (r === 'join' && arg) {
    try { localStorage.setItem('wwm.invite', arg); } catch (e) {}
    if (user) { App.setPendingInvite(arg); location.replace('#/app'); return; }
    if (user === null) { location.replace('#/login'); return; }
  }
  if (r === 'demo') {
    if (view !== 'demo') { stopLanding(); show('shell'); view = 'demo'; App.startDemo(() => { location.hash = '#/'; }); }
    return;
  }
  if (r === 'app') {
    if (user === undefined) { show('public'); pub.innerHTML = `<div class="lwrap login"><div class="empty">${t('Loading…')}</div></div>`; view = 'wait'; return; }
    if (!user) { location.replace('#/login'); return; }
    if (view !== 'app') { stopLanding(); show('shell'); view = 'app'; App.startLive(user, exitApp); }
    return;
  }
  if (view === 'app' || view === 'demo') App.stop();
  if (r === 'login') {
    if (user) { location.replace('#/app'); return; }
    show('public'); view = 'login';
    let invited = false; try { invited = !!localStorage.getItem('wwm.invite'); } catch (e) {}
    renderLogin(pub, { hasBackend: B.hasBackend, invited, ...login });
    return;
  }
  show('public'); view = 'landing'; renderLanding(pub, { signedIn: !!user }); scrollTo(0, 0);
}
async function exitApp() {
  const wasDemo = view === 'demo';
  App.stop(); view = null;
  if (!wasDemo) { await B.signOut(); }
  location.hash = '#/';
}

/* public-page buttons */
pub.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-l]'); if (!el) return;
  const a = el.dataset.l;
  if (a === 'lang') { setLang(el.dataset.v); view = null; route(); return; }
  if (a === 'resend') { login.sent = null; route(); return; }
  if (a === 'google') {
    login.error = null;
    try { await B.signInGoogle(); } catch (err) { if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') { login.error = t('Sign-in failed. Try again.'); console.error(err); route(); } }
    return;
  }
  if (a === 'magic') {
    const email = (document.getElementById('email')?.value || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { login.error = t('Enter a valid email.'); route(); return; }
    login.busy = true; login.error = null; route();
    try { await B.sendMagicLink(email); login.sent = email; } catch (err) { console.error(err); login.error = t('Sign-in failed. Try again.'); }
    login.busy = false; route();
  }
});
pub.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'email') pub.querySelector('[data-l="magic"]')?.click(); });

window.addEventListener('hashchange', route);

/* boot */
(async () => {
  if (B.isMagicLink()) {
    try { await B.completeMagicLink(() => prompt(t('Confirm your email to finish signing in'))); if (!location.hash || location.hash === '#/' || location.hash === '#/login') location.hash = '#/app'; }
    catch (err) { console.error(err); login.error = t('Sign-in failed. Try again.'); }
  }
  B.onAuth((u) => {
    const prev = user; user = u || null;
    if (user && view === 'login') { location.hash = '#/app'; return; }
    if (!user && view === 'app') { App.stop(); view = null; }
    if (prev === undefined || view === 'wait' || view === 'landing' || !user) route();
  });
  route();
})();
