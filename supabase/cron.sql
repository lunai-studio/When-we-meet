-- Optional: daily comment digest at 18:00 Prague time (17:00 UTC in winter).
-- 1. Database > Extensions: enable pg_cron and pg_net.
-- 2. Replace YOUR-PROJECT and YOUR-CRON-SECRET (same value as the CRON_SECRET function secret), then run.

select cron.unschedule('wwm-digest') where exists (select 1 from cron.job where jobname = 'wwm-digest');

select cron.schedule(
  'wwm-digest',
  '0 17 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb
  );
  $$
);
