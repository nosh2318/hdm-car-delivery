-- KEYDROP 上流ファネル ログ（匿名・PIIなし）。「どの画面で離脱したか」を自社DBで読めるようにする。
-- 下流（決済到達/完了）は keydrop_payments / reservations に既にあるので、上流(top→...→complete)だけ記録する。
create table if not exists public.kd_funnel_log (
  id          bigint generated always as identity primary key,
  session_id  text not null,           -- 1フローを識別（端末セッション）
  step        text not null,           -- top/step_location/step_vehicle/options/form/confirm/terms/payment/complete
  step_number int  not null,           -- 1..9
  store       text,                    -- sapporo/naha
  created_at  timestamptz not null default now()
);
create index if not exists idx_kd_funnel_session on public.kd_funnel_log(session_id);
create index if not exists idx_kd_funnel_created on public.kd_funnel_log(created_at);

alter table public.kd_funnel_log enable row level security;
-- 公開サイトは anon キー → INSERT だけ許可（読取・改変は不可）
drop policy if exists kd_funnel_anon_insert on public.kd_funnel_log;
create policy kd_funnel_anon_insert on public.kd_funnel_log for insert to anon with check (true);
grant insert on public.kd_funnel_log to anon;

-- 集計ビュー（誰が読んでも同じ数字＝属人性ゼロ）。過去30日・ステップ毎の到達セッション数。
create or replace view public.public_kd_funnel_v as
select step_number,
       max(step)                  as step,
       coalesce(store,'(unknown)') as store,
       count(distinct session_id) as sessions
from public.kd_funnel_log
where created_at >= now() - interval '30 days'
group by step_number, coalesce(store,'(unknown)');
grant select on public.public_kd_funnel_v to anon;
