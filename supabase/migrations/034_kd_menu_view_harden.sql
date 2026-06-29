-- 034 KEYDROP Pulse: メニュー項目タップ ビューを selftest 除外で再定義
-- 背景: public_kd_menu_v は内部/テスト(session_id=selftest_*)を除外していなかった
--       （プローブ検証で selftest 1件を入れたら taps が +1 された＝素通り）。
--       → ?internal=1 の内部除外がメニュー集計に効くように、ビュー側でも selftest を弾く。
-- 列は据え置き: menu_key / taps / sessions（kd-analytics.html がこの3列を参照）。
-- DDLはRLS外＝オーナーがSupabase SQL EditorでRUN。1回きり。

create or replace view public_kd_menu_v as
select
  split_part(step, ':', 2) as menu_key,
  count(*)                  as taps,
  count(distinct session_id) as sessions
from kd_funnel_log
where step like 'menu:%'
  and created_at >= now() - interval '30 days'
  and session_id not like 'selftest%'
group by 1;

-- 検証（プローブ selftest_probe_menu が消え、menuVehicle が実数に戻る）
-- select * from public_kd_menu_v order by taps desc;
