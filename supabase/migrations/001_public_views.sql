-- ============================================================
-- デリバリーレンタカー新サービス 公開ビュー（在庫反映の土台）
-- 2026-06-09 / omni
-- 目的: 顧客UIに「札幌adminと同一DBの在庫」を安全に見せる。
--   - PII（氏名/連絡先/メール）・コスト（リース額等）は一切出さない
--   - 基テーブル(vehicles/fleet/reservations/maintenance)は anon SELECT 禁止のまま
--   - view は定義者(postgres)権限で実行＝基テーブルRLSを貫通し、許可列だけ返す
-- これにより札幌側の在庫変化（予約/車両増減/整備/月別除外）が顧客の空き表示へ自動反映。
-- ============================================================

-- 公開してよい車両マスター（保険車両=insurance_veh=true は除外、稼働中のみ）
create or replace view public.public_vehicles_v
  with (security_invoker = off) as
  select code, type, name, seats
  from public.vehicles
  where coalesce(insurance_veh, false) = false
    and coalesce(active, true) = true;

-- 予約で埋まっている「期間」だけ（氏名/金額/メールは出さない）
create or replace view public.public_busy_v
  with (security_invoker = off) as
  select f.vehicle_code, r.lend_date, r.return_date
  from public.fleet f
  join public.reservations r on r.id = f.reservation_id
  where coalesce(r.status, '') not in ('cancelled', 'キャンセル', 'cancel')
    and r.return_date::text >= to_char(current_date, 'YYYY-MM-DD');

-- 整備中（期間のみ）
create or replace view public.public_maint_v
  with (security_invoker = off) as
  select vehicle_code, start_date, end_date
  from public.maintenance
  where end_date::text >= to_char(current_date, 'YYYY-MM-DD');

-- 配車表の「月別除外フラグ」も顧客在庫に反映（active=false の車両×月）
create or replace view public.public_inactive_v
  with (security_invoker = off) as
  select vehicle_code, year_month
  from public.vehicle_monthly_kpi
  where coalesce(active, true) = false;

-- anon に view だけ許可（基テーブルは閉じたまま）
grant select on
  public.public_vehicles_v,
  public.public_busy_v,
  public.public_maint_v,
  public.public_inactive_v
to anon;

-- 確認用:
--   select * from public_vehicles_v;
--   select * from public_busy_v where lend_date <= '2026-07-10' and return_date >= '2026-07-08';
