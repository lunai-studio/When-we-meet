# WhenWeMeet

Find the day that works for everyone. Everyone marks their free days once, the app finds the overlap, you propose a plan at an exact time (or let the group vote), and it's on.

For couples, friend groups and clubs. English and Spanish.

## What's in here

| Route | What it is |
|---|---|
| `#/` | Home page: a video-style walkthrough (6 scenes, play/pause, jump to any scene), how it works, many groups, Google Maps, use cases (couples, friends, clubs), themes, privacy |
| `#/login` | Sign in with Google or an email link (no passwords) |
| `#/app` | Your groups: home, calendar, plans |
| `#/join/<code>` | Invite link. Signs you in if needed, then adds you to the group |
| `#/demo` | The full app with sample data. Nothing is saved |

**Invites work like Secret Santa.** Opening an invite link needs no account: you type your name, pick an emoji and you're in. Behind the scenes it's a Firebase anonymous session that stays on that device, so the next invite (or the next visit) goes straight in. "Save your account" links Google or an email to the *same* user, keeping every group, day and answer, and lets you use it on other devices. Creating a group requires a saved account, so organizers never lose their group. If a guest picks a Google account that already exists, they switch to it and their guest groups are re-joined automatically.

**Privacy.** Groups are invite-only. Nobody can list or browse groups. You join by opening an invite link, and only members can read a group, its plans, comments and availability. All of this is enforced in `firestore.rules` and covered by `tests/rules.test.mjs`. The group creator can reset the link or remove members.

**Many groups, one person.** You can be in as many groups as you like (partner, friends, club). Your days are marked once in a main calendar and every group sees them, or you give one group its own calendar. Group chips at the top of the home screen switch between groups.

**People are emoji + color.** Everyone picks an emoji and a color. They show up the same way everywhere: avatars, plan answers, and the "Everyone" calendar, where each bar is one person in their color.

**Google Maps.** A plan's place can be a name or any Google Maps link. The plan shows an embedded map (no API key needed) and buttons for "Open in Google Maps" and "Directions".

**Themes.** Midnight (dark violet), Blossom (soft pink, light), Slate (charcoal + steel + amber) and Paper (light, minimal). You pick one in your profile or on the home page, and it's saved to your account.

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
2. **Authentication → Sign-in method**: enable **Google**, **Email/Password → Email link (passwordless sign-in)** and **Anonymous** (for guests who open an invite link).
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

### End-to-end guest flow

```bash
npx firebase emulators:start --only firestore,auth --project demo-wwm
VITE_USE_EMULATORS=1 VITE_FIREBASE_API_KEY=fake VITE_FIREBASE_PROJECT_ID=demo-wwm npx vite --port 5174
npm run test:e2e                # invite → join as guest → remembered → 2nd invite → save account (same user)
```
