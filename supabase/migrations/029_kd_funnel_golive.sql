-- KEYDROP 内製アナリティクス 本番開始（最適化）：検証データ全削除＋集計ビューをtest除外で堅牢化
-- 1) これまでの行は全て検証アクセス → クリア
delete from public.kd_funnel_log;

-- 2) 集計ビューを 'selftest%' 除外で再定義（今後の動作確認が数字を汚さない）
create or replace view public.public_kd_funnel_v as
select step_number, max(step) as step, coalesce(store,'') as store, count(distinct session_id) as sessions
from public.kd_funnel_log
where created_at >= now() - interval '30 days' and session_id not like 'selftest%'
group by step_number, coalesce(store,'');
grant select on public.public_kd_funnel_v to anon;

create or replace view public.public_kd_source_v as
with sess as (
  select session_id, coalesce(max(referrer),'unknown') as src, max(step_number) as max_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days' and session_id not like 'selftest%'
  group by session_id)
select src, count(*) as sessions,
       count(*) filter (where max_step >= 1) as entered_app,
       count(*) filter (where max_step >= 8) as reached_payment,
       count(*) filter (where max_step >= 9) as completed
from sess group by src order by sessions desc;
grant select on public.public_kd_source_v to anon;

create or replace view public.public_kd_dropoff_v as
with sess as (
  select session_id, max(step_number) as last_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days' and session_id not like 'selftest%'
  group by session_id)
select last_step, count(*) as sessions from sess group by last_step order by last_step;
grant select on public.public_kd_dropoff_v to anon;

create or replace view public.public_kd_live_v as
select count(distinct session_id) as active_30m
from public.kd_funnel_log
where created_at >= now() - interval '30 minutes' and session_id not like 'selftest%';
grant select on public.public_kd_live_v to anon;
