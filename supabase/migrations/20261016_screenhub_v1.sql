-- ScreenHub Digital Services: Netflix household portal, database schema v1
--
-- Run the whole file once in the Supabase SQL Editor of a NEW Supabase project
-- (do not reuse the Tetra project). Safe to run again: nothing is dropped.
--
-- * If tables with the same names already exist and were not created by this
--   script (e.g. Tetra's), the script stops with an error and changes nothing.
-- * RLS is enabled on every table with NO policies, and anon/authenticated
--   lose all privileges, so only the service role (server side) can read or
--   write.
-- * No passwords are stored in the database. The admin password lives in the
--   ADMIN_PASSWORD environment variable.

create schema if not exists screenhub_private;
revoke all on schema screenhub_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not exposed through the Supabase API)
-- ---------------------------------------------------------------------------

-- 10-digit Indian mobile: strips non-digits, a leading 91 (12 digits) or 0 (11 digits).
create or replace function screenhub_private.norm_mobile(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^[0-9]{10}$' then d
    when d ~ '^91[0-9]{10}$' then right(d, 10)
    when d ~ '^0[0-9]{10}$' then right(d, 10)
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function screenhub_private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Guard: never touch tables that belong to another app
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['activations', 'subscribers', 'cookie_pool', 'app_settings'] loop
    if to_regclass('public.' || t) is not null
       and coalesce(obj_description(('public.' || t)::regclass, 'pg_class'), '') <> 'screenhub-v1' then
      raise exception 'Table public.% already exists and was not created by ScreenHub. Use a new, empty Supabase project.', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.cookie_pool (
  id                   text primary key default ('nflx-' || gen_random_uuid()),
  profile_name         text not null default 'Netflix Account',
  account_label        text,
  account_email        text,
  user_agent           text not null default '',
  device_metadata      jsonb not null default '{}'::jsonb,
  cookies              jsonb not null default '[]'::jsonb check (jsonb_typeof(cookies) = 'array'),
  status               text not null default 'unknown'
                       check (status in ('live', 'expiring_soon', 'expired', 'needs_reimport', 'unverified', 'unknown')),
  earliest_expiry      timestamptz,
  last_checked_at      timestamptz,
  last_refreshed_at    timestamptz,
  last_result          text,
  last_detail          text not null default '',
  consecutive_failures integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.cookie_pool is 'screenhub-v1';

create table if not exists public.subscribers (
  id                  text primary key default ('c-' || gen_random_uuid()),
  mobile              text not null unique check (mobile ~ '^[0-9]{10}$'),
  service             text not null default 'Netflix',
  subscription_date   date,
  validity            text not null default '1 Month',
  expiry_date         date,
  assigned_account_id text references public.cookie_pool (id) on delete set null,
  is_blocked          boolean not null default false,
  tv_quota_reset_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.subscribers is 'screenhub-v1';
create index if not exists subscribers_assigned_account_idx on public.subscribers (assigned_account_id);

create table if not exists public.activations (
  id            bigint generated always as identity primary key,
  subscriber_id text references public.subscribers (id) on delete set null,
  mobile        text not null,
  action        text not null check (action in ('tv_login', 'household_update')),
  code          text,
  ip            text,
  status        text not null check (status in ('success', 'failed', 'rate_limited', 'blocked')),
  account_id    text references public.cookie_pool (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);
comment on table public.activations is 'screenhub-v1';
create index if not exists activations_created_idx on public.activations (created_at desc);
create index if not exists activations_subscriber_idx on public.activations (subscriber_id, action, created_at desc);
create index if not exists activations_mobile_idx on public.activations (mobile, created_at desc);

create table if not exists public.app_settings (
  id                      text primary key default 'default' check (id = 'default'),
  company_name            text not null default 'ScreenHub Digital Services',
  support_whatsapp        text not null default '917597958755',
  max_tv_logins_per_month integer not null default 2 check (max_tv_logins_per_month >= 1),
  log_retention_days      integer not null default 180 check (log_retention_days >= 31),
  updated_at              timestamptz not null default now()
);
comment on table public.app_settings is 'screenhub-v1';
insert into public.app_settings (id) values ('default') on conflict (id) do nothing;

drop trigger if exists touch_updated_at on public.cookie_pool;
create trigger touch_updated_at before update on public.cookie_pool
  for each row execute function screenhub_private.touch_updated_at();
drop trigger if exists touch_updated_at on public.subscribers;
create trigger touch_updated_at before update on public.subscribers
  for each row execute function screenhub_private.touch_updated_at();
drop trigger if exists touch_updated_at on public.app_settings;
create trigger touch_updated_at before update on public.app_settings
  for each row execute function screenhub_private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- TV login: atomic eligibility check + monthly limit + sticky account
-- assignment + activation log, in one transaction with the subscriber row
-- locked, so concurrent requests cannot exceed the limit.
-- Months are calendar months in India time (Asia/Kolkata).
-- ---------------------------------------------------------------------------

create or replace function public.screenhub_record_tv_login(p_mobile text, p_code text, p_ip text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s            public.subscribers%rowtype;
  acc          public.cookie_pool%rowtype;
  v_max        integer;
  v_used       integer;
  v_today      date := (now() at time zone 'Asia/Kolkata')::date;
  v_month_from timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  select max_tv_logins_per_month into v_max from public.app_settings where id = 'default';
  v_max := coalesce(v_max, 2);

  select * into s from public.subscribers where mobile = p_mobile for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'used', 0, 'max', v_max);
  end if;

  if s.is_blocked then
    insert into public.activations (subscriber_id, mobile, action, code, ip, status, notes)
    values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'blocked', 'Customer is blocked');
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'used', 0, 'max', v_max);
  end if;

  if s.expiry_date is not null and s.expiry_date < v_today then
    insert into public.activations (subscriber_id, mobile, action, code, ip, status, notes)
    values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'failed', 'Subscription expired');
    return jsonb_build_object('ok', false, 'reason', 'expired', 'used', 0, 'max', v_max,
                              'expiry_date', s.expiry_date);
  end if;

  select count(*) into v_used from public.activations
   where subscriber_id = s.id and action = 'tv_login' and status = 'success'
     and created_at >= greatest(v_month_from, coalesce(s.tv_quota_reset_at, v_month_from));

  if v_used >= v_max then
    insert into public.activations (subscriber_id, mobile, action, code, ip, status, notes)
    values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'rate_limited', 'Monthly TV login limit reached');
    return jsonb_build_object('ok', false, 'reason', 'monthly_limit', 'used', v_used, 'max', v_max);
  end if;

  if s.assigned_account_id is not null then
    -- Linked account stays fixed. If it is broken the admin must fix or relink it.
    select * into acc from public.cookie_pool where id = s.assigned_account_id;
    if acc.status in ('expired', 'needs_reimport') then
      insert into public.activations (subscriber_id, mobile, action, code, ip, status, account_id, notes)
      values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'failed', acc.id, 'Linked account needs fresh cookies');
      return jsonb_build_object('ok', false, 'reason', 'account_unavailable', 'used', v_used, 'max', v_max);
    end if;
  else
    -- Unassigned: pick a random working account and link it permanently.
    select * into acc from public.cookie_pool
     where status in ('live', 'expiring_soon') order by random() limit 1;
    if not found then
      select * into acc from public.cookie_pool
       where status in ('unverified', 'unknown') order by random() limit 1;
    end if;
    if not found then
      insert into public.activations (subscriber_id, mobile, action, code, ip, status, notes)
      values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'failed', 'No working account in the vault');
      return jsonb_build_object('ok', false, 'reason', 'no_account', 'used', v_used, 'max', v_max);
    end if;
    update public.subscribers set assigned_account_id = acc.id where id = s.id;
  end if;

  insert into public.activations (subscriber_id, mobile, action, code, ip, status, account_id)
  values (s.id, s.mobile, 'tv_login', p_code, p_ip, 'success', acc.id);

  return jsonb_build_object(
    'ok', true,
    'used', v_used + 1,
    'max', v_max,
    'account_id', acc.id,
    'account_label', coalesce(acc.account_label, acc.profile_name),
    'account_email', acc.account_email
  );
end $$;

-- ---------------------------------------------------------------------------
-- Lock down: RLS on, no policies, no anon/authenticated access.
-- ---------------------------------------------------------------------------

alter table public.cookie_pool  enable row level security;
alter table public.subscribers  enable row level security;
alter table public.activations  enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.cookie_pool, public.subscribers, public.activations, public.app_settings
  from public, anon, authenticated;
grant all on public.cookie_pool, public.subscribers, public.activations, public.app_settings
  to service_role;
grant usage, select on sequence public.activations_id_seq to service_role;

revoke all on function public.screenhub_record_tv_login(text, text, text) from public, anon, authenticated;
grant execute on function public.screenhub_record_tv_login(text, text, text) to service_role;

revoke all on all functions in schema screenhub_private from public, anon, authenticated;
grant usage on schema screenhub_private to service_role;
grant execute on all functions in schema screenhub_private to service_role;

-- Final check: every row returned should show rls_enabled = true and anon_access = false.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_access,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('cookie_pool', 'subscribers', 'activations', 'app_settings')
order by 1;
