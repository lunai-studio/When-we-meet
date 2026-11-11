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

Stack: Vite + React + TypeScript on GitHub Pages, Supabase for auth and Postgres (row-level security keeps groups private).

## Try it without a backend

If the Supabase variables are missing, or the URL has `?demo`, the app runs in **demo mode** with fake friends and in-memory data.

```bash
npm install
npm run dev        # http://localhost:5173/When-we-meet/
```

## Set up Supabase (once, ~10 minutes)

1. Create a free project at supabase.com (region: Frankfurt is closest to Prague).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Authentication → URL Configuration**
   - Site URL: `https://lunai-studio.github.io/When-we-meet/`
   - Redirect URLs: add the same URL, plus `http://localhost:5173/When-we-meet/` for local work.
4. Email magic link works out of the box. Supabase's built-in mailer is rate-limited (a few emails per hour); for real use add your own SMTP under **Authentication → Emails** (Resend free tier works).
5. *(Optional)* Google sign-in: **Authentication → Providers → Google**, paste a Google OAuth client ID/secret. Until then the Google button will show an error; email works.
6. **Project Settings → API**: copy the Project URL and the `anon` public key.

## Emails (optional, ~10 minutes)

The app works without this; people just won't get emails.

1. Create a free account at resend.com and an API key. To send from your own address, verify a domain there; otherwise Resend only delivers to your own email.
2. Install the Supabase CLI, then from this repo:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT
   supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL="WhenWeMeet <hola@yourdomain.com>" \
     APP_URL=https://lunai-studio.github.io/When-we-meet/ CRON_SECRET=some-long-random-string
   supabase functions deploy notify
   supabase functions deploy digest
   ```
3. Daily comment digest: enable the `pg_cron` and `pg_net` extensions, fill in `supabase/cron.sql` and run it in the SQL Editor.

## Deploy to GitHub Pages

1. Repo **Settings → Pages** → Source: **GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is public by design; RLS protects the data).
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

Groups are created and joined only through the `create_group` / `join_group` functions. Members see each other's profiles, the calendar each member uses in that group, and the group's plans. Nobody can write someone else's days, answers or votes; only invitees answer or vote; only the creator edits, confirms or deletes a plan. Busy marks from plans are written by a database trigger (`refresh_plan_busy`).

Known trade-off: a day holds one mark per calendar, so accepting a plan replaces a Free mark on that day, and it doesn't come back if you later change your answer.
