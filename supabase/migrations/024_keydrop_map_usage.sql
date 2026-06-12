-- ============================================================
-- 024_keydrop_map_usage.sql : KEYDROP 地図API 予算管理・監視
-- 2026-06-13 / omni
--
-- 目的: Google Maps へ移行後の「地図を開いた回数(map load)」を自前で数え、
--       月予算(¥10,000)・無料枠(月10,000回)に対する消費を可視化＋Slack早期警告する。
--   - Googleの請求(1日遅延・メールのみ)とは別に、自分のデータでリアルタイム監視。
--   - LP(index.html)が地図初期化時に rpc kd_bump_maploads(store) を1回呼ぶ（Google移行時に配線）。
--   - ダッシュボード(keydrop-budget.html)が public ビューを anon で読む。
--   - Edge Function(keydrop-budget-watch)が日次で閾値Slack通知。
-- ============================================================

-- ── 1. 月×店舗 の地図起動カウンター ──
create table if not exists public.keydrop_map_loads (
  ym         text not null,                 -- 'YYYY-MM'(JST)
  store      text not null default 'spk',   -- spk | nha
  loads      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ym, store)
);

-- ── 2. 予算設定（1行・id=1）＋ 通知の重複防止状態 ──
create table if not exists public.keydrop_budget (
  id               int primary key default 1,
  monthly_budget_yen int  not null default 10000, -- 月予算（アラート基準）
  free_loads       int    not null default 10000, -- Google無料枠（map load/月）
  yen_per_1000     numeric not null default 1050,  -- 無料枠超過の単価(概算 $7/1000≒¥1,050・要調整)
  last_alert_ym    text,                            -- 最後に通知した月
  last_alert_pct   int     not null default 0,      -- その月で最後に通知した達成段階(0/50/80/100/free80/free100)
  updated_at       timestamptz not null default now(),
  constraint keydrop_budget_singleton check (id = 1)
);
insert into public.keydrop_budget (id) values (1) on conflict (id) do nothing;

-- ── 3. カウントアップRPC（anon から1回/起動で呼ぶ・SECURITY DEFINER）──
create or replace function public.kd_bump_maploads(p_store text default 'spk')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ym text := to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM');
  v_store text := case when lower(coalesce(p_store,'spk')) in ('nha','naha') then 'nha' else 'spk' end;
begin
  insert into public.keydrop_map_loads (ym, store, loads, updated_at)
  values (v_ym, v_store, 1, now())
  on conflict (ym, store)
  do update set loads = public.keydrop_map_loads.loads + 1, updated_at = now();
end;
$$;

-- ── 4. ダッシュボード用 公開ビュー（anon read・PIIなし）──
create or replace view public.public_kd_map_usage_v as
  select ym, store, loads, updated_at from public.keydrop_map_loads;

create or replace view public.public_kd_budget_v as
  select monthly_budget_yen, free_loads, yen_per_1000 from public.keydrop_budget where id = 1;

-- ── 5. 権限 ──
grant execute on function public.kd_bump_maploads(text) to anon, authenticated;
grant select on public.public_kd_map_usage_v to anon, authenticated;
grant select on public.public_kd_budget_v   to anon, authenticated;

-- keydrop_map_loads / keydrop_budget 本体は service_role 専用（Edge Functionが読む）。
alter table public.keydrop_map_loads enable row level security;
alter table public.keydrop_budget    enable row level security;
-- anon/authenticated には本体を開けない（公開ビュー経由のみ）。RPCは definer で加算。

-- ── 6. 日次Slack監視（pg_cron → Edge Function）──
-- ※ 既存 keydrop-send-mail の net.http_post cron と同じ流儀。CRON_SECRET は実値に置換、
--    もしくは送信メールcronと同じ参照方法に合わせること。毎日 09:30 JST(=00:30 UTC)。
-- select cron.schedule('keydrop-budget-watch', '30 0 * * *', $$
--   select net.http_post(
--     url := 'https://ckrxttbnawkclshczsia.supabase.co/functions/v1/keydrop-budget-watch',
--     headers := jsonb_build_object('content-type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body := '{}'::jsonb
--   );
-- $$);
