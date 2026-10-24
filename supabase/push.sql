-- Small Cap Tracker: push notifications for new picks.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Needs setup.sql first. Then deploy supabase/functions/notify-picks (see README).

-- Devices that asked for a notification when there are new picks.
create table if not exists public.push_subscriptions (
  endpoint   text primary key check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push own read"   on public.push_subscriptions;
drop policy if exists "push own insert" on public.push_subscriptions;
drop policy if exists "push own update" on public.push_subscriptions;
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own read"   on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push own insert" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "push own update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push own delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- A few devices per person and a cap overall, so the free tier can't be flooded.
create or replace function public.push_subscriptions_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 5 then
    raise exception 'Notifications are already on for 5 of your devices. Turn one off first.';
  end if;
  if (select count(*) from public.push_subscriptions) >= 200 then
    raise exception 'Notifications are full right now.';
  end if;
  return new;
end $$;
revoke all on function public.push_subscriptions_limit() from public, anon, authenticated;
drop trigger if exists push_subscriptions_limit on public.push_subscriptions;
create trigger push_subscriptions_limit before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_limit();

-- The sender's state: its signing keys (made by the notify-picks function on its first
-- run) and the last picks it notified about. No policies, so only the function reads it.
create table if not exists public.push_state (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  last_as_of    date,
  last_picks    text[] not null default '{}',
  last_run      timestamptz,
  last_result   text
);
alter table public.push_state enable row level security;

-- The public half of the signing key, which browsers need to subscribe.
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select vapid_public from public.push_state where id = 1;
$$;
revoke all on function public.push_public_key() from public;
grant execute on function public.push_public_key() to anon, authenticated;

-- Check for new picks every 15 minutes. The function only sends when picks.json has a
-- newer date than the last notification, so extra runs do nothing.
-- Replace YOUR-PROJECT and YOUR-ANON-KEY (Project Settings → API) before running.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule('notify-picks') where exists (select 1 from cron.job where jobname = 'notify-picks');
select cron.schedule('notify-picks', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/notify-picks',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR-ANON-KEY"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
