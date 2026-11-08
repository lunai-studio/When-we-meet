// End-to-end check of the Secret-Santa style guest flow against the Firebase emulators.
// Needs: `firebase emulators:start --only firestore,auth --project demo-wwm` and the app served with
// VITE_USE_EMULATORS=1 VITE_FIREBASE_API_KEY=fake VITE_FIREBASE_PROJECT_ID=demo-wwm on APP_URL (default http://localhost:5174).
const { chromium } = require('playwright');
const APP = process.env.APP_URL || 'http://localhost:5174';
const SHOTS = process.env.SHOTS || '.';

(async () => {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, getDoc } = await import('firebase/firestore');
  const env = await initializeTestEnvironment({ projectId: 'demo-wwm', firestore: { host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    const g = (name, emoji, code) => ({ name, emoji, createdBy: 'ana', createdAt: 1, inviteCode: code, goalCount: 1, goalPer: 'month', minPeople: 2, memberIds: ['ana'], members: { ana: { name: 'Ana', emoji: '🦊', color: '#C084FC', joinedAt: 1, availMode: 'main' } } });
    await setDoc(doc(f, 'groups/g1'), g('Dinner crew', '🍽️', 'code1aaaaaaaa'));
    await setDoc(doc(f, 'invites/code1aaaaaaaa'), { gid: 'g1', groupName: 'Dinner crew', emoji: '🍽️', createdBy: 'ana', createdAt: 1 });
    await setDoc(doc(f, 'groups/g2'), g('Book club', '📚', 'code2bbbbbbbb'));
    await setDoc(doc(f, 'invites/code2bbbbbbbb'), { gid: 'g2', groupName: 'Book club', emoji: '📚', createdBy: 'ana', createdAt: 1 });
    await setDoc(doc(f, 'groups/g1/plans/p1'), { title: 'Tacos', type: 'Dinner', createdBy: 'ana', createdAt: 1, status: 'open', chosen: 0, invited: [], votes: {}, rsvp: { ana: 'yes' }, options: [{ date: day, allDay: false, time: '19:30', end: '' }], place: 'Las Adelitas, Praha', note: '' });
  });

  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  // 1. open the invite link with no account
  await page.goto(APP + '/#/join/code1aaaaaaaa');
  await page.waitForSelector('.invite-hero', { timeout: 15000 });
  ok((await page.textContent('.invite-hero')).includes('Dinner crew'), 'invite page shows the group name, no sign-in screen');
  await page.screenshot({ path: SHOTS + '/e2e-1-invite.png' });
  await page.fill('#joinName', 'Cecilia'); await page.click('[data-act=joinEmoji][data-v="🐙"]'); await page.click('[data-act=join]');
  await page.waitForSelector('.gchip.on', { timeout: 15000 });
  ok((await page.textContent('.gchip.on')).includes('Dinner crew'), 'guest joined and sees the group');
  ok(await page.isVisible('.banner.guest'), 'guest sees the "save your account" banner');
  await page.screenshot({ path: SHOTS + '/e2e-2-joined.png' });
  await page.click('[data-act=tab][data-v=plans]'); await page.click('text=Tacos');
  ok(await page.isVisible('[data-act=rsvp][data-v=yes]'), 'guest can answer the plan');
  await page.click('[data-act=rsvp][data-v=yes]'); await page.waitForTimeout(800); await page.keyboard.press('Escape');

  // 2. come back later: remembered on this device
  await page.reload(); await page.waitForSelector('#nav button[aria-current]', { timeout: 15000 });
  ok(!(await page.isVisible('#joinName')), 'returning guest is remembered (no name prompt)');

  // 3. a second invite joins straight away, with the same name and emoji
  await page.goto(APP + '/#/join/code2bbbbbbbb'); await page.waitForTimeout(2500);
  await page.click('[data-act=tab][data-v=home]'); await page.waitForTimeout(300);
  const chips = await page.$$eval('.gchip:not(.add)', (els) => els.map((e) => e.textContent));
  ok(chips.some((c) => c.includes('Book club')) && chips.some((c) => c.includes('Dinner crew')), 'second invite joins directly, both groups listed');
  await page.screenshot({ path: SHOTS + '/e2e-3-two-groups.png' });

  // 4. guests can't create groups (organizers save an account first)
  await page.click('[data-act=groups]'); await page.waitForTimeout(300);
  ok(!(await page.isVisible('#newGroup')) && (await page.isVisible('#sheet .banner.guest')), 'create-group asks guests to save their account');

  // 5. what got stored
  const uid = await page.evaluate(() => new Promise((r) => { const req = indexedDB.open('firebaseLocalStorageDb'); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage'); const g = tx.objectStore('firebaseLocalStorage').getAll(); g.onsuccess = () => r(g.result[0]?.value?.uid); }; }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    const g1 = (await getDoc(doc(f, 'groups/g1'))).data(), p1 = (await getDoc(doc(f, 'groups/g1/plans/p1'))).data();
    ok(g1.memberIds.includes(uid) && g1.members[uid].name === 'Cecilia' && g1.members[uid].emoji === '🐙', 'stored as member with name + emoji');
    ok(p1.rsvp[uid] === 'yes', 'answer stored');
  });
  // 6. save the account with an email link: same user id, so every group and answer is kept
  await page.keyboard.press('Escape');
  await page.goto(APP + '/#/login'); await page.waitForSelector('#email');
  ok((await page.textContent('h1')).length > 0 && (await page.isVisible('.login-card')), 'guest can open "save your account"');
  await page.screenshot({ path: SHOTS + '/e2e-4-save.png' });
  await page.fill('#email', 'cecilia@example.com'); await page.click('[data-l=magic]'); await page.waitForTimeout(1500);
  const codes = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-wwm/oobCodes')).json();
  const oob = codes.oobCodes.filter((c) => c.email === 'cecilia@example.com').pop();
  await page.goto(`${APP}/?mode=signIn&oobCode=${oob.oobCode}&apiKey=fake&lang=en#/app`);
  await page.waitForSelector('#nav button[aria-current]', { timeout: 15000 }); await page.waitForTimeout(1500);
  const after = await page.evaluate(() => new Promise((r) => { const req = indexedDB.open('firebaseLocalStorageDb'); req.onsuccess = () => { const g = req.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); g.onsuccess = () => r(g.result[0]?.value); }; }));
  ok(after.uid === uid && after.isAnonymous === false && after.email === 'cecilia@example.com', 'account saved: same user, no longer a guest');
  await page.click('[data-act=tab][data-v=home]'); await page.waitForTimeout(400);
  ok(!(await page.isVisible('.banner.guest')), 'guest banner gone after saving');
  const chips2 = await page.$$eval('.gchip:not(.add)', (els) => els.map((e) => e.textContent));
  ok(chips2.length === 2, 'both groups still there after saving');
  await page.screenshot({ path: SHOTS + '/e2e-5-saved.png' });
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close(); await env.cleanup();
})();
