-- Optional: daily comment digest at 18:00 Prague time (17:00 UTC in winter).
-- 1. Database > Extensions: enable pg_cron and pg_net.
-- 2. Replace ilcmaabjczttmrzsxfeu and YOUR-CRON-SECRET (same value as the WHENWEMEET_CRON_SECRET function secret), then run.

select cron.unschedule('whenwemeet-digest') where exists (select 1 from cron.job where jobname = 'whenwemeet-digest');

select cron.schedule(
  'whenwemeet-digest',
  '0 17 * * *',
  $$
  select net.http_post(
    url := 'https://ilcmaabjczttmrzsxfeu.supabase.co/functions/v1/whenwemeet-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb
  );
  $$
);
