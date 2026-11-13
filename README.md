# WhenWeMeet

Find the days your friends are free. Mobile-first web app, EN/ES.

**What it does**
- Sign-in with email magic link or Google. Private groups with invite links; one person can be in many groups.
- One main calendar shared across groups, or a separate calendar per group, with sync both ways (confirm + Undo).
- Free / Busy / Out of the city, for All day, AM, PM or a custom time range. Tap, or hold and drag to mark many days; Undo; repeat weekly; clear all.
- "Everyone" view per day, home with goal progress (confirmed plans this week/month), next best date and top 3 suggestions, each with **Propose** or **Let the group vote**.
- Plans: type, title, place (name, address or pasted Google Maps link, with an "Open in Google Maps" button), note, one or several date options, who's invited. One date: I'm in / Maybe / Can't. Several: vote, then the creator locks it in. Creator can edit, confirm ("It's on"), reopen or delete. Comment threads.
- Saying **I'm in** marks you Busy on that date in your main calendar and every group calendar of your own, never over an "Out of the city" day. Changing the answer or deleting the plan removes it.
- "New" badges for plans and comments, a badge on Plans for things waiting for your answer, "Copy message for WhatsApp" with the Maps link.
- Live updates between members (Supabase Realtime) and emails (invites, votes, date set, confirmed, daily comment digest), in each person's language, with an opt-out in the account sheet.

Not included: Google Places autocomplete (needs a paid Google API key; the place field works with names, addresses and pasted links).

Stack: Vite + React + TypeScript on GitHub Pages, Supabase (shared Lunai project, schema `whenwemeet`) for auth and Postgres; row-level security keeps groups private.

## Try it without a backend

If the Supabase variables are missing, or the URL has `?demo`, the app runs in **demo mode** with fake friends and in-memory data.

```bash
npm install
npm run dev        # http://localhost:5173/When-we-meet/
```

## Supabase (shared Lunai project)

WhenWeMeet runs in Lunai's shared Supabase project **lunai-apps** (org Lunai Dev, ref `ilcmaabjczttmrzsxfeu`, eu-central-1), next to other Lunai apps. Rules:

- Everything of this app lives in the schema **`whenwemeet`** (tables, `create_group` / `join_group` / `has_access` RPCs). RLS helpers and triggers live in **`whenwemeet_private`**, which is not exposed through the API. Nothing in `public`, nothing that depends on other apps' schemas.
- Every policy also checks `private.is_app_member('whenwemeet')`. Auth is shared: sign-in sends `data: { app: 'whenwemeet' }`, and a trigger registers new users for this app.
- Schema changes only as migrations named `whenwemeet_*`; run the security advisors afterwards. `supabase/schema.sql` is the full current schema.
- Edge Functions and secrets carry the prefix: `whenwemeet-notify`, `whenwemeet-digest`, `WHENWEMEET_*`.

**One-time settings in the dashboard** (can't be done from SQL):
1. **Settings → Data API → Exposed schemas**: add `whenwemeet` (not `whenwemeet_private`).
2. **Authentication → URL Configuration → Redirect URLs**: add `https://lunai-studio.github.io/When-we-meet/**` and `http://localhost:5173/When-we-meet/**`. Don't change the Site URL; other apps share it.
3. Auth emails (magic link) use the project's shared templates and SMTP.

**Known limits (accepted for now)**
- Same email = same account across Lunai apps. An email first registered in another Lunai app isn't a WhenWeMeet user; the app shows a "not set up for WhenWeMeet" screen.
- Google sign-in is hidden until `VITE_GOOGLE_ENABLED` is set. Google sign-ups can't send `data.app`, so they also need a way to register for the app (pending decision).

## Emails (optional)

Both functions are deployed. They stay silent until these secrets exist (**Edge Functions → Secrets**):

```
WHENWEMEET_RESEND_API_KEY=re_xxx
WHENWEMEET_FROM_EMAIL="WhenWeMeet <hola@yourdomain.com>"
WHENWEMEET_APP_URL=https://lunai-studio.github.io/When-we-meet/
WHENWEMEET_CRON_SECRET=some-long-random-string
```

Daily comment digest: with `pg_cron` and `pg_net` enabled, fill in the secret in `supabase/cron.sql` and run it.

## Deploy to GitHub Pages

1. Repo **Settings → Pages** → Source: **GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (values in `.env.example`; public by design, RLS protects the data). Optional: `VITE_GOOGLE_ENABLED=1`.
3. Push to `main` (or run the workflow by hand). The site goes to `https://lunai-studio.github.io/When-we-meet/`.

Invite links look like `https://lunai-studio.github.io/When-we-meet/?join=<code>`; the code survives the sign-in redirect.

## Data model

| table | what |
|---|---|
| `profiles` | display name, language, color |
| `groups` | name, goal (N per week/month), min people for a good day, invite code |
| `group_members` | membership + `calendar_mode` (`main` or `own`) |
| `availability` | one mark per day per calendar; `group_id` null = main calendar; `plan_id` = Busy mark created by a plan |
| `plans`, `plan_options` | plan details and its date options (`chosen_option_id` once locked in) |
| `plan_invites`, `plan_responses`, `plan_votes` | who's invited, I'm in / Maybe / Can't, date votes |
| `comments` | plan comment threads |

Groups are created and joined only through the `create_group` / `join_group` functions. Members see each other's profiles, the calendar each member uses in that group, and the group's plans. Nobody can write someone else's days, answers or votes; only invitees answer or vote; only the creator edits, confirms or deletes a plan. Busy marks from plans are written by a database trigger (`whenwemeet_private.refresh_plan_busy`).

Known trade-off: a day holds one mark per calendar, so accepting a plan replaces a Free mark on that day, and it doesn't come back if you later change your answer.
