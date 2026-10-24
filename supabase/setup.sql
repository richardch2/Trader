-- Small Cap Tracker: hosted watchlist
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Before running, replace you@example.com below with the email you'll sign in with.
-- Only emails in the editors table can change the watchlist; anyone can read it,
-- the same as everything else on the public site.

create table if not exists public.editors (
  email text primary key
);
insert into public.editors (email) values ('you@example.com')   -- ← your email
on conflict do nothing;

create table if not exists public.watchlist (
  id         bigint generated always as identity primary key,
  symbol     text not null unique check (symbol ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  name       text,
  note       text check (char_length(note) <= 280),
  source     text not null default 'manual' check (source in ('manual', 'top10')),
  added      date not null default current_date,
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Keep the list within the free Alpha Vantage budget (25 calls a day, 8 used by the index ETFs).
create or replace function public.watchlist_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.watchlist) >= 15 then
    raise exception 'The watchlist is full (15 stocks). Remove one first.';
  end if;
  return new;
end $$;

drop trigger if exists watchlist_limit on public.watchlist;
create trigger watchlist_limit before insert on public.watchlist
  for each row execute function public.watchlist_limit();

-- Row-level security: everyone reads, only editors write.
alter table public.watchlist enable row level security;
alter table public.editors enable row level security;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

drop policy if exists "watchlist read"   on public.watchlist;
drop policy if exists "watchlist insert" on public.watchlist;
drop policy if exists "watchlist update" on public.watchlist;
drop policy if exists "watchlist delete" on public.watchlist;
create policy "watchlist read"   on public.watchlist for select using (true);
create policy "watchlist insert" on public.watchlist for insert to authenticated with check (public.is_editor());
create policy "watchlist update" on public.watchlist for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "watchlist delete" on public.watchlist for delete to authenticated using (public.is_editor());

-- Lets the site check whether the signed-in person can edit.
grant execute on function public.is_editor() to anon, authenticated;
