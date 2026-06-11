-- ============================================================
-- 014 KEYDROP 予約変更リクエスト（マイページ申請→現場承認→反映）
-- 2026-06-11 / omni
-- 顧客がマイページでお届け(貸出)/回収(返却)の時間・場所の変更を「申請」→
--   keydrop_payments.change_req(jsonb) に記録（即時反映しない）→ Slack/SPK通知 →
--   SPK adminで承認すると reservations/tasks に反映、却下なら破棄。
-- 締切：お届け=出発48時間前まで / 回収=返却2時間前まで（締切後はLINE）。
-- change_req 形:
--   { "del": {"time":"10:00","place":"...","lat":43.0,"lng":141.0},   // お届け変更（任意）
--     "col": {"time":"10:00","place":"...","lat":43.0,"lng":141.0},   // 回収変更（任意）
--     "requested_at":"ISO", "status":"pending" }
-- ============================================================
alter table public.keydrop_payments add column if not exists change_req jsonb;
alter table public.keydrop_payments add column if not exists change_req_at timestamptz;

-- 公開ビュー public_keydrop_classes_v 等と同様、SPKは authenticated で keydrop_payments を直接読む（既存RLS）。
-- 顧客LPは Edge Function(keydrop-mypage) 経由でのみ申請/参照（service_role）。
