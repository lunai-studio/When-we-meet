-- WhenWeMeet schema, in its own schema `whenwemeet` inside Lunai's shared Supabase project (lunai-apps).
-- Rules of the shared project:
--   * everything of this app lives in schema whenwemeet, never in public;
--   * every policy also checks private.is_app_member('whenwemeet') (membership comes from sign-up with data.app = 'whenwemeet');
--   * no dependencies on other apps' schemas, so the app can move to its own project later
--     (to move: drop the is_app_member checks, or recreate private.is_app_member there).
-- Applied as migration whenwemeet_init. Safe to re-run.

create schema if not exists whenwemeet;
grant usage on schema whenwemeet to authenticated;

-- ============================================================ Tables

create table if not exists whenwemeet.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  language text not null default 'en' check (language in ('en','es')),
  color text not null default '#3DDC97',
  email_opt_in boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists whenwemeet.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  goal_count int not null default 2 check (goal_count between 1 and 31),
  goal_period text not null default 'month' check (goal_period in ('week','month')),
  min_people int not null default 2 check (min_people between 1 and 100),
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists whenwemeet.group_members (
  group_id uuid not null references whenwemeet.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_mode text not null default 'main' check (calendar_mode in ('main','own')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists whenwemeet.plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references whenwemeet.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  type text not null default 'other' check (type in ('dinner','drinks','party','trip','gym','movie','coffee','other')),
  title text not null check (char_length(title) between 1 and 80),
  place_text text,
  place_maps_url text,
  note text,
  status text not null default 'open' check (status in ('open','confirmed')),
  chosen_option_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whenwemeet.plan_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references whenwemeet.plans(id) on delete cascade,
  date date not null,
  slot text not null default 'all' check (slot in ('all','am','pm','custom')),
  time_from time,
  time_to time,
  constraint option_custom_times check (slot <> 'custom' or (time_from is not null and time_to is not null and time_to > time_from))
);

do $$ begin
  alter table whenwemeet.plans add constraint plans_chosen_fk
    foreign key (chosen_option_id) references whenwemeet.plan_options(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists whenwemeet.plan_invites (
  plan_id uuid not null references whenwemeet.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (plan_id, user_id)
);

create table if not exists whenwemeet.plan_responses (
  plan_id uuid not null references whenwemeet.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rsvp text not null check (rsvp in ('yes','maybe','no')),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

-- One row per voter: the options that work for them, or none_work = true.
create table if not exists whenwemeet.plan_votes (
  plan_id uuid not null references whenwemeet.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_ids uuid[] not null default '{}',
  none_work boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create table if not exists whenwemeet.comments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references whenwemeet.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_plan_idx on whenwemeet.comments (plan_id, created_at);

-- group_id null = the user's MAIN calendar. One mark per day per calendar.
-- plan_id set = a Busy mark created by accepting that plan (removed with it).
create table if not exists whenwemeet.availability (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references whenwemeet.groups(id) on delete cascade,
  date date not null,
  status text not null check (status in ('free','busy','away')),
  slot text not null default 'all' check (slot in ('all','am','pm','custom')),
  time_from time,
  time_to time,
  plan_id uuid references whenwemeet.plans(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint availability_unique unique nulls not distinct (owner_id, group_id, date),
  constraint away_is_all_day check (status <> 'away' or slot = 'all'),
  constraint avail_custom_times check (slot <> 'custom' or (time_from is not null and time_to is not null and time_to > time_from))
);
create index if not exists availability_owner_idx on whenwemeet.availability (owner_id, group_id);
create index if not exists availability_plan_idx on whenwemeet.availability (plan_id);

-- ============================================================ Helpers (security definer avoids RLS recursion)

create or replace function whenwemeet.is_member(g uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid());
$$;

create or replace function whenwemeet.shares_group(other uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Main calendar of `other` is visible if we share a group where `other` uses their main calendar.
create or replace function whenwemeet.can_see_main(other uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other and b.calendar_mode = 'main'
  );
$$;

create or replace function whenwemeet.plan_group(p uuid)
returns uuid language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select group_id from plans where id = p;
$$;

create or replace function whenwemeet.is_plan_member(p uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select whenwemeet.is_member(whenwemeet.plan_group(p));
$$;

create or replace function whenwemeet.is_plan_creator(p uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select exists (select 1 from plans where id = p and created_by = auth.uid());
$$;

create or replace function whenwemeet.is_invited(p uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select exists (select 1 from plan_invites where plan_id = p and user_id = auth.uid());
$$;

create or replace function whenwemeet.create_group(p_name text)
returns whenwemeet.groups language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
declare g whenwemeet.groups;
begin
  if auth.uid() is null or not private.is_app_member('whenwemeet') then raise exception 'not signed in'; end if;
  insert into groups (name, created_by) values (p_name, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function whenwemeet.join_group(p_code text)
returns whenwemeet.groups language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
declare g whenwemeet.groups;
begin
  if auth.uid() is null or not private.is_app_member('whenwemeet') then raise exception 'not signed in'; end if;
  select * into g from groups where invite_code = lower(trim(p_code));
  if g.id is null then raise exception 'invalid invite'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end $$;

grant execute on function whenwemeet.create_group(text) to authenticated;
grant execute on function whenwemeet.join_group(text) to authenticated;

-- ============================================================ Plan -> Busy marks
-- Everyone who answered "yes" to a plan with a fixed date gets a Busy mark on that date,
-- in their main calendar and every group calendar of their own. "Out of the city" days are never overwritten.

create or replace function whenwemeet.refresh_plan_busy(p uuid)
returns void language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
declare
  opt plan_options;
  n_opts int;
  pl plans;
begin
  delete from availability where plan_id = p;
  select * into pl from plans where id = p;
  if pl.id is null then return; end if;
  select count(*) into n_opts from plan_options where plan_id = p;
  if pl.chosen_option_id is not null then
    select * into opt from plan_options where id = pl.chosen_option_id;
  elsif n_opts = 1 then
    select * into opt from plan_options where plan_id = p;
  else
    return;
  end if;

  insert into availability (owner_id, group_id, date, status, slot, time_from, time_to, plan_id)
  select r.user_id, cal.group_id, opt.date, 'busy', opt.slot, opt.time_from, opt.time_to, p
  from plan_responses r
  cross join lateral (
    select null::uuid as group_id
    union all
    select gm.group_id from group_members gm where gm.user_id = r.user_id and gm.calendar_mode = 'own'
  ) cal
  where r.plan_id = p and r.rsvp = 'yes'
  on conflict (owner_id, group_id, date) do update
    set status = 'busy', slot = excluded.slot, time_from = excluded.time_from, time_to = excluded.time_to,
        plan_id = excluded.plan_id, updated_at = now()
    where availability.status <> 'away';
end $$;

create or replace function whenwemeet.trg_responses_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  perform whenwemeet.refresh_plan_busy(coalesce(new.plan_id, old.plan_id));
  return null;
end $$;

create or replace function whenwemeet.trg_plans_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  if new.chosen_option_id is distinct from old.chosen_option_id then
    perform whenwemeet.refresh_plan_busy(new.id);
  end if;
  return null;
end $$;

create or replace function whenwemeet.trg_options_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  perform whenwemeet.refresh_plan_busy(coalesce(new.plan_id, old.plan_id));
  return null;
end $$;

create or replace function whenwemeet.trg_touch_plan()
returns trigger language plpgsql set search_path = whenwemeet, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists responses_busy on whenwemeet.plan_responses;
create trigger responses_busy after insert or update or delete on whenwemeet.plan_responses
  for each row execute function whenwemeet.trg_responses_busy();

drop trigger if exists plans_busy on whenwemeet.plans;
create trigger plans_busy after update on whenwemeet.plans
  for each row execute function whenwemeet.trg_plans_busy();

drop trigger if exists options_busy on whenwemeet.plan_options;
create trigger options_busy after insert or update or delete on whenwemeet.plan_options
  for each row execute function whenwemeet.trg_options_busy();

drop trigger if exists plans_touch on whenwemeet.plans;
create trigger plans_touch before update on whenwemeet.plans
  for each row execute function whenwemeet.trg_touch_plan();

-- ============================================================ Row-level security

alter table whenwemeet.profiles enable row level security;
alter table whenwemeet.groups enable row level security;
alter table whenwemeet.group_members enable row level security;
alter table whenwemeet.availability enable row level security;
alter table whenwemeet.plans enable row level security;
alter table whenwemeet.plan_options enable row level security;
alter table whenwemeet.plan_invites enable row level security;
alter table whenwemeet.plan_responses enable row level security;
alter table whenwemeet.plan_votes enable row level security;
alter table whenwemeet.comments enable row level security;

drop policy if exists profiles_read on whenwemeet.profiles;
drop policy if exists profiles_insert on whenwemeet.profiles;
drop policy if exists profiles_update on whenwemeet.profiles;
create policy profiles_read on whenwemeet.profiles for select to authenticated
  using ((select private.is_app_member('whenwemeet')) and (id = auth.uid() or whenwemeet.shares_group(id)));
create policy profiles_insert on whenwemeet.profiles for insert to authenticated
  with check ((select private.is_app_member('whenwemeet')) and (id = auth.uid()));
create policy profiles_update on whenwemeet.profiles for update to authenticated
  using ((select private.is_app_member('whenwemeet')) and (id = auth.uid())) with check ((select private.is_app_member('whenwemeet')) and (id = auth.uid()));

-- Groups are created/joined only through the RPCs above.
drop policy if exists groups_read on whenwemeet.groups;
drop policy if exists groups_update on whenwemeet.groups;
create policy groups_read on whenwemeet.groups for select to authenticated
  using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_member(id)));
create policy groups_update on whenwemeet.groups for update to authenticated
  using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_member(id))) with check ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_member(id)));

drop policy if exists members_read on whenwemeet.group_members;
drop policy if exists members_update_self on whenwemeet.group_members;
drop policy if exists members_leave on whenwemeet.group_members;
create policy members_read on whenwemeet.group_members for select to authenticated
  using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_member(group_id)));
create policy members_update_self on whenwemeet.group_members for update to authenticated
  using ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid())) with check ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid()));
