-- 032_keydrop_menu_view.sql
-- KEYDROP Pulse : ハンバーガーメニュー各項目のタップ集計
-- kd_funnel_log の step='menu:<key>' を項目別に集計（どの項目がどれだけ踏まれたか）。

create or replace view public.public_kd_menu_v as
select
  substring(step from 6)            as menu_key,   -- 'menu:menuAbout' → 'menuAbout'
  count(*)                          as taps,
  count(distinct session_id)        as sessions
from public.kd_funnel_log
where step like 'menu:%'
group by 1
order by taps desc;

grant select on public.public_kd_menu_v to anon, authenticated;
