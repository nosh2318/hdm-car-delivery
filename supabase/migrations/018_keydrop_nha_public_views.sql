-- ============================================================
-- 018 KEYDROP 那覇(NHA)拡張: 顧客LP用 anon公開ビュー（那覇テーブル版）
-- 2026-06-11 / omni
-- 001/002/003 の札幌版(public_*_v)に対応する那覇版(public_*_nha_v)を作る。
-- 顧客LPは ?area=naha のとき これらを読む。基テーブル(nha_*)はanon SELECT禁止のまま、
-- view(定義者postgres権限)で許可列だけ返す＝札幌と同じ安全設計。
-- ⚠️ nha_reservations の期間列は start_date/end_date（札幌は lend_date/return_date）。
-- ============================================================

-- 公開車両マスター（保険車両除外・稼働中のみ）
create or replace view public.public_vehicles_nha_v
  with (security_invoker = off) as
  select code, type, name, seats
  from public.nha_vehicles
  where coalesce(insurance_veh, false) = false
    and coalesce(active, true) = true;

-- 予約で埋まっている期間のみ（PII/金額は出さない）
create or replace view public.public_busy_nha_v
  with (security_invoker = off) as
  select f.vehicle_code, r.start_date as lend_date, r.end_date as return_date
  from public.nha_fleet f
  join public.nha_reservations r on r.id = f.reservation_id
  where coalesce(r.status, '') not in ('cancelled', 'キャンセル', 'cancel')
    and r.end_date::text >= to_char(current_date, 'YYYY-MM-DD');

-- 整備中（期間のみ）
create or replace view public.public_maint_nha_v
  with (security_invoker = off) as
  select vehicle_code, start_date, end_date
  from public.nha_maintenance
  where end_date::text >= to_char(current_date, 'YYYY-MM-DD');

-- 月別除外フラグ（active=false の車両×月）
create or replace view public.public_inactive_nha_v
  with (security_invoker = off) as
  select vehicle_code, year_month
  from public.nha_vehicle_monthly_kpi
  where coalesce(active, true) = false;

-- 価格マスター（nha_app_settings）
create or replace view public.public_class_price_nha_v
  with (security_invoker = off) as
  select key, value from public.nha_app_settings where key = 'hdm_keydrop_price';

-- クラス紹介（nha_app_settings）
create or replace view public.public_keydrop_classes_nha_v
  with (security_invoker = off) as
  select key, value from public.nha_app_settings where key = 'hdm_keydrop_classes';

-- 配達範囲（nha_app_settings）
create or replace view public.public_delivery_config_nha_v
  with (security_invoker = off) as
  select value from public.nha_app_settings where key = 'hdm_delivery_config';

-- anon に view だけ許可（基テーブルは閉じたまま）
grant select on
  public.public_vehicles_nha_v,
  public.public_busy_nha_v,
  public.public_maint_nha_v,
  public.public_inactive_nha_v,
  public.public_class_price_nha_v,
  public.public_keydrop_classes_nha_v,
  public.public_delivery_config_nha_v
to anon;

-- 確認:
--   select * from public_vehicles_nha_v limit 5;
--   select * from public_delivery_config_nha_v;
