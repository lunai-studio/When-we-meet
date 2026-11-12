// POST { kind: 'invited' | 'vote' | 'locked' | 'confirmed', plan_id, app_url? }
// Called by the app after an action. Emails the plan's invitees (except the caller) who allow email.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { admin, appUrl, cors, layout, recipients, send, when } from '../_shared/email.ts';

type Kind = 'invited' | 'vote' | 'locked' | 'confirmed';

const copy = {
  en: {
    invited: (by: string, title: string) => [`${by} invited you: ${title}`, 'Let them know if you can make it.'],
    vote: (by: string, title: string) => [`Vote on dates: ${title}`, `${by} wants to find the best date. Pick every option that works for you.`],
    locked: (_: string, title: string) => [`Date set: ${title}`, 'The group picked a date. Are you in?'],
    confirmed: (_: string, title: string) => [`It's on: ${title}`, 'This plan is confirmed.'],
    cta: 'Open WhenWeMeet',
  },
  es: {
    invited: (by: string, title: string) => [`${by} te invitó: ${title}`, 'Dile si puedes ir.'],
    vote: (by: string, title: string) => [`Vota fechas: ${title}`, `${by} quiere encontrar la mejor fecha. Elige todas las opciones que te funcionen.`],
    locked: (_: string, title: string) => [`Fecha fijada: ${title}`, 'El grupo eligió una fecha. ¿Te apuntas?'],
    confirmed: (_: string, title: string) => [`Confirmado: ${title}`, 'Este plan está confirmado.'],
    cta: 'Abrir WhenWeMeet',
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { kind, plan_id, app_url } = (await req.json()) as { kind: Kind; plan_id: string; app_url?: string };
    if (!['invited', 'vote', 'locked', 'confirmed'].includes(kind)) throw new Error('bad kind');

    // Who is calling? Use their token so RLS proves they can see this plan.
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
      db: { schema: 'whenwemeet' },
    });
    const { data: who } = await caller.auth.getUser();
    if (!who.user) return new Response('unauthorized', { status: 401, headers: cors });
    const { data: visible } = await caller.from('plans').select('id').eq('id', plan_id).maybeSingle();
    if (!visible) return new Response('not found', { status: 404, headers: cors });

    const db = admin();
    const { data: plan } = await db
      .from('plans')
      .select('id, title, created_by, place_text, chosen_option_id, plan_options(*), plan_invites(user_id)')
      .eq('id', plan_id)
      .single();
    if (!plan) return new Response('not found', { status: 404, headers: cors });
    const { data: byProf } = await db.from('profiles').select('display_name').eq('id', who.user.id).single();
    const by = byProf?.display_name ?? 'Someone';

    const invitees = (plan.plan_invites as { user_id: string }[]).map((i) => i.user_id).filter((u) => u !== who.user!.id);
    const people = await recipients(db, invitees);
    const opts = plan.plan_options as { id: string; date: string; slot: string; time_from: string | null; time_to: string | null }[];
    const fixed = opts.find((o) => o.id === plan.chosen_option_id) ?? (opts.length === 1 ? opts[0] : undefined);
    const url = appUrl(app_url);

    let sent = 0;
    for (const r of people) {
      const c = copy[r.lang] ?? copy.en;
      const [subject, intro] = c[kind](by, plan.title);
      const lines = [intro];
      if (fixed) lines.push(when(fixed, r.lang));
      else lines.push(...opts.map((o) => '• ' + when(o, r.lang)));
      if (plan.place_text) lines.push(plan.place_text);
      await send(r.email, subject, layout(subject, lines, { label: c.cta, url }));
      sent++;
    }
    return new Response(JSON.stringify({ sent }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
