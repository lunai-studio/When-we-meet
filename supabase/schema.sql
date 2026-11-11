-- WhenWeMeet MVP schema. Paste into Supabase > SQL Editor and run once.
-- Safe to re-run: drops and recreates policies and functions.

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  language text not null default 'en' check (language in ('en','es')),
  color text not null default '#3DDC97',
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  goal_count int not null default 2 check (goal_count between 1 and 31),
  goal_period text not null default 'month' check (goal_period in ('week','month')),
  min_people int not null default 2 check (min_people between 1 and 100),
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_mode text not null default 'main' check (calendar_mode in ('main','own')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- group_id null = the user's MAIN calendar. One status per day per calendar.
create table if not exists public.availability (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  date date not null,
  status text not null check (status in ('free','busy','away')),
  slot text not null default 'all' check (slot in ('all','am','pm')),
  updated_at timestamptz not null default now(),
  constraint availability_unique unique nulls not distinct (owner_id, group_id, date),
  constraint away_is_all_day check (status <> 'away' or slot = 'all')
);

create index if not exists availability_owner_idx on public.availability (owner_id, group_id);

-- ---------- Helper functions (security definer avoids RLS recursion) ----------

create or replace function public.is_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid());
$$;

create or replace function public.shares_group(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Main calendar of `other` is visible if we share a group where `other` uses their main calendar.
create or replace function public.can_see_main(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other and b.calendar_mode = 'main'
  );
$$;

create or replace function public.create_group(p_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into groups (name, created_by) values (p_name, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(p_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into g from groups where invite_code = lower(trim(p_code));
  if g.id is null then raise exception 'invalid invite'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end $$;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;

-- ---------- Row-level security ----------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.availability enable row level security;

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Groups are created/joined only through the RPCs above.
drop policy if exists groups_read on public.groups;
drop policy if exists groups_update on public.groups;
create policy groups_read on public.groups for select to authenticated
  using (public.is_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.group_members;
drop policy if exists members_update_self on public.group_members;
drop policy if exists members_leave on public.group_members;
create policy members_read on public.group_members for select to authenticated
  using (public.is_member(group_id));
create policy members_update_self on public.group_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_leave on public.group_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists availability_read on public.availability;
drop policy if exists availability_write on public.availability;
create policy availability_read on public.availability for select to authenticated
  using (
    owner_id = auth.uid()
    or (group_id is not null and public.is_member(group_id))
    or (group_id is null and public.can_see_main(owner_id))
  );
create policy availability_write on public.availability for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (group_id is null or public.is_member(group_id)));

-- Realtime: let other members' changes show up live.
do $$ begin
  alter publication supabase_realtime add table public.availability, public.group_members, public.groups;
exception when duplicate_object then null; end $$;
