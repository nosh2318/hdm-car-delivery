-- KEYDROP 内製アナリティクス：参照元＋「どこから/どこに止まり/どこで離脱/どこを直せばCV」
-- 1) referrer列を追加（流入元）
alter table public.kd_funnel_log add column if not exists referrer text;

-- 既存ビューを置換（step0=landing も含む・過去30日）
create or replace view public.public_kd_funnel_v as
select step_number,
       max(step)                   as step,
       coalesce(store,'')          as store,
       count(distinct session_id)  as sessions
from public.kd_funnel_log
where created_at >= now() - interval '30 days'
group by step_number, coalesce(store,'');
grant select on public.public_kd_funnel_v to anon;

-- 2) 流入元（どこから入ったか）：参照元 × 着地セッション数 ＋ そのうちどこまで進んだか
create or replace view public.public_kd_source_v as
with sess as (
  select session_id,
         coalesce(max(referrer),'unknown') as src,
         max(step_number)                  as max_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days'
  group by session_id
)
select src,
       count(*)                                   as sessions,        -- 流入セッション
       count(*) filter (where max_step >= 1)       as entered_app,     -- ゲート突破(アプリ進入)
       count(*) filter (where max_step >= 8)       as reached_payment, -- 決済到達
       count(*) filter (where max_step >= 9)       as completed        -- 完了
from sess group by src order by sessions desc;
grant select on public.public_kd_source_v to anon;

-- 3) どこに止まり/どこで離脱したか：セッション毎の「到達した最深ステップ」分布
create or replace view public.public_kd_dropoff_v as
with sess as (
  select session_id, max(step_number) as last_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days'
  group by session_id
)
select last_step, count(*) as sessions
from sess group by last_step order by last_step;
grant select on public.public_kd_dropoff_v to anon;

-- 4) リアルタイム：直近30分の訪問セッション数
create or replace view public.public_kd_live_v as
select count(distinct session_id) as active_30m
from public.kd_funnel_log
where created_at >= now() - interval '30 minutes';
grant select on public.public_kd_live_v to anon;