create policy members_leave on whenwemeet.group_members for delete to authenticated
  using ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid()));

drop policy if exists availability_read on whenwemeet.availability;
drop policy if exists availability_write on whenwemeet.availability;
create policy availability_read on whenwemeet.availability for select to authenticated
  using ((select private.is_app_member('whenwemeet')) and (
    owner_id = auth.uid()
    or (group_id is not null and whenwemeet.is_member(group_id))
    or (group_id is null and whenwemeet.can_see_main(owner_id))
  ));
create policy availability_write on whenwemeet.availability for all to authenticated
  using ((select private.is_app_member('whenwemeet')) and (owner_id = auth.uid()))
  with check ((select private.is_app_member('whenwemeet')) and (owner_id = auth.uid() and (group_id is null or whenwemeet.is_member(group_id))));

-- Plans: every member of the group sees them; only the creator edits, confirms or deletes.
drop policy if exists plans_read on whenwemeet.plans;
drop policy if exists plans_insert on whenwemeet.plans;
drop policy if exists plans_update on whenwemeet.plans;
drop policy if exists plans_delete on whenwemeet.plans;
create policy plans_read on whenwemeet.plans for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_member(group_id)));
create policy plans_insert on whenwemeet.plans for insert to authenticated
  with check ((select private.is_app_member('whenwemeet')) and (created_by = auth.uid() and whenwemeet.is_member(group_id)));
