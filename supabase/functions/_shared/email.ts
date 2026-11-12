// Shared helpers for WhenWeMeet emails (Deno, Supabase Edge Functions).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.0';

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false }, db: { schema: 'whenwemeet' } });

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface Recipient {
  id: string;
  email: string;
  name: string;
  lang: 'en' | 'es';
}

/** Profiles + auth emails for user ids, keeping only people who allow email. */
export async function recipients(db: SupabaseClient, ids: string[]): Promise<Recipient[]> {
  if (!ids.length) return [];
  const { data: profs } = await db.from('profiles').select('id, display_name, language, email_opt_in').in('id', ids);
  const out: Recipient[] = [];
  for (const p of profs ?? []) {
    if (p.email_opt_in === false) continue;
    const { data } = await db.auth.admin.getUserById(p.id);
    if (data.user?.email) out.push({ id: p.id, email: data.user.email, name: p.display_name, lang: p.language });
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function layout(title: string, lines: string[], cta: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#07070B;font-family:Arial,sans-serif;color:#F5F5F7">
<div style="max-width:480px;margin:0 auto;padding:28px 20px">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9C9AB0">WhenWeMeet</div>
<h1 style="font-size:22px;margin:10px 0 14px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;color:#C9C8D6;line-height:1.5">${esc(l)}</p>`).join('')}
<a href="${cta.url}" style="display:inline-block;margin-top:14px;background:#F5F5F7;color:#07070B;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:bold">${esc(cta.label)}</a>
</div></body></html>`;
}

export async function send(to: string, subject: string, html: string) {
  const key = Deno.env.get('WHENWEMEET_RESEND_API_KEY');
  const from = Deno.env.get('WHENWEMEET_FROM_EMAIL') ?? 'WhenWeMeet <onboarding@resend.dev>';
  if (!key) throw new Error('WHENWEMEET_RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export const appUrl = (fallback?: string) => Deno.env.get('WHENWEMEET_APP_URL') ?? fallback ?? 'https://lunai-studio.github.io/When-we-meet/';

const fmtDate = (d: string, lang: 'en' | 'es') =>
  new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const when = (o: { date: string; slot: string; time_from?: string | null; time_to?: string | null }, lang: 'en' | 'es') => {
  const slot =
    o.slot === 'custom' ? `${o.time_from?.slice(0, 5)}–${o.time_to?.slice(0, 5)}` : o.slot === 'all' ? (lang === 'es' ? 'todo el día' : 'all day') : o.slot.toUpperCase();
  return `${fmtDate(o.date, lang)} · ${slot}`;
};
