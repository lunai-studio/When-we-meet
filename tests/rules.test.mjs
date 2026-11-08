// Security rules tests. Run with: npm run test:rules (starts the Firestore emulator).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, arrayUnion, arrayRemove, deleteField } from 'firebase/firestore';

let env;
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const group = (members) => ({
  name: 'Dinner crew', createdBy: members[0], createdAt: 1, inviteCode: 'code123', goalCount: 1, goalPer: 'month', minPeople: 3,
  memberIds: members, members: Object.fromEntries(members.map((m) => [m, { name: m, joinedAt: 1, availMode: 'main' }])),
});

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-wwm', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'groups/g1'), group(['alice', 'bob']));
    await setDoc(doc(f, 'invites/code123'), { gid: 'g1', groupName: 'Dinner crew', createdBy: 'alice', createdAt: 1 });
    await setDoc(doc(f, 'groups/g1/plans/p1'), { title: 'Tacos', createdBy: 'alice', status: 'open', options: [{ date: '2030-01-01', time: '19:00' }], votes: {}, rsvp: { alice: 'yes' } });
    await setDoc(doc(f, 'groups/g1/avail/bob'), { days: {} });
    await setDoc(doc(f, 'users/alice'), { name: 'Alice', mainDays: {} });
  });
});

test('signed-out users cannot read anything', async () => {
  await assertFails(getDoc(doc(db(null), 'groups/g1')));
  await assertFails(getDoc(doc(db(null), 'invites/code123')));
});

test('members read their group, strangers do not', async () => {
  await assertSucceeds(getDoc(doc(db('alice'), 'groups/g1')));
  await assertSucceeds(getDoc(doc(db('bob'), 'groups/g1/plans/p1')));
  await assertFails(getDoc(doc(db('eve'), 'groups/g1')));
  await assertFails(getDoc(doc(db('eve'), 'groups/g1/plans/p1')));
  await assertFails(getDoc(doc(db('eve'), 'groups/g1/avail/bob')));
});

test('you can only list your own groups', async () => {
  await assertSucceeds(getDocs(query(collection(db('alice'), 'groups'), where('memberIds', 'array-contains', 'alice'))));
  await assertFails(getDocs(collection(db('eve'), 'groups')));
});

test('invites can be fetched by code but not listed', async () => {
  await assertSucceeds(getDoc(doc(db('eve'), 'invites/code123')));
  await assertFails(getDocs(collection(db('eve'), 'invites')));
});

test('profiles are private', async () => {
  await assertSucceeds(getDoc(doc(db('alice'), 'users/alice')));
  await assertFails(getDoc(doc(db('bob'), 'users/alice')));
});

test('joining with a valid invite code works', async () => {
  const f = db('eve');
  await assertSucceeds(updateDoc(doc(f, 'groups/g1'), { memberIds: arrayUnion('eve'), 'members.eve': { name: 'Eve', joinedAt: 2, availMode: 'main' }, joinCode: 'code123' }));
  await assertSucceeds(getDoc(doc(f, 'groups/g1/plans/p1')));
});

test('joining with a wrong code, or adding someone else, fails', async () => {
  const f = db('eve');
  await assertFails(updateDoc(doc(f, 'groups/g1'), { memberIds: arrayUnion('eve'), 'members.eve': { name: 'Eve' }, joinCode: 'nope' }));
  await assertFails(updateDoc(doc(f, 'groups/g1'), { memberIds: arrayUnion('eve', 'mallory'), 'members.eve': { name: 'Eve' }, joinCode: 'code123' }));
  await assertFails(updateDoc(doc(f, 'groups/g1'), { memberIds: arrayUnion('eve'), 'members.eve': { name: 'Eve' }, joinCode: 'code123', name: 'Hacked' }));
});

test('creating a group with yourself as the only member', async () => {
  const f = db('carol'), b = writeBatch(f);
  b.set(doc(f, 'groups/g2'), group(['carol']));
  b.set(doc(f, 'invites/newcode'), { gid: 'g2', groupName: 'x', createdBy: 'carol', createdAt: 1 });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(f, 'groups/g3'), group(['carol', 'bob'])));
});

test('cannot create an invite for a group you are not in', async () => {
  await assertFails(setDoc(doc(db('eve'), 'invites/evil'), { gid: 'g1', createdBy: 'eve' }));
});

test('members edit settings and their own entry, not others', async () => {
  const f = db('bob');
  await assertSucceeds(updateDoc(doc(f, 'groups/g1'), { goalCount: 2 }));
  await assertSucceeds(updateDoc(doc(f, 'groups/g1'), { 'members.bob.availMode': 'own' }));
  await assertFails(updateDoc(doc(f, 'groups/g1'), { 'members.alice.name': 'Mallory' }));
  await assertFails(updateDoc(doc(f, 'groups/g1'), { inviteCode: 'mine' }));
});

test('leaving the group; only the creator removes others', async () => {
  await assertFails(updateDoc(doc(db('bob'), 'groups/g1'), { memberIds: arrayRemove('alice'), 'members.alice': deleteField() }));
  await assertSucceeds(updateDoc(doc(db('alice'), 'groups/g1'), { memberIds: arrayRemove('bob'), 'members.bob': deleteField() }));
  await assertFails(getDoc(doc(db('bob'), 'groups/g1')));
});

test('a member can leave', async () => {
  await assertSucceeds(updateDoc(doc(db('bob'), 'groups/g1'), { memberIds: arrayRemove('bob'), 'members.bob': deleteField() }));
});

test('availability: read by members, written only by its owner', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), 'groups/g1/avail/alice'), { days: { '2030-01-01': { s: 'free', t: 'all' } } }));
  await assertFails(setDoc(doc(db('alice'), 'groups/g1/avail/bob'), { days: {} }));
  await assertFails(setDoc(doc(db('eve'), 'groups/g1/avail/eve'), { days: {} }));
});

test('plans: anyone answers for themselves, only the creator edits', async () => {
  const f = db('bob');
  await assertSucceeds(updateDoc(doc(f, 'groups/g1/plans/p1'), { 'rsvp.bob': 'yes' }));
  await assertSucceeds(updateDoc(doc(f, 'groups/g1/plans/p1'), { 'votes.bob': [0] }));
  await assertFails(updateDoc(doc(f, 'groups/g1/plans/p1'), { 'rsvp.alice': 'no' }));
  await assertFails(updateDoc(doc(f, 'groups/g1/plans/p1'), { status: 'confirmed' }));
  await assertFails(deleteDoc(doc(f, 'groups/g1/plans/p1')));
  await assertSucceeds(updateDoc(doc(db('alice'), 'groups/g1/plans/p1'), { status: 'confirmed', chosen: 0 }));
  await assertFails(setDoc(doc(f, 'groups/g1/plans/p2'), { title: 'x', createdBy: 'alice' }));
});

test('comments: members write as themselves', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'groups/g1/comments/c1'), { planId: 'p1', by: 'bob', text: 'hi', at: 1 }));
  await assertFails(setDoc(doc(db('bob'), 'groups/g1/comments/c2'), { planId: 'p1', by: 'alice', text: 'hi', at: 1 }));
  await assertFails(setDoc(doc(db('eve'), 'groups/g1/comments/c3'), { planId: 'p1', by: 'eve', text: 'hi', at: 1 }));
});
