-- ============================================================
-- 008 KEYDROP 通知キュー（メール送信を確実にする台帳）
-- 2026-06-10 / omni
-- 役割:
--   Edge Function が「送るべき通知」を1行=1通として積む → GAS送信ワーカー(keydrop_mail.gs)が
--   reserve@rent-handyman.jp から送信し sent=true にする（5分ポーリング）。
--   webhook/関数から直接メールを送らず "キュー" にすることで、メール障害時も取りこぼさず再送できる。
-- type:
--   'confirm'        … 予約完了（入金確認）→ 宛先=顧客メール
--   'cancel_request' … 顧客のキャンセル依頼  → 宛先=運営メール
-- payload(jsonb): メール本文生成に必要な値（予約番号/氏名/クラス/日時/場所/金額/理由 等）
-- アクセス: anon/authenticated 不可。Edge Function(service_role)が積み、GAS(service_role)が回収。
-- ============================================================

create table if not exists public.keydrop_notifications (
  id              bigint generated always as identity primary key,
  type            text not null,                 -- confirm | cancel_request
  reservation_id  text,
  to_email        text not null,
  payload         jsonb not null default '{}'::jsonb,
  sent            boolean not null default false,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_keydrop_notif_unsent on public.keydrop_notifications (sent, created_at);

alter table public.keydrop_notifications enable row level security;
-- ポリシーを作らない＝anon/authenticated 全拒否。service_role はRLSをバイパス。
revoke all on public.keydrop_notifications from anon, authenticated;
