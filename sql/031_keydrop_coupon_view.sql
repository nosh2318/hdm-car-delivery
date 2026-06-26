-- 031_keydrop_coupon_view.sql
-- KEYDROP Pulse : クーポン効果（お届けマップの10%OFF予告タップ → その後の進行）
-- coupon_tap を踏んだセッションが、車両選択 / 決済 / 完了 へどれだけ進んだかを store 別に集計。

create or replace view public.public_kd_coupon_v as
with tapped as (
  select distinct session_id, store
  from public.kd_funnel_log
  where step = 'coupon_tap'
),
sess as (
  select
    session_id,
    max((step = 'step_vehicle')::int) as rv,
    max((step = 'payment')::int)      as rp,
    max((step = 'complete')::int)     as cv
  from public.kd_funnel_log
  group by session_id
)
select
  coalesce(nullif(t.store, ''), 'unknown') as store,
  count(*)        as taps,
  sum(s.rv)       as reached_vehicle,
  sum(s.rp)       as reached_payment,
  sum(s.cv)       as completed
from tapped t
join sess s using (session_id)
group by 1;

grant select on public.public_kd_coupon_v to anon, authenticated;
