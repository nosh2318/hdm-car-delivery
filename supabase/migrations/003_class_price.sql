-- ============================================================
-- KEYDROP 連携 価格マスター（SPKがマスター・顧客はビュー越しに読む）
-- 2026-06-09 / omni  ※DBはまとめてRUN予定（価格以外も同時作成のため保留）
-- 設計: SPK(admin)が app_settings.hdm_keydrop_price にクラス別1日料金(JSON)を保持。
--       顧客KEYDROPは public_class_price_v(anon) を読む→ベタ書きCLASS_PRICES廃止。
-- ============================================================

-- 1) マスター初期値（SPKが正・後でSPK専用価格表UI keydrop-prices.html から編集）
--    value は JSON文字列。クラス=A/A2/B/B2/C/S/F/H、値=1日あたり税込（暫定）
insert into public.app_settings (key, value)
values ('hdm_keydrop_price',
  '{"A":18000,"A2":16000,"B":10000,"B2":9000,"C":7000,"S":12000,"F":5500,"H":6000}')
on conflict (key) do nothing;  -- 既存があれば上書きしない（SPK編集値を尊重）

-- 2) 公開ビュー（anon可・基テーブルapp_settingsは閉じたまま）
create or replace view public.public_class_price_v
  with (security_invoker = off) as
  select key, value from public.app_settings where key = 'hdm_keydrop_price';

grant select on public.public_class_price_v to anon;

-- 確認: select * from public_class_price_v;
