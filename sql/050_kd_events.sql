-- 新KEYDROP（v3 TOP・代車LP・両フロー・チャット）横断の汎用イベント計測
-- 目的：どのページがどれだけ見られ、どの要素がどれだけ踏まれ、どこで離脱したか を全部取る
create table if not exists public.kd_events (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  session_id    text,          -- fs_xxxx（本番） / selftest_xxxx（内部テスト＝集計から除外）
  page          text,          -- top / daisha_lp / daisha_flow / daisha_chat / flow ...
  kind          text,          -- pv(閲覧) / click(要素クリック) / step(フロー段階) / exit(離脱)
  target        text,          -- クリック要素のラベル、または段階名
  step_no       int,           -- フロー段階番号（kind=step）
  area          text,          -- spk / nha / daisha / ''（TOP）
  device        text,          -- pc / mobile / tablet
  ref           text,          -- 流入元（organic / instagram / google ...）
  ref_host      text,
  utm_campaign  text,
  dwell_ms      int,           -- 離脱時の滞在ミリ秒（kind=exit）
  ua            text
);
alter table public.kd_events enable row level security;
drop policy if exists kd_events_anon_insert on public.kd_events;
create policy kd_events_anon_insert on public.kd_events for insert to anon with check (true);
create index if not exists kd_events_ts_idx        on public.kd_events(ts);
create index if not exists kd_events_page_kind_idx  on public.kd_events(page, kind);
create index if not exists kd_events_sess_idx       on public.kd_events(session_id);

-- ── 集計ビュー（anon読取・selftestは常に除外）──────────────────────────
-- 1) 日別トレンド
create or replace view public.public_kd_ev_daily_v as
select (ts at time zone 'Asia/Tokyo')::date as day,
       count(*) filter (where kind='pv')                as pv,
       count(distinct session_id)                        as sessions,
       count(*) filter (where kind='click')             as clicks,
       count(*) filter (where kind='exit')              as exits
from public.kd_events
where coalesce(session_id,'') not like 'selftest%'
group by 1 order by 1;

-- 2) ページ別（閲覧/セッション/クリック/離脱/平均滞在秒）
create or replace view public.public_kd_ev_page_v as
select coalesce(nullif(page,''),'(unknown)') as page,
       count(*) filter (where kind='pv')                          as pv,
       count(distinct session_id) filter (where kind='pv')         as sessions,
       count(*) filter (where kind='click')                       as clicks,
       count(*) filter (where kind='exit')                        as exits,
       round((avg(dwell_ms) filter (where kind='exit' and dwell_ms>0))/1000.0, 1) as avg_sec
from public.kd_events
where coalesce(session_id,'') not like 'selftest%'
group by 1 order by pv desc;

-- 3) 要素クリック順位（どこがどのくらい踏まれてるか）
create or replace view public.public_kd_ev_click_v as
select coalesce(nullif(page,''),'(unknown)') as page,
       coalesce(nullif(target,''),'(no-label)') as target,
       count(*)                    as clicks,
       count(distinct session_id)  as sessions
from public.kd_events
where kind='click' and coalesce(session_id,'') not like 'selftest%'
group by 1,2 order by clicks desc;

-- 4) フロー段階（離脱＝段階ごとの到達セッション数の減り）
create or replace view public.public_kd_ev_funnel_v as
select coalesce(nullif(area,''),'(all)') as area,
       step_no,
       coalesce(nullif(target,''),'?') as step,
       count(distinct session_id) as sessions
from public.kd_events
where kind='step' and coalesce(session_id,'') not like 'selftest%'
group by 1,2,3 order by 1, 2;

-- 5) 端末別
create or replace view public.public_kd_ev_device_v as
select coalesce(nullif(device,''),'unknown') as device,
       count(distinct session_id)               as sessions,
       count(*) filter (where kind='pv')        as pv
from public.kd_events
where coalesce(session_id,'') not like 'selftest%'
group by 1 order by sessions desc;

-- 6) 流入元別
create or replace view public.public_kd_ev_source_v as
select coalesce(nullif(ref,''),'unknown') as source,
       count(distinct session_id) as sessions,
       count(*) filter (where kind='pv') as pv
from public.kd_events
where kind='pv' and coalesce(session_id,'') not like 'selftest%'
group by 1 order by sessions desc;

grant select on public.public_kd_ev_daily_v, public.public_kd_ev_page_v,
                public.public_kd_ev_click_v, public.public_kd_ev_funnel_v,
                public.public_kd_ev_device_v, public.public_kd_ev_source_v
  to anon, authenticated;
create or replace view public.public_kd_ev_summary_v as
select count(distinct session_id)                         as sessions,
       count(*) filter (where kind='pv')                  as pv,
       count(*) filter (where kind='click')               as clicks,
       count(*) filter (where kind='exit')                as exits,
       count(*) filter (where kind='step')                as steps,
       round((avg(dwell_ms) filter (where kind='exit' and dwell_ms>0))/1000.0,1) as avg_sec
from public.kd_events
where coalesce(session_id,'') not like 'selftest%';
grant select on public.public_kd_ev_summary_v to anon, authenticated;
