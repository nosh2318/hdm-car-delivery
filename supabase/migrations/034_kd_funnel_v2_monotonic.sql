-- KEYDROP ファネルを「単調(max_step基準)＋v2起点(step1=日付・車両 到達)セッション限定」に修正。
-- 旧 public_kd_funnel_v は step毎に「そのstepを1回でもログしたsession数」を独立カウント→
-- old-flow(PC/マップ先頭)がtop(step4)を入口にするとstep1〜3を踏まずstep4に加算され ④>③ の破綻が発生。
-- 新ビューは max_step>=N の単調ファネル＝ ④≤③ を数学的に保証。step1(日付・車両)未到達の旧フローを除外。
create or replace view public.public_kd_funnel2_v as
with v2 as (
  select session_id,
         coalesce(max(store),'') as store,
         max(step_number) as max_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days'
    and session_id in (
      select session_id from public.kd_funnel_log
      where step_number = 1 and created_at >= now() - interval '30 days'
    )
  group by session_id
)
select s.n as step_number,
       coalesce(v2.store,'') as store,
       count(*) filter (where v2.max_step >= s.n) as sessions
from v2 cross join generate_series(1,8) as s(n)
group by s.n, coalesce(v2.store,'');
grant select on public.public_kd_funnel2_v to anon;
