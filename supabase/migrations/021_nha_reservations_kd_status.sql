-- ============================================================
-- 021 KEYDROP 那覇拡張: nha_reservations に kd_status 列を追加
-- 2026-06-11 / omni
-- 札幌 reservations には kd_status があるが nha_reservations には無い。
-- OPシート連携(担当割当→preparing→active→delivering→completed)に必要。
-- ============================================================
alter table public.nha_reservations add column if not exists kd_status text;

-- 確認: select column_name from information_schema.columns where table_name='nha_reservations' and column_name='kd_status';
