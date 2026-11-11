# WhenWeMeet

Find the days your friends are free. Mobile-first web app, EN/ES.

**MVP scope:** sign-in (email magic link or Google), private groups with invite links, one main calendar shared across groups or a separate calendar per group (with sync both ways), Free / Busy / Out of the city marks with All day / AM / PM, tap or hold-and-drag marking with Undo, repeat weekly, the "Everyone" view, and a home screen with the group goal, next best date and top 3 suggestions.

Not yet: plans, votes, comments, emails. The full spec lives in the Lunai project ("WhenWeMeet app prompt").

Stack: Vite + React + TypeScript on GitHub Pages, Supabase for auth and Postgres (row-level security keeps groups private).

## Try it without a backend

If the Supabase variables are missing, or the URL has `?demo`, the app runs in **demo mode** with fake friends and in-memory data.

```bash
npm install
npm run dev        # http://localhost:5173/when-we-meet/
```

## Set up Supabase (once, ~10 minutes)

1. Create a free project at supabase.com (region: Frankfurt is closest to Prague).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Authentication → URL Configuration**
   - Site URL: `https://lunai-studio.github.io/when-we-meet/`
   - Redirect URLs: add the same URL, plus `http://localhost:5173/when-we-meet/` for local work.
4. Email magic link works out of the box. Supabase's built-in mailer is rate-limited (a few emails per hour); for real use add your own SMTP under **Authentication → Emails** (Resend free tier works).
5. *(Optional)* Google sign-in: **Authentication → Providers → Google**, paste a Google OAuth client ID/secret. Until then the Google button will show an error; email works.
6. **Project Settings → API**: copy the Project URL and the `anon` public key.

## Deploy to GitHub Pages

1. Repo **Settings → Pages** → Source: **GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is public by design; RLS protects the data).
3. Push to `main` (or run the workflow by hand). The site goes to `https://lunai-studio.github.io/when-we-meet/`.

Invite links look like `https://lunai-studio.github.io/when-we-meet/?join=<code>`; the code survives the sign-in redirect.

## Data model

| table | what |
|---|---|
| `profiles` | display name, language, color |
| `groups` | name, goal (N per week/month), min people for a good day, invite code |
| `group_members` | membership + `calendar_mode` (`main` or `own`) |
| `availability` | one mark per day per calendar; `group_id` null = main calendar |

Groups are created and joined only through the `create_group` / `join_group` functions. Members see each other's profiles and the calendar each member uses in that group; nobody can write someone else's days.
