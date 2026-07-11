-- KEYDROP ファネルを「単調(max_step基準)＋v2起点(step1到達)＋新フロー開始日以降」に修正。
-- 【重要】カットオフ '2026-07-10 07:27:41+00' = v2新フロー(TOP仕様変更/step_vehicle=1初出)開始時刻。
--   それ以前は step番号の意味が違う旧フロー→混ぜると 2451件等の無意味な数字になる(必ず残すこと)。
-- 旧 public_kd_funnel_v は step毎に「そのstepを1回でもログしたsession数」を独立カウント→
--   old-flow(マップ先頭)がtop(step4)を入口にするとstep1〜3を踏まずstep4に加算され ④>③ が破綻。
-- 新ビューは max_step>=N の単調ファネル(=④≤③保証) かつ 新フロー開始以降のみ集計。
-- ⚠️ カットオフを外す(30日窓等に戻す)と旧フローが混入し破綻再発。migrationにも必ずこの日付を残す。
create or replace view public.public_kd_funnel2_v as
with v2 as (
  select session_id,
         coalesce(max(store),'') as store,
         max(step_number) as max_step
  from public.kd_funnel_log
  where created_at >= '2026-07-10 07:27:41+00'
    and session_id in (
      select session_id from public.kd_funnel_log
      where step_number = 1 and created_at >= '2026-07-10 07:27:41+00'
    )
  group by session_id
)
select s.n as step_number,
       coalesce(v2.store,'') as store,
       count(*) filter (where v2.max_step >= s.n) as sessions
from v2 cross join generate_series(1,8) as s(n)
group by s.n, coalesce(v2.store,'');
grant select on public.public_kd_funnel2_v to anon;
