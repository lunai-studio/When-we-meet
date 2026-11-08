/* Thin wrapper over Firebase Auth + Firestore.
   Paths are plain strings ("groups/abc/plans/xyz") so the app code stays close to the original artifact. */
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signInAnonymously,
  linkWithPopup, linkWithCredential, signInWithCredential, EmailAuthProvider, connectAuthEmulator,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, writeBatch, arrayUnion, arrayRemove, deleteField, connectFirestoreEmulator,
} from 'firebase/firestore';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
export const hasBackend = !!(config.apiKey && config.projectId);

let auth = null, fs = null;
if (hasBackend) {
  const app = initializeApp(config);
  auth = getAuth(app);
  let cache;
  try { cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() }); } catch (e) { cache = undefined; }
  fs = initializeFirestore(app, cache ? { localCache: cache } : {});
  if (env.VITE_USE_EMULATORS) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(fs, '127.0.0.1', 8080); }
}

/* ---------- auth ---------- */
const EMAIL_KEY = 'wwm.emailForSignIn';
export function onAuth(cb) { if (!auth) { cb(null); return () => {}; } return onAuthStateChanged(auth, cb); }
/* Guests: opening an invite link signs you in anonymously. The session stays on this device,
   so the next invite works without asking anything. "Save your account" links Google or an
   email to the same user id, so groups and days are kept. */
const GUEST_CODES = 'wwm.guestCodes';
export const isGuest = () => !!auth?.currentUser?.isAnonymous;
export async function signInGuest() { if (auth.currentUser) return auth.currentUser; return (await signInAnonymously(auth)).user; }
export function rememberGuestJoin(code) { try { const l = JSON.parse(localStorage.getItem(GUEST_CODES) || '[]'); if (!l.includes(code)) l.push(code); localStorage.setItem(GUEST_CODES, JSON.stringify(l)); } catch (e) {} }
export function takeGuestCodes() { try { const l = JSON.parse(localStorage.getItem(GUEST_CODES) || '[]'); localStorage.removeItem(GUEST_CODES); return l; } catch (e) { return []; } }
export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  if (isGuest()) {
    try { return await linkWithPopup(auth.currentUser, provider); }
    catch (err) {
      // that Google account already exists: switch to it; the groups joined as a guest get re-joined (see takeGuestCodes)
      if (err?.code === 'auth/credential-already-in-use') { const cred = GoogleAuthProvider.credentialFromError(err); if (cred) return signInWithCredential(auth, cred); }
      throw err;
    }
  }
  return signInWithPopup(auth, provider);
}
export async function sendMagicLink(email) {
  const url = location.origin + location.pathname; // the hash route is kept in localStorage, not in the link
  await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch (e) {}
}
export function isMagicLink() { return !!auth && isSignInWithEmailLink(auth, location.href); }
export async function completeMagicLink(askEmail) {
  await auth.authStateReady(); // so we know whether a guest session is there to upgrade
  let email = null;
  try { email = localStorage.getItem(EMAIL_KEY); } catch (e) {}
  if (!email) email = askEmail();
  if (!email) return null;
  let res;
  if (isGuest()) {
    try { res = await linkWithCredential(auth.currentUser, EmailAuthProvider.credentialWithLink(email, location.href)); }
    catch (err) { if (err?.code === 'auth/credential-already-in-use' || err?.code === 'auth/email-already-in-use') res = await signInWithEmailLink(auth, email, location.href); else throw err; }
  } else res = await signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch (e) {}
  history.replaceState(null, '', location.pathname + location.hash);
  return res;
}
export const signOut = () => (auth ? fbSignOut(auth) : Promise.resolve());

/* ---------- data ---------- */
const ref = (p) => doc(fs, p);
export const newId = (col) => doc(collection(fs, col)).id;
export const set = (p, data) => setDoc(ref(p), data);
/* update() takes dotted keys ("votes.uid") for nested fields, like Firestore's updateDoc */
export const update = (p, patch) => updateDoc(ref(p), patch);
export const del = (p) => deleteDoc(ref(p));
export async function get(p) { const s = await getDoc(ref(p)); return s.exists() ? s.data() : null; }
export async function batch(ops) {
  const b = writeBatch(fs);
  for (const [op, p, data] of ops) {
    if (op === 'set') b.set(ref(p), data);
    else if (op === 'update') b.update(ref(p), data);
    else if (op === 'delete') b.delete(ref(p));
  }
  return b.commit();
}
export function listenDoc(p, cb, err) {
  return onSnapshot(ref(p), (s) => cb(s.exists() ? s.data() : null), err || (() => {}));
}
export function listenCol(p, cb, err) {
  return onSnapshot(collection(fs, p), (q) => { const o = {}; q.docs.forEach((d) => (o[d.id] = d.data())); cb(o); }, err || (() => {}));
}
export function listenMyGroups(uid, cb, err) {
  const q = query(collection(fs, 'groups'), where('memberIds', 'array-contains', uid));
  return onSnapshot(q, (s) => { const o = {}; s.docs.forEach((d) => (o[d.id] = d.data())); cb(o); }, err || (() => {}));
}
export { arrayUnion, arrayRemove, deleteField };
