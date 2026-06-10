-- ============================================================
-- 010 KEYDROP キャンセル依頼マーカーを keydrop_payments に追加
-- 2026-06-10 / omni
-- 理由：reservations には changed_json 列が無い（それは tasks の列）。
--   顧客のキャンセル依頼状態は KEYDROP専用の keydrop_payments に持たせ、
--   SPK(authenticated)が一覧表示する。確定で status→refunded となり一覧から外れる。
-- ============================================================
alter table public.keydrop_payments
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reason       text;
