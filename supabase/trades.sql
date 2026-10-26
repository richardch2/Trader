-- Small Cap Tracker: trade log. Each buy and sale, private to the person who made it,
-- with the realized gain on every sale. Run after alerts-positions.sql. Safe to run again.
--
-- Trades go through public.record_trade, which also updates the position in the same
-- step: a buy adds shares and re-averages the cost, a sale books the gain against the
-- average cost and reduces (or closes) the position.

create table if not exists public.trades (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Z^][A-Z0-9.=^-]{0,11}$'),
  side        text not null check (side in ('buy', 'sell')),
  shares      numeric not null check (shares > 0),
  price       numeric not null check (price >= 0),
  cost_basis  numeric,          -- sales: the average cost per share at the time
  realized    numeric,          -- sales: (price - cost_basis) * shares
  traded_on   date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists trades_user on public.trades (user_id, traded_on desc);
alter table public.trades enable row level security;

drop policy if exists "trades own read"   on public.trades;
drop policy if exists "trades own insert" on public.trades;
drop policy if exists "trades own delete" on public.trades;
create policy "trades own read"   on public.trades for select to authenticated using (user_id = (select auth.uid()));
create policy "trades own insert" on public.trades for insert to authenticated with check (user_id = (select auth.uid()));
create policy "trades own delete" on public.trades for delete to authenticated using (user_id = (select auth.uid()));

-- the same flood limits as alerts and positions
create or replace function public.private_rows_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare mine int; total int; cap_mine int; cap_total int;
begin
  if tg_table_name = 'alerts' then
    select count(*) into mine from public.alerts where user_id = new.user_id;
    select count(*) into total from public.alerts;
    cap_mine := 50; cap_total := 2000;
  elsif tg_table_name = 'trades' then
    select count(*) into mine from public.trades where user_id = new.user_id;
    select count(*) into total from public.trades;
    cap_mine := 5000; cap_total := 50000;
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
drop trigger if exists trades_limit on public.trades;
create trigger trades_limit before insert on public.trades for each row execute function public.private_rows_limit();

-- Record a buy or sale and update the position. Runs as the caller, so row security
-- keeps everyone to their own rows. Returns {realized, remaining}.
create or replace function public.record_trade(p_symbol text, p_side text, p_shares numeric, p_price numeric,
                                               p_date date default current_date)
returns json language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  pos public.positions%rowtype;
  gain numeric;
  left_over numeric;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_shares is null or p_shares <= 0 then raise exception 'Enter how many shares.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Enter the price per share.'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Enter the trade date.'; end if;
  select * into pos from public.positions where user_id = uid and symbol = p_symbol for update;

  if p_side = 'buy' then
    if found then
      left_over := pos.shares + p_shares;
      update public.positions
         set cost = (pos.shares * pos.cost + p_shares * p_price) / left_over, shares = left_over, updated_at = now()
       where id = pos.id;
    else
      insert into public.positions (user_id, symbol, shares, cost, opened) values (uid, p_symbol, p_shares, p_price, p_date);
      left_over := p_shares;
    end if;
    insert into public.trades (user_id, symbol, side, shares, price, traded_on)
    values (uid, p_symbol, 'buy', p_shares, p_price, p_date);

  elsif p_side = 'sell' then
    if not found then raise exception 'You have no % position to sell.', p_symbol; end if;
    if p_shares > pos.shares * 1.000001 then
      raise exception 'You hold % % shares, so you can''t sell %.', trim_scale(pos.shares), p_symbol, trim_scale(p_shares);
    end if;
    gain := (p_price - pos.cost) * p_shares;
    insert into public.trades (user_id, symbol, side, shares, price, cost_basis, realized, traded_on)
    values (uid, p_symbol, 'sell', p_shares, p_price, pos.cost, gain, p_date);
    left_over := pos.shares - p_shares;
    if left_over <= pos.shares * 0.000001 then
      delete from public.positions where id = pos.id;
      left_over := 0;
    else
      update public.positions set shares = left_over, updated_at = now() where id = pos.id;
    end if;

  else
    raise exception 'Unknown trade side %.', p_side;
  end if;
  return json_build_object('realized', gain, 'remaining', left_over);
end $$;
revoke all on function public.record_trade(text, text, numeric, numeric, date) from public, anon;
grant execute on function public.record_trade(text, text, numeric, numeric, date) to authenticated;
