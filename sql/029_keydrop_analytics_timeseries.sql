-- 029_keydrop_analytics_timeseries.sql
-- KEYDROP Pulse : 日別 / 月別 バイオリズム（訪問・各ステップ到達・CVの時系列）
-- kd_funnel_log を JST(Asia/Tokyo) の 日 / 月 × store で集計し、anon に公開する。
-- ステップ値: top / step_vehicle / options / form / confirm / terms / payment / complete

create or replace view public.public_kd_daily_v as
select
  to_char((created_at at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD')          as day,
  coalesce(nullif(store, ''), 'unknown')                                       as store,
  count(distinct session_id) filter (where step = 'top')                       as visits,
  count(distinct session_id) filter (where step = 'step_vehicle')              as reached_vehicle,
  count(distinct session_id) filter (where step = 'payment')                   as reached_payment,
  count(distinct session_id) filter (where step = 'complete')                  as completed
from public.kd_funnel_log
group by 1, 2;

create or replace view public.public_kd_monthly_v as
select
  to_char((created_at at time zone 'Asia/Tokyo'), 'YYYY-MM')                    as month,
  coalesce(nullif(store, ''), 'unknown')                                       as store,
  count(distinct session_id) filter (where step = 'top')                       as visits,
  count(distinct session_id) filter (where step = 'step_vehicle')              as reached_vehicle,
  count(distinct session_id) filter (where step = 'payment')                   as reached_payment,
  count(distinct session_id) filter (where step = 'complete')                  as completed
from public.kd_funnel_log
group by 1, 2;

grant select on public.public_kd_daily_v   to anon, authenticated;
grant select on public.public_kd_monthly_v to anon, authenticated;
