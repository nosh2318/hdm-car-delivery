-- KEYDROP 流入の正体を特定できるよう、媒体/キャンペーン/生referrerを記録
alter table public.kd_funnel_log add column if not exists utm_medium   text;
alter table public.kd_funnel_log add column if not exists utm_campaign text;
alter table public.kd_funnel_log add column if not exists ref_host     text;

-- 流入の詳細内訳（source × medium × campaign × referrerホスト）＝「an とは何か」をここで特定
create or replace view public.public_kd_campaign_v as
with sess as (
  select session_id,
         coalesce(nullif(max(referrer),''),'unknown')      as src,
         coalesce(nullif(max(utm_medium),''),'-')          as medium,
         coalesce(nullif(max(utm_campaign),''),'-')        as campaign,
         coalesce(nullif(max(ref_host),''),'-')            as ref_host,
         max(step_number)                                   as max_step
  from public.kd_funnel_log
  where created_at >= now() - interval '30 days' and session_id not like 'selftest%'
  group by session_id)
select src, medium, campaign, ref_host,
       count(*)                               as sessions,
       count(*) filter (where max_step >= 2)  as reached_vehicle,
       count(*) filter (where max_step >= 7)  as reached_payment,
       count(*) filter (where max_step >= 8)  as completed
from sess
group by src, medium, campaign, ref_host
order by sessions desc;
grant select on public.public_kd_campaign_v to anon;
