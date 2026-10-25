-- Small Cap Tracker: price alerts and positions. Both are private: each signed-in person
-- sees and changes only their own rows. Run once after setup.sql and push.sql
-- (Dashboard → SQL Editor → New query → paste → Run). Safe to run again.

-- ---------- price alerts ----------
-- kind 'above' / 'below': a close at or past `value` (a price). Fires once, then turns off.
-- kind 'move': a day's change of at least `value` percent, up or down. Fires at most once a day.
create table if not exists public.alerts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Z^][A-Z0-9.=^-]{0,11}$'),
  kind        text not null check (kind in ('above', 'below', 'move')),
  value       numeric not null check (value > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  fired_at    timestamptz,
  fired_price numeric,
  fired_on    date            -- the price date that last fired it
);
create index if not exists alerts_user on public.alerts (user_id);
create index if not exists alerts_active on public.alerts (active) where active;
alter table public.alerts enable row level security;

drop policy if exists "alerts own read"   on public.alerts;
drop policy if exists "alerts own insert" on public.alerts;
drop policy if exists "alerts own update" on public.alerts;
drop policy if exists "alerts own delete" on public.alerts;
create policy "alerts own read"   on public.alerts for select to authenticated using (user_id = (select auth.uid()));
create policy "alerts own insert" on public.alerts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "alerts own update" on public.alerts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "alerts own delete" on public.alerts for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- positions ----------
-- One row per person per symbol: shares held and the average cost per share.
create table if not exists public.positions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol     text not null check (symbol ~ '^[A-Z^][A-Z0-9.=^-]{0,11}$'),
  shares     numeric not null check (shares > 0),
  cost       numeric not null check (cost >= 0),   -- average cost per share (or per coin)
  opened     date not null default current_date,
  updated_at timestamptz not null default now(),
  unique (user_id, symbol)
);
alter table public.positions enable row level security;

drop policy if exists "positions own read"   on public.positions;
drop policy if exists "positions own insert" on public.positions;
drop policy if exists "positions own update" on public.positions;
drop policy if exists "positions own delete" on public.positions;
create policy "positions own read"   on public.positions for select to authenticated using (user_id = (select auth.uid()));
create policy "positions own insert" on public.positions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "positions own update" on public.positions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "positions own delete" on public.positions for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- limits, so the free tier can't be flooded ----------
create or replace function public.private_rows_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare mine int; total int; cap_mine int; cap_total int;
begin
  if tg_table_name = 'alerts' then
    select count(*) into mine from public.alerts where user_id = new.user_id;
    select count(*) into total from public.alerts;
    cap_mine := 50; cap_total := 2000;
  else
    select count(*) into mine from public.positions where user_id = new.user_id;
    select count(*) into total from public.positions;
    cap_mine := 100; cap_total := 2000;
  end if;
  if mine >= cap_mine then
    raise exception 'You have % % already. Remove one first.', cap_mine, tg_table_name;
  end if;
  if total >= cap_total then
    raise exception 'The % list is full right now.', tg_table_name;
  end if;
  return new;
end $$;
revoke all on function public.private_rows_limit() from public, anon, authenticated;
drop trigger if exists alerts_limit on public.alerts;
create trigger alerts_limit before insert on public.alerts for each row execute function public.private_rows_limit();
drop trigger if exists positions_limit on public.positions;
create trigger positions_limit before insert on public.positions for each row execute function public.private_rows_limit();

-- ---------- the push sender's bookkeeping ----------
alter table public.push_state add column if not exists prices_checked text;     -- prices.json "updated" last checked for alerts
alter table public.push_state add column if not exists earnings_sent date;      -- day the earnings reminder last went out
alter table public.push_state add column if not exists last_dispatch timestamptz; -- last "fetch prices now" request to GitHub

-- OPTIONAL (not yet applied to the live project): the database advisor's performance suggestion for
-- the push tables, which re-checks the user once per query instead of once per row. Behaviour is the
-- same either way; run this part on its own if you want the advisor warnings gone.
drop policy if exists "push own read"   on public.push_subscriptions;
drop policy if exists "push own insert" on public.push_subscriptions;
drop policy if exists "push own update" on public.push_subscriptions;
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own read"   on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "push own insert" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "push own update" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push own delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
