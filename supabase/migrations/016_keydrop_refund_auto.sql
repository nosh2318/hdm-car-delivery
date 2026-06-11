-- 016 KEYDROP 自動返金：Square refund id を保存する列を追加
-- 2026-06-11 / omni
-- keydrop-refund が承認時に Square Refunds API で実返金→ refund id を記録。
alter table public.keydrop_payments add column if not exists square_refund_id text;
