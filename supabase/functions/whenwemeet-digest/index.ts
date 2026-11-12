// Daily digest of new comments (last 24 h). Run by pg_cron (see supabase/cron.sql).
// Requires header  x-cron-secret: <CRON_SECRET>.
import { admin, appUrl, cors, layout, recipients, send } from '../_shared/email.ts';

const copy = {
  en: { subject: (n: number) => `${n} new ${n === 1 ? 'comment' : 'comments'} on your plans`, cta: 'Open WhenWeMeet' },
  es: { subject: (n: number) => `${n} ${n === 1 ? 'comentario nuevo' : 'comentarios nuevos'} en tus planes`, cta: 'Abrir WhenWeMeet' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.headers.get('x-cron-secret') !== Deno.env.get('WHENWEMEET_CRON_SECRET')) return new Response('forbidden', { status: 403 });
  try {
    const db = admin();
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: comments } = await db
      .from('comments')
      .select('plan_id, user_id, text, created_at, plans(title, created_by, plan_invites(user_id))')
      .gte('created_at', since)
      .order('created_at');
    if (!comments?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: cors });

    // user -> plan title -> comments written by others
    const perUser = new Map<string, Map<string, { author: string; text: string }[]>>();
    const authorIds = [...new Set(comments.map((c) => c.user_id))];
    const { data: authors } = await db.from('profiles').select('id, display_name').in('id', authorIds);
    const nameOf = (id: string) => authors?.find((a) => a.id === id)?.display_name ?? '?';

    for (const c of comments) {
      // deno-lint-ignore no-explicit-any
      const plan = c.plans as any;
      const audience = new Set<string>([plan.created_by, ...plan.plan_invites.map((i: { user_id: string }) => i.user_id)]);
      for (const u of audience) {
        if (u === c.user_id) continue;
        if (!perUser.has(u)) perUser.set(u, new Map());
        const m = perUser.get(u)!;
        if (!m.has(plan.title)) m.set(plan.title, []);
        m.get(plan.title)!.push({ author: nameOf(c.user_id), text: c.text });
      }
    }

    const people = await recipients(db, [...perUser.keys()]);
    let sent = 0;
    for (const r of people) {
      const byPlan = perUser.get(r.id)!;
      const total = [...byPlan.values()].reduce((n, l) => n + l.length, 0);
      const c = copy[r.lang] ?? copy.en;
      const lines: string[] = [];
      for (const [title, list] of byPlan) {
        lines.push(`${title}:`);
        for (const x of list.slice(-5)) lines.push(`${x.author}: ${x.text.slice(0, 160)}`);
      }
      await send(r.email, c.subject(total), layout(c.subject(total), lines, { label: c.cta, url: appUrl() }));
      sent++;
    }
    return new Response(JSON.stringify({ sent }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