create policy plans_update on whenwemeet.plans for update to authenticated
  using ((select private.is_app_member('whenwemeet')) and (created_by = auth.uid())) with check ((select private.is_app_member('whenwemeet')) and (created_by = auth.uid() and whenwemeet.is_member(group_id)));
create policy plans_delete on whenwemeet.plans for delete to authenticated using ((select private.is_app_member('whenwemeet')) and (created_by = auth.uid()));

drop policy if exists options_read on whenwemeet.plan_options;
drop policy if exists options_write on whenwemeet.plan_options;
create policy options_read on whenwemeet.plan_options for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_member(plan_id)));
create policy options_write on whenwemeet.plan_options for all to authenticated
  using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_creator(plan_id))) with check ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_creator(plan_id)));

drop policy if exists invites_read on whenwemeet.plan_invites;
drop policy if exists invites_write on whenwemeet.plan_invites;
create policy invites_read on whenwemeet.plan_invites for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_member(plan_id)));
create policy invites_write on whenwemeet.plan_invites for all to authenticated
  using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_creator(plan_id)))
  with check ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_creator(plan_id) and exists (
    select 1 from whenwemeet.group_members gm where gm.group_id = whenwemeet.plan_group(plan_id) and gm.user_id = plan_invites.user_id)));

drop policy if exists responses_read on whenwemeet.plan_responses;
drop policy if exists responses_write on whenwemeet.plan_responses;
create policy responses_read on whenwemeet.plan_responses for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_member(plan_id)));
create policy responses_write on whenwemeet.plan_responses for all to authenticated
  using ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid())) with check ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid() and whenwemeet.is_invited(plan_id)));

