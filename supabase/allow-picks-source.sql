-- Small Cap Tracker: let stocks be added to the watchlist from the Picks page.
-- Only needed if you ran setup.sql before the Picks page existed. Run once in
-- Supabase: Dashboard → SQL Editor → New query → paste → Run.

alter table public.watchlist drop constraint if exists watchlist_source_check;
alter table public.watchlist add constraint watchlist_source_check
  check (source in ('manual', 'top10', 'picks'));
