# WhenWeMeet

Find the day that works for everyone. Everyone marks their free days once, the app finds the overlap, you propose a plan at an exact time (or let the group vote), and it's on.

For couples, friend groups and clubs. English and Spanish.

## What's in here

| Route | What it is |
|---|---|
| `#/` | Home page: animated walkthrough, how it works, use cases (couples, friends, clubs), privacy |
| `#/login` | Sign in with Google or an email link (no passwords) |
| `#/app` | Your groups: home, calendar, plans |
| `#/join/<code>` | Invite link. Signs you in if needed, then adds you to the group |
| `#/demo` | The full app with sample data. Nothing is saved |

**Privacy.** Groups are invite-only. Nobody can list or browse groups. You join by opening an invite link, and only members can read a group, its plans, comments and availability. All of this is enforced in `firestore.rules` and covered by `tests/rules.test.mjs`. The group creator can reset the link or remove members.

**Plans at a specific time.** Each date option has a start time and an optional end time, or "all day". Once a plan is fixed you can add it to Google Calendar or download an `.ics` file for Apple Calendar or Outlook. Saying "I'm in" marks you as busy for that time slot.

## Stack

- Vite + vanilla JS (ported from the WhenWeMeet artifact, same look and interactions)
- Firebase Auth (Google + email link) and Cloud Firestore
- Static hosting (Firebase Hosting config included; any static host works)

Data model:

```
users/{uid}                 name, lang, mainDays          (only you)
groups/{gid}                name, goals, memberIds, members{uid:{name,availMode}}, inviteCode
groups/{gid}/avail/{uid}    days                          (your copy for this group)
groups/{gid}/plans/{pid}    title, type, options[{date,time,end,allDay}], votes, rsvp, status
groups/{gid}/comments/{cid}
invites/{code}              gid, groupName                (fetchable by code, never listable)
```

Your main calendar lives in your private `users` doc and is copied into each group that uses it. That way other members only ever read group data.

## Run it

```bash
npm install
npm run dev            # without Firebase config the login page offers the demo
```

### Connect Firebase (about 10 minutes)

1. Create a project at https://console.firebase.google.com.
2. **Authentication → Sign-in method**: enable **Google** and **Email/Password → Email link (passwordless sign-in)**.
3. **Authentication → Settings → Authorized domains**: add your production domain.
4. **Firestore Database**: create it in production mode (an EU region like `europe-west3` if your users are in Europe).
5. **Project settings → Your apps → Web app**: copy the config into `.env.local` (see `.env.example`).
6. Deploy the rules and the site:

```bash
npx firebase login
npx firebase use --add          # pick your project
npm run deploy                  # builds, then deploys hosting + firestore rules
```

### Test the security rules

```bash
npm run test:rules              # starts the Firestore emulator (needs Java) and runs the tests
```