drop policy if exists votes_read on whenwemeet.plan_votes;
drop policy if exists votes_write on whenwemeet.plan_votes;
create policy votes_read on whenwemeet.plan_votes for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_member(plan_id)));
create policy votes_write on whenwemeet.plan_votes for all to authenticated
  using ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid())) with check ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid() and whenwemeet.is_invited(plan_id)));

drop policy if exists comments_read on whenwemeet.comments;
drop policy if exists comments_insert on whenwemeet.comments;
drop policy if exists comments_delete on whenwemeet.comments;
create policy comments_read on whenwemeet.comments for select to authenticated using ((select private.is_app_member('whenwemeet')) and (whenwemeet.is_plan_member(plan_id)));
create policy comments_insert on whenwemeet.comments for insert to authenticated
  with check ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid() and whenwemeet.is_plan_member(plan_id)));
create policy comments_delete on whenwemeet.comments for delete to authenticated using ((select private.is_app_member('whenwemeet')) and (user_id = auth.uid()));

-- ============================================================ Grants (custom schema: nothing is granted by default)

revoke all on all tables in schema whenwemeet from anon, public;
revoke all on all functions in schema whenwemeet from anon, public;
grant select, insert, update, delete on all tables in schema whenwemeet to authenticated;
grant usage on all sequences in schema whenwemeet to authenticated;
grant execute on all functions in schema whenwemeet to authenticated;
-- trigger-only functions are not callable through the API
revoke execute on function whenwemeet.refresh_plan_busy(uuid), whenwemeet.trg_responses_busy(), whenwemeet.trg_plans_busy(),
  whenwemeet.trg_options_busy(), whenwemeet.trg_touch_plan() from authenticated;

-- ============================================================ Realtime (other members' changes show up live)

do $$
declare t text;
begin
  foreach t in array array['availability','group_members','groups','plans','plan_options','plan_responses','plan_votes','comments'] loop
    begin
      execute format('alter publication supabase_realtime add table whenwemeet.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================ Migration whenwemeet_private_helpers
-- RLS helpers and triggers move to a schema the Data API does not expose (no /rpc endpoints for them).

create schema if not exists whenwemeet_private;
revoke all on schema whenwemeet_private from public, anon;
grant usage on schema whenwemeet_private to authenticated;

do $$
declare f text;
begin
  foreach f in array array['is_member(uuid)','shares_group(uuid)','can_see_main(uuid)','plan_group(uuid)','is_plan_member(uuid)',
    'is_plan_creator(uuid)','is_invited(uuid)','refresh_plan_busy(uuid)','trg_responses_busy()','trg_plans_busy()','trg_options_busy()','trg_touch_plan()'] loop
    if to_regprocedure('whenwemeet.' || f) is not null then
      execute 'alter function whenwemeet.' || f || ' set schema whenwemeet_private';
    end if;
  end loop;
end $$;

create or replace function whenwemeet_private.is_plan_member(p uuid)
returns boolean language sql stable security definer set search_path = whenwemeet, pg_temp as $$
  select whenwemeet_private.is_member(whenwemeet_private.plan_group(p));
$$;
create or replace function whenwemeet_private.trg_responses_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  perform whenwemeet_private.refresh_plan_busy(coalesce(new.plan_id, old.plan_id));
  return null;
end $$;
create or replace function whenwemeet_private.trg_plans_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  if new.chosen_option_id is distinct from old.chosen_option_id then
    perform whenwemeet_private.refresh_plan_busy(new.id);
  end if;
  return null;
end $$;
create or replace function whenwemeet_private.trg_options_busy()
returns trigger language plpgsql security definer set search_path = whenwemeet, pg_temp as $$
begin
  perform whenwemeet_private.refresh_plan_busy(coalesce(new.plan_id, old.plan_id));
  return null;
end $$;
revoke all on all functions in schema whenwemeet_private from public, anon;
revoke execute on function whenwemeet_private.refresh_plan_busy(uuid), whenwemeet_private.trg_responses_busy(),
  whenwemeet_private.trg_plans_busy(), whenwemeet_private.trg_options_busy(), whenwemeet_private.trg_touch_plan() from authenticated;

-- ============================================================ Migration whenwemeet_has_access
-- Lets the app tell "signed in but not a WhenWeMeet user" (account from another Lunai app) from an empty account.
create or replace function whenwemeet.has_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_app_member('whenwemeet');
$$;
revoke all on function whenwemeet.has_access() from public, anon;
grant execute on function whenwemeet.has_access() to authenticated;
