-- ============================================================
-- 011 KEYDROP レート制限テーブル（スパム対策②）
-- 2026-06-10 / omni
-- create-booking / keydrop-mypage が IP×時間窓で件数を数えて過剰アクセスを429で拒否。
-- 行は1日で自動掃除（pg_cron）。anon/authenticated不可・service_roleのみ。
-- ============================================================
create table if not exists public.keydrop_rate (
  id         bigint generated always as identity primary key,
  ip         text,
  path       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_keydrop_rate_lookup on public.keydrop_rate (ip, path, created_at);
alter table public.keydrop_rate enable row level security;
revoke all on public.keydrop_rate from anon, authenticated;

-- 掃除（1日より古い行を削除）
create or replace function public.keydrop_rate_purge() returns int
language plpgsql security definer set search_path = public as $$
declare n int; begin
  delete from public.keydrop_rate where created_at < now() - interval '1 day';
  get diagnostics n = row_count; return n;
end; $$;
revoke all on function public.keydrop_rate_purge() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('keydrop-rate-purge'); exception when others then null; end $$;
select cron.schedule('keydrop-rate-purge', '0 * * * *', $$ select public.keydrop_rate_purge() $$);
