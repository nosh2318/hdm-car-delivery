-- ============================================================
-- KEYDROP よくある質問（FAQ）行動ログ ＝ ヒット率を可視化する基盤
--   - 匿名（個人情報なし）。検索語/開いた質問/解決可否を記録
--   - anon は INSERT のみ可（読取は集計ビュー経由）
--   - ヒット率・未解決ワードTop を keydrop-faq-stats.html で表示する想定
-- 適用：Supabase SQL Editor に貼って RUN（project ckrxttbnawkclshczsia）
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists public.keydrop_faq_logs (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  ym          text not null default to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM'),
  store       text,          -- spk / nha（閲覧中エリア）
  lang        text,          -- ja / en / zh / ko
  event       text not null, -- open / search / view / resolved / unresolved / escalate_line / no_result
  query       text,          -- 検索語（event=search / no_result）
  question    text,          -- 開いた/評価したFAQ質問（event=view / resolved / unresolved）
  session_id  text           -- 匿名セッションID（端末ローカル生成）
);
create index if not exists idx_kd_faq_logs_ym    on public.keydrop_faq_logs (ym);
create index if not exists idx_kd_faq_logs_event on public.keydrop_faq_logs (event);
create index if not exists idx_kd_faq_logs_ts    on public.keydrop_faq_logs (ts);

-- RLS：anon は INSERT のみ（生ログの読取は不可＝スクレイプ防止）
alter table public.keydrop_faq_logs enable row level security;
drop policy if exists kd_faq_logs_anon_insert on public.keydrop_faq_logs;
create policy kd_faq_logs_anon_insert on public.keydrop_faq_logs
  for insert to anon with check (true);
grant insert on public.keydrop_faq_logs to anon;

-- ── 集計ビュー（anon read 可・生データは出さない） ──
-- ① 日次/月次 × 店舗 × 言語 × イベント 件数
create or replace view public.public_kd_faq_daily_v as
  select ym, coalesce(store,'') as store, coalesce(lang,'') as lang, event, count(*)::int as cnt
  from public.keydrop_faq_logs
  group by ym, coalesce(store,''), coalesce(lang,''), event;
grant select on public.public_kd_faq_daily_v to anon;

-- ② 検索語ランキング（特に未解決＝FAQの穴。event in search/no_result/unresolved）
create or replace view public.public_kd_faq_query_v as
  select ym, coalesce(store,'') as store, lower(btrim(query)) as q, event, count(*)::int as cnt
  from public.keydrop_faq_logs
  where event in ('search','no_result','unresolved')
    and query is not null and btrim(query) <> ''
  group by ym, coalesce(store,''), lower(btrim(query)), event;
grant select on public.public_kd_faq_query_v to anon;

-- ③ 開かれたFAQ質問ランキング（役に立った項目）
create or replace view public.public_kd_faq_question_v as
  select ym, coalesce(store,'') as store, question, event, count(*)::int as cnt
  from public.keydrop_faq_logs
  where event in ('view','resolved','unresolved')
    and question is not null and btrim(question) <> ''
  group by ym, coalesce(store,''), question, event;
grant select on public.public_kd_faq_question_v to anon;
