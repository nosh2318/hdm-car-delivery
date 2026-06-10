-- ============================================================
-- 009 KEYDROP 決済台帳に返金カラム追加（keydrop-refund Edge Function 用）
-- 2026-06-10 / omni
-- status は 'paid' → 'refunded' に遷移。返金額・キャンセル料・率・返金日時を記録。
-- ============================================================
alter table public.keydrop_payments
  add column if not exists refunded_at  timestamptz,
  add column if not exists refund_amount numeric,
  add column if not exists cancel_fee    numeric,
  add column if not exists cancel_rate   int;
