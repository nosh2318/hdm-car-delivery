-- 🎯 KEYDROP 施策ログ（狙い→実績）を Pulse から自走で記録するためのテーブル
-- 内製・第三者非依存。匿名(anon)で読み書き可（社内ツール／非機密。invoice_manager・asana と同方針）。
-- Supabase SQL Editor で1回 RUN。RUN後、kd-analytics.html の施策ログが「追加・判定」可能になる（未RUNでも埋め込み初期値で閲覧は可）。

create table if not exists kd_actions (
  id           bigint generated always as identity primary key,
  action_date  text,                 -- '2026-06-27' / '計画' など自由表記
  title        text not null,        -- 施策（やること）
  aim          text,                 -- 狙い・仮説
  kpi          text,                 -- 対象KPI
  status       text default '計画',   -- 計画 / 観察 / 完了 / ◯ / △ / ×
  note         text,
  sort         int  default 0,       -- 大きいほど上
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table kd_actions enable row level security;

drop policy if exists kd_actions_sel on kd_actions;
drop policy if exists kd_actions_ins on kd_actions;
drop policy if exists kd_actions_upd on kd_actions;
drop policy if exists kd_actions_del on kd_actions;
create policy kd_actions_sel on kd_actions for select to anon using (true);
create policy kd_actions_ins on kd_actions for insert to anon with check (true);
create policy kd_actions_upd on kd_actions for update to anon using (true) with check (true);
create policy kd_actions_del on kd_actions for delete to anon using (true);

-- updated_at 自動更新
create or replace function kd_actions_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists kd_actions_touch_t on kd_actions;
create trigger kd_actions_touch_t before update on kd_actions
  for each row execute function kd_actions_touch();

-- 初期データ（既に埋め込みで運用していた施策をDBへ移行）。重複RUN防止のため空のときだけ投入。
insert into kd_actions (action_date,title,aim,kpi,status,sort)
select * from (values
  ('2026-06-27','日程ピッカー刷新（範囲選択カレンダー）','日程入力の離脱を減らす','TOP→車両選択','観察',70),
  ('2026-06-27','車ストリップ（PC TOPに車種を先見せ）','車を先に見せて動機づけ','TOP→車両選択','観察',60),
  ('2026-06-27','フロー入替（回収場所を車選択の後へ）','お届けだけで車へ進ませ初動負荷を下げる','TOP→車両選択','観察',50),
  ('2026-06-27','クーポンを車両一覧の先頭バナーに一本化','全車対象を明確化・カード非干渉','クーポンCVR','観察',40),
  ('2026-06-25','GTM一本化・gtag.js削除','GA4二重計測の停止','計測整合','完了',30),
  ('計画','TOPの価値伝達強化（使い方/信頼/価格チラ見せ）','冷たい全国旅行者を3秒でオンボード','TOP→車両選択','計画',20),
  ('計画','TOP着地 vs 車両一覧着地 A/B','着地先で通過率が変わるか検証','TOP→車両選択','計画',10)
) as v(action_date,title,aim,kpi,status,sort)
where not exists (select 1 from kd_actions);
